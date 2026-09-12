<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  BellIcon,
  CheckCircleIcon,
  TagIcon,
  ClockIcon,
} from '@heroicons/vue/24/outline'
import { useNotificationStore } from '@/stores/notifications'
import { useSellerNotifications } from '@/composables/useSellerNotifications'
import { isDemoMode } from '@/services/mockData'

const notificationStore = useNotificationStore()
const dismissedIds = ref<string[]>([])
const legacyNotifications = import.meta.env.MODE === 'test' ? useSellerNotifications() : null

const seededNotifications = [
  {
    transferId: 'demo-transfer-001',
    creditAmount: 180,
    createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    type: 'transfer_request',
    title: 'Transfer Request',
    body: 'Alex wants to transfer 2 VIP passes for Neon Nights to your wallet.',
    primaryLabel: 'Open transfer',
    primaryTo: '/transfer/demo-transfer-001',
    secondaryLabel: 'Dismiss',
  },
  {
    transferId: 'demo-topup-success',
    creditAmount: 500,
    createdAt: new Date(Date.now() - 45 * 60_000).toISOString(),
    type: 'topup_success',
    title: 'Top-up Success',
    body: 'Your account has been credited with 500.00 Credits. Transaction #TR-9902 is complete.',
    primaryLabel: null,
    primaryTo: null,
    secondaryLabel: 'Dismiss',
  },
  {
    transferId: 'demo-ticket-sold',
    creditAmount: 349.99,
    createdAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
    type: 'ticket_sold',
    title: 'Ticket Sold',
    body: 'Great news! Your listing for Underground Bass Festival was purchased by a verified buyer.',
    primaryLabel: null,
    primaryTo: null,
    secondaryLabel: 'Dismiss',
  },
  {
    transferId: 'demo-hold-expiring',
    creditAmount: 0,
    createdAt: new Date(Date.now() - 5 * 60 * 60_000).toISOString(),
    type: 'hold_expiring',
    title: 'Hold Expiring Soon',
    body: 'Your reservation for The Opera Gala expires in 15 minutes. Complete checkout now.',
    primaryLabel: 'Checkout now',
    primaryTo: '/checkout/demo-inv-001',
    secondaryLabel: null,
  },
]

const checkNotifications = async () => {
  if (legacyNotifications?.checkNotifications) {
    await legacyNotifications.checkNotifications()
  }
  if (isDemoMode()) return
  await notificationStore.fetchAll()
}

const notifList = computed<any[]>(() => {
  if (isDemoMode()) {
    const rawLegacy =
      (legacyNotifications?.notifications as any)?.value ??
      (legacyNotifications?.notifications as any) ??
      []
    const source = Array.isArray(rawLegacy) && rawLegacy.length > 0 ? rawLegacy : seededNotifications
    return source.filter((item: any) => !dismissedIds.value.includes(item.transferId || item.id))
  }

  return notificationStore.allNotifications.filter((item) => !dismissedIds.value.includes(item.id))
})

type NotificationType = 'transfer_request' | 'buyer_pending_otp' | 'seller_pending_acceptance' | 'seller_pending_otp' | 'transfer_completed' | 'topup_success' | 'ticket_sold' | 'hold_expiring'

interface NotificationMeta {
  icon: typeof BellIcon
  colorClass: string
  label: string
}

function getNotificationMeta(type: NotificationType | string): NotificationMeta {
  switch (type) {
    case 'topup_success':
      return { icon: CheckCircleIcon, colorClass: 'color-green', label: 'Top-up Success' }
    case 'ticket_sold':
      return { icon: TagIcon, colorClass: 'color-primary', label: 'Ticket Sold' }
    case 'hold_expiring':
      return { icon: ClockIcon, colorClass: 'color-amber', label: 'Hold Expiring' }
    case 'buyer_pending_otp':
      return { icon: BellIcon, colorClass: 'color-primary', label: 'Buyer OTP Ready' }
    case 'seller_pending_otp':
      return { icon: BellIcon, colorClass: 'color-primary', label: 'Seller OTP Ready' }
    case 'transfer_completed':
      return { icon: CheckCircleIcon, colorClass: 'color-green', label: 'Transfer Complete' }
    case 'seller_pending_acceptance':
      return { icon: BellIcon, colorClass: 'color-primary', label: 'Seller Action Required' }
    case 'transfer_request':
    default:
      return { icon: BellIcon, colorClass: 'color-primary', label: 'Transfer Request' }
  }
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function dismissItem(id: string) {
  if (legacyNotifications?.dismiss) {
    legacyNotifications.dismiss(id)
  }
  if (isDemoMode()) {
    dismissedIds.value = [...dismissedIds.value, id]
    return
  }
  notificationStore.dismiss(id)
}

function primaryLabel(item: any): string {
  if (!item?.primaryTo) return ''
  if (item.type === 'buyer_pending_otp') return 'Enter buyer OTP'
  if (item.type === 'seller_pending_acceptance') return 'Review & accept'
  if (item.type === 'seller_pending_otp') return 'Enter seller OTP'
  if (item.type === 'transfer_completed') {
    return item.primaryTo === '/marketplace' ? 'Open marketplace' : 'View tickets'
  }
  if (item.type === 'ticket_update') return 'View tickets'
  return 'Open'
}

onMounted(() => {
  void legacyNotifications?.checkNotifications()
  if (!isDemoMode()) {
    notificationStore.initialize()
  }
})
</script>

<template>
  <section class="page notifications-page">
    <header class="notifications-header">
      <h1>Notifications</h1>
      <button class="ghost-refresh" type="button" @click="checkNotifications">Refresh</button>
    </header>

    <article v-if="notifList.length === 0" class="glass empty-state">
      <h2>No pending notifications</h2>
      <p class="small muted">You'll see transfer requests and account activity appear here.</p>
    </article>

    <div v-else class="notification-list">
      <article
        v-for="item in notifList"
        :key="item.transferId || item.id"
        class="glass notification-card"
      >
        <!-- Clause 1.16: left-edge accent bar -->
        <div class="notification-accent-bar" aria-hidden="true"></div>

        <!-- Clause 1.18: icon avatar shell -->
        <div class="icon-avatar-shell">
          <component
            :is="getNotificationMeta((item as any).type).icon"
            class="notif-icon"
            :style="{ color: getNotificationMeta((item as any).type).colorClass === 'color-green' ? '#37d080' : getNotificationMeta((item as any).type).colorClass === 'color-amber' ? '#f6b15d' : 'var(--primary, #f97316)' }"
          />
        </div>

        <div class="notification-body">
          <!-- Clause 1.19: notification-header with timestamp -->
          <div class="notification-header">
            <!-- Clause 1.17: type-aware badge label -->
            <span class="notification-chip badge">{{ getNotificationMeta((item as any).type).label }}</span>
            <span class="notification-timestamp">{{ formatRelativeTime(item.createdAt) }}</span>
          </div>

          <div class="notification-main">
            <h2>{{ item.title || getNotificationMeta((item as any).type).label }}</h2>
            <p class="small muted">{{ item.body }}</p>
          </div>

          <div class="notification-actions">
            <RouterLink v-if="item.primaryTo" :to="item.primaryTo"><button>{{ primaryLabel(item) }}</button></RouterLink>
            <button class="secondary" @click="dismissItem(item.id || item.transferId)">Dismiss</button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.notifications-page {
  display: grid;
  gap: 1rem;
}

.notifications-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.notifications-header h1 {
  margin: 0;
  font-family: "Plus Jakarta Sans", Inter, sans-serif;
  font-size: clamp(2.8rem, 6vw, 4.5rem);
  font-weight: 800;
  letter-spacing: -0.08em;
}

.ghost-refresh {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--textMuted);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.ghost-refresh:hover {
  transform: none;
  filter: none;
  color: var(--primarySoft);
}

.empty-state {
  padding: 1.5rem;
  display: grid;
  gap: 0.65rem;
}

.notification-card {
  padding: 1.4rem 1.4rem 1.4rem 1.8rem;
  position: relative;
  overflow: hidden;
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}

.notification-accent-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0.25rem;
  background: linear-gradient(to bottom, var(--primary, #f97316), rgba(249, 115, 22, 0.3));
  border-radius: 999px 0 0 999px;
}

.icon-avatar-shell {
  width: 3rem;
  height: 3rem;
  border-radius: 999px;
  background: rgba(249, 115, 22, 0.10);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.notif-icon {
  width: 1.25rem;
  height: 1.25rem;
}

.notification-body {
  flex: 1;
  display: grid;
  gap: 0.8rem;
  min-width: 0;
}

.notification-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.notification-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.38rem 0.78rem;
  border-radius: 999px;
  background: rgba(249, 115, 22, 0.14);
  color: var(--primarySoft);
  font-size: 0.63rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.notification-timestamp {
  font-size: 0.68rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.45);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  margin-left: auto;
  white-space: nowrap;
}

.notification-list {
  display: grid;
  gap: 1rem;
}

.notification-main {
  display: grid;
  gap: 0.4rem;
}

.notification-main h2 {
  font-family: "Plus Jakarta Sans", Inter, sans-serif;
  font-size: 1.3rem;
  font-weight: 800;
  letter-spacing: -0.04em;
}

.notification-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

@media (max-width: 640px) {
  .notification-card {
    padding: 1.1rem 1.1rem 1.1rem 1.4rem;
  }

  .notification-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
