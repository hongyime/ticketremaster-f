import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useAuthStore } from '@/stores/auth'
import { useNotificationStore } from '@/stores/notifications'

const mocks = vi.hoisted(() => ({ get: vi.fn(), demo: false }))
vi.mock('@/api/client', () => ({ default: { get: mocks.get } }))
vi.mock('@/services/mockData', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/mockData')>(),
  isDemoMode: () => mocks.demo,
  setDemoMode: (enabled: boolean) => { mocks.demo = enabled },
}))

type Store = ReturnType<typeof useNotificationStore>
type Auth = ReturnType<typeof useAuthStore>
type Pending = { url: string; signal?: AbortSignal; resolve: (value: unknown) => void; reject: (error: unknown) => void }
let store: Store
let auth: Auth
let hidden = false
let online = true

function session(userId = 'fixture-user-a') {
  auth.setSession({
    access_token: `${userId}-token`, refresh_token: 'fixture-refresh',
    user: { userId, email: 'fixture@example.invalid', phoneNumber: '', role: 'user', isFlagged: false, isAdmin: false },
  })
}
function response(transfers: unknown[] = []) { return { data: { data: { transfers } } } }
function deferredRequests() {
  const pending: Pending[] = []
  mocks.get.mockImplementation((url: string, config: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
    pending.push({ url, signal: config?.signal, resolve, reject })
  }))
  return pending
}
function visibility(value: boolean) {
  hidden = value
  document.dispatchEvent(new Event('visibilitychange'))
}
function connectivity(value: boolean) {
  online = value
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  localStorage.clear()
  sessionStorage.clear()
  hidden = false
  online = true
  mocks.demo = false
  mocks.get.mockReset().mockResolvedValue(response())
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible')
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
  setActivePinia(createPinia())
  auth = useAuthStore()
  session()
  store = useNotificationStore()
})
afterEach(() => {
  store.clearAll()
  store.$dispose()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('notification request lifecycle', () => {
  it('shares overlapping initialization, navigation and manual refresh requests', async () => {
    const requests = deferredRequests()
    store.initialize()
    const refresh = store.fetchAll()
    const anotherRefresh = store.fetchAll()
    expect(mocks.get).toHaveBeenCalledTimes(2)
    requests.forEach(request => request.resolve(response()))
    await Promise.all([refresh, anotherRefresh])
    expect(store.loading).toBe(false)
  })

  it('does not overlap a slow pair of requests with fallback ticks', async () => {
    const requests = deferredRequests()
    store.initialize()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(mocks.get).toHaveBeenCalledTimes(2)
    requests.forEach(request => request.resolve(response()))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(mocks.get).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.get).toHaveBeenCalledTimes(4)
  })

  it('pauses hidden-tab polling and fetches once on return to the page', async () => {
    store.initialize()
    await flushPromises()
    visibility(true)
    await vi.advanceTimersByTimeAsync(90_000)
    expect(mocks.get).toHaveBeenCalledTimes(2)
    visibility(false)
    await flushPromises()
    expect(mocks.get).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.get).toHaveBeenCalledTimes(6)
  })

  it('does not initialize network reads while hidden or offline', async () => {
    hidden = true
    online = false
    store.initialize()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.get).not.toHaveBeenCalled()
    visibility(false)
    expect(mocks.get).not.toHaveBeenCalled()
    connectivity(true)
    await flushPromises()
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it('keeps realtime updates active without scheduled HTTP polls', async () => {
    store.initialize()
    await flushPromises()
    store.setRealtimeConnected(true)
    await vi.advanceTimersByTimeAsync(90_000)
    expect(mocks.get).toHaveBeenCalledTimes(2)
    store.handleTransferUpdate({ transferId: 'fixture-transfer', buyerId: 'fixture-user-a', status: 'pending_seller_otp' })
    await flushPromises()
    expect(mocks.get).toHaveBeenCalledTimes(4)
    store.setRealtimeConnected(false)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.get).toHaveBeenCalledTimes(6)
  })

  it('refreshes on visibility return even when the socket remained connected', async () => {
    store.initialize()
    await flushPromises()
    store.setRealtimeConnected(true)
    visibility(true)
    visibility(false)
    await flushPromises()
    expect(mocks.get).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.get).toHaveBeenCalledTimes(4)
  })

  it('aborts hidden requests and ignores their eventual responses', async () => {
    const requests = deferredRequests()
    store.initialize()
    visibility(true)
    expect(requests.every(request => request.signal?.aborted)).toBe(true)
    requests.forEach(request => request.resolve(response([{ transferId: 'stale-transfer' }])))
    await flushPromises()
    expect(store.allNotifications).toEqual([])
    expect(store.lastFetch).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('ignores requests that finish after clearAll and does not restart polling', async () => {
    const requests = deferredRequests()
    store.initialize()
    store.clearAll()
    requests.forEach(request => request.resolve(response([{ transferId: 'old-session-transfer' }])))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(store.allNotifications).toEqual([])
    expect(store.lastFetch).toBeNull()
    expect(store.loading).toBe(false)
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it('never publishes the previous user’s response into a replacement session', async () => {
    const requests = deferredRequests()
    store.initialize()
    session('fixture-user-b')
    await flushPromises()
    expect(mocks.get).toHaveBeenCalledTimes(4)
    requests.slice(0, 2).forEach(request => request.resolve(response([{ transferId: 'user-a-private-transfer' }])))
    await flushPromises()
    expect(store.allNotifications).toEqual([])
    requests.slice(2).forEach(request => request.resolve(response([{ transferId: 'user-b-transfer' }])))
    await flushPromises()
    expect(store.allNotifications.every(item => item.transferId === 'user-b-transfer')).toBe(true)
    expect(store.allNotifications).toHaveLength(2)
  })

  it('queues one fresh pair when realtime events arrive during an existing fetch', async () => {
    const requests = deferredRequests()
    store.initialize()
    store.setRealtimeConnected(true)
    store.handleTransferUpdate({ transferId: 'fixture-transfer', buyerId: 'fixture-user-a', status: 'completed' })
    store.handleTransferUpdate({ transferId: 'fixture-transfer', buyerId: 'fixture-user-a', status: 'completed' })
    expect(mocks.get).toHaveBeenCalledTimes(2)
    requests.slice(0, 2).forEach(request => request.resolve(response([{ transferId: 'stale-pending-transfer' }])))
    await flushPromises()
    expect(mocks.get).toHaveBeenCalledTimes(4)
    expect(store.sellerPending).toEqual([])
    expect(store.buyerPending).toEqual([])
    requests.slice(2).forEach(request => request.resolve(response()))
    await flushPromises()
    expect(store.ephemeral).toHaveLength(1)
    expect(store.sellerPending).toEqual([])
    expect(store.buyerPending).toEqual([])
  })

  it('stops listeners, outstanding requests and timers when the store is disposed', async () => {
    const requests = deferredRequests()
    store.initialize()
    store.$dispose()
    expect(requests.every(request => request.signal?.aborted)).toBe(true)
    visibility(true)
    visibility(false)
    connectivity(false)
    connectivity(true)
    requests.forEach(request => request.resolve(response([{ transferId: 'disposed-transfer' }])))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.get).toHaveBeenCalledTimes(2)
    expect(store.allNotifications).toEqual([])
  })

  it('aborts offline reads and performs one catch-up pair on reconnection', async () => {
    const requests = deferredRequests()
    store.initialize()
    connectivity(false)
    expect(requests.every(request => request.signal?.aborted)).toBe(true)
    await vi.advanceTimersByTimeAsync(90_000)
    expect(mocks.get).toHaveBeenCalledTimes(2)
    connectivity(true)
    expect(mocks.get).toHaveBeenCalledTimes(4)
    requests.slice(0, 2).forEach(request => request.resolve(response([{ transferId: 'offline-stale' }])))
    await flushPromises()
    expect(store.loading).toBe(true)
    expect(store.allNotifications).toEqual([])
    requests.slice(2).forEach(request => request.resolve(response()))
    await flushPromises()
    expect(store.loading).toBe(false)
  })

  it('invalidates late responses when auth logs out without the root component', async () => {
    const requests = deferredRequests()
    store.initialize()
    auth.clearSession()
    requests.forEach(request => request.resolve(response([{ transferId: 'private-before-logout' }])))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(store.allNotifications).toEqual([])
    expect(store.lastFetch).toBeNull()
    expect(store.loading).toBe(false)
    expect(requests.every(request => request.signal?.aborted)).toBe(true)
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it('retains the last known notifications and refresh time on transient failures without logging private errors', async () => {
    mocks.get.mockResolvedValue(response([{ transferId: 'retained-transfer' }]))
    await store.fetchAll()
    const lastFetch = store.lastFetch
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warningLog = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.get.mockRejectedValue({ response: { status: 503 }, config: { headers: { Authorization: 'fixture-private' } } })
    await vi.advanceTimersByTimeAsync(1_000)
    await store.fetchAll()
    expect(store.allNotifications).toHaveLength(2)
    expect(store.lastFetch).toEqual(lastFetch)
    expect(errorLog).not.toHaveBeenCalled()
    expect(warningLog).not.toHaveBeenCalled()
  })

  it('keeps direct endpoint calls isolated and shares them with a concurrent full refresh', async () => {
    const requests = deferredRequests()
    const seller = store.fetchSellerPending()
    expect(requests.map(request => request.url)).toEqual(['/transfer/pending'])
    const all = store.fetchAll()
    const buyer = store.fetchBuyerPending()
    expect(requests.map(request => request.url)).toEqual(['/transfer/pending', '/transfer/my-pending'])
    requests.forEach(request => request.resolve(response([{ transferId: 'fixture-transfer', status: 'pending_seller_otp' }])))
    await Promise.all([seller, buyer, all])
    expect(store.sellerPending[0]?.type).toBe('seller_pending_otp')
    expect(store.buyerPending[0]?.type).toBe('buyer_pending_otp')
    expect(store.allNotifications.every(item => item.primaryTo === '/transfer/fixture-transfer')).toBe(true)
  })

  it('clears account-specific completion notices when switching users', async () => {
    store.initialize()
    await flushPromises()
    store.handleTransferUpdate({ transferId: 'fixture-completion', buyerId: 'fixture-user-a', status: 'completed' })
    expect(store.ephemeral).toHaveLength(1)
    session('fixture-user-b')
    await flushPromises()
    expect(store.ephemeral).toEqual([])
    expect(JSON.parse(sessionStorage.getItem('notification_ephemeral_cache')!)).toEqual([])
  })

  it('can initialize again after cleanup without duplicate event listeners', async () => {
    store.initialize()
    await flushPromises()
    store.clearAll()
    store.initialize()
    store.initialize()
    await flushPromises()
    expect(mocks.get).toHaveBeenCalledTimes(4)
    visibility(true)
    visibility(false)
    await flushPromises()
    expect(mocks.get).toHaveBeenCalledTimes(6)
  })

  for (const mode of ['logged-out', 'staff', 'admin', 'demo'] as const) {
    it(`makes no notification reads for ${mode}`, async () => {
      if (mode === 'logged-out') auth.clearSession()
      if (mode === 'staff' || mode === 'admin') auth.state.user!.role = mode
      if (mode === 'demo') auth.demoLogin('user')
      store.initialize()
      await store.fetchAll()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(mocks.get).not.toHaveBeenCalled()
    })
  }
})
