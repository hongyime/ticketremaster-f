<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Bars3Icon, BellIcon, UserCircleIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { useAuthStore } from '@/stores/auth'
import { useNotificationStore } from '@/stores/notifications'
import api from '@/api/client'
import { useLogout } from '@/composables/useLogout'
import { isDemoMode } from '@/services/mockData'

const auth = useAuthStore()
const notificationStore = useNotificationStore()
const route = useRoute()
const { logout } = useLogout()

const balance = ref<number | null>(null)
const balanceLoading = ref(false)
const mobileMenuOpen = ref(false)
let balanceTimer: number | undefined
const minimalTopNav = computed(() => auth.isAdmin || auth.isStaff || (auth.isLoggedIn && isDemoMode()))
const showNotifications = computed(() => auth.isLoggedIn && !auth.isStaff && !auth.isAdmin && !isDemoMode())
const showGuestNotifications = computed(() => !auth.isLoggedIn && !minimalTopNav.value)
const adminEventId = computed(() => {
  const paramId = typeof route.params.eventId === 'string' ? route.params.eventId : null
  if (paramId) return paramId

  const queryId = typeof route.query.eventId === 'string' ? route.query.eventId : null
  return queryId || null
})
const profileRoute = computed(() => {
  if (!auth.isLoggedIn) return '/login'
  if (auth.isAdmin && adminEventId.value) return `/profile?eventId=${encodeURIComponent(adminEventId.value)}`
  return '/profile'
})

const primaryNav = [
  { to: '/events', label: 'Events' },
  { to: '/marketplace', label: 'Marketplace' },
]

const mobileNav = computed(() => {
  if (auth.isLoggedIn) {
    return [
      { to: '/events', label: 'Events' },
      { to: '/marketplace', label: 'Marketplace' },
      { to: '/help', label: 'Support' },
    ]
  }
  return [
    { to: '/events', label: 'Events' },
    { to: '/marketplace', label: 'Marketplace' },
    { to: '/login', label: 'Login' },
    { to: '/register', label: 'Register' },
    { to: '/help', label: 'Support' },
  ]
})

const fetchBalance = async () => {
  if (!auth.isLoggedIn || auth.isStaff || auth.isAdmin) {
    balance.value = null
    return
  }
  balanceLoading.value = true
  try {
    if (isDemoMode()) {
      const stored = sessionStorage.getItem('demo_balance')
      balance.value = stored !== null ? parseFloat(stored) : 500
      return
    }
    const { data } = await api.get('/credits/balance')
    const value = data?.data?.creditBalance ?? data?.creditBalance
    balance.value = typeof value === 'number' ? value : null
  } catch {
    balance.value = null
  } finally {
    balanceLoading.value = false
  }
}

const scheduleBalance = () => {
  if (balanceTimer) clearTimeout(balanceTimer)
  balanceTimer = window.setTimeout(fetchBalance, 250)
}

const showBalanceChip = computed(() => {
  if (!auth.isLoggedIn || auth.isStaff || auth.isAdmin) return false
  return balanceLoading.value || balance.value !== null
})

const balanceLabel = computed(() => {
  if (!auth.isLoggedIn || auth.isStaff || auth.isAdmin) return null
  if (balanceLoading.value) return '$ ...'
  if (balance.value === null) return null
  return `$${balance.value.toFixed(2)}`
})
const notificationCount = computed(() => notificationStore.unreadCount)

const isActive = (target: string) => route.path === target || route.path.startsWith(`${target}/`)

watch(() => auth.isLoggedIn, () => {
  if (auth.isLoggedIn) {
    scheduleBalance()
  }
})

watch(() => route.fullPath, () => {
  mobileMenuOpen.value = false
  if (auth.isLoggedIn && !auth.isStaff && !auth.isAdmin) scheduleBalance()
})

onMounted(() => {
  if (auth.isLoggedIn) {
    scheduleBalance()
  }
})

</script>

<template>
  <header class="nav-shell">
    <div class="nav-pill">
      <RouterLink to="/" class="brand">TicketRemaster</RouterLink>

      <nav class="desktop-nav" aria-label="Primary">
        <RouterLink
          v-for="item in primaryNav"
          :key="item.to"
          :to="item.to"
          class="center-link"
          :class="{ active: isActive(item.to) }"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="action-cluster">
        <RouterLink v-if="showBalanceChip" to="/credits/topup" class="balance-chip">
          {{ balanceLabel }}
        </RouterLink>
        <span v-if="isDemoMode()" class="demo-chip">Demo</span>
        <RouterLink v-if="showGuestNotifications" to="/login" class="icon-button" aria-label="Notifications">
          <BellIcon class="icon" />
        </RouterLink>
        <RouterLink v-if="showNotifications" to="/notifications" class="icon-button" aria-label="Notifications">
          <BellIcon class="icon" />
          <span v-if="notificationCount" class="icon-count">{{ notificationCount }}</span>
        </RouterLink>
        <RouterLink :to="profileRoute" class="icon-button profile-button" :aria-label="auth.isLoggedIn ? 'Profile' : 'Login'">
          <UserCircleIcon class="icon" />
        </RouterLink>
        <button
          class="icon-button mobile-toggle"
          type="button"
          :aria-label="mobileMenuOpen ? 'Close navigation' : 'Open navigation'"
          @click="mobileMenuOpen = !mobileMenuOpen"
        >
          <XMarkIcon v-if="mobileMenuOpen" class="icon" />
          <Bars3Icon v-else class="icon" />
        </button>
      </div>
    </div>

    <nav v-if="mobileMenuOpen" class="mobile-panel" aria-label="Mobile">
      <RouterLink
        v-for="item in mobileNav"
        :key="item.to"
        :to="item.to"
        class="mobile-link"
      >
        {{ item.label }}
      </RouterLink>
      <button v-if="auth.isLoggedIn" class="mobile-link mobile-logout" type="button" @click="logout">Logout</button>
    </nav>
  </header>
</template>

<style scoped>
.nav-shell {
  position: fixed;
  top: 1.5rem;
  left: 50%;
  z-index: 100;
  width: min(90%, 64rem);
  transform: translateX(-50%);
}

.nav-pill {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1rem;
  min-height: 4rem;
  padding: 0.8rem 1.4rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  background: rgba(14, 14, 14, 0.7);
  backdrop-filter: blur(24px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}

.brand {
  font-family: "Plus Jakarta Sans", Inter, sans-serif;
  font-size: 0.86rem;
  font-weight: 900;
  letter-spacing: -0.04em;
  text-transform: uppercase;
  color: #fff;
  white-space: nowrap;
}

.desktop-nav {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1.75rem;
}

.center-link {
  padding-bottom: 0.2rem;
  color: rgba(255, 255, 255, 0.62);
  font-size: 0.82rem;
  font-weight: 500;
  transition: color 0.18s ease, border-color 0.18s ease;
  border-bottom: 2px solid transparent;
}

.center-link.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

.action-cluster {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.55rem;
}

.balance-chip,
.demo-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.48rem 0.85rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.balance-chip {
  background: rgba(249, 115, 22, 0.1);
  border: 1px solid rgba(249, 115, 22, 0.22);
  color: var(--primary);
}

.demo-chip {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--primary);
  text-transform: uppercase;
}

.demo-chip {
  color: var(--primary);
}

.icon-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  padding: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.82);
}

.profile-button {
  background: rgba(249, 115, 22, 0.16);
  border-color: rgba(249, 115, 22, 0.18);
  color: var(--primary);
}

.icon {
  width: 1rem;
  height: 1rem;
}

.icon-count {
  position: absolute;
  top: -0.1rem;
  right: -0.1rem;
  min-width: 1rem;
  height: 1rem;
  padding: 0 0.2rem;
  border-radius: 999px;
  background: var(--primary);
  color: #1f0d03;
  font-size: 0.62rem;
  font-weight: 800;
  line-height: 1rem;
  text-align: center;
}

.mobile-toggle {
  display: none;
}

.mobile-panel {
  margin-top: 0.75rem;
  display: grid;
  gap: 0.35rem;
  padding: 0.8rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 1.75rem;
  background: rgba(14, 14, 14, 0.84);
  backdrop-filter: blur(24px);
  box-shadow: 0 20px 42px rgba(0, 0, 0, 0.32);
}

.mobile-link {
  display: block;
  padding: 0.85rem 1rem;
  border-radius: 1rem;
  color: rgba(255, 255, 255, 0.84);
  font-weight: 600;
}

.mobile-logout {
  width: 100%;
  justify-content: flex-start;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.84);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

@media (max-width: 900px) {
  .nav-pill {
    grid-template-columns: auto 1fr auto;
    padding-inline: 1rem;
  }

  .desktop-nav,
  .balance-chip,
  .demo-chip {
    display: none;
  }

  .mobile-toggle {
    display: inline-flex;
  }
}

@media (max-width: 540px) {
  .nav-shell {
    top: 1rem;
    width: min(94%, 40rem);
  }

  .nav-pill {
    min-height: 3.6rem;
    padding: 0.6rem 0.9rem;
  }

  .brand {
    font-size: 0.78rem;
  }
}
</style>
