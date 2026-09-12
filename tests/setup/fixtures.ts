import { monitorConsole } from './console-monitor'
import { test as base, expect, type WebSocketRoute, type BrowserContext } from '@playwright/test'

export async function seedUser(context: BrowserContext, role = 'user', userId = 'usr_001') {
  await context.addInitScript(({ role, userId }) => {
      if (location.origin !== 'http://127.0.0.1:43187') return
    localStorage.setItem('access_token', 'fixture-token')
    localStorage.setItem('refresh_token', 'fixture-refresh')
    localStorage.setItem('user', JSON.stringify({ userId, email: 'test@example.com', role }))
  }, { role, userId })
}

export const event = {
  eventId: 'evt_001', name: 'Taylor Swift', eventDate: '2030-06-15T19:00:00Z',
  description: 'Fixture concert', status: 'published', type: 'concert',
  venue: { venueId: 'venue_001', name: 'National Stadium', address: '1 Stadium Drive' },
  venueName: 'National Stadium', pricing: [{ section: 'A', price: 100 }], price: 100,
}
export const seat = { inventoryId: 'inv_001', seatId: 'seat_001', rowNumber: 'A', seatNumber: '1', section: 'A', status: 'available', price: 100 }

type SocketFixture = { connections: WebSocketRoute[]; subscriptions: string[]; send: (name: string, payload: unknown) => void }

export const test = base.extend<{ sockets: SocketFixture; isolatedNetwork: void }>({
  sockets: async ({ context }, use) => {
    const connections: WebSocketRoute[] = []
    const subscriptions: string[] = []
    await context.routeWebSocket('**/*', ws => {
      if (new URL(ws.url()).hostname !== 'ticketremasterws.invalid') throw new Error(`Unexpected WebSocket: ${ws.url()}`)
      connections.push(ws)
      ws.onMessage(message => {
        const packet = String(message)
        if (packet === '40') ws.send('40' + JSON.stringify({ sid: `fixture-${connections.length}` }))
        if (packet.startsWith('42')) {
          const [name, payload] = JSON.parse(packet.slice(2))
          if (name === 'subscribe') subscriptions.push(payload.channel)
        }
      })
      ws.send('0' + JSON.stringify({ sid: 'fixture-engine', upgrades: [], pingInterval: 120000, pingTimeout: 120000, maxPayload: 1000000 }))
    })
    await use({ connections, subscriptions, send: (name, payload) => connections.forEach(ws => ws.send('42' + JSON.stringify([name, payload]))) })
  },
  isolatedNetwork: [async ({ context, baseURL, sockets }, use, testInfo) => {
    void sockets
    const unexpected: string[] = []
    const consoleErrors = monitorConsole(context)
    await context.route('**/*', async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.origin === baseURL) return route.continue()
      if (url.hostname === 'js.stripe.com') return route.fulfill({ contentType: 'text/javascript', body: '' })
      if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
      if (request.resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" />' })
      if (url.hostname === 'ticketremasterapi.invalid' && request.method() === 'GET') {
        const path = url.pathname
        let data: unknown
        if (path === '/events') data = { events: [event], pagination: { total: 1, page: 1, limit: 12 } }
        else if (path === '/events/evt_001') data = event
        else if (path === '/events/evt_001/seats') data = { seats: [seat] }
        else if (path === '/events/evt_001/seats/inv_001') data = seat
        else if (path === '/credits/balance') data = { creditBalance: 500 }
        else if (path === '/credits/transactions') data = { transactions: [] }
        else if (path === '/marketplace') data = { listings: [], pagination: { total: 0 } }
        else if (path === '/tickets') data = { tickets: [] }
        else if (['/transfer/pending', '/transfer/my-pending', '/transfer/history'].includes(path)) data = { transfers: [] }
        else if (path === '/purchase/hold/resume/evt_001') data = null
        else if (path === '/venues') data = { venues: [{ venueId: 'venue_001', name: 'National Stadium' }] }
        else if (path === '/admin/users') data = { users: [] }
        else if (path === '/auth/me') data = { userId: 'usr_001', email: 'test@example.com', role: 'user' }
        if (data !== undefined) return route.fulfill({ json: { data } })
      }
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort('blockedbyclient')
    })
    // Exercise the application's Stripe call without loading a provider or card data.
    await context.addInitScript(() => {
      if (location.origin !== 'http://127.0.0.1:43187') return
      const calls: unknown[] = []
      Object.assign(window, {
        __stripeCalls: calls,
        Stripe: Object.assign(() => ({
          elements: () => ({ create: () => ({ mount: (target: HTMLElement) => { target.textContent = 'Synthetic card fixture' }, destroy: () => {} }) }),
          confirmCardPayment: async (...args: unknown[]) => { calls.push(args); return (window as any).__stripeResult ?? { paymentIntent: { id: 'pi_test', status: 'succeeded' } } },
        }), { _registerWrapper: () => {}, version: 'dahlia' }),
      })
    })
    await use()
    const advisories = consoleErrors.advisories()
    if (advisories.length) await testInfo.attach('preload-timing-advisories', { body: JSON.stringify(advisories, null, 2), contentType: 'application/json' })
    expect(consoleErrors.errors(), 'Unexpected browser errors or warnings').toEqual([])
    expect(unexpected, 'Every external/API request needs an explicit synthetic fixture').toEqual([])
  }, { auto: true }],
})

export { expect }
