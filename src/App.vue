<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { RouterView, useRouter } from 'vue-router'
import AppNavbar from '@/components/common/AppNavbar.vue'
import Footer from '@/components/layout/Footer.vue'
import ToastStack from '@/components/common/ToastStack.vue'
import ConnectionStatus from '@/components/common/ConnectionStatus.vue'
import DebugPanel from '@/components/DebugPanel.vue'
import PendingOrderBanner from '@/components/common/PendingOrderBanner.vue'
import { useAuthStore } from '@/stores/auth'
import { useNotificationStore } from '@/stores/notifications'
import { useWebSocket } from '@/composables/useWebSocket'
import { useToast } from '@/composables/useToast'
import { isDemoMode } from '@/services/mockData'

const router = useRouter()
const auth = useAuthStore()
const notifications = useNotificationStore()
const websocket = useWebSocket()
const toast = useToast()
const showDebugPanel =
  import.meta.env.DEV &&
  (new URLSearchParams(window.location.search).get('debugPanel') === 'true' ||
    window.localStorage.getItem('ticketremaster_debug_panel') === 'true')

const supportsNotificationRuntime = computed(
  () => auth.isLoggedIn && !auth.isStaff && !auth.isAdmin && !isDemoMode(),
)

let unsubscribeTransfer: (() => void) | null = null
let unsubscribeTicket: (() => void) | null = null

const unwrapSocketPayload = (payload: any) => payload?.payload ?? payload

const cleanupNotificationSubscriptions = () => {
  if (unsubscribeTransfer) {
    unsubscribeTransfer()
    unsubscribeTransfer = null
  }
  if (unsubscribeTicket) {
    unsubscribeTicket()
    unsubscribeTicket = null
  }
}

const setupNotificationRuntime = () => {
  if (!supportsNotificationRuntime.value) return

  notifications.initialize()

  if (!unsubscribeTransfer) {
    unsubscribeTransfer = websocket.subscribe('transfer_update', (message: any) => {
      notifications.handleTransferUpdate(unwrapSocketPayload(message.payload))
    })
  }

  if (!unsubscribeTicket) {
    unsubscribeTicket = websocket.subscribe('ticket_update', (message: any) => {
      notifications.handleTicketUpdate(unwrapSocketPayload(message.payload))
    })
  }
}

const handleOffline = () => {
  if (auth.isLoggedIn && !auth.isDemoSession) {
    auth.downgradeToDemo()
    toast.warning('Backend unavailable. Switched to offline demo mode.', 4200)
  }
}

const handleOnline = () => {
  if (auth.restoreFromOfflineFallback()) {
    toast.info('Connection restored. Please sign in again to continue online.', 4200)
    router.push('/login')
  }
}

onMounted(() => {
  window.addEventListener('api:offline', handleOffline)
  window.addEventListener('api:online', handleOnline)
})

watch(
  supportsNotificationRuntime,
  (enabled) => {
    if (enabled) {
      setupNotificationRuntime()
      return
    }

    cleanupNotificationSubscriptions()
    notifications.clearAll()
  },
  { immediate: true },
)

watch(
  () => websocket.state.value.connected,
  (connected) => {
    notifications.setRealtimeConnected(Boolean(connected) && supportsNotificationRuntime.value)
    if (connected && supportsNotificationRuntime.value) {
      void notifications.fetchAll()
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  window.removeEventListener('api:offline', handleOffline)
  window.removeEventListener('api:online', handleOnline)
  cleanupNotificationSubscriptions()
  notifications.clearAll()
})
</script>

<template>
  <ConnectionStatus />
  <AppNavbar />
  <RouterView />
  <Footer />
  <ToastStack />
  <PendingOrderBanner />
  <DebugPanel v-if="showDebugPanel" />
</template>

<style scoped>
</style>
