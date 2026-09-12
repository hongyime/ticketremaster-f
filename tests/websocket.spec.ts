import { test, expect, seedUser } from './setup/fixtures'

test.describe('WebSocket notification handling in the browser', () => {
  test.beforeEach(async ({ context }) => seedUser(context))
  test('should establish the connection and subscribe for the signed-in user', async ({ page, sockets }) => {
    await page.goto('/notifications')
    await expect.poll(() => sockets.subscriptions).toEqual(expect.arrayContaining(['transfer_update', 'ticket_update']))
    expect(sockets.connections).toHaveLength(1)
    await expect(page.getByRole('heading', { name: 'No pending notifications' })).toBeVisible()
  })
  test('should reconnect and restore subscriptions after a socket closes', async ({ page, sockets }) => {
    await page.goto('/notifications')
    await expect.poll(() => sockets.subscriptions.length).toBe(2)
    await sockets.connections[0].close({ code: 1001, reason: 'Synthetic connection loss' })
    await expect.poll(() => sockets.connections.length).toBe(2)
    await expect.poll(() => sockets.subscriptions.filter(name => name === 'ticket_update').length).toBe(2)
    sockets.connections[1].send('42' + JSON.stringify(['ticket_update', { payload: { ticketId: 'reconnected', ownerId: 'usr_001', eventName: 'Reconnect Concert' } }]))
    await expect(page.locator('.notification-card')).toContainText('Reconnect Concert')
  })
  test('should render ticket updates only for the current owner', async ({ page, sockets }) => {
    await page.goto('/notifications')
    await expect.poll(() => sockets.subscriptions.length).toBe(2)
    sockets.send('ticket_update', { payload: { ticketId: 'private', ownerId: 'someone-else', eventName: 'Another account' } })
    sockets.send('ticket_update', { payload: { ticketId: 'owned', ownerId: 'usr_001', eventName: 'My Concert' } })
    await expect(page.locator('.notification-card')).toHaveCount(1)
    await expect(page.locator('.notification-card')).toContainText('My Concert')
    await page.getByRole('button', { name: 'View tickets', exact: true }).click()
    await expect(page).toHaveURL('/tickets')
  })
  test('should render a completed transfer for the current buyer', async ({ page, sockets }) => {
    await page.goto('/notifications')
    await expect.poll(() => sockets.subscriptions.length).toBe(2)
    sockets.send('transfer_update', { transferId: 'transfer_1', buyerId: 'usr_001', sellerId: 'seller', status: 'completed', eventName: 'Transferred Concert' })
    await expect(page.locator('.notification-card h2')).toHaveText('Transfer Complete')
    await expect(page.locator('.notification-card')).toContainText('Transferred Concert')
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(page.locator('.notification-card')).toHaveCount(0)
  })
  test('seat updates should not appear as account completion notifications', async ({ page, sockets }) => {
    await page.goto('/notifications')
    await expect.poll(() => sockets.subscriptions.length).toBe(2)
    sockets.send('seat_update', { payload: { inventoryId: 'inv_001', eventId: 'evt_001', status: 'sold' } })
    // This subsequent message proves that the socket delivery queue was processed.
    sockets.send('ticket_update', { payload: { ticketId: 'sentinel', ownerId: 'usr_001', eventName: 'Delivery sentinel' } })
    await expect(page.locator('.notification-card')).toHaveCount(1)
    await expect(page.locator('.notification-card')).toContainText('Delivery sentinel')
  })
  test('purchase messages alone should not issue a purchase confirmation', async ({ page, sockets }) => {
    await page.goto('/notifications')
    await expect.poll(() => sockets.subscriptions.length).toBe(2)
    sockets.send('purchase_update', { inventoryId: 'inv_001', ticketId: 'not-authoritative', userId: 'usr_001', status: 'completed' })
    sockets.send('ticket_update', { payload: { ticketId: 'sentinel', ownerId: 'usr_001', eventName: 'Delivery sentinel' } })
    await expect(page.locator('.notification-card')).toHaveCount(1)
    await expect(page.locator('.notification-card')).toContainText('Delivery sentinel')
    await expect(page).toHaveURL('/notifications')
    // Any purchase API call fails the global guard; the UI waits for authoritative results.
  })
})
