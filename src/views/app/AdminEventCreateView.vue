<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import api from '@/api/client'
import { isDemoMode, mockVenues } from '@/services/mockData'
import AccountSidebar from '@/components/account/AccountSidebar.vue'

const form = reactive({
  name: '',
  description: '',
  type: 'concert',
  venueId: '',
  venueName: '',
  venueAddress: '',
  startDate: '',
  endDate: '',
  totalSeats: 200,
  cat1Price: 100,
})

const loading = ref(false)
const created = ref<{ eventId: string; seatsCreated: number } | null>(null)
const venues = ref<any[]>([])
const dashboardTo = computed(() => (created.value?.eventId ? `/admin/events/${created.value.eventId}/dashboard` : null))
const selectedVenue = computed(() => venues.value.find(v => v.venueId === form.venueId) || null)
const lockedVenueFields = computed(() => Boolean(selectedVenue.value))

onMounted(async () => {
  try {
    if (isDemoMode()) {
      venues.value = mockVenues
      return
    }
    const { data } = await api.get('/venues')
    venues.value = data?.venues || data?.data?.venues || []
  } catch (e) {
    venues.value = mockVenues
    console.error('Failed to load venues')
  }
})

watch(() => form.venueId, (newId) => {
  const venue = venues.value.find(v => v.venueId === newId)
  if (venue) {
    form.venueName = venue.name
    form.venueAddress = venue.address || ''
    form.totalSeats = venue.capacity || 200
  }
})

const submit = async () => {
  loading.value = true
  created.value = null
  try {
    if (isDemoMode()) {
      created.value = {
        eventId: 'demo-event-created',
        seatsCreated: Number(form.totalSeats),
      }
      return
    }
    const payload = {
      name: form.name,
      description: form.description,
      type: form.type,
      venue_id: form.venueId,
      venue: { name: form.venueName, address: form.venueAddress },
      event_date: form.startDate,
      end_date: form.endDate,
      total_seats: Number(form.totalSeats),
      pricing_tiers: { CAT1: Number(form.cat1Price) },
    }
    const { data } = await api.post('/admin/events', payload)
    created.value = {
      eventId: data?.data?.eventId || data?.data?.event_id,
      seatsCreated: data?.data?.seatsCreated ?? data?.data?.seats_created,
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="page admin-page">
    <header class="admin-header">
      <h1><span>Create</span> New Event</h1>
    </header>

    <div class="admin-layout">
      <AccountSidebar active-key="create" create-to="/admin/events/new" :dashboard-to="dashboardTo" />

      <article class="glass admin-form">
        <div class="admin-head">
          <div>
            <h2 class="section-title">Event Create</h2>
            <p class="small muted">Set event details, venue metadata, dates, and initial pricing in one flow.</p>
          </div>
          <span v-if="created" class="badge">Created</span>
        </div>

        <div class="grid-2">
          <div>
            <label>Event Name</label>
            <input v-model="form.name" placeholder="Neon Skyline Festival" />
          </div>
          <div>
            <label>Event Type</label>
            <select v-model="form.type">
              <option value="festival">Festival</option>
              <option value="concert">Concert</option>
              <option value="theatre">Theatre</option>
              <option value="sports">Sports</option>
              <option value="classical">Classical</option>
            </select>
          </div>
        </div>

        <div>
          <label>Description</label>
          <textarea v-model="form.description" rows="3" placeholder="Write a short description for this event."></textarea>
        </div>

        <div class="grid-2">
          <div>
            <label>Start Date</label>
            <input v-model="form.startDate" type="datetime-local" />
          </div>
          <div>
            <label>End Date</label>
            <input v-model="form.endDate" type="datetime-local" />
          </div>
        </div>

        <div class="grid-2">
          <div>
            <label>Venue</label>
            <select v-model="form.venueId">
              <option disabled value="">Select a venue...</option>
              <option v-for="venue in venues" :key="venue.venueId" :value="venue.venueId">{{ venue.name }}</option>
            </select>
            <p v-if="lockedVenueFields" class="small muted field-note">Venue-backed values are locked from seeded data.</p>
          </div>
          <div>
            <label>Total Seats</label>
            <input v-model="form.totalSeats" type="number" min="1" :readonly="lockedVenueFields" :disabled="lockedVenueFields" />
          </div>
        </div>

        <div class="grid-2">
          <div>
            <label>Venue Name</label>
            <input v-model="form.venueName" placeholder="Venue name" :readonly="lockedVenueFields" :disabled="lockedVenueFields" />
          </div>
          <div>
            <label>Ticket Price</label>
            <input v-model="form.cat1Price" type="number" min="1" :readonly="lockedVenueFields" :disabled="lockedVenueFields" />
          </div>
        </div>

        <div>
          <label>Venue Address</label>
          <input v-model="form.venueAddress" placeholder="Venue address" />
        </div>

        <div class="admin-actions">
          <p v-if="created" class="small status-success">Created {{ created.eventId }} with {{ created.seatsCreated }} seats.</p>
          <button :disabled="loading" @click="submit">{{ loading ? 'Creating...' : 'Create Event' }}</button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.admin-page {
  display: grid;
  gap: 1.5rem;
}

.admin-header {
  text-align: center;
}

.admin-header h1 {
  font-family: "Plus Jakarta Sans", Inter, sans-serif;
  font-size: clamp(2.7rem, 7vw, 4.35rem);
  font-weight: 800;
  letter-spacing: -0.07em;
}

.admin-header span {
  color: var(--primary);
}

.admin-layout {
  display: grid;
  grid-template-columns: var(--account-sidebar-width) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}

.admin-form {
  padding: 1.5rem;
  display: grid;
  gap: 1rem;
  border-radius: 1.5rem;
  background: rgba(34, 31, 30, 0.84);
  border-color: rgba(255, 255, 255, 0.06);
}

.admin-head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  flex-wrap: wrap;
}
.admin-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.field-note {
  margin-top: 0.45rem;
}

.admin-form input:disabled,
.admin-form select:disabled,
.admin-form textarea:disabled {
  opacity: 0.78;
  cursor: not-allowed;
}

@media (max-width: 920px) {
  .admin-layout { grid-template-columns: 1fr; }
}
</style>
