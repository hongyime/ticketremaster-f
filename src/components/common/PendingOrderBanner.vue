<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()

const secondsLeft = ref(0)
const orderId = ref('')
const eventName = ref('')
const orderKey = ref('')
const dismissedOrderKey = ref('')
let ticker: number | undefined

const visible = computed(() =>
  secondsLeft.value > 0 &&
  orderKey.value !== dismissedOrderKey.value &&
  !String(route.path).startsWith('/checkout') &&
  !String(route.path).endsWith('/seats'),
)

const timeDisplay = computed(() => {
  const m = Math.floor(secondsLeft.value / 60)
  const s = secondsLeft.value % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

const loadFromStorage = () => {
  try {
    const raw = localStorage.getItem('pendingOrder')
    if (!raw) { secondsLeft.value = 0; orderId.value = ''; orderKey.value = ''; return }
    const parsed = JSON.parse(raw)
    const heldUntil = parsed?.heldUntil
    if (!heldUntil || !Number.isFinite(new Date(heldUntil).getTime())) { secondsLeft.value = 0; return }
    const secs = Math.max(0, Math.ceil((new Date(heldUntil).getTime() - Date.now()) / 1000))
    secondsLeft.value = secs
    orderId.value = parsed?.orderId || parsed?.inventoryId || ''
    orderKey.value = `${orderId.value}:${heldUntil}`
    eventName.value = parsed?.event?.name || 'your selected event'
    if (secs === 0 && localStorage.getItem('pendingOrder') === raw) localStorage.removeItem('pendingOrder')
  } catch {
    secondsLeft.value = 0
  }
}

const resume = () => {
  if (orderId.value) router.push(`/checkout/${orderId.value}`)
}

const dismiss = () => {
  // Dismissing presentation must never cancel or delete the held seat.
  dismissedOrderKey.value = orderKey.value
}

const resumeTimer = () => {
  window.clearInterval(ticker)
  loadFromStorage()
  if (document.visibilityState === 'visible') {
    // Read the current order and its absolute expiry. A timer captured while the
    // store was empty must not delete a reservation created later in the session.
    ticker = window.setInterval(loadFromStorage, 1000)
  }
}

watch(() => route.fullPath, loadFromStorage)
onMounted(() => {
  resumeTimer()
  document.addEventListener('visibilitychange', resumeTimer)
  window.addEventListener('storage', loadFromStorage)
})

onUnmounted(() => {
  window.clearInterval(ticker)
  document.removeEventListener('visibilitychange', resumeTimer)
  window.removeEventListener('storage', loadFromStorage)
})
</script>

<template>
  <Transition name="banner-slide">
    <div v-if="visible" class="pending-banner" role="alert">
      <div class="banner-inner">
        <div class="banner-left">
          <span class="banner-timer">{{ timeDisplay }}</span>
          <span class="banner-text">Seat held for <strong>{{ eventName }}</strong> — complete your purchase before time runs out.</span>
        </div>
        <div class="banner-actions">
          <button class="btn-resume" @click="resume">Resume Checkout</button>
          <button class="btn-dismiss" @click="dismiss" aria-label="Dismiss">✕</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.pending-banner {
  position: fixed;
  bottom: 1.5rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  width: min(calc(100% - 2rem), 52rem);
  background: rgba(20, 20, 20, 0.96);
  border: 1px solid rgba(249, 115, 22, 0.35);
  border-radius: 1.2rem;
  backdrop-filter: blur(16px);
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(249, 115, 22, 0.1);
}

.banner-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1.2rem;
  flex-wrap: wrap;
}

.banner-left {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  flex: 1;
  min-width: 0;
}

.banner-timer {
  font-size: 1.1rem;
  font-weight: 900;
  color: #f97316;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.banner-text {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.75);
  line-height: 1.4;
}

.banner-text strong {
  color: #fff;
  font-weight: 700;
}

.banner-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-shrink: 0;
}

.btn-resume {
  padding: 0.5rem 1.1rem;
  border-radius: 0.7rem;
  background: #f97316;
  color: #fff;
  font-size: 0.82rem;
  font-weight: 800;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}

.btn-resume:hover {
  background: #ea6c0a;
}

.btn-dismiss {
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.75rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.btn-dismiss:hover {
  background: rgba(255, 255, 255, 0.12);
}

.banner-slide-enter-active,
.banner-slide-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.banner-slide-enter-from,
.banner-slide-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(1rem);
}
</style>
