<script setup lang="ts">
import { computed, markRaw, onMounted, ref, shallowRef, watch } from 'vue'
import { ClipboardDocumentCheckIcon } from '@heroicons/vue/24/outline'
import api from '@/api/client'
import AccountSidebar from '@/components/account/AccountSidebar.vue'
import { useAuthStore } from '@/stores/auth'
import { isDemoMode, mockServices } from '@/services/mockData'

type ScanResult = 'PASS' | 'FAILED' | 'WRONG_HALL' | 'WRONG_EVENT'

interface VenueItem {
  venueId: string
  name: string
  address: string
}

interface EventItem {
  eventId: string
  venueId: string
  name: string
  date?: string
  venue?: {
    venueId: string
    name: string
    address?: string
  }
}

interface ScanRecord {
  id: number
  label: string
  sublabel: string
  result: ScanResult
  message: string
  time: string
}

const auth = useAuthStore()
const feedback = ref<{ result: ScanResult; message: string } | null>(null)
const history = ref<ScanRecord[]>([])
const venues = ref<VenueItem[]>([])
const events = ref<EventItem[]>([])
const loading = ref(false)
const manualInput = ref('')
const manualLoading = ref(false)
const cameraSupported = ref(false)
const selectedVenueId = ref('')
const selectedEventId = ref('')
const selectionConfirmed = ref(false)
const barcodeReader = shallowRef<any>(null)

let recordSeq = 0
let lastQr = ''
let lastQrTime = 0

const lockedVenueId = computed(() => auth.state.user?.venueId || '')
const selectedVenue = computed(() => venues.value.find(venue => venue.venueId === selectedVenueId.value) || null)
const filteredEvents = computed(() => events.value.filter(event => event.venueId === selectedVenueId.value))
const selectedEvent = computed(() => filteredEvents.value.find(event => event.eventId === selectedEventId.value) || null)
const scannerReady = computed(() => Boolean(selectionConfirmed.value && selectedVenue.value && selectedEvent.value))
const setupStep = computed(() => {
  if (!selectedVenueId.value) return 1
  if (!selectedEventId.value) return 2
  return selectionConfirmed.value ? 3 : 2
})

const feedbackClass = computed(() => {
  if (!feedback.value) return ''
  return {
    PASS: 'feedback-pass',
    WRONG_HALL: 'feedback-hall',
    WRONG_EVENT: 'feedback-event',
    FAILED: 'feedback-fail',
  }[feedback.value.result]
})

const feedbackLabel = computed(() => {
  if (!feedback.value) return ''
  return {
    PASS: 'PASS',
    WRONG_HALL: 'WRONG HALL',
    WRONG_EVENT: 'WRONG EVENT',
    FAILED: 'FAILED',
  }[feedback.value.result]
})

const formatDate = (value?: string) => {
  if (!value) return 'Date TBA'
  return new Date(value).toLocaleDateString('en-SG', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const mapVenue = (venue: any): VenueItem => ({
  venueId: venue?.venueId || venue?.venue_id || '',
  name: venue?.name || 'Unnamed venue',
  address: venue?.address || 'Address unavailable',
})

const mapEvent = (event: any): EventItem => ({
  eventId: event?.eventId || event?.event_id || '',
  venueId: event?.venueId || event?.venue_id || event?.venue?.venueId || '',
  name: event?.name || 'Unnamed event',
  date: event?.date || event?.eventDate || event?.event_date,
  venue: event?.venue
    ? {
        venueId: event.venue.venueId || '',
        name: event.venue.name || 'Unknown venue',
        address: event.venue.address,
      }
    : undefined,
})

const normalizeVenues = (payload: any): VenueItem[] => {
  const raw = payload?.data?.venues || payload?.venues || payload?.data || []
  return raw.map((venue: any) => mapVenue(venue)).filter((venue: VenueItem) => Boolean(venue.venueId))
}

const normalizeEvents = (payload: any): EventItem[] => {
  const raw = payload?.data?.events || payload?.events || payload?.data || []
  return raw.map((event: any) => mapEvent(event)).filter((event: EventItem) => Boolean(event.eventId))
}

const loadData = async () => {
  loading.value = true
  try {
    if (isDemoMode()) {
      const [venueData, eventData] = await Promise.all([
        mockServices.getVenues(),
        mockServices.getEvents({ limit: 200 }),
      ])
      venues.value = normalizeVenues(venueData)
      events.value = normalizeEvents(eventData)
    } else {
      const [{ data: venueData }, { data: eventData }] = await Promise.all([
        api.get('/venues'),
        api.get('/events', { params: { limit: 500 } }),
      ])
      venues.value = normalizeVenues(venueData)
      events.value = normalizeEvents(eventData)
    }

    if (lockedVenueId.value) {
      venues.value = venues.value.filter(venue => venue.venueId === lockedVenueId.value)
    }

    if (!selectedVenueId.value || !venues.value.some(venue => venue.venueId === selectedVenueId.value)) {
      selectedVenueId.value = venues.value.length === 1 ? venues.value[0].venueId : ''
    }
  } catch {
    try {
      const [venueData, eventData] = await Promise.all([
        mockServices.getVenues(),
        mockServices.getEvents({ limit: 200 }),
      ])
      venues.value = normalizeVenues(venueData)
      events.value = normalizeEvents(eventData)

      if (lockedVenueId.value) {
        venues.value = venues.value.filter(venue => venue.venueId === lockedVenueId.value)
      }

      if (!selectedVenueId.value || !venues.value.some(venue => venue.venueId === selectedVenueId.value)) {
        selectedVenueId.value = venues.value.length === 1 ? venues.value[0].venueId : ''
      }
    } catch {
      venues.value = []
      events.value = []
    }
  } finally {
    loading.value = false
  }
}

watch(selectedVenueId, () => {
  selectedEventId.value = ''
  selectionConfirmed.value = false
})

watch(selectedEventId, () => {
  selectionConfirmed.value = false
})

const showFeedback = (result: ScanResult, message: string, label: string, sublabel = '') => {
  feedback.value = { result, message }
  history.value.unshift({
    id: recordSeq++,
    label: label.length > 28 ? `${label.slice(0, 28)}...` : label,
    sublabel,
    result,
    message,
    time: new Date().toLocaleTimeString(),
  })
  setTimeout(() => {
    feedback.value = null
  }, 3000)
}

const confirmSelection = () => {
  if (!selectedVenue.value || !selectedEvent.value) return
  selectionConfirmed.value = true
}

const processQr = async (raw: string) => {
  if (!scannerReady.value) return
  const qrHash = raw.includes('/ticket-qr/') ? raw.split('/ticket-qr/')[1].split('?')[0] : raw
  try {
    if (isDemoMode()) {
      showFeedback('PASS', 'Check-in successful', selectedEvent.value?.name || 'Manual entry', `Ticket ${qrHash.slice(0, 8)}...`)
      return
    }

    const { data } = await api.post('/verify/scan', {
      qrHash,
      selectedVenueId: selectedVenueId.value,
      selectedEventId: selectedEventId.value,
    })
    const d = data?.data
    const label = d?.event?.name || selectedEvent.value?.name || 'Unknown Event'
    const sublabel = d?.ticketId ? `Ticket ${d.ticketId.slice(0, 8)}...` : `${qrHash.slice(0, 16)}...`
    showFeedback('PASS', 'Check-in successful', label, sublabel)
  } catch (e: any) {
    const code = e?.response?.data?.error?.code
    if (code === 'WRONG_HALL') {
      const venue = e?.response?.data?.error?.correctVenue?.name || selectedVenue.value?.name || 'another venue'
      showFeedback('WRONG_HALL', `Wrong hall. Redirect to ${venue}.`, `${qrHash.slice(0, 16)}...`, selectedEvent.value?.name || '')
    } else if (code === 'WRONG_EVENT') {
      const eventName = e?.response?.data?.error?.correctEvent?.name || selectedEvent.value?.name || 'another event'
      showFeedback('WRONG_EVENT', `Wrong event. Redirect to ${eventName}.`, `${qrHash.slice(0, 16)}...`, selectedVenue.value?.name || '')
    } else {
      const message = e?.response?.data?.error?.message
        || (code === 'QR_EXPIRED' ? 'QR expired'
          : code === 'ALREADY_CHECKED_IN' ? 'Already scanned'
          : code === 'TICKET_NOT_FOUND' ? 'Ticket not found'
          : 'Verification failed')
      showFeedback('FAILED', message, `${qrHash.slice(0, 16)}...`)
    }
  }
}

const onDecode = (result: string) => {
  if (!scannerReady.value) return
  if (!result) return
  const now = Date.now()
  if (result === lastQr && now - lastQrTime < 4000) return
  lastQr = result
  lastQrTime = now
  processQr(result)
}

const submitManual = async () => {
  if (!scannerReady.value) return
  const value = manualInput.value.trim()
  if (!value) return
  manualLoading.value = true
  try {
    if (isDemoMode()) {
      showFeedback('PASS', 'Check-in successful', selectedEvent.value?.name || 'Manual entry', `Ticket ${value.slice(0, 8)}...`)
      manualInput.value = ''
      return
    }

    const { data } = await api.post('/verify/manual', {
      ticketId: value,
      selectedVenueId: selectedVenueId.value,
      selectedEventId: selectedEventId.value,
    })
    const d = data?.data
    const label = d?.event?.name || selectedEvent.value?.name || 'Manual entry'
    showFeedback('PASS', 'Check-in successful', label, `Ticket ${value.slice(0, 8)}...`)
    manualInput.value = ''
  } catch (e: any) {
    const code = e?.response?.data?.error?.code
    if (code === 'WRONG_HALL') {
      const venue = e?.response?.data?.error?.correctVenue?.name || selectedVenue.value?.name || 'another venue'
      showFeedback('WRONG_HALL', `Wrong hall. Redirect to ${venue}.`, `Ticket ${value.slice(0, 8)}...`, selectedEvent.value?.name || '')
    } else if (code === 'WRONG_EVENT') {
      const eventName = e?.response?.data?.error?.correctEvent?.name || selectedEvent.value?.name || 'another event'
      showFeedback('WRONG_EVENT', `Wrong event. Redirect to ${eventName}.`, `Ticket ${value.slice(0, 8)}...`, selectedVenue.value?.name || '')
    } else {
      const message = e?.response?.data?.error?.message
        || (code === 'ALREADY_CHECKED_IN' ? 'Already scanned'
          : code === 'TICKET_NOT_FOUND' ? 'Ticket not found'
          : 'Verification failed')
      showFeedback('FAILED', message, `Ticket ${value.slice(0, 8)}...`)
    }
  } finally {
    manualLoading.value = false
  }
}

onMounted(() => {
  loadData()
  cameraSupported.value =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof navigator.mediaDevices.enumerateDevices === 'function'

  if (cameraSupported.value) {
    import('vue-barcode-reader')
      .then((module) => {
        const reader = module.StreamBarcodeReader || module.default?.StreamBarcodeReader
        if (!reader) {
          cameraSupported.value = false
          return
        }
        // The upstream component drops the decode promise. Catch permission and
        // device failures here so manual verification remains available.
        barcodeReader.value = markRaw({
          ...reader,
          beforeUnmount(this: any) {
            this.cameraDisposed = true
            reader.beforeUnmount?.call(this)
          },
          methods: {
            ...reader.methods,
            async start(this: any) {
              try {
                await this.codeReader.decodeFromVideoDevice(undefined, this.$refs.scanner, (result: any) => {
                  if (result && !this.cameraDisposed) {
                    this.$emit('decode', result.text)
                    this.$emit('result', result)
                  }
                })
                if (this.cameraDisposed) this.codeReader.reset()
              } catch {
                if (!this.cameraDisposed) this.$emit('camera-unavailable')
              }
            },
          },
        })
      })
      .catch(() => {
        cameraSupported.value = false
      })
  }
})
</script>

<template>
  <section class="page scanner-page">
    <header class="scanner-top">
      <div>
        <span class="badge">Staff Scanner</span>
        <h1 class="section-title">Fast gate verification for live events.</h1>
        <p class="section-subtitle">Choose a venue, lock an event, then scan QR codes or verify tickets manually when the line is moving quickly.</p>
      </div>
    </header>

    <div class="scanner-layout">
      <AccountSidebar active-key="scanner" />

      <div class="scanner-content">
        <article class="glass setup-card">
          <div class="setup-head">
            <div>
              <span class="badge">Step {{ setupStep }} of 3</span>
              <h2>Pick the active venue and event before opening the scanner.</h2>
              <p class="small muted">
                {{ lockedVenueId ? 'Your staff account is restricted to one venue, so only matching events are shown.' : 'The event list updates after you choose a venue, and scanning stays locked until you confirm both selections.' }}
              </p>
            </div>
            <div class="setup-status" :class="{ active: scannerReady }">
              <strong>{{ scannerReady ? 'Scanning enabled' : 'Scanner locked' }}</strong>
              <span class="small muted">{{ scannerReady ? 'Camera and manual verification are ready.' : 'Finish the selection flow to enable verification.' }}</span>
            </div>
          </div>

          <div class="selection-grid">
            <label class="field-stack">
              <span>Venue</span>
              <select v-model="selectedVenueId" :disabled="loading || venues.length === 0 || Boolean(lockedVenueId)">
                <option value="" disabled>{{ loading ? 'Loading venues...' : 'Select venue' }}</option>
                <option v-for="venue in venues" :key="venue.venueId" :value="venue.venueId">{{ venue.name }}</option>
              </select>
            </label>

            <label class="field-stack">
              <span>Event</span>
              <select v-model="selectedEventId" :disabled="loading || !selectedVenueId || filteredEvents.length === 0">
                <option value="" disabled>{{ !selectedVenueId ? 'Choose a venue first' : filteredEvents.length === 0 ? 'No events for this venue' : 'Select event' }}</option>
                <option v-for="event in filteredEvents" :key="event.eventId" :value="event.eventId">
                  {{ event.name }}{{ event.date ? ` • ${formatDate(event.date)}` : '' }}
                </option>
              </select>
            </label>
          </div>

          <div class="setup-footer">
            <div class="setup-summary">
              <span class="small muted">Active context</span>
              <strong>{{ selectedVenue?.name || 'No venue selected' }}</strong>
              <p class="small muted">{{ selectedEvent?.name || 'No event selected' }}</p>
            </div>
            <button :disabled="!selectedVenue || !selectedEvent" @click="confirmSelection">
              {{ scannerReady ? 'Reconfirm selection' : 'Confirm selection' }}
            </button>
          </div>
        </article>

        <div class="scanner-grid">
          <article class="glass scanner-card">
            <div v-if="scannerReady" class="active-session">
              <div>
                <span class="badge">Scanning session</span>
                <strong>{{ selectedVenue?.name }}</strong>
                <p class="small muted">{{ selectedEvent?.name }}</p>
              </div>
              <div class="session-meta">
                <span class="session-pill">{{ selectedVenue?.address }}</span>
                <span class="session-pill">{{ selectedEvent?.date ? formatDate(selectedEvent.date) : 'Date TBA' }}</span>
              </div>
            </div>

            <div class="camera-wrap">
              <component v-if="scannerReady && cameraSupported && barcodeReader" :is="barcodeReader" @decode="onDecode" @camera-unavailable="cameraSupported = false" />
              <div v-else class="camera-fallback" :class="{ 'camera-fallback-locked': !scannerReady }">
                <span class="badge">{{ scannerReady ? 'Camera unavailable' : 'Scanner locked' }}</span>
                <h2 v-if="scannerReady">Use manual verification on this device.</h2>
                <h2 v-else>Choose a venue and event to enable scanning.</h2>
                <p class="small muted">
                  {{ scannerReady ? 'Live scanning is only enabled when the browser supports camera access.' : 'Camera and manual verification stay disabled until both selections are confirmed.' }}
                </p>
              </div>
              <div v-if="feedback" class="feedback-overlay" :class="feedbackClass">
                <p class="feedback-label">{{ feedbackLabel }}</p>
                <p class="feedback-msg">{{ feedback.message }}</p>
              </div>
            </div>

            <div class="manual-card panel">
              <label>Manual ticket lookup</label>
              <p class="small muted">{{ scannerReady ? 'Use the selected venue and event context for manual verification.' : 'Manual verification unlocks after the selection is confirmed.' }}</p>
              <div class="manual-row">
                <input v-model="manualInput" placeholder="Ticket ID" :disabled="!scannerReady" @keydown.enter="submitManual" />
                <button :disabled="manualLoading || !scannerReady || !manualInput.trim()" @click="submitManual">{{ manualLoading ? '...' : 'Verify' }}</button>
              </div>
            </div>
          </article>

          <article class="glass history-card">
            <div class="history-head">
              <span class="badge">Session History</span>
              <p class="small muted">{{ history.length }} check{{ history.length === 1 ? '' : 's' }}</p>
            </div>

            <div v-if="history.length === 0" class="history-empty">
              <div class="history-empty-icon-shell" aria-hidden="true">
                <ClipboardDocumentCheckIcon class="history-empty-icon" />
              </div>
              <strong>No scans yet</strong>
              <p class="small muted">Verified, failed, and wrong-hall or wrong-event scans will appear here as soon as the session starts moving.</p>
              <div class="history-empty-foot">
                <span class="badge history-empty-badge">Session ready</span>
                <p class="small muted">Use the camera feed or manual lookup to add the first ticket check.</p>
              </div>
            </div>

            <ul v-else class="history-list">
              <li v-for="record in history" :key="record.id" class="history-item" :class="`hist-${record.result.toLowerCase().replace('_', '-')}`">
                <div class="hist-dot"></div>
                <div class="hist-copy">
                  <strong>{{ record.label }}</strong>
                  <p v-if="record.sublabel" class="small muted">{{ record.sublabel }}</p>
                  <p class="small muted">{{ record.message }}</p>
                </div>
                <span class="hist-time">{{ record.time }}</span>
              </li>
            </ul>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.scanner-page {
  display: grid;
  gap: 1.5rem;
}

.scanner-top {
  text-align: left;
}

.scanner-layout {
  display: grid;
  grid-template-columns: var(--account-sidebar-width) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}

.scanner-content {
  display: grid;
  gap: 1rem;
}

.scanner-grid {
  display: grid;
  grid-template-columns: 1.4fr 0.9fr;
  gap: 1rem;
  align-items: start;
}

.setup-card,
.scanner-card,
.history-card {
  padding: 1rem;
  display: grid;
  gap: 1rem;
}

.history-card {
  align-content: start;
}

.setup-head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: start;
}

.setup-head h2 {
  margin: 0.35rem 0 0.25rem;
  font-size: 1.1rem;
}

.setup-head p {
  margin: 0;
}

.setup-status {
  min-width: 12rem;
  padding: 0.85rem 1rem;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  display: grid;
  gap: 0.2rem;
}

.setup-status.active {
  background: rgba(82, 209, 140, 0.1);
  border-color: rgba(82, 209, 140, 0.2);
}

.selection-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
}

.field-stack {
  display: grid;
  gap: 0.45rem;
}

.field-stack span {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--textMuted);
}

.setup-footer {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: end;
  flex-wrap: wrap;
}

.setup-summary {
  display: grid;
  gap: 0.2rem;
}

.setup-summary strong,
.active-session strong {
  font-size: 1rem;
}

.setup-summary p,
.active-session p {
  margin: 0;
}

.active-session {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  padding: 0.8rem 0.9rem;
  border-radius: var(--radius-md);
  background:
    radial-gradient(circle at top left, rgba(249, 115, 22, 0.14), transparent 45%),
    rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.session-meta {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.session-pill {
  padding: 0.45rem 0.7rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--textMuted);
  font-size: 0.76rem;
}

.camera-wrap {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-lg);
  min-height: 420px;
  background: #0b0b0d;
}

.camera-fallback {
  height: 100%;
  min-height: 420px;
  display: grid;
  place-content: center;
  gap: 0.75rem;
  padding: 1.5rem;
  text-align: center;
}

.camera-fallback-locked {
  background:
    radial-gradient(circle at top, rgba(249, 115, 22, 0.12), transparent 42%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0.01));
}

.camera-fallback h2,
.camera-fallback p {
  margin: 0;
}

.manual-card {
  padding: 1rem;
}

.manual-row {
  display: flex;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.history-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.history-empty {
  min-height: 100%;
  display: grid;
  align-content: center;
  justify-items: start;
  gap: 0.75rem;
  padding: 1.2rem;
  border-radius: calc(var(--radius-lg) - 0.2rem);
  background:
    radial-gradient(circle at top left, rgba(249, 115, 22, 0.14), transparent 45%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0.01));
  border: 1px dashed rgba(255, 255, 255, 0.08);
}

.history-empty strong {
  font-size: 1.05rem;
  letter-spacing: -0.02em;
}

.history-empty > p {
  max-width: 24rem;
  margin: 0;
  line-height: 1.6;
}

.history-empty-icon-shell {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: 0.95rem;
  background: rgba(249, 115, 22, 0.12);
  border: 1px solid rgba(249, 115, 22, 0.18);
}

.history-empty-icon {
  width: 1.4rem;
  height: 1.4rem;
  color: var(--primarySoft);
}

.history-empty-foot {
  display: grid;
  gap: 0.45rem;
  padding-top: 0.35rem;
}

.history-empty-foot p {
  margin: 0;
}

.history-empty-badge {
  width: fit-content;
}

.history-list {
  display: grid;
  gap: 0.5rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.history-item {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  padding: 0.65rem;
  border-radius: var(--radius-md);
  background: rgba(60, 51, 49, .45);
}

.hist-dot {
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;
  margin-top: 0.25rem;
}

.hist-pass .hist-dot {
  background: var(--success);
}

.hist-failed .hist-dot {
  background: var(--error);
}

.hist-wrong-hall .hist-dot {
  background: var(--warning);
}

.hist-wrong-event .hist-dot {
  background: #60a5fa;
}

.hist-copy {
  flex: 1;
  display: grid;
  gap: 0.2rem;
}

.hist-time {
  color: var(--textMuted);
  font-size: 0.75rem;
}

.feedback-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  text-align: center;
  gap: 0.25rem;
}

.feedback-pass {
  background: rgba(82, 209, 140, .88);
}

.feedback-fail {
  background: rgba(255, 140, 122, .88);
}

.feedback-hall {
  background: rgba(255, 176, 32, .88);
}

.feedback-event {
  background: rgba(96, 165, 250, .88);
}

.feedback-label {
  font-size: 2.75rem;
  font-weight: 800;
  color: #fff;
  letter-spacing: 0.08em;
}

.feedback-msg {
  color: rgba(255, 255, 255, .95);
}

@media (max-width: 920px) {
  .scanner-layout,
  .scanner-grid,
  .selection-grid {
    grid-template-columns: 1fr;
  }

  .setup-head,
  .active-session {
    flex-direction: column;
    align-items: start;
  }
}
</style>
