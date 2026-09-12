<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api/client'
import { useToast } from '@/composables/useToast'
import { isDemoMode, mockServices } from '@/services/mockData'
import { resolveEventImage } from '@/utils/eventMedia'
import type { EventSummary, EventType } from '@/types'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const EVENT_TYPES: Array<{ value: EventType | 'all'; label: string }> = [
  { value: 'all', label: 'All Categories' },
  { value: 'concert', label: 'Concert' },
  { value: 'sports', label: 'Sports' },
  { value: 'theatre', label: 'Theatre' },
  { value: 'classical', label: 'Classical' },
  { value: 'festival', label: 'Festival' },
  { value: 'other', label: 'Other' },
]
const listingFallbackImages = [
  '/stitch-media/listing/listing-featured-rooftop.jpg',
  '/stitch-media/listing/listing-neon-resonance.jpg',
  '/stitch-media/listing/listing-obsidian-jazz.jpg',
  '/stitch-media/listing/listing-midnight-gallery.jpg',
  '/stitch-media/listing/listing-kinetic-summit.jpg',
]

const loading = ref(false)
const events = ref<EventSummary[]>([])
const page = ref(1)
const totalPages = ref(1)
const search = ref((route.query.search as string) || '')
const typeFilter = ref<EventType | 'all'>((route.query.type as EventType | 'all') || 'all')
const fromDate = ref('')
const toDate = ref('')
const activeView = ref<'all' | 'upcoming' | 'favorites'>('all')
const favoriteIds = ref<string[]>(JSON.parse(localStorage.getItem('favoriteEvents') || '[]'))

watch(
  favoriteIds,
  () => localStorage.setItem('favoriteEvents', JSON.stringify(favoriteIds.value)),
  { deep: true },
)

const buildCacheKey = () => `events_list:${page.value}:${typeFilter.value}`

const mapEvent = (event: any, index = 0): EventSummary => ({
  eventId: event.eventId || event.event_id,
  name: event.name,
  date: event.date || event.eventDate || event.event_date,
  venueId: event.venueId || event.venue_id || '',
  price: Number(event.price || 0),
  type: (event.type || 'other') as EventType,
  image:
    resolveEventImage({
      eventId: event.eventId || event.event_id,
      context: 'listing',
    }) ||
    event.image ||
    listingFallbackImages[index % listingFallbackImages.length],
  seatsAvailable: event.seatsAvailable,
  venue: event.venue
    ? { venueId: event.venue.venueId || '', name: event.venue.name, address: event.venue.address }
    : undefined,
})

const load = async () => {
  loading.value = true
  try {
    const params: Record<string, unknown> = { page: page.value, limit: 10 }
    if (typeFilter.value !== 'all') params.type = typeFilter.value

    if (isDemoMode()) {
      const result = await mockServices.getEvents({
        page: page.value,
        limit: 10,
        type: typeFilter.value !== 'all' ? typeFilter.value : undefined,
      })
      events.value = result.events.map((event, index) => mapEvent(event, index))
      totalPages.value = Math.max(1, Math.ceil(result.pagination.total / 10))
      return
    }

    const { data } = await api.get('/events', { params })
    const raw = data?.data?.events || data?.data || []
    events.value = raw.map((event: any, index: number) => mapEvent(event, index))
    const pagination = data?.data?.pagination || data?.pagination || {}
    const total = pagination.total || events.value.length
    const limit = pagination.limit || 10
    totalPages.value = pagination.totalPages || pagination.total_pages || Math.max(1, Math.ceil(total / limit))
    localStorage.setItem(buildCacheKey(), JSON.stringify({ items: events.value, totalPages: totalPages.value }))
  } catch {
    const cached = localStorage.getItem(buildCacheKey())
    if (cached) {
      const parsed = JSON.parse(cached)
      events.value = parsed.items || []
      totalPages.value = parsed.totalPages || 1
      toast.push('Showing cached events.', 'info', 3200)
    } else {
      try {
        const result = await mockServices.getEvents({
          page: page.value,
          limit: 10,
          type: typeFilter.value !== 'all' ? typeFilter.value : undefined,
        })
        events.value = result.events.map((event, index) => mapEvent(event, index))
        totalPages.value = Math.max(1, Math.ceil(result.pagination.total / 10))
        toast.push('Backend unavailable. Showing demo events.', 'info', 3200)
      } catch {
        events.value = []
        totalPages.value = 1
        toast.push('Could not load events.', 'error', 3200)
      }
    }
  } finally {
    loading.value = false
  }
}

const visibleEvents = computed(() => {
  const needle = search.value.trim().toLowerCase()
  const today = new Date().toISOString().slice(0, 10)

  return events.value.filter((event) => {
    const text = `${event.name} ${event.venue?.name || ''}`.toLowerCase()
    if (needle && !text.includes(needle)) return false
    const parsedDate = event.date ? new Date(event.date) : null
    const date = parsedDate && Number.isFinite(parsedDate.getTime())
      ? `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, '0')}-${String(parsedDate.getDate()).padStart(2, '0')}`
      : ''
    if (fromDate.value && (!date || date < fromDate.value)) return false
    if (toDate.value && (!date || date > toDate.value)) return false
    if (activeView.value === 'upcoming' && (event.date?.slice(0, 10) || '') < today) return false
    if (activeView.value === 'favorites' && !favoriteIds.value.includes(event.eventId)) return false
    return true
  })
})

const featuredEvent = computed(() => visibleEvents.value[0] || null)
const secondaryEvents = computed(() => visibleEvents.value.slice(featuredEvent.value ? 1 : 0))

const openEventDetails = (eventId: string) => {
  router.push(`/events/${eventId}`)
}

const toggleFavorite = (eventId: string) => {
  favoriteIds.value = favoriteIds.value.includes(eventId)
    ? favoriteIds.value.filter((id) => id !== eventId)
    : [...favoriteIds.value, eventId]
}

const setType = (value: EventType | 'all') => {
  typeFilter.value = value
  router.replace({ query: { ...route.query, type: value === 'all' ? undefined : value } })
  page.value = 1
  load()
}

const formatDate = (value?: string) => {
  if (!value) return 'Date TBA'
  return new Date(value).toLocaleDateString('en-SG', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

onMounted(load)
</script>

<template>
  <section class="events-page">
    <header class="listing-header">
      <h1>
        Curated <span>Experiences</span>
      </h1>

      <div class="listing-controls">
        <label class="search-shell">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <input v-model="search" placeholder="Search events, artists, or venues..." />
        </label>

        <div class="date-filters">
          <label>From date<input v-model="fromDate" type="date" aria-label="From date" /></label>
          <label>To date<input v-model="toDate" type="date" aria-label="To date" /></label>
        </div>

        <div class="chip-row">
          <button
            v-for="type in EVENT_TYPES"
            :key="type.value"
            class="filter-chip"
            :class="{ active: typeFilter === type.value }"
            type="button"
            @click="setType(type.value)"
          >
            {{ type.label }}
          </button>
          <button
            class="filter-chip"
            :class="{ active: activeView === 'favorites' }"
            type="button"
            @click="activeView = activeView === 'favorites' ? 'all' : 'favorites'"
          >
            Favorites
          </button>
        </div>
      </div>
    </header>

    <div v-if="loading" class="listing-grid loading-grid">
      <div class="event-card event-card-feature loading-card"></div>
      <div v-for="n in 4" :key="n" class="event-card loading-card"></div>
    </div>

    <template v-else>
      <div v-if="visibleEvents.length === 0" class="empty-card">
        <h2>No events found.</h2>
        <p>Try another search or switch category.</p>
      </div>

      <div v-else class="listing-grid">
        <article
          v-if="featuredEvent"
          class="event-card event-card-feature"
          role="link"
          tabindex="0"
          @click="openEventDetails(featuredEvent.eventId)"
          @keyup.enter="openEventDetails(featuredEvent.eventId)"
          @keyup.space.prevent="openEventDetails(featuredEvent.eventId)"
        >
          <img v-if="featuredEvent.image" :src="featuredEvent.image" :alt="featuredEvent.name" />
          <div class="card-overlay"></div>
          <button
            class="favorite-toggle" type="button"
            :aria-label="`Favorite ${featuredEvent.name}`"
            :aria-pressed="favoriteIds.includes(featuredEvent.eventId)"
            @click.stop="toggleFavorite(featuredEvent.eventId)"
            @keyup.enter.stop @keyup.space.stop
          >{{ favoriteIds.includes(featuredEvent.eventId) ? '♥' : '♡' }}</button>
          <div class="card-copy featured-copy">
            <div class="feature-topline">
              <span class="tag tag-primary">Featured</span>
              <span>{{ formatDate(featuredEvent.date) }}</span>
            </div>
            <h2>{{ featuredEvent.name }}</h2>
            <p>{{ featuredEvent.venue?.name || 'Featured venue' }}</p>
            <div class="feature-actions">
              <button type="button" @click.stop="openEventDetails(featuredEvent.eventId)">Get Tickets</button>
            </div>
          </div>
        </article>

        <article
          v-for="event in secondaryEvents"
          :key="event.eventId"
          class="event-card"
          role="link"
          tabindex="0"
          @click="openEventDetails(event.eventId)"
          @keyup.enter="openEventDetails(event.eventId)"
          @keyup.space.prevent="openEventDetails(event.eventId)"
        >
          <div class="square-media">
            <img v-if="event.image" :src="event.image" :alt="event.name" loading="lazy" decoding="async" />
            <div class="card-overlay"></div>
            <button class="favorite-toggle" type="button"
              :aria-label="`Favorite ${event.name}`" :aria-pressed="favoriteIds.includes(event.eventId)"
              @click.stop="toggleFavorite(event.eventId)" @keyup.enter.stop @keyup.space.stop>
              {{ favoriteIds.includes(event.eventId) ? '♥' : '♡' }}
            </button>
          </div>

          <div class="card-copy">
            <span class="tag">{{ event.type }}</span>
            <h3>{{ event.name }}</h3>
            <p>{{ formatDate(event.date) }} • {{ event.venue?.name || 'Venue TBA' }}</p>
            <button class="secondary full-button" type="button" @click.stop="openEventDetails(event.eventId)">
              Get Tickets
            </button>
          </div>
        </article>
      </div>

      <div v-if="totalPages > 1" class="pagination">
        <button class="secondary" :disabled="page <= 1" @click="page--; load()">Previous</button>
        <span>Page {{ page }} of {{ totalPages }}</span>
        <button class="secondary" :disabled="page >= totalPages" @click="page++; load()">Next</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.events-page {
  display: grid;
  gap: 2rem;
  width: min(100% - 3rem, 84rem);
  margin: 0 auto;
  padding: 7.5rem 0 4.5rem;
}

.listing-header {
  display: grid;
  gap: 1.75rem;
  justify-items: center;
  text-align: center;
}

.listing-header h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(3.6rem, 8vw, 5.8rem);
  font-weight: 900;
  line-height: 0.92;
  letter-spacing: -0.07em;
}

.listing-header h1 span {
  color: var(--primary);
}

.listing-controls {
  display: grid;
  gap: 1rem;
  width: min(100%, 56rem);
}

.search-shell {
  position: relative;
  width: min(100%, 32rem);
  justify-self: center;
}

.search-shell input {
  padding-left: 3rem;
  border-radius: 999px;
  background: rgba(38, 38, 38, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.search-icon {
  position: absolute;
  top: 50%;
  left: 1rem;
  transform: translateY(-50%);
  color: rgba(255, 255, 255, 0.48);
  font-size: 1.1rem;
}

.date-filters {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.date-filters label {
  display: grid;
  gap: 0.35rem;
  color: var(--textMuted);
  font-size: 0.8rem;
}

.date-filters input {
  width: 10.5rem;
  padding: 0.65rem;
  color-scheme: dark;
  border: 1px solid var(--outlineSoft);
  border-radius: 0.6rem;
  background: var(--surface);
  color: var(--text);
}

.chip-row {
  display: flex;
  gap: 0.7rem;
  justify-content: center;
  flex-wrap: wrap;
}

.filter-chip {
  padding: 0.82rem 1.2rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(38, 38, 38, 0.82);
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.82rem;
  font-weight: 600;
  white-space: nowrap;
}

.filter-chip.active {
  background: var(--primary);
  color: #2a1203;
  border-color: transparent;
}

.listing-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: stretch;
  gap: 1.35rem;
}

.event-card {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 1.35rem;
  background: rgba(19, 19, 19, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.05);
  min-height: 17rem;
  cursor: pointer;
  transition:
    transform 0.25s ease,
    border-color 0.25s ease,
    box-shadow 0.25s ease;
}

.event-card-feature {
  grid-column: span 2;
  min-height: 17rem;
  height: 100%;
}

.event-card-feature img {
  position: absolute;
  inset: 0;
}

.event-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.45s ease;
}

.event-card:hover img {
  transform: scale(1.04);
}

.event-card:hover,
.event-card:focus-visible {
  border-color: rgba(249, 115, 22, 0.32);
  box-shadow: 0 1.1rem 2.5rem rgba(0, 0, 0, 0.28);
  transform: translateY(-0.2rem);
}

.event-card:focus-visible {
  outline: 2px solid rgba(249, 115, 22, 0.82);
  outline-offset: 0.18rem;
}

.square-media {
  position: relative;
  aspect-ratio: 1 / 1;
}

.card-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.02), rgba(0, 0, 0, 0.86));
}

.favorite-toggle {
  z-index: 2;
  position: absolute;
  top: 0.9rem;
  right: 0.9rem;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(14, 14, 14, 0.48);
  color: #fff;
}

.card-copy {
  display: grid;
  gap: 0.65rem;
  padding: 1.2rem;
}

.featured-copy {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1;
  padding: 1.5rem;
}

.feature-topline {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  color: rgba(255, 255, 255, 0.74);
  font-size: 0.82rem;
  font-weight: 600;
}

.tag {
  width: fit-content;
  padding: 0.35rem 0.72rem;
  border-radius: 999px;
  background: rgba(38, 38, 38, 0.9);
  color: var(--primary);
  font-size: 0.64rem;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.tag-primary {
  background: rgba(249, 115, 22, 0.95);
  color: #230f02;
}

.featured-copy h2,
.card-copy h3,
.empty-card h2 {
  margin: 0;
  font-family: var(--font-display);
  line-height: 0.98;
  letter-spacing: -0.05em;
}

.featured-copy h2 {
  max-width: 28rem;
  font-size: clamp(1.9rem, 4vw, 3rem);
}

.card-copy h3 {
  font-size: 1.22rem;
}

.card-copy p,
.featured-copy p,
.empty-card p,
.pagination {
  margin: 0;
  color: var(--text-muted);
}

.feature-actions,
.pagination {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
}

.feature-actions button {
  min-width: 8.75rem;
}

.full-button {
  width: 100%;
}

.empty-card {
  display: grid;
  gap: 0.5rem;
  justify-items: center;
  text-align: center;
  padding: 3rem 1.5rem;
  border-radius: 1.5rem;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(19, 19, 19, 0.74);
}

.pagination {
  justify-content: flex-end;
}

.loading-card {
  background: linear-gradient(90deg, rgba(32, 31, 31, 0.7), rgba(44, 44, 44, 0.9), rgba(32, 31, 31, 0.7));
}

@media (max-width: 980px) {
  .listing-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .event-card-feature {
    grid-column: span 2;
  }
}

@media (max-width: 720px) {
  .listing-grid {
    grid-template-columns: 1fr;
  }

  .events-page {
    width: min(100% - 1rem, 84rem);
    padding-top: 6.5rem;
  }

  .event-card-feature {
    grid-column: span 1;
    min-height: 26rem;
  }

  .event-card-feature img {
    position: absolute;
    inset: 0;
  }

  .pagination {
    justify-content: flex-start;
  }
}
</style>
