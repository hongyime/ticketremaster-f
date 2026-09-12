import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import {
  savePendingRegistration,
  readPendingRegistration,
  clearPendingRegistration,
} from '@/utils/registrationState'
import api from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useNotificationStore } from '@/stores/notifications'
import { isDemoMode } from '@/services/mockData'

vi.mock('@/api/client', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ push: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

vi.mock('@/utils/eventMedia', () => ({
  resolveEventImage: vi.fn().mockReturnValue('/mock-image.jpg'),
}))

vi.mock('qrcode', () => ({
  default: {
    toCanvas: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
  return {
    ...actual,
    useRoute: vi.fn().mockReturnValue({
      path: '/events',
      fullPath: '/events',
      params: { transferId: 'demo-transfer-001', orderId: 'demo-order-001' },
      query: {},
    }),
    useRouter: vi.fn().mockReturnValue({ push: vi.fn() }),
    RouterLink: { template: '<a><slot /></a>' },
    onBeforeRouteLeave: vi.fn(),
  }
})

vi.mock('@/components/account/AccountSidebar.vue', () => ({
  default: { template: '<div class="account-sidebar-stub" />' },
}))

const mockData = vi.hoisted(() => ({
  marketplaceListings: [
    {
      listingId: 'listing-self-001',
      ticketId: 'ticket-self-001',
      sellerId: 'user-self-001',
      eventId: 'evt-001',
      price: 180,
      status: 'active',
      createdAt: new Date().toISOString(),
      event: {
        eventId: 'evt-001',
        name: 'Neon Nights',
        date: new Date().toISOString(),
        venueId: 'ven-001',
        price: 180,
        type: 'concert',
        image: '/mock-image.jpg',
      },
    },
  ],
  venues: [
    { venueId: 'ven-001', name: 'Esplanade Concert Hall', address: '1 Esplanade Drive' },
  ],
  events: [
    { eventId: 'evt-001', venueId: 'ven-001', name: 'Neon Nights', date: new Date().toISOString() },
  ],
}))

vi.mock('@/services/mockData', () => ({
  isDemoMode: vi.fn().mockReturnValue(true),
  mockEvents: [],
  mockTransfers: [],
  mockUser: { userId: 'u1', email: 'user@test.com', phoneNumber: '+6511111111', role: 'user', isFlagged: false, isAdmin: false },
  mockAdminUser: { userId: 'a1', email: 'admin@test.com', phoneNumber: '+6511111112', role: 'admin', isFlagged: false, isAdmin: true },
  mockStaffUser: { userId: 's1', email: 'staff@test.com', phoneNumber: '+6511111113', role: 'staff', isFlagged: false, isAdmin: false, venueId: 'ven-001' },
  setDemoMode: vi.fn(),
  mockServices: {
    getMarketplaceListings: vi.fn().mockResolvedValue({
      listings: mockData.marketplaceListings,
      pagination: { page: 1, limit: 10, total: 1 },
    }),
    getMyTickets: vi.fn().mockResolvedValue({ tickets: [] }),
    getVenues: vi.fn().mockResolvedValue({ venues: mockData.venues }),
    getEvents: vi.fn().mockResolvedValue({ events: mockData.events, pagination: { page: 1, limit: 200, total: 1 } }),
  },
}))

function createTestPinia() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

function seedAuthUser(overrides: Record<string, any> = {}) {
  const auth = useAuthStore()
  auth.state.accessToken = 'demo-token'
  auth.state.user = {
    userId: 'user-self-001',
    email: 'user@test.com',
    phoneNumber: '+6511111111',
    role: 'user',
    isFlagged: false,
    isAdmin: false,
    ...overrides,
  } as any
}

async function flushAsync() {
  await Promise.resolve()
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function flushNavbarBalance() {
  await new Promise((resolve) => setTimeout(resolve, 300))
  await flushAsync()
}

describe('Frontend UX Fixes — targeted coverage', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.clearAllMocks()
    vi.mocked(isDemoMode).mockReturnValue(true)
    createTestPinia()
    seedAuthUser()
  })

  it('registration helper clears stale pending state after TTL expiry', () => {
    savePendingRegistration({
      userId: 'user-ttl-001',
      fullName: 'TTL User',
      email: 'ttl@example.com',
      phoneNumber: '+6512345678',
    })

    const raw = localStorage.getItem('pending_registration')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw as string)
    parsed.expiresAt = new Date(Date.now() - 60_000).toISOString()
    localStorage.setItem('pending_registration', JSON.stringify(parsed))

    const stale = readPendingRegistration()
    expect(stale).toBeNull()
    expect(localStorage.getItem('pending_registration')).toBeNull()

    clearPendingRegistration()
  })

  it('verify OTP grid click focuses the hidden OTP input', async () => {
    vi.mocked(isDemoMode).mockReturnValue(false)
    const { default: VerifyView } = await import('../VerifyView.vue')
    const wrapper = mount(VerifyView, { attachTo: document.body })
    await flushAsync()

    await wrapper.find('.otp-grid').trigger('click')
    const input = wrapper.find('.otp-hidden-input').element as HTMLInputElement
    expect(document.activeElement).toBe(input)
    wrapper.unmount()
  })

  it('ticket QR view resolves event details from qrHash without showing obsidian fallback copy', async () => {
    vi.mocked(isDemoMode).mockReturnValue(false)
    const { useRoute } = await import('vue-router')
    vi.mocked(useRoute).mockReturnValueOnce({
      path: '/ticket-qr/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      fullPath: '/ticket-qr/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      params: { qrHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      query: {},
    } as any)

    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/tickets/qr/')) {
        return Promise.resolve({
          data: {
            data: {
              ticketId: 'tkt-qr-001',
              qrHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              status: 'active',
              seat: { section: 'VIP', rowNumber: 'A', seatNumber: '12', gate: 'North' },
              event: { name: 'Singapore Jazz Festival 2026', date: '2026-05-10T20:00:00Z' },
              venue: { name: 'Singapore Indoor Stadium', address: '2 Stadium Walk' },
            },
          },
        }) as any
      }
      return Promise.resolve({ data: {} }) as any
    })

    const { default: TicketQrView } = await import('../TicketQrView.vue')
    const wrapper = shallowMount(TicketQrView)
    await flushAsync()

    expect(wrapper.text()).toContain('Singapore Jazz Festival 2026')
    expect(wrapper.text()).toContain('Singapore Indoor Stadium')
    expect(wrapper.text()).toContain('VIP')
    expect(wrapper.text()).not.toContain('The Obsidian Hearth Series')
    wrapper.unmount()
  })

  it('ticket QR view hydrates full seat details when entered with a ticket id first', async () => {
    vi.mocked(isDemoMode).mockReturnValue(false)
    const { useRoute } = await import('vue-router')
    vi.mocked(useRoute).mockReturnValueOnce({
      path: '/ticket-qr/tkt-qr-002',
      fullPath: '/ticket-qr/tkt-qr-002',
      params: { qrHash: 'tkt-qr-002' },
      query: {},
    } as any)

    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/tickets/tkt-qr-002/qr') {
        return Promise.resolve({
          data: {
            data: {
              ticketId: 'tkt-qr-002',
              qrHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              status: 'active',
              event: { name: 'Taylor Swift | The Eras Tour', date: '2026-06-15T11:30:00Z' },
              venue: { name: 'Esplanade Concert Hall', address: '1 Esplanade Drive' },
            },
          },
        }) as any
      }

      if (url === '/tickets/qr/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') {
        return Promise.resolve({
          data: {
            data: {
              ticketId: 'tkt-qr-002',
              qrHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              status: 'active',
              seat: { section: 'GA', rowNumber: 'A', seatNumber: '12', gate: 'North' },
              event: { name: 'Taylor Swift | The Eras Tour', date: '2026-06-15T11:30:00Z' },
              venue: { name: 'Esplanade Concert Hall', address: '1 Esplanade Drive' },
            },
          },
        }) as any
      }

      return Promise.resolve({ data: {} }) as any
    })

    const { default: TicketQrView } = await import('../TicketQrView.vue')
    const wrapper = shallowMount(TicketQrView)
    await flushAsync()

    expect(wrapper.text()).toContain('Taylor Swift | The Eras Tour')
    expect(wrapper.text()).toContain('Esplanade Concert Hall')
    expect(wrapper.text()).toContain('GA')
    expect(wrapper.text()).toContain('North')
    expect(wrapper.text()).not.toContain('Add to Apple Wallet')
    wrapper.unmount()
  })

  it('ticket detail view hydrates seat context from the qr hash lookup and hides secondary actions', async () => {
    vi.mocked(isDemoMode).mockReturnValue(false)
    const { useRoute } = await import('vue-router')
    vi.mocked(useRoute).mockReturnValueOnce({
      path: '/tickets/tkt-detail-001',
      fullPath: '/tickets/tkt-detail-001',
      params: { ticketId: 'tkt-detail-001' },
      query: {},
    } as any)

    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/tickets') {
        return Promise.resolve({
          data: {
            data: {
              tickets: [
                {
                  ticketId: 'tkt-detail-001',
                  status: 'active',
                  price: 188,
                  createdAt: '2026-04-08T12:00:00Z',
                  event: {
                    eventId: 'evt-001',
                    name: 'Taylor Swift | The Eras Tour',
                    date: '2026-06-15T11:30:00Z',
                  },
                  venue: {
                    venueId: 'ven-001',
                    name: 'Esplanade Concert Hall',
                  },
                },
              ],
            },
          },
        }) as any
      }

      if (url === '/tickets/tkt-detail-001/qr') {
        return Promise.resolve({
          data: {
            data: {
              ticketId: 'tkt-detail-001',
              qrHash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              event: { name: 'Taylor Swift | The Eras Tour', date: '2026-06-15T11:30:00Z' },
              venue: { name: 'Esplanade Concert Hall', address: '1 Esplanade Drive' },
            },
          },
        }) as any
      }

      if (url === '/tickets/qr/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc') {
        return Promise.resolve({
          data: {
            data: {
              ticketId: 'tkt-detail-001',
              qrHash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
              status: 'active',
              seat: { section: 'GA', rowNumber: 'A', seatNumber: '12', gate: 'North' },
              event: { name: 'Taylor Swift | The Eras Tour', date: '2026-06-15T11:30:00Z' },
              venue: { name: 'Esplanade Concert Hall', address: '1 Esplanade Drive' },
            },
          },
        }) as any
      }

      return Promise.resolve({ data: {} }) as any
    })

    const { default: TicketDetailView } = await import('../TicketDetailView.vue')
    const wrapper = shallowMount(TicketDetailView)
    await flushAsync()

    expect(wrapper.text()).toContain('Taylor Swift | The Eras Tour')
    expect(wrapper.text()).toContain('Esplanade Concert Hall')
    expect(wrapper.text()).toContain('GA')
    expect(wrapper.text()).toContain('North')
    expect(wrapper.text()).not.toContain('Add to Apple Wallet')
    expect(wrapper.text()).not.toContain('Open Full QR')
    wrapper.unmount()
  })

  it('verification success stays sidebar-free and keeps primary card layout', async () => {
    const { default: VerificationSuccessView } = await import('../VerificationSuccessView.vue')
    const wrapper = mount(VerificationSuccessView)
    await flushAsync()

    expect(wrapper.find('.verification-card').exists()).toBe(true)
    expect(wrapper.find('.account-sidebar-stub').exists()).toBe(false)
  })

  it('transfer stays sidebar-free and shows a waiting state to the buyer during seller OTP', async () => {
    const { default: TransferConfirmView } = await import('../TransferConfirmView.vue')
    const wrapper = shallowMount(TransferConfirmView)
    await flushAsync()

    const vm = wrapper.vm as any
    vm.transfer = {
      transferId: 'demo-transfer-001',
      status: 'pending_seller_otp',
      sellerId: 'different-seller-id',
      buyerId: 'user-self-001',
      eventName: 'Neon Nights',
      seatRow: '12',
      seatNumber: '08',
    }
    await nextTick()

    expect(wrapper.find('.otp-layout').exists()).toBe(false)
    expect(wrapper.find('.account-sidebar-stub').exists()).toBe(false)
    expect(wrapper.text()).toContain('Waiting for seller verification')
    expect(wrapper.find('.otp-grid').exists()).toBe(false)
  })

  it('transfer keeps buyer out of OTP stage until buyer verification is actually ready', async () => {
    const { default: TransferConfirmView } = await import('../TransferConfirmView.vue')
    const wrapper = shallowMount(TransferConfirmView)
    await flushAsync()

    const vm = wrapper.vm as any
    vm.transfer = {
      transferId: 'demo-transfer-001',
      status: 'pending_buyer_otp',
      sellerOtpVerified: false,
      buyerVerificationSid: null,
      sellerId: 'seller-001',
      buyerId: 'user-self-001',
      eventName: 'Neon Nights',
    }
    await nextTick()

    expect(wrapper.find('.otp-layout').exists()).toBe(false)
    expect(wrapper.text()).toContain('Preparing buyer verification.')
    expect(wrapper.text()).not.toContain('Waiting for buyer verification')
  })

  it('transfer page does not auto-resend seller OTP on mount', async () => {
    vi.mocked(isDemoMode).mockReturnValue(false)
    seedAuthUser({ userId: 'seller-001' })
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        data: {
          transferId: 'demo-transfer-001',
          status: 'pending_seller_otp',
          sellerId: 'seller-001',
          buyerId: 'buyer-001',
          sellerVerificationSid: 'VE_seller',
          eventName: 'Neon Nights',
        },
      },
    } as any)

    const { default: TransferConfirmView } = await import('../TransferConfirmView.vue')
    shallowMount(TransferConfirmView)
    await flushAsync()

    expect(vi.mocked(api.post)).not.toHaveBeenCalledWith(expect.stringContaining('/resend-otp'))
  })

  it('transfer treats pending buyer OTP as buyer-ready when blocking fields are missing instead of explicitly false', async () => {
    const { default: TransferConfirmView } = await import('../TransferConfirmView.vue')
    const wrapper = shallowMount(TransferConfirmView)
    await flushAsync()

    const vm = wrapper.vm as any
    vm.transfer = {
      transferId: 'demo-transfer-001',
      status: 'pending_buyer_otp',
      sellerId: 'user-self-001',
      buyerId: 'buyer-001',
      eventName: 'Neon Nights',
    }
    await nextTick()

    expect(wrapper.find('.otp-layout').exists()).toBe(false)
    expect(wrapper.text()).toContain('Waiting for buyer verification')
    expect(wrapper.text()).not.toContain('Waiting for seller verification')
  })

  it('transfer shows the buyer OTP stage with live event details once seller verification is complete', async () => {
    const { default: TransferConfirmView } = await import('../TransferConfirmView.vue')
    const wrapper = shallowMount(TransferConfirmView)
    await flushAsync()

    const vm = wrapper.vm as any
    vm.transfer = {
      transferId: 'demo-transfer-001',
      status: 'pending_buyer_otp',
      sellerOtpVerified: true,
      buyerVerificationSid: 'VE_buyer',
      sellerId: 'seller-001',
      buyerId: 'user-self-001',
      eventName: 'Singapore Jazz Festival 2026',
      seatRow: 'B',
      seatNumber: '14',
    }
    await nextTick()

    expect(wrapper.find('.otp-layout').exists()).toBe(true)
    expect(wrapper.text()).toContain('Singapore Jazz Festival 2026')
    expect(wrapper.text()).toContain('Row B')
    expect(wrapper.text()).toContain('Seat 14')
    expect(wrapper.text()).toContain('Verify & Complete')
    expect(wrapper.text()).not.toContain('Waiting for seller verification')
  })

  it('transfer completion state keeps buyer and seller CTAs distinct', async () => {
    const { default: TransferConfirmView } = await import('../TransferConfirmView.vue')
    const wrapper = mount(TransferConfirmView)
    await flushAsync()

    const vm = wrapper.vm as any
    vm.transfer = {
      transferId: 'demo-transfer-001',
      status: 'completed',
      sellerId: 'seller-001',
      buyerId: 'user-self-001',
      creditAmount: 180,
      eventName: 'Neon Nights',
    }
    await nextTick()

    expect(wrapper.text()).toContain('Transfer complete.')
    expect(wrapper.text()).toContain('View Tickets')
    expect(wrapper.text()).not.toContain('Back to Marketplace')

    seedAuthUser({ userId: 'seller-001' })
    await nextTick()

    expect(wrapper.text()).toContain('Back to Marketplace')
    expect(wrapper.text()).not.toContain('View Tickets')
  })

  it('transfer page uses cached initiated transfer context instead of placeholder copy when live fetch fails', async () => {
    vi.mocked(isDemoMode).mockReturnValue(false)
    vi.mocked(api.get).mockRejectedValueOnce({ response: { status: 404 } } as any)
    sessionStorage.setItem(
      'transfer_context:demo-transfer-001',
      JSON.stringify({
        transferId: 'demo-transfer-001',
        status: 'pending_seller_acceptance',
        sellerName: 'Casey Seller',
        eventName: 'Singapore Jazz Festival 2026',
        eventDate: '2026-05-10T20:00:00Z',
        location: 'Singapore Indoor Stadium',
        seatSection: 'VIP',
        seatRow: 'B',
        seatNumber: '14',
      }),
    )

    const { default: TransferConfirmView } = await import('../TransferConfirmView.vue')
    const wrapper = shallowMount(TransferConfirmView)
    await flushAsync()

    expect(wrapper.text()).toContain('Singapore Jazz Festival 2026')
    expect(wrapper.text()).toContain('Casey Seller')
    expect(wrapper.text()).toContain('Singapore Indoor Stadium')
    expect(wrapper.text()).toContain('VIP')
    expect(wrapper.text()).not.toContain('Afterlife: Echoes of Eternity')
    expect(wrapper.text()).not.toContain('The Obsidian Dome')
    expect(wrapper.text()).not.toContain('Julian Vane')
  })

  it('transfer page hydrates incoming seller transfers from pending transfer collections when direct lookup is bare', async () => {
    vi.mocked(isDemoMode).mockReturnValue(false)
    seedAuthUser({ userId: 'seller-self-001' })
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/transfer/demo-transfer-001') {
        return Promise.resolve({
          data: {
            data: {
              transferId: 'demo-transfer-001',
              status: 'pending_seller_acceptance',
              buyerId: 'buyer-001',
              sellerId: 'seller-self-001',
            },
          },
        }) as any
      }

      if (url === '/transfer/pending') {
        return Promise.resolve({
          data: {
            data: {
              transfers: [
                {
                  transferId: 'demo-transfer-001',
                  status: 'pending_seller_acceptance',
                  buyerId: 'buyer-001',
                  sellerId: 'seller-self-001',
                  sellerName: 'Mia Seller',
                  eventName: 'Singapore Jazz Festival 2026',
                  eventImage: '/jazz-festival.jpg',
                  location: 'Singapore Indoor Stadium',
                  seatSection: 'VIP',
                  seatRow: 'B',
                  seatNumber: '14',
                },
              ],
            },
          },
        }) as any
      }

      return Promise.resolve({ data: { data: { transfers: [] } } }) as any
    })

    const { default: TransferConfirmView } = await import('../TransferConfirmView.vue')
    const wrapper = shallowMount(TransferConfirmView)
    await flushAsync()

    expect(wrapper.text()).toContain('Singapore Jazz Festival 2026')
    expect(wrapper.text()).toContain('Singapore Indoor Stadium')
    expect(wrapper.text()).toContain('VIP')
    expect(wrapper.text()).not.toContain('Transfer request')
    wrapper.unmount()
  })

  it('transfer page enriches buyer request details from listing and event resources when transfer lookup is incomplete', async () => {
    vi.mocked(isDemoMode).mockReturnValue(false)
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/transfer/demo-transfer-001') {
        return Promise.resolve({
          data: {
            data: {
              transferId: 'demo-transfer-001',
              status: 'pending_seller_acceptance',
              buyerId: 'user-self-001',
              sellerId: 'seller-001',
              listingId: 'listing-001',
            },
          },
        }) as any
      }

      if (url === '/transfer/pending' || url === '/transfer/my-pending' || url === '/transfer/history') {
        return Promise.resolve({ data: { data: { transfers: [] } } }) as any
      }

      if (url === '/marketplace/listing-001') {
        return Promise.resolve({
          data: {
            data: {
              listingId: 'listing-001',
              ticketId: 'ticket-001',
            },
          },
        }) as any
      }

      if (url === '/tickets/ticket-001') {
        return Promise.resolve({
          data: {
            data: {
              ticketId: 'ticket-001',
              eventId: 'evt-001',
              venueId: 'ven-001',
              seat: {
                section: 'VIP',
                rowNumber: 'B',
                seatNumber: '14',
              },
            },
          },
        }) as any
      }

      if (url === '/events/evt-001') {
        return Promise.resolve({
          data: {
            data: {
              eventId: 'evt-001',
              name: 'Singapore Jazz Festival 2026',
              date: '2026-05-10T20:00:00Z',
              image: '/jazz-festival.jpg',
              type: 'festival',
              venue: {
                venueId: 'ven-001',
                name: 'Singapore Indoor Stadium',
              },
            },
          },
        }) as any
      }

      return Promise.resolve({ data: {} }) as any
    })

    const { default: TransferConfirmView } = await import('../TransferConfirmView.vue')
    const wrapper = shallowMount(TransferConfirmView)
    await flushAsync()

    expect(wrapper.text()).toContain('Singapore Jazz Festival 2026')
    expect(wrapper.text()).toContain('Singapore Indoor Stadium')
    expect(wrapper.text()).toContain('VIP')
    expect(wrapper.text()).not.toContain('Location unavailable')
    wrapper.unmount()
  })

  it('notification store merges sources and dedupes by id', () => {
    const store = useNotificationStore()

    store.sellerPending = [
      {
        id: 'dup-001',
        type: 'seller_pending_acceptance',
        title: 'Seller pending',
        body: 'Seller pending item',
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        transferId: 't-001',
      },
    ] as any
    store.buyerPending = [
      {
        id: 'dup-001',
        type: 'buyer_pending_otp',
        title: 'Buyer pending',
        body: 'Buyer pending item',
        createdAt: new Date().toISOString(),
        transferId: 't-001',
      },
    ] as any

    expect(store.allNotifications.length).toBe(1)
    expect(store.allNotifications[0].title).toBe('Buyer pending')

    store.addEphemeral({
      type: 'transfer_completed',
      title: 'Transfer Complete',
      body: 'Your transfer is complete.',
      createdAt: new Date().toISOString(),
      primaryTo: '/tickets',
      transferId: 't-001',
    })
    store.addEphemeral({
      type: 'transfer_completed',
      title: 'Transfer Complete',
      body: 'Your transfer is complete.',
      createdAt: new Date().toISOString(),
      primaryTo: '/tickets',
      transferId: 't-001',
    })

    expect(store.ephemeral.length).toBe(1)
  })

  it('notification store treats buyer pending 404 as empty without warning noise', async () => {
    vi.mocked(isDemoMode).mockReturnValue(false)
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(api.get).mockRejectedValueOnce({ response: { status: 404 } } as any)

    const store = useNotificationStore()
    await store.fetchBuyerPending()

    expect(store.buyerPending).toEqual([])
    expect(consoleWarn).not.toHaveBeenCalled()
  })

  it('notification store shows seller OTP-ready copy after buyer verification', async () => {
    vi.mocked(isDemoMode).mockReturnValue(false)
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        data: {
          transfers: [
            {
              transferId: 'transfer-seller-001',
              buyerName: 'Avery Buyer',
              eventName: 'Neon Nights',
              status: 'pending_seller_otp',
            },
          ],
        },
      },
    } as any)

    const store = useNotificationStore()
    await store.fetchSellerPending()

    expect(store.sellerPending).toHaveLength(1)
    expect(store.sellerPending[0].body).toContain('Enter your seller OTP to complete the transfer')
    expect(store.sellerPending[0].body).not.toContain('accept it to receive your seller OTP')
  })

  it('checkout hydrates sparse pending orders with fallback event and seat pricing', async () => {
    localStorage.setItem(
      'pendingOrder',
      JSON.stringify({
        orderId: 'demo-order-001',
        inventoryId: 'demo-order-001',
        holdToken: 'hold-123',
        heldUntil: new Date(Date.now() + 300_000).toISOString(),
        eventId: 'evt_001',
        seat: {},
        event: {
          name: 'Recovered Event',
          price: 248,
          venueName: 'Esplanade Concert Hall',
          eventDate: '2026-06-15T19:30:00',
        },
      }),
    )

    const { default: CheckoutView } = await import('../CheckoutView.vue')
    const wrapper = shallowMount(CheckoutView)
    await flushAsync()

    const vm = wrapper.vm as any
    expect(vm.order?.event?.name).toBe('Recovered Event')
    expect(vm.order?.seat?.price).toBeGreaterThan(0)
    expect(vm.seatPrice).toBeGreaterThan(0)
  })

  it('scanner keeps verify controls locked until venue/event are confirmed', async () => {
    const { default: StaffScannerView } = await import('../StaffScannerView.vue')
    const wrapper = mount(StaffScannerView)
    await flushAsync()

    const selects = wrapper.findAll('select')
    expect(selects.length).toBe(2)

    const manualInput = wrapper.find('input[placeholder="Ticket ID"]')
    expect(manualInput.attributes('disabled')).toBeDefined()

    await selects[0].setValue('ven-001')
    await selects[1].setValue('evt-001')
    await nextTick()

    const confirmButton = wrapper
      .findAll('button')
      .find((btn) => /confirm selection|reconfirm selection/i.test(btn.text()))
    expect(confirmButton).toBeTruthy()
    await confirmButton!.trigger('click')
    await nextTick()

    expect(wrapper.text()).toContain('Scanning session')
    expect(wrapper.find('input[placeholder="Ticket ID"]').attributes('disabled')).toBeUndefined()
  })

  it('marketplace renders own listed ticket with readable disabled listed button', async () => {
    const { default: MarketplaceView } = await import('../MarketplaceView.vue')
    const wrapper = mount(MarketplaceView)
    await flushAsync()

    const listedButton = wrapper.find('.listed-button')
    expect(listedButton.exists()).toBe(true)
    expect(listedButton.attributes('disabled')).toBeDefined()
    expect((listedButton.attributes('style') || '').includes('opacity: 0.45')).toBe(false)
  })

  it('navbar keeps the credit chip visible for zero balances but hides unresolved, staff, and admin states', async () => {
    const mockApiGet = vi.mocked(api.get)
    vi.mocked(isDemoMode).mockReturnValue(false)

    const { default: AppNavbar } = await import('@/components/common/AppNavbar.vue')

    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/credits/balance')) {
        return Promise.resolve({ data: { data: { creditBalance: 125 } } }) as any
      }
      if (url.includes('/transfer/')) {
        return Promise.resolve({ data: { transfers: [] } }) as any
      }
      return Promise.resolve({ data: {} }) as any
    })

    seedAuthUser({ role: 'user', isAdmin: false })
    const userWrapper = mount(AppNavbar)
    await flushNavbarBalance()
    expect(userWrapper.find('.balance-chip').exists()).toBe(true)
    expect(userWrapper.find('.balance-chip').text()).toContain('$125.00')
    userWrapper.unmount()

    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/credits/balance')) {
        return Promise.resolve({ data: { data: { creditBalance: 0 } } }) as any
      }
      if (url.includes('/transfer/')) {
        return Promise.resolve({ data: { transfers: [] } }) as any
      }
      return Promise.resolve({ data: {} }) as any
    })

    seedAuthUser({ role: 'user', isAdmin: false })
    const zeroWrapper = mount(AppNavbar)
    await flushNavbarBalance()
    expect(zeroWrapper.find('.balance-chip').exists()).toBe(true)
    expect(zeroWrapper.find('.balance-chip').text()).toContain('$0.00')
    zeroWrapper.unmount()

    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/credits/balance')) {
        return Promise.resolve({ data: { data: {} } }) as any
      }
      if (url.includes('/transfer/')) {
        return Promise.resolve({ data: { transfers: [] } }) as any
      }
      return Promise.resolve({ data: {} }) as any
    })

    seedAuthUser({ role: 'user', isAdmin: false })
    const unresolvedWrapper = mount(AppNavbar)
    await flushNavbarBalance()
    expect(unresolvedWrapper.find('.balance-chip').exists()).toBe(false)
    unresolvedWrapper.unmount()

    seedAuthUser({ role: 'staff', isAdmin: false })
    const staffWrapper = mount(AppNavbar)
    await flushNavbarBalance()
    expect(staffWrapper.find('.balance-chip').exists()).toBe(false)
    staffWrapper.unmount()

    seedAuthUser({ role: 'admin', isAdmin: true })
    const adminWrapper = mount(AppNavbar)
    await flushNavbarBalance()
    expect(adminWrapper.find('.balance-chip').exists()).toBe(false)
    adminWrapper.unmount()
  })

  it('my tickets archive shows seller-completed transfers in Past & Transferred', async () => {
    const mockApiGet = vi.mocked(api.get)
    vi.mocked(isDemoMode).mockReturnValue(false)

    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/tickets')) {
        return Promise.resolve({ data: { data: { tickets: [] } } }) as any
      }
      if (url.includes('/transfer/history')) {
        return Promise.resolve({
          data: {
            data: {
              transfers: [
                {
                  transferId: 'trf-archive-001',
                  ticketId: 'tkt-archive-001',
                  sellerId: 'user-self-001',
                  status: 'completed',
                  creditAmount: 180,
                  createdAt: '2026-03-10T10:00:00Z',
                  completedAt: '2026-03-10T11:00:00Z',
                  event: {
                    eventId: 'evt-001',
                    name: 'Neon Nights',
                    date: '2026-08-01T20:00:00Z',
                    type: 'concert',
                    image: '/mock-image.jpg',
                    venue: { venueId: 'ven-001', name: 'Esplanade Concert Hall' },
                  },
                  venue: { venueId: 'ven-001', name: 'Esplanade Concert Hall' },
                  seat: { seatId: 'seat-001', rowNumber: 'A', seatNumber: '12', section: 'VIP' },
                },
              ],
            },
          },
        }) as any
      }
      return Promise.resolve({ data: {} }) as any
    })

    seedAuthUser({ role: 'user', isAdmin: false })
    const { default: MyTicketsView } = await import('../MyTicketsView.vue')
    const wrapper = mount(MyTicketsView)
    await flushAsync()

    expect(wrapper.text()).toContain('Past & Transferred')
    expect(wrapper.text()).toContain('Neon Nights')
    expect(wrapper.text()).toContain('Transferred')
    expect(wrapper.find('.archive-pill.transferred').exists()).toBe(true)
  })
})
