/**
 * Shared notification center store
 * Manages seller pending, buyer pending, and ephemeral completion notifications
 * Integrates with WebSocket for real-time updates and HTTP polling as fallback
 */

import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, watch } from 'vue'
import type { NotificationCenterItem, NotificationItemType } from '@/types'
import api from '@/api/client'
import { useAuthStore } from './auth'
import { isDemoMode } from '@/services/mockData'

const SESSION_CACHE_KEY = 'notification_ephemeral_cache'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const POLL_INTERVAL_MS = 30 * 1000
const SILENT_BACKGROUND_REQUEST = { suppressErrorToast: true, suppressErrorLog: true, timeout: 30_000 } as any

interface CachedNotification extends NotificationCenterItem {
  expiresAt: string
}

function loadEphemeralCache(): NotificationCenterItem[] {
  const raw = sessionStorage.getItem(SESSION_CACHE_KEY)
  if (!raw) return []

  try {
    const cached = JSON.parse(raw) as CachedNotification[]
    const now = new Date()

    const valid = cached.filter(item => new Date(item.expiresAt) > now)

    if (valid.length !== cached.length) {
      saveEphemeralCache(valid)
    }

    return valid
  } catch {
    sessionStorage.removeItem(SESSION_CACHE_KEY)
    return []
  }
}

function saveEphemeralCache(items: NotificationCenterItem[]): void {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MS).toISOString()

  const cached: CachedNotification[] = items.map(item => ({
    ...item,
    expiresAt,
  }))

  sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(cached))
}

function readTransfers(responseData: any): any[] {
  if (Array.isArray(responseData?.data?.transfers)) return responseData.data.transfers
  if (Array.isArray(responseData?.data)) return responseData.data
  if (Array.isArray(responseData?.transfers)) return responseData.transfers
  if (Array.isArray(responseData)) return responseData
  return []
}

function toIsoDate(value: any): string {
  if (typeof value === 'string' && value.trim()) return value
  return new Date().toISOString()
}

function transferIdOf(transfer: any): string {
  return transfer?.transferId || transfer?.transfer_id || transfer?.id || ''
}

function eventNameOf(transfer: any): string {
  return transfer?.event?.name || transfer?.eventName || transfer?.event_name || 'your ticket'
}

function seatLabelOf(transfer: any): string {
  const section = transfer?.seat?.section || transfer?.seatSection
  const row = transfer?.seat?.rowNumber || transfer?.seat?.row || transfer?.seatRow
  const seat = transfer?.seat?.seatNumber || transfer?.seat?.seat || transfer?.seatNumber

  const parts = [section ? `Section ${section}` : '', row ? `Row ${row}` : '', seat ? `Seat ${seat}` : '']
    .filter(Boolean)
  return parts.join(' · ')
}

function mapSellerPendingTransfer(transfer: any): NotificationCenterItem {
  const transferId = transferIdOf(transfer)
  const eventName = eventNameOf(transfer)
  const seatLabel = seatLabelOf(transfer)
  const buyerName = transfer?.buyerName || transfer?.buyer?.name || 'A buyer'
  const status = transfer?.status

  if (status === 'pending_seller_otp') {
    return {
      id: `seller-pending:${transferId || transfer?.listingId || Date.now()}`,
      type: 'seller_pending_otp' as NotificationItemType,
      title: 'Seller OTP Ready',
      body: `${buyerName} has verified ${eventName}${seatLabel ? ` (${seatLabel})` : ''}. Enter your seller OTP to complete the transfer.`,
      createdAt: toIsoDate(transfer?.createdAt || transfer?.created_at),
      primaryTo: transferId ? `/transfer/${transferId}` : '/notifications',
      transferId: transferId || undefined,
    }
  }

  return {
    id: `seller-pending:${transferId || transfer?.listingId || Date.now()}`,
    type: 'seller_pending_acceptance' as NotificationItemType,
    title: 'Seller Action Required',
    body: `${buyerName} wants ${eventName}${seatLabel ? ` (${seatLabel})` : ''}. Open the transfer to review the request and accept it to receive your seller OTP.`,
    createdAt: toIsoDate(transfer?.createdAt || transfer?.created_at),
    primaryTo: transferId ? `/transfer/${transferId}` : '/notifications',
    transferId: transferId || undefined,
  }
}

function mapBuyerPendingTransfer(transfer: any): NotificationCenterItem {
  const transferId = transferIdOf(transfer)
  const eventName = eventNameOf(transfer)
  const seatLabel = seatLabelOf(transfer)

  return {
    id: `buyer-pending:${transferId || transfer?.listingId || Date.now()}`,
    type: 'buyer_pending_otp' as NotificationItemType,
    title: 'Buyer OTP Ready',
    body: `Enter your buyer OTP for ${eventName}${seatLabel ? ` (${seatLabel})` : ''}. The seller will be notified after you verify.`,
    createdAt: toIsoDate(transfer?.createdAt || transfer?.created_at),
    primaryTo: transferId ? `/transfer/${transferId}` : '/notifications',
    transferId: transferId || undefined,
  }
}

export const useNotificationStore = defineStore('notifications', () => {
  const auth = useAuthStore()

  const sellerPending = ref<NotificationCenterItem[]>([])
  const buyerPending = ref<NotificationCenterItem[]>([])
  const ephemeral = ref<NotificationCenterItem[]>(loadEphemeralCache())
  const loading = ref(false)
  const lastFetch = ref<Date | null>(null)
  const initialized = ref(false)
  const realtimeConnected = ref(false)
  let pollTimer: number | undefined
  let disposed = false
  let listening = false
  let generation = 0
  let revision = 0
  let refreshQueued = false
  let activeBatch: Promise<void> | undefined
  const requests = new Map<string, { controller: AbortController; promise: Promise<boolean> }>()

  const allNotifications = computed(() => {
    const merged = [...sellerPending.value, ...buyerPending.value, ...ephemeral.value]
    const deduped = Array.from(new Map(merged.map(item => [item.id, item])).values())
    return deduped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  })

  const unreadCount = computed(() => allNotifications.value.length)

  function eligible(): boolean {
    return Boolean(auth.state.accessToken) && !auth.isStaff && !auth.isAdmin && !auth.isDemoSession && !isDemoMode()
  }

  function canRead(): boolean {
    return !disposed && eligible() && !document.hidden && navigator.onLine !== false
  }

  function startPolling(): void {
    if (pollTimer !== undefined || activeBatch || !initialized.value || !canRead() || realtimeConnected.value) return

    // Wait after completion so a slow backend cannot accumulate overlapping reads.
    pollTimer = window.setTimeout(() => {
      pollTimer = undefined
      void fetchAll()
    }, POLL_INTERVAL_MS)
  }

  function stopPolling(): void {
    if (pollTimer !== undefined) {
      window.clearTimeout(pollTimer)
      pollTimer = undefined
    }
  }

  function invalidateRequests(): void {
    generation += 1
    stopPolling()
    for (const request of requests.values()) request.controller.abort()
    requests.clear()
    activeBatch = undefined
    refreshQueued = false
    loading.value = false
  }

  function handleAvailability(): void {
    if (!initialized.value) return
    if (!canRead()) {
      invalidateRequests()
      return
    }
    // A connected socket does not guarantee events were received while suspended.
    void fetchAll()
  }

  function setListeners(enabled: boolean): void {
    if (enabled === listening) return
    listening = enabled
    if (enabled) {
      document.addEventListener('visibilitychange', handleAvailability)
      window.addEventListener('online', handleAvailability)
      window.addEventListener('offline', handleAvailability)
    } else {
      document.removeEventListener('visibilitychange', handleAvailability)
      window.removeEventListener('online', handleAvailability)
      window.removeEventListener('offline', handleAvailability)
    }
  }

  function setRealtimeConnected(connected: boolean): void {
    realtimeConnected.value = connected
    if (connected) {
      stopPolling()
      return
    }
    startPolling()
  }

  function initialize(): void {
    if (initialized.value || disposed) return
    initialized.value = true
    setListeners(true)
    void fetchAll()
  }

  function fetchPending(seller: boolean): Promise<boolean> {
    if (!canRead()) return Promise.resolve(false)
    const url = seller ? '/transfer/pending' : '/transfer/my-pending'
    const existing = requests.get(url)
    if (existing) return existing.promise
    const target = seller ? sellerPending : buyerPending
    const mapper = seller ? mapSellerPendingTransfer : mapBuyerPendingTransfer
    const controller = new AbortController()
    const requestGeneration = generation
    const requestRevision = revision
    const token = auth.state.accessToken
    const userId = auth.state.user?.userId
    const current = () => canRead() && !controller.signal.aborted &&
      requestGeneration === generation && requestRevision === revision &&
      token === auth.state.accessToken && userId === auth.state.user?.userId

    const promise = (async () => {
      try {
        const response = await api.get(url, { ...SILENT_BACKGROUND_REQUEST, signal: controller.signal })
        if (!current()) return false
        target.value = readTransfers(response.data).map(mapper)
        return true
      } catch (error: any) {
        if (current() && error?.response?.status === 404) target.value = []
        // Keep the last known list on transient failures. Axios handles these
        // background errors silently; never log request headers or user data.
        return false
      } finally {
        if (requests.get(url)?.controller === controller) requests.delete(url)
      }
    })()
    requests.set(url, { controller, promise })
    return promise
  }

  async function fetchSellerPending(): Promise<void> {
    await fetchPending(true)
  }

  async function fetchBuyerPending(): Promise<void> {
    await fetchPending(false)
  }

  function addEphemeral(item: Omit<NotificationCenterItem, 'id'>): void {
    const id = `${item.type}:${item.transferId || item.ticketId || Date.now()}`
    if (ephemeral.value.some(n => n.id === id)) return

    const notification: NotificationCenterItem = {
      ...item,
      id,
    }

    ephemeral.value = [notification, ...ephemeral.value]
    saveEphemeralCache(ephemeral.value)
  }

  function dismiss(id: string): void {
    sellerPending.value = sellerPending.value.filter(n => n.id !== id)
    buyerPending.value = buyerPending.value.filter(n => n.id !== id)
    ephemeral.value = ephemeral.value.filter(n => n.id !== id)
    saveEphemeralCache(ephemeral.value)
  }

  function fetchAll(): Promise<void> {
    if (!canRead()) return Promise.resolve()
    if (activeBatch) return activeBatch
    stopPolling()
    const batchGeneration = generation
    const batchToken = auth.state.accessToken
    const batchUserId = auth.state.user?.userId
    loading.value = true
    const batch = Promise.all([fetchPending(true), fetchPending(false)])
      .then(results => {
        if (canRead() && batchGeneration === generation && batchToken === auth.state.accessToken &&
          batchUserId === auth.state.user?.userId && results.every(Boolean) && !refreshQueued) lastFetch.value = new Date()
      })
      .finally(() => {
        if (activeBatch !== batch) return
        activeBatch = undefined
        loading.value = false
        if (refreshQueued) {
          refreshQueued = false
          void fetchAll()
        } else {
          startPolling()
        }
      })
    activeBatch = batch
    return batch
  }

  function handleTransferUpdate(payload: any): void {
    const transfer = payload?.transfer || payload || {}
    const status = transfer?.status
    const transferId = transferIdOf(transfer)
    const userId = auth.state.user?.userId

    if (!userId) return
    const isBuyer = transfer?.buyerId === userId
    const isSeller = transfer?.sellerId === userId
    const eventName = eventNameOf(transfer)

    if (status === 'completed' && (isBuyer || isSeller)) {
      if (isBuyer) {
        addEphemeral({
          type: 'transfer_completed',
          title: 'Transfer Complete',
          body: `Your purchase of ${eventName} is complete. The ticket is now in your account.`,
          createdAt: toIsoDate(transfer?.completedAt),
          primaryTo: '/tickets',
          transferId: transferId || undefined,
        })
      }
      if (isSeller) {
        addEphemeral({
          type: 'transfer_completed',
          title: 'Sale Complete',
          body: `Your transfer of ${eventName} is complete and the buyer now owns the ticket.`,
          createdAt: toIsoDate(transfer?.completedAt),
          primaryTo: '/marketplace',
          transferId: transferId || undefined,
        })
      }

      sellerPending.value = sellerPending.value.filter(n => n.transferId !== transferId)
      buyerPending.value = buyerPending.value.filter(n => n.transferId !== transferId)
    }

    if (isBuyer || isSeller) {
      // Events can supersede a response already in flight. Coalesce a burst into
      // one follow-up read and prevent that older response restoring stale items.
      revision += 1
      if (activeBatch) refreshQueued = true
      else {
        invalidateRequests()
        void fetchAll()
      }
    }
  }

  function handleTicketUpdate(payload: any): void {
    const ticketId = payload?.ticketId
    const ownerId = payload?.ownerId || payload?.newOwnerId
    const userId = auth.state.user?.userId

    if (!userId || ownerId !== userId || !ticketId) return

    addEphemeral({
      type: 'ticket_update',
      title: 'Ticket Updated',
      body: payload?.eventName
        ? `${payload.eventName} is now available in your tickets.`
        : 'A ticket was updated in your account.',
      createdAt: new Date().toISOString(),
      primaryTo: '/tickets',
      ticketId,
      transferId: payload?.transferId,
    })
  }

  function clearAll(): void {
    invalidateRequests()
    setListeners(false)
    sellerPending.value = []
    buyerPending.value = []
    ephemeral.value = []
    lastFetch.value = null
    initialized.value = false
    realtimeConnected.value = false
    stopPolling()
    saveEphemeralCache([])
  }

  watch(
    () => [auth.state.accessToken, auth.state.user?.userId, auth.isStaff, auth.isAdmin, auth.isDemoSession] as const,
    (next, previous) => {
      invalidateRequests()
      sellerPending.value = []
      buyerPending.value = []
      lastFetch.value = null
      if (next[1] !== previous[1] || !eligible()) {
        ephemeral.value = []
        saveEphemeralCache([])
      }
      if (initialized.value) void fetchAll()
    },
  )

  onScopeDispose(() => {
    disposed = true
    initialized.value = false
    invalidateRequests()
    setListeners(false)
  })

  return {
    sellerPending,
    buyerPending,
    ephemeral,
    loading,
    lastFetch,
    initialized,
    realtimeConnected,

    allNotifications,
    unreadCount,

    initialize,
    setRealtimeConnected,
    fetchAll,
    fetchSellerPending,
    fetchBuyerPending,
    addEphemeral,
    dismiss,
    handleTransferUpdate,
    handleTicketUpdate,
    startPolling,
    stopPolling,
    clearAll,
  }
})
