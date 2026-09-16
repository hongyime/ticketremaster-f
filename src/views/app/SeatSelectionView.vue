<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { isDemoMode, mockServices } from '@/services/mockData'
import { resolveEventImage } from '@/utils/eventMedia'
import type { Event } from '@/types'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToast()

interface Seat {
  inventoryId: string
  seatId: string
  rowNumber: string
  seatNumber: string
  status: 'AVAILABLE' | 'HELD' | 'SOLD'
  heldUntil?: string | null
  section?: string
  price?: number
}

interface SeatRowGroup {
  label: string
  seats: Seat[]
}

interface SeatSectionGroup {
  section: string
  rows: SeatRowGroup[]
}

const sections = ref<SeatSectionGroup[]>([])
const selectedSeat = ref<Seat | null>(null)
const holdSeconds = ref(0)
const orderId = ref('')
const loading = ref(false)
const eventData = ref<Event | null>(null)
let timer: number | undefined
const SILENT_HOLD_RESUME_REQUEST = { suppressErrorToast: true, suppressErrorLog: true } as any

const holdDisplay = computed(() => {
  const m = Math.floor(holdSeconds.value / 60)
  const s = holdSeconds.value % 60
  return `${m}:${String(s).padStart(2, '0')}`
})

const totalAvailable = computed(() =>
  sections.value.reduce(
    (count, section) => count + section.rows.reduce((rowCount, row) => rowCount + row.seats.filter((seat) => seat.status === 'AVAILABLE').length, 0),
    0,
  ),
)

const subtotal = computed(() => selectedSeat.value?.price ?? eventData.value?.price ?? 0)
const serviceFee = computed(() => (subtotal.value ? Math.max(12.5, subtotal.value * 0.11) : 0))
const totalAmount = computed(() => subtotal.value + serviceFee.value)

const eventDateLabel = computed(() => {
  if (!eventData.value?.date) return 'Date TBA'
  return new Date(eventData.value.date).toLocaleDateString('en-SG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
})

const setSectionsFromSeats = (rawSeats: any[]) => {
  const sectionMap = new Map<string, Map<string, Seat[]>>()

  for (const rawSeat of rawSeats) {
    const sectionName = rawSeat.section || 'General Admission'
    const rowName = rawSeat.rowNumber ?? 'GA'
    const seat: Seat = {
      inventoryId: rawSeat.inventoryId,
      seatId: rawSeat.seatId,
      rowNumber: rowName,
      seatNumber: rawSeat.seatNumber ?? rawSeat.inventoryId?.slice?.(-4) ?? '--',
      status: (rawSeat.status ?? 'available').toUpperCase() as Seat['status'],
      heldUntil: rawSeat.heldUntil,
      section: sectionName,
      price: Number(rawSeat.price ?? eventData.value?.price ?? 0),
    }

    if (!sectionMap.has(sectionName)) sectionMap.set(sectionName, new Map())
    const rowsForSection = sectionMap.get(sectionName)!
    if (!rowsForSection.has(rowName)) rowsForSection.set(rowName, [])
    rowsForSection.get(rowName)!.push(seat)
  }

  sections.value = [...sectionMap.entries()].map(([section, rowMap]) => ({
    section,
    rows: [...rowMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([label, seats]) => ({
        label,
        seats: seats.sort((a, b) => a.seatNumber.localeCompare(b.seatNumber, undefined, { numeric: true })),
      })),
  }))
}

const loadEvent = async () => {
  try {
    const eventId = String(route.params.eventId)
    if (isDemoMode() || eventId.startsWith('demo-')) {
      eventData.value = await mockServices.getEvent(eventId)
      return
    }
    const { data } = await api.get(`/events/${eventId}`)
    eventData.value = data?.data
      ? {
          ...data.data,
          image: resolveEventImage({
            image: data.data.image,
            eventId,
            type: data.data.type,
            context: 'event',
          }),
        }
      : null
  } catch {
    try {
      eventData.value = await mockServices.getEvent(String(route.params.eventId))
    } catch {
      eventData.value = null
    }
  }
}

const loadSeats = async () => {
  loading.value = true
  try {
    if (isDemoMode()) {
      const result = await mockServices.getSeats(String(route.params.eventId))
      setSectionsFromSeats(result.seats)
      return
    }
    const { data } = await api.get(`/events/${route.params.eventId}/seats`)
    const rawSeats: any[] = data?.data?.seats || []
    setSectionsFromSeats(rawSeats)
  } catch (e) {
    try {
      const result = await mockServices.getSeats(String(route.params.eventId))
      setSectionsFromSeats(result.seats)
      toast.push('Showing demo seat map.', 'info', 2800)
    } catch {
      console.error('Failed to load event or seats')
      toast.push('Failed to load seat map.', 'error', 3200)
    }
  } finally {
    loading.value = false
  }
}

const readResumablePendingOrder = () => {
  try {
    const raw = localStorage.getItem('pendingOrder')
    if (!raw) return null

    const parsed = JSON.parse(raw)
    const heldUntil = parsed?.heldUntil
    const storedEventId = String(parsed?.eventId || '')
    const currentEventId = String(route.params.eventId)

    if (!heldUntil || storedEventId !== currentEventId) return null

    const secondsLeft = Math.max(0, Math.floor((new Date(heldUntil).getTime() - Date.now()) / 1000))
    if (secondsLeft <= 0) {
      localStorage.removeItem('pendingOrder')
      return null
    }

    return parsed
  } catch {
    localStorage.removeItem('pendingOrder')
    return null
  }
}

const selectSeat = async (seat: Seat) => {
  selectedSeat.value = seat

  const eventId = String(route.params.eventId)
  if (isDemoMode() || eventId.startsWith('demo-')) return

  try {
    const { data } = await api.get(`/events/${eventId}/seats/${seat.inventoryId}`)
    const raw = data?.data
    if (!raw) return

    selectedSeat.value = {
      ...seat,
      inventoryId: raw.inventoryId || seat.inventoryId,
      seatId: raw.seatId || seat.seatId,
      rowNumber: raw.rowNumber ?? seat.rowNumber,
      seatNumber: raw.seatNumber ?? seat.seatNumber,
      status: (raw.status ?? seat.status).toUpperCase() as Seat['status'],
      heldUntil: raw.heldUntil ?? seat.heldUntil,
      section: raw.section || seat.section,
      price: Number(raw.price ?? seat.price ?? eventData.value?.price ?? 0),
    }
  } catch {
    // Keep the optimistic local seat selection if the detail lookup fails.
  }
}

const reserveSeat = async () => {
  if (!selectedSeat.value || !auth.state.user) return

  try {
    const inventoryId = selectedSeat.value.inventoryId
    const selectedPrice = selectedSeat.value.price ?? eventData.value?.price ?? 0

    if (isDemoMode()) {
      holdSeconds.value = 300
      if (timer) clearInterval(timer)
      timer = window.setInterval(() => {
        holdSeconds.value = Math.max(0, holdSeconds.value - 1)
      }, 1000)
      orderId.value = inventoryId
      localStorage.setItem(
        'pendingOrder',
        JSON.stringify({
          orderId: orderId.value,
          inventoryId: orderId.value,
          holdToken: 'demo-hold-token',
          heldUntil: new Date(Date.now() + 300000).toISOString(),
          eventId: route.params.eventId,
          seat: {
            seatId: selectedSeat.value.seatId,
            rowNumber: selectedSeat.value.rowNumber,
            seatNumber: selectedSeat.value.seatNumber,
            price: selectedPrice,
            section: selectedSeat.value.section,
          },
        event: {
          name: eventData.value?.name || 'Selected Event',
          image: eventData.value?.image,
          eventDate: eventData.value?.date,
          venueName: eventData.value?.venue?.name,
        },
      }),
      )
      toast.push('Seat held. You have 5 minutes to finish checkout.', 'success', 3200)
      return
    }

    const { data } = await api.post(`/purchase/hold/${inventoryId}`)
    const heldUntil = data?.data?.heldUntil || data?.data?.held_until
    holdSeconds.value = heldUntil
      ? Math.max(0, Math.floor((new Date(heldUntil).getTime() - Date.now()) / 1000))
      : 300
    if (timer) clearInterval(timer)
    timer = window.setInterval(() => {
      holdSeconds.value = Math.max(0, holdSeconds.value - 1)
    }, 1000)
    orderId.value = data?.data?.inventoryId || inventoryId
    localStorage.setItem(
      'pendingOrder',
      JSON.stringify({
        orderId: orderId.value,
        inventoryId: orderId.value,
        holdToken: data?.data?.holdToken || '',
        heldUntil: heldUntil || new Date(Date.now() + 300000).toISOString(),
        eventId: route.params.eventId,
        seat: {
          seatId: selectedSeat.value.seatId,
          rowNumber: selectedSeat.value.rowNumber,
          seatNumber: selectedSeat.value.seatNumber,
          price: selectedPrice,
          section: selectedSeat.value.section,
        },
        event: {
          name: eventData.value?.name,
          image: eventData.value?.image,
          eventDate: eventData.value?.date,
          venueName: eventData.value?.venue?.name,
        },
      }),
    )
    toast.push('Seat held. You have 5 minutes to finish checkout.', 'success', 3200)
  } catch (e: any) {
    const code = e?.response?.data?.error?.code
    const status = e?.response?.status
    const message =
      code === 'SEAT_UNAVAILABLE' || status === 409
        ? 'Seat is no longer available.'
        : code === 'EVENT_ENDED' || status === 410
          ? 'Event has ended.'
          : 'Unable to reserve seat.'
    toast.push(message, 'error', 3200)
  }
}

onMounted(async () => {
  await loadEvent()
  await loadSeats()

  // Check if user already has an active hold for this event (e.g. returning from top-up)
  const existingPendingOrder = readResumablePendingOrder()
  if (!isDemoMode() && auth.state.user && existingPendingOrder) {
    try {
      const eventId = String(route.params.eventId)
      const { data } = await api.get(`/purchase/hold/resume/${eventId}`, SILENT_HOLD_RESUME_REQUEST)
      const hold = data?.data
      if (hold?.inventoryId && hold?.heldUntil) {
        const secondsLeft = Math.max(0, Math.floor((new Date(hold.heldUntil).getTime() - Date.now()) / 1000))
        if (secondsLeft > 0) {
          // Restore the hold into localStorage and redirect straight to checkout
          localStorage.setItem('pendingOrder', JSON.stringify({
            orderId: hold.inventoryId || existingPendingOrder?.orderId,
            inventoryId: hold.inventoryId || existingPendingOrder?.inventoryId,
            holdToken: hold.holdToken || existingPendingOrder?.holdToken || '',
            heldUntil: hold.heldUntil || existingPendingOrder?.heldUntil,
            eventId,
            seat: {
              seatId: hold.seat?.seatId || existingPendingOrder?.seat?.seatId,
              rowNumber: hold.seat?.rowNumber || existingPendingOrder?.seat?.rowNumber,
              seatNumber: hold.seat?.seatNumber || existingPendingOrder?.seat?.seatNumber,
              price: hold.seat?.price ?? existingPendingOrder?.seat?.price ?? eventData.value?.price ?? 0,
              section: hold.seat?.section || existingPendingOrder?.seat?.section,
            },
            event: {
              name: hold.event?.name ?? existingPendingOrder?.event?.name ?? eventData.value?.name,
              image: hold.event?.image ?? existingPendingOrder?.event?.image ?? eventData.value?.image,
              eventDate: hold.event?.date ?? existingPendingOrder?.event?.eventDate ?? eventData.value?.date,
              venueName: hold.event?.venueName ?? existingPendingOrder?.event?.venueName ?? eventData.value?.venue?.name,
            },
          }))
          toast.push('Resuming your existing seat hold.', 'info', 3000)
          router.push(`/checkout/${hold.inventoryId}`)
          return
        }
      }
    } catch (e: any) {
      // 404 = no active hold, that's fine - continue normally
      if (e?.response?.status === 404) {
        localStorage.removeItem('pendingOrder')
      } else {
        console.warn('Could not check for existing hold')
      }
    }
  }
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <section class="seat-page">
    <header class="seat-header">
      <span class="seat-pill">Live Selection</span>
      <h1>{{ eventData?.name || 'Seat Selection' }}</h1>
      <div class="seat-meta">
        <span>{{ eventData?.venue?.name || 'Venue TBA' }}</span>
        <span class="seat-dot"></span>
        <span>{{ eventDateLabel }}</span>
      </div>
    </header>

    <div class="seat-layout">
      <section class="seat-map-card">
        <div class="seat-map-top">
          <h2>Floor Level Selection</h2>
          <div class="seat-legend">
            <span><i class="legend-box available"></i>Available</span>
            <span><i class="legend-box selected"></i>Selected</span>
            <span><i class="legend-box sold"></i>Sold</span>
          </div>
        </div>

        <div class="stage-rail">
          <span>Stage Front</span>
        </div>

        <div v-if="loading" class="seat-loading">Loading seat map...</div>

        <div v-else class="seat-sections">
          <article v-for="section in sections" :key="section.section" class="seat-section">
            <div class="seat-section-header">
              <h3>{{ section.section }}</h3>
              <span>{{ section.rows.length }} rows</span>
            </div>

            <div v-for="row in section.rows" :key="`${section.section}-${row.label}`" class="seat-row">
              <span class="row-label">{{ row.label }}</span>
              <div class="seat-track">
                <button
                  v-for="seat in row.seats"
                  :key="seat.inventoryId"
                  class="seat-tile"
                  :class="{
                    available: seat.status === 'AVAILABLE',
                    held: seat.status === 'HELD',
                    sold: seat.status === 'SOLD',
                    chosen: selectedSeat?.inventoryId === seat.inventoryId
                  }"
                  :disabled="seat.status !== 'AVAILABLE'"
                  @click="selectSeat(seat)"
                >
                  {{ seat.seatNumber }}
                </button>
              </div>
            </div>
          </article>

          <div v-if="sections.length === 0" class="seat-loading">No seats available for this event.</div>
        </div>
      </section>

      <aside class="seat-sidebar">
        <article class="sidebar-card timer-card">
          <div>
            <span class="mini-label">Time Remaining</span>
            <strong>{{ holdSeconds > 0 ? holdDisplay : '05:00' }}</strong>
          </div>
          <div class="status-block">
            <span class="mini-label">Status</span>
            <span class="status-pill" :class="{ active: holdSeconds > 0 }">
              {{ holdSeconds > 0 ? 'Reserved' : 'Ready' }}
            </span>
          </div>
        </article>

        <article class="sidebar-card">
          <h2>Selected Tickets</h2>

          <div class="ticket-summary-card" v-if="selectedSeat">
            <div>
              <p>{{ selectedSeat.section || 'Selected Section' }}</p>
              <small>Seat {{ selectedSeat.rowNumber }}-{{ selectedSeat.seatNumber }}</small>
            </div>
            <strong>SGD {{ subtotal.toFixed(2) }}</strong>
          </div>

          <div v-else class="empty-ticket-card">
            Choose one available seat to generate your checkout summary.
          </div>

          <div class="total-breakdown">
            <div>
              <span>Subtotal</span>
              <strong>SGD {{ subtotal.toFixed(2) }}</strong>
            </div>
            <div>
              <span>Service Fees</span>
              <strong>SGD {{ serviceFee.toFixed(2) }}</strong>
            </div>
            <div class="total-row">
              <span>Total Amount</span>
              <strong>SGD {{ totalAmount.toFixed(2) }}</strong>
            </div>
          </div>

          <button type="button" :disabled="!selectedSeat || holdSeconds > 0" @click="reserveSeat">
            {{ holdSeconds > 0 ? 'Seat Reserved' : 'Reserve Seat' }}
          </button>
          <button v-if="orderId" class="secondary" type="button" @click="router.push(`/checkout/${orderId}`)">
            Checkout Now
          </button>

          <p class="secure-note">{{ totalAvailable }} seats currently available. Secure encrypted transaction.</p>
        </article>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.seat-page {
  display: grid;
  gap: 2rem;
  width: min(100% - 3rem, 84rem);
  margin: 0 auto;
  padding: 7.5rem 0 4.5rem;
}

.seat-header {
  display: grid;
  justify-items: center;
  gap: 0.9rem;
  text-align: center;
}

.seat-pill,
.mini-label {
  color: var(--primary);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.seat-header h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(3rem, 7vw, 5.4rem);
  font-weight: 900;
  line-height: 0.94;
  letter-spacing: -0.06em;
}

.seat-meta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  color: var(--text-muted);
}

.seat-dot {
  width: 0.35rem;
  height: 0.35rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
}

.seat-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(19rem, 0.92fr);
  gap: 1.5rem;
  align-items: start;
}

.seat-map-card,
.sidebar-card {
  border-radius: 1.6rem;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(19, 19, 19, 0.9);
}

.seat-map-card {
  position: relative;
  overflow: hidden;
  padding: 1.5rem;
}

.seat-map-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(249, 115, 22, 0.05), transparent 30%);
  pointer-events: none;
}

.seat-map-top,
.seat-section-header,
.ticket-summary-card,
.total-breakdown div,
.timer-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.seat-map-top {
  position: relative;
  z-index: 1;
  margin-bottom: 1.75rem;
  flex-wrap: wrap;
}

.seat-map-top h2,
.sidebar-card h2 {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.seat-legend {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.seat-legend span {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.legend-box {
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 0.2rem;
  display: inline-block;
}

.legend-box.available {
  background: rgba(249, 115, 22, 0.42);
}

.legend-box.selected {
  background: #3b82f6;
}

.legend-box.sold {
  background: #202020;
}

.stage-rail {
  position: relative;
  z-index: 1;
  margin-bottom: 2rem;
  height: 0.35rem;
  border-radius: 999px;
  background: #0f0f0f;
}

.stage-rail span {
  position: absolute;
  bottom: calc(100% + 0.8rem);
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.38);
  font-size: 0.64rem;
  font-weight: 900;
  letter-spacing: 0.28em;
  text-transform: uppercase;
}

.seat-sections {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 1rem;
}

.seat-section {
  display: grid;
  gap: 0.9rem;
  padding: 1rem;
  border-radius: 1.2rem;
  background: rgba(26, 25, 25, 0.76);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.seat-section-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
}

.seat-section-header span,
.row-label,
.secure-note,
.empty-ticket-card,
.ticket-summary-card small {
  color: var(--text-muted);
}

.seat-row {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr);
  gap: 0.75rem;
  align-items: center;
}

.row-label {
  font-size: 0.82rem;
  font-weight: 700;
  text-align: center;
}

.seat-track {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.seat-tile {
  min-width: 2rem;
  height: 2rem;
  padding: 0 0.4rem;
  border-radius: 0.35rem;
  font-size: 0.68rem;
  font-weight: 700;
  color: #fff;
}

.seat-tile.available {
  background: rgba(249, 115, 22, 0.38);
  border-color: rgba(249, 115, 22, 0.24);
}

.seat-tile.held {
  background: rgba(109, 40, 217, 0.32);
  border-color: rgba(109, 40, 217, 0.2);
  color: rgba(255, 255, 255, 0.72);
}

.seat-tile.sold {
  background: #1f1f1f;
  border-color: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.34);
}

.seat-tile.chosen {
  background: #3b82f6;
  border-color: rgba(59, 130, 246, 0.3);
  box-shadow: 0 0 16px rgba(59, 130, 246, 0.32);
}

.seat-sidebar {
  display: grid;
  gap: 1rem;
}

.sidebar-card {
  display: grid;
  gap: 1.25rem;
  padding: 1.4rem;
}

.timer-card strong {
  display: block;
  margin-top: 0.3rem;
  font-size: 2rem;
  font-weight: 900;
  line-height: 1;
  color: var(--primary);
}

.status-block {
  display: grid;
  gap: 0.35rem;
  justify-items: end;
}

.status-pill {
  padding: 0.35rem 0.65rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.65);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.status-pill.active {
  background: rgba(249, 115, 22, 0.16);
  color: var(--primary);
}

.ticket-summary-card,
.empty-ticket-card {
  padding: 1rem;
  border-radius: 1rem;
  background: rgba(26, 25, 25, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.ticket-summary-card p {
  margin: 0 0 0.2rem;
  font-weight: 700;
}

.ticket-summary-card strong,
.total-row strong {
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--primary);
}

.empty-ticket-card {
  line-height: 1.6;
}

.total-breakdown {
  display: grid;
  gap: 0.85rem;
}

.total-breakdown span {
  color: var(--text-muted);
}

.total-row {
  padding-top: 0.8rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.secure-note,
.seat-loading {
  text-align: center;
  line-height: 1.6;
}

@media (max-width: 980px) {
  .seat-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .seat-page {
    width: min(100% - 1rem, 84rem);
    padding-top: 6.5rem;
  }

  .seat-map-top,
  .timer-card,
  .ticket-summary-card,
  .total-breakdown div {
    align-items: start;
  }

  .seat-map-top,
  .timer-card,
  .ticket-summary-card,
  .total-breakdown div,
  .seat-row {
    grid-template-columns: 1fr;
  }

  .seat-map-top,
  .timer-card,
  .ticket-summary-card,
  .total-breakdown div {
    display: grid;
  }

  .seat-row {
    display: grid;
    gap: 0.5rem;
  }

  .row-label {
    text-align: left;
  }
}
</style>
