<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import api from '@/api/client'
import { setDemoMode } from '@/services/mockData'

const DISMISS_KEY = 'offline_banner_dismissed'
const storedDemoContext = sessionStorage.getItem('demo_context')
const offline = ref(Boolean((window as unknown as Record<string, unknown>).__apiOffline) ||
  storedDemoContext === 'offline' ||
  (sessionStorage.getItem('ticketremaster_demo_mode') === 'true' && storedDemoContext !== 'manual'))
const message = ref('Backend unavailable. Showing demo data while live services recover.')
const retrying = ref(false)
const retryError = ref('')
const RETRY_REQUEST = { params: { limit: 1 }, timeout: 8000, skipRetry: true, suppressErrorToast: true, suppressErrorLog: true }

const retryConnection = async () => {
  if (retrying.value) return
  retrying.value = true
  retryError.value = ''
  const wasOfflineAccount = sessionStorage.getItem('demo_context') === 'offline'
  try {
    // One user-initiated probe, with an eight-second deadline and no automatic retries.
    await api.get('/events', RETRY_REQUEST)
    setDemoMode(false)
    sessionStorage.removeItem(DISMISS_KEY)
    window.dispatchEvent(new Event('api:online'))
    window.location.assign(wasOfflineAccount ? '/login' : window.location.href)
  } catch {
    retryError.value = 'The service is still unavailable. Please try again later.'
  } finally {
    retrying.value = false
  }
}

const dismissed = ref(sessionStorage.getItem(DISMISS_KEY) === 'true')

const showBanner = computed(() => offline.value && !dismissed.value)

const dismiss = () => {
  dismissed.value = true
  sessionStorage.setItem(DISMISS_KEY, 'true')
}

const handleOnline = () => {
  offline.value = false
  dismissed.value = false
  sessionStorage.removeItem(DISMISS_KEY)
}

const handleOffline = (event: Event) => {
  offline.value = true
  const detail = (event as CustomEvent<{ message?: string }>).detail
  message.value = detail?.message || 'Backend unavailable. Showing demo data while live services recover.'
}

onMounted(() => {
  window.addEventListener('api:online', handleOnline)
  window.addEventListener('api:offline', handleOffline as EventListener)
})

onUnmounted(() => {
  window.removeEventListener('api:online', handleOnline)
  window.removeEventListener('api:offline', handleOffline as EventListener)
})
</script>

<template>
  <div v-if="showBanner" class="offline-banner" role="status" aria-live="polite">
    <div class="offline-copy">
      <strong>Offline Demo Mode</strong>
      <p>{{ message }}</p>
      <p v-if="retryError" class="retry-error" role="alert">{{ retryError }}</p>
    </div>
    <div class="offline-actions">
      <button class="dismiss-button" type="button" :disabled="retrying" @click="retryConnection">{{ retrying ? 'Retrying...' : 'Retry connection' }}</button>
      <button class="dismiss-button" type="button" @click="dismiss">Dismiss</button>
    </div>
  </div>
</template>

<style scoped>
.offline-banner {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 120;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid rgba(255, 145, 83, 0.28);
  background: linear-gradient(180deg, rgba(31, 18, 10, 0.9), rgba(17, 11, 7, 0.96));
  backdrop-filter: blur(20px);
  box-shadow: 0 -14px 40px rgba(0, 0, 0, 0.3);
}

.offline-copy {
  display: grid;
  gap: 0.2rem;
}

.offline-copy strong {
  color: var(--primarySoft);
  font-size: 0.82rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.offline-copy p {
  color: rgba(255, 255, 255, 0.78);
  font-size: 0.92rem;
  line-height: 1.45;
}

.offline-actions {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.dismiss-button {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.1);
  color: var(--text);
  white-space: nowrap;
}

@media (max-width: 720px) {
  .offline-banner {
    flex-direction: column;
    align-items: stretch;
    padding: 1rem;
  }

  .dismiss-button {
    width: 100%;
  }
}
</style>
