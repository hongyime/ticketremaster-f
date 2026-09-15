<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ArrowRightIcon, ClockIcon, CreditCardIcon, LockClosedIcon, ShieldCheckIcon, WalletIcon } from '@heroicons/vue/24/outline'
import api from '@/api/client'
import { useToast } from '@/composables/useToast'
import { isDemoMode, mockEvents } from '@/services/mockData'
import { resolveEventImage } from '@/utils/eventMedia'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const balance = ref(0)
const order = ref<any>(null)
const loading = ref(false)
const holdSeconds = ref(0)
const holdExpired = ref(false)
const ticket = ref<any>(null)
const eventName = ref('')
const trustRowRef = ref<HTMLElement | null>(null)
let holdTimer: number | undefined
let successRedirectTimer: number | undefined
const PURCHASE_REDIRECT_DELAY_MS = 1400

const seatPrice = computed(() => Number(order.value?.seat?.price || 0))
const serviceFee = computed(() => Number((seatPrice.value * 0.098).toFixed(2)))
const processingFee = computed(() => (seatPrice.value ? 4.2 : 0))
const totalAmount = computed(() => Number((seatPrice.value + serviceFee.value + processingFee.value).toFixed(2)))
const hasEnoughCredits = computed(() => balance.value >= totalAmount.value)
const remainingBalance = computed(() => Math.max(0, balance.value - totalAmount.value))

const holdDisplay = computed(() => {
  const m = Math.floor(holdSeconds.value / 60)
  const s = holdSeconds.value % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

const holdWarning = computed(() => holdSeconds.value > 0 && holdSeconds.value < 60)
const orderVenue = computed(() => order.value?.event?.venueName || order.value?.event?.venue || 'Venue TBA')
const orderDate = computed(() => {
  const value = order.value?.event?.eventDate
  if (!value) return 'Date TBA'
  return new Date(value).toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
})
const seatLabel = computed(() =>
  order.value?.seat ? `${order.value.seat.rowNumber}-${order.value.seat.seatNumber}` : 'Seat pending',
)
const orderPoster = computed(() => {
  const eventId = order.value?.eventId
  const fallbackEvent = mockEvents.find((item) => item.eventId === eventId)
  return (
    resolveEventImage({
      eventId,
      type: fallbackEvent?.type,
      context: 'checkout',
    }) || order.value?.event?.image
  )
})

const hydratePendingOrder = (rawOrder: any) => {
  const fallbackEvent = mockEvents.find((event) => event.eventId === rawOrder?.eventId)
  const fallbackSeatPrice = Number(rawOrder?.seat?.price ?? rawOrder?.event?.price ?? fallbackEvent?.price ?? 0)
  return {
    ...rawOrder,
    seat: {
      ...rawOrder?.seat,
      price: fallbackSeatPrice,
      section: rawOrder?.seat?.section || 'Selected section',
      rowNumber: rawOrder?.seat?.rowNumber || 'Seat',
      seatNumber: rawOrder?.seat?.seatNumber || 'pending',
    },
    event: {
      ...rawOrder?.event,
      name: rawOrder?.event?.name || fallbackEvent?.name || 'Selected Event',
      image: resolveEventImage({
        image: rawOrder?.event?.image,
        eventId: rawOrder?.eventId,
        type: fallbackEvent?.type,
        context: 'event',
      }),
      eventDate: rawOrder?.event?.eventDate || fallbackEvent?.date,
      venueName: rawOrder?.event?.venueName || fallbackEvent?.venue?.name,
      price: rawOrder?.event?.price ?? fallbackEvent?.price ?? 0,
    },
  }
}

const loadOrder = () => {
  const raw = localStorage.getItem('pendingOrder')
  if (!raw) return
  try {
    const parsed = JSON.parse(raw)
    // Accept if orderId matches the route param, OR if the stored inventoryId matches,
    // OR if there's only one pending order and the eventId is consistent (returning from top-up)
    const routeOrderId = String(route.params.orderId)
    const isMatch = parsed?.orderId === routeOrderId || parsed?.inventoryId === routeOrderId
    if (!isMatch) return
    order.value = hydratePendingOrder(parsed)
    const heldUntil = parsed?.heldUntil
    if (heldUntil) {
      holdSeconds.value = Math.max(0, Math.floor((new Date(heldUntil).getTime() - Date.now()) / 1000))
      if (holdSeconds.value === 0) {
        holdExpired.value = true
      } else {
        holdTimer = window.setInterval(() => {
          holdSeconds.value = Math.max(0, holdSeconds.value - 1)
          if (holdSeconds.value === 0) {
            clearInterval(holdTimer)
            holdExpired.value = true
            localStorage.removeItem('pendingOrder')
            toast.push('Your seat hold has expired. Please select a seat again.', 'error', 4000)
            router.push(order.value?.eventId ? `/events/${order.value.eventId}` : '/events')
          }
        }, 1000)
      }
    }
  } catch {
    order.value = null
  }
}

const loadEventName = async () => {
  if (!order.value?.eventId) return
  if (isDemoMode()) {
    const found = mockEvents.find((event) => event.eventId === order.value.eventId)
    eventName.value = found?.name || 'Demo Event'
    return
  }
  try {
    const { data } = await api.get(`/events/${order.value.eventId}`)
    eventName.value = data?.data?.name || data?.name || ''
  } catch {
    eventName.value = ''
  }
}

const loadBalance = async () => {
  if (isDemoMode()) {
    const stored = sessionStorage.getItem('demo_balance')
    balance.value = stored !== null ? parseFloat(stored) : 500
    return
  }
  try {
    const { data } = await api.get('/credits/balance')
    balance.value = data?.data?.creditBalance || 0
  } catch {
    balance.value = 0
  }
}

const releaseHold = async () => {
  if (isDemoMode()) {
    localStorage.removeItem('pendingOrder')
    return
  }
  const raw = localStorage.getItem('pendingOrder')
  if (!raw) return
  try {
    const parsed = JSON.parse(raw)
    const inventoryId = parsed?.inventoryId || route.params.orderId
    const holdToken = parsed?.holdToken || ''
    await api.delete(`/purchase/hold/${inventoryId}`, { data: { holdToken } })
  } catch (error) {
    console.error('Failed to release hold')
  }
  localStorage.removeItem('pendingOrder')
}

const cancel = async () => {
  await releaseHold()
  if (holdTimer) clearInterval(holdTimer)
  router.push(order.value?.eventId ? `/events/${order.value.eventId}` : '/events')
}

const scheduleSuccessRedirect = () => {
  if (successRedirectTimer) window.clearTimeout(successRedirectTimer)
  successRedirectTimer = window.setTimeout(() => {
    router.push('/tickets')
  }, PURCHASE_REDIRECT_DELAY_MS)
}

const pay = async () => {
  if (holdExpired.value) {
    toast.push('Your seat hold has expired. Please select a seat again.', 'error', 4000)
    router.push(order.value?.eventId ? `/events/${order.value.eventId}` : '/events')
    return
  }
  loading.value = true
  try {
    if (isDemoMode()) {
      await new Promise((resolve) => setTimeout(resolve, 1400))
      localStorage.removeItem('pendingOrder')
      if (holdTimer) clearInterval(holdTimer)
      const currentBalance = parseFloat(sessionStorage.getItem('demo_balance') || '500')
      sessionStorage.setItem('demo_balance', String(Math.max(0, currentBalance - totalAmount.value)))
      ticket.value = {
        ticketId: `demo-ticket-${Date.now()}`,
        eventId: order.value?.eventId || '',
        inventoryId: order.value?.inventoryId || '',
        price: totalAmount.value,
        status: 'active',
        createdAt: new Date().toISOString(),
      }
      scheduleSuccessRedirect()
      return
    }

    const inventoryId = order.value?.inventoryId || route.params.orderId
    const { data } = await api.post(
      `/purchase/confirm/${inventoryId}`,
      { holdToken: order.value?.holdToken || '', eventId: order.value?.eventId || '' },
      { headers: { 'Idempotency-Key': crypto.randomUUID() } },
    )
    localStorage.removeItem('pendingOrder')
    if (holdTimer) clearInterval(holdTimer)
    ticket.value = data?.data
    scheduleSuccessRedirect()
  } catch (error: any) {
    const errorCode = error?.response?.data?.error?.code || error?.response?.data?.error_code
    const status = error?.response?.status
    if (errorCode === 'INSUFFICIENT_CREDITS' || status === 402) {
      toast.push('Not enough credits. Redirecting to top up.', 'error', 3200)
      router.push('/credits/topup')
    } else if (errorCode === 'PAYMENT_HOLD_EXPIRED' || status === 410) {
      toast.push('Seat hold expired. Please select a seat again.', 'error', 3200)
      localStorage.removeItem('pendingOrder')
      router.push(`/events/${order.value?.eventId}`)
    } else if (errorCode === 'SEAT_UNAVAILABLE' || status === 409) {
      toast.push('Seat no longer available. Please select another.', 'error', 3200)
      router.push(`/events/${order.value?.eventId}`)
    } else if (errorCode === 'VALIDATION_ERROR' || status === 400) {
      toast.push('Invalid request. Please try again.', 'error', 3200)
    } else {
      toast.push('Payment failed. Please try again.', 'error', 3200)
    }
  } finally {
    loading.value = false
  }
}

onBeforeRouteLeave(async (to, _from, next) => {
  // Don't release the hold if user is going to top up credits - they'll return to checkout
  const isTopUp = to.path === '/credits/topup'
  if (!ticket.value && !isTopUp) await releaseHold()
  if (holdTimer) clearInterval(holdTimer)
  if (successRedirectTimer) window.clearTimeout(successRedirectTimer)
  next()
})

onMounted(async () => {
  loadOrder()
  await Promise.all([loadBalance(), loadEventName()])
  await nextTick()
  // Apply grayscale filter directly to bypass Vue's auto-prefixing
  if (trustRowRef.value) {
    trustRowRef.value.style.setProperty('filter', 'grayscale(1)')
  }
})

onUnmounted(() => {
  if (holdTimer) clearInterval(holdTimer)
  if (successRedirectTimer) window.clearTimeout(successRedirectTimer)
})
</script>

<template>
  <section class="checkout-page">
    <template v-if="ticket">
      <article class="success-shell">
        <span class="eyebrow">Purchase Complete</span>
        <h1>Ticket secured.</h1>
        <p>Your order for {{ eventName || order?.event?.name || 'this event' }} has been confirmed and moved into your wallet.</p>

        <div class="success-grid">
          <div><span class="meta-label">Ticket ID</span><strong>{{ ticket.ticketId }}</strong></div>
          <div><span class="meta-label">Status</span><strong>{{ ticket.status?.toUpperCase() || 'ACTIVE' }}</strong></div>
          <div><span class="meta-label">Price Paid</span><strong>SGD {{ Number(ticket.price ?? totalAmount).toFixed(2) }}</strong></div>
          <div><span class="meta-label">Seat</span><strong>{{ seatLabel }}</strong></div>
        </div>

        <div class="hero-actions">
          <RouterLink :to="`/tickets/${ticket.ticketId}`"><button>Show QR Code</button></RouterLink>
          <RouterLink to="/tickets"><button class="secondary">My Tickets</button></RouterLink>
        </div>
      </article>
    </template>

    <template v-else>
      <header class="checkout-header">
        <span class="eyebrow">Finalize Order</span>
        <h1>
          {{ eventName || order?.event?.name || 'Checkout' }}
        </h1>
        <div class="header-meta">
          <span>{{ orderVenue }}</span>
          <span class="meta-dot"></span>
          <span>{{ orderDate }}</span>
        </div>
      </header>

      <div class="checkout-grid">
        <section class="payment-column">
          <article class="payment-card">
            <h2>Pay with Credits</h2>

            <div class="wallet-panel">
              <div class="wallet-topline">
                <div class="wallet-identity">
                  <div class="wallet-icon-shell">
                    <WalletIcon class="wallet-icon" />
                  </div>
                  <div class="wallet-copy">
                    <span class="meta-label">Available Balance</span>
                    <strong>SGD {{ balance.toFixed(2) }}</strong>
                  </div>
                </div>
              </div>

              <div class="wallet-balance-row">
                <span class="meta-label">Remaining Balance</span>
                <strong :class="{ warning: !hasEnoughCredits }">SGD {{ remainingBalance.toFixed(2) }}</strong>
              </div>

              <label class="credit-toggle-shell" aria-label="Credit wallet enabled">
                <input checked disabled type="checkbox" class="credit-toggle-peer" />
              </label>
            </div>

            <div class="summary-lines">
              <div><span>Transaction Total</span><strong>-SGD {{ totalAmount.toFixed(2) }}</strong></div>
              <div><span>Seat Price</span><strong>SGD {{ seatPrice.toFixed(2) }}</strong></div>
              <div><span>Service Fee</span><strong>SGD {{ serviceFee.toFixed(2) }}</strong></div>
              <div><span>Processing</span><strong>SGD {{ processingFee.toFixed(2) }}</strong></div>
            </div>

            <button
              class="confirm-button"
              style="background: linear-gradient(135deg, #f97316 0%, #ff7a23 100%)"
              :disabled="loading || !hasEnoughCredits || holdExpired"
              @click="pay"
            >
              <span>{{ loading ? 'Processing...' : 'Confirm Purchase' }}</span>
              <ArrowRightIcon class="confirm-arrow" />
            </button>

            <button class="secondary cancel-button" @click="cancel">Cancel</button>

            <p class="trust-copy">Secure credit transaction • Final sale • Instant fulfillment</p>
            <p v-if="!hasEnoughCredits" class="warning-copy">Insufficient credits. Top up before this hold expires.</p>
          </article>

          <div ref="trustRowRef" class="trust-row">
            <span><ShieldCheckIcon class="trust-icon" /></span>
            <span><LockClosedIcon class="trust-icon" /></span>
            <span><CreditCardIcon class="trust-icon" /></span>
            <span><WalletIcon class="trust-icon" /></span>
          </div>
        </section>

        <aside class="summary-column">
          <article class="timer-card" :class="{ warning: holdWarning }">
            <div class="timer-time-display">
              <ClockIcon class="timer-icon" aria-hidden="true" />
              <div>
                <span class="meta-label">Time Remaining</span>
                <strong>{{ holdExpired ? 'Expired' : holdDisplay }}</strong>
              </div>
            </div>
            <div class="status-block">
              <span class="meta-label">Status</span>
              <span class="status-pill">{{ holdExpired ? 'Expired' : 'Reserved' }}</span>
            </div>
          </article>

          <article class="order-card">
            <h2>Order Summary</h2>
            <div class="order-top">
              <img v-if="orderPoster" :src="orderPoster" :alt="order?.event?.name || 'Event summary image'" />
              <div class="order-copy">
                <strong>{{ eventName || order?.event?.name || 'Held seat' }}</strong>
                <p>{{ order?.seat?.section || 'Selected section' }} • Seat {{ seatLabel }}</p>
                <span class="order-copy-price">SGD {{ seatPrice.toFixed(2) }}</span>
                <p>{{ orderDate }}</p>
              </div>
            </div>

            <div class="order-breakdown">
              <div><span>Subtotal</span><strong>SGD {{ seatPrice.toFixed(2) }}</strong></div>
              <div><span>Service Fee</span><strong>SGD {{ serviceFee.toFixed(2) }}</strong></div>
              <div><span>Processing</span><strong>SGD {{ processingFee.toFixed(2) }}</strong></div>
              <div class="order-total"><span>Total Amount</span><strong>SGD {{ totalAmount.toFixed(2) }}</strong></div>
            </div>
          </article>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.checkout-page {
  width: min(100% - 3rem, 84rem);
  margin: 0 auto;
  padding: 7.5rem 0 4.5rem;
  display: grid;
  gap: 2rem;
}

.checkout-header,
.success-shell {
  display: grid;
  gap: 1rem;
  justify-items: center;
  text-align: center;
}

.checkout-header h1,
.success-shell h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(3rem, 7vw, 5.8rem);
  font-weight: 900;
  line-height: 0.92;
  letter-spacing: -0.07em;
}

.eyebrow,
.meta-label {
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.eyebrow {
  color: var(--primary, #f97316);
}

.meta-label {
  color: rgba(255, 255, 255, 0.5);
}

.checkout-header p,
.success-shell p {
  margin: 0;
  color: var(--text-muted);
}

.header-meta {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  color: var(--text-muted);
}

.meta-dot {
  width: 0.3rem;
  height: 0.3rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
}

.checkout-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(19rem, 0.85fr);
  gap: 1.5rem;
  align-items: start;
}

.payment-column,
.summary-column {
  display: grid;
  gap: 1rem;
}

.payment-card,
.timer-card,
.order-card,
.success-shell {
  padding: 1.6rem;
  border-radius: 1.6rem;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(26, 25, 25, 0.84);
  backdrop-filter: blur(20px);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.18);
}

.payment-card {
  display: grid;
  gap: 1.4rem;
}

.payment-card h2,
.order-card h2 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.wallet-panel {
  display: grid;
  gap: 1rem;
  padding: 1.5rem;
  border-radius: 1.4rem;
  background: rgba(249, 115, 22, 0.06);
  border: 1px solid rgba(249, 115, 22, 0.16);
}

.credit-toggle-shell {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.credit-toggle-peer {
  opacity: 0;
}

.wallet-topline,
.wallet-balance-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.wallet-identity {
  display: flex;
  align-items: center;
  gap: 0.9rem;
}

.wallet-icon-shell {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: 999px;
  background: rgba(249, 115, 22, 0.16);
}

.wallet-copy {
  display: grid;
  gap: 0.2rem;
}

.wallet-icon,
.trust-icon,
.confirm-arrow,
.timer-icon {
  width: 1rem;
  height: 1rem;
}

.timer-icon {
  width: 1.4rem;
  height: 1.4rem;
  flex-shrink: 0;
  color: var(--primary, #f97316);
}

.timer-time-display {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.wallet-icon {
  color: var(--primary);
}


.wallet-copy strong,
.wallet-balance-row strong,
.timer-card strong {
  display: block;
  margin-top: 0.35rem;
  font-family: var(--font-display);
  font-size: 2rem;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.05em;
}

.summary-lines,
.order-breakdown {
  display: grid;
  gap: 0.9rem;
}

.summary-lines div,
.order-breakdown div,
.timer-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.summary-lines span,
.order-breakdown span {
  color: var(--text-muted);
}

.confirm-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding-block: 1.25rem;
  font-size: 1rem;
  font-weight: 900;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, #f97316 0%, #ff7a23 100%);
  border-radius: 999px;
  width: 100%;
  box-shadow: 0 10px 30px rgba(249, 115, 22, 0.3);
  border: 0;
  color: #fff;
}

.confirm-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

.cancel-button {
  width: 100%;
}

.trust-copy,
.warning-copy {
  text-align: center;
  line-height: 1.6;
}

.warning,
.warning-copy {
  color: #f4a44f;
}

.trust-row {
  display: flex;
  justify-content: center;
  gap: 1rem;
  flex-wrap: wrap;
  opacity: 0.58;
  color: rgba(255, 255, 255, 0.72);
  filter: grayscale(1);
  transition: filter 0.5s, opacity 0.5s;
}

.trust-row:hover {
  filter: grayscale(0);
  opacity: 1;
}

.trust-row span {
  display: grid;
  place-items: center;
  width: 2.4rem;
  height: 2.4rem;
}

.status-block {
  display: grid;
  gap: 0.35rem;
  justify-items: start;
  text-align: left;
}

.status-pill {
  padding: 0.35rem 0.65rem;
  border-radius: 999px;
  background: rgba(249, 115, 22, 0.15);
  color: var(--primary);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.order-top {
  display: grid;
  grid-template-columns: 5rem minmax(0, 1fr);
  gap: 1rem;
  margin-top: 1rem;
}

.order-top img {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 1rem;
  object-fit: cover;
}

.order-copy {
  display: grid;
  gap: 0.3rem;
}

.order-copy strong {
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.order-copy-price {
  color: var(--primary);
  font-size: 0.92rem;
  font-weight: 800;
}

.order-copy p {
  margin: 0;
  color: var(--text-muted);
  line-height: 1.5;
}

.order-breakdown {
  margin-top: 1.25rem;
  padding-top: 1.25rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.order-total {
  padding-top: 0.85rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.order-total strong,
.summary-lines strong,
.success-grid strong {
  color: #fff;
}

.success-shell {
  max-width: 54rem;
  justify-self: center;
}

.success-grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  padding: 0.5rem 0;
}

.success-grid div {
  display: grid;
  gap: 0.3rem;
  padding: 1rem;
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.03);
}

.hero-actions {
  display: flex;
  gap: 0.8rem;
  flex-wrap: wrap;
}

@media (max-width: 900px) {
  .checkout-grid,
  .success-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .checkout-page {
    width: min(100% - 1rem, 84rem);
    padding-top: 6.5rem;
  }

  .header-meta,
  .timer-card {
    align-items: start;
  }

  .meta-dot {
    display: none;
  }
}
</style>
