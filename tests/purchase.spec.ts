import { test, expect, seedUser, seat } from './setup/fixtures'

const api = 'https://ticketremasterapi.invalid'
test.describe('Purchase Flow', () => {
  test.beforeEach(async ({ context }) => seedUser(context))

  test('should reserve a seat and complete checkout', async ({ page }) => {
    await page.clock.install()
    const holdRequests: string[] = []
    const payments: unknown[] = []
    await page.route(`${api}/purchase/hold/inv_001`, route => {
      holdRequests.push(route.request().method())
      return route.fulfill({ json: { data: { inventoryId: 'inv_001', holdToken: 'held-token', heldUntil: new Date(Date.now() + 300000).toISOString() } } })
    })
    await page.route(`${api}/purchase/confirm/inv_001`, route => {
      payments.push(route.request().postDataJSON())
      return route.fulfill({ json: { data: { ticketId: 'tkt_001', status: 'active' } } })
    })
    await page.goto('/events/evt_001/seats')
    await page.locator('.seat-tile.available').click()
    await expect(page.locator('.seat-tile')).toHaveClass(/chosen/)
    await page.getByRole('button', { name: 'Reserve Seat', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Seat Reserved', exact: true })).toBeDisabled()
    expect(holdRequests).toEqual(['POST'])
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pendingOrder')!))).toMatchObject({ inventoryId: 'inv_001', holdToken: 'held-token', seat: { price: 100 } })
    await page.clock.runFor(1100)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pendingOrder')!))).toMatchObject({ holdToken: 'held-token', eventId: 'evt_001' })
    await page.getByRole('button', { name: /Checkout/ }).click()
    await expect(page).toHaveURL('/checkout/inv_001')
    await page.getByRole('button', { name: 'Confirm Purchase' }).click()
    await expect(page.getByRole('heading', { name: 'Ticket secured.' })).toBeVisible()
    await page.clock.runFor(1500)
    await expect(page).toHaveURL('/tickets')
    expect(payments).toEqual([{ holdToken: 'held-token', eventId: 'evt_001' }])
    expect(await page.evaluate(() => localStorage.getItem('pendingOrder'))).toBeNull()
  })

  test('should handle SEAT_UNAVAILABLE (409) when reserving', async ({ page }) => {
    let attempts = 0
    await page.route(`${api}/purchase/hold/inv_001`, route => {
      attempts++
      return route.fulfill({ status: 409, json: { error: { code: 'SEAT_UNAVAILABLE', message: 'Seat no longer available' } } })
    })
    await page.goto('/events/evt_001/seats')
    await page.locator('.seat-tile.available').click()
    await page.getByRole('button', { name: 'Reserve Seat', exact: true }).click()
    await expect(page.locator('.toast.error').first()).toContainText(/available/i)
    expect(attempts).toBe(1)
    expect(await page.evaluate(() => localStorage.getItem('pendingOrder'))).toBeNull()
    await expect(page.getByRole('button', { name: 'Seat Reserved', exact: true })).toHaveCount(0)
  })

  for (const failure of [
    { status: 402, code: 'INSUFFICIENT_CREDITS', path: '/credits/topup', message: /credits/i },
    { status: 410, code: 'PAYMENT_HOLD_EXPIRED', path: '/events/evt_001', message: /expired/i },
  ]) {
    test(`should handle ${failure.code} (${failure.status}) returned at confirmation`, async ({ page, context }) => {
      await context.addInitScript(order => localStorage.setItem('pendingOrder', JSON.stringify(order)), {
        orderId: 'inv_001', inventoryId: 'inv_001', holdToken: 'held-token',
        heldUntil: new Date(Date.now() + 300000).toISOString(), eventId: 'evt_001', seat,
      })
      let attempts = 0
      await page.route(`${api}/purchase/confirm/inv_001`, route => {
        attempts++
        return route.fulfill({ status: failure.status, json: { error: { code: failure.code } } })
      })
      // On expired confirmation the route guard also releases any server-side hold.
      await page.route(`${api}/purchase/hold/inv_001`, route => route.fulfill({ json: { data: {} } }))
      await page.goto('/checkout/inv_001')
      await expect(page.getByRole('button', { name: 'Confirm Purchase' })).toBeEnabled()
      await page.getByRole('button', { name: 'Confirm Purchase' }).click()
      await expect(page).toHaveURL(failure.path)
      await expect(page.locator('.toast.error').first()).toContainText(failure.message)
      expect(attempts).toBe(1)
    })
  }
})


test('dismissing a reservation banner must retain the hold until its absolute expiry', async ({ page }) => {
  const now = new Date('2030-01-01T00:00:00Z')
  await page.clock.install({ time: now })
  await page.clock.pauseAt(now)
  await page.goto('/events')
  await page.evaluate(() => localStorage.setItem('pendingOrder', JSON.stringify({ orderId: 'kept-order', inventoryId: 'kept-order', heldUntil: new Date(Date.now() + 5000).toISOString(), event: { name: 'Kept Concert' } })))
  await page.clock.runFor(1100)
  await expect(page.locator('.pending-banner')).toContainText('Kept Concert')
  await page.locator('.pending-banner').getByRole('button', { name: 'Dismiss' }).click()
  await page.clock.runFor(1100)
  await expect(page.locator('.pending-banner')).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pendingOrder')!).orderId)).toBe('kept-order')
  const expiry = await page.evaluate(() => new Date(JSON.parse(localStorage.getItem('pendingOrder')!).heldUntil).getTime())
  await page.clock.setFixedTime(new Date(expiry - 100))
  await page.evaluate(() => window.dispatchEvent(new Event('storage')))
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pendingOrder')!).orderId)).toBe('kept-order')
  await page.clock.setFixedTime(new Date(expiry))
  await page.evaluate(() => window.dispatchEvent(new Event('storage')))
  expect(await page.evaluate(() => localStorage.getItem('pendingOrder'))).toBeNull()
})

test('a new reservation replaces the dismissed banner without losing its token', async ({ page }) => {
  await page.clock.install()
  await page.goto('/events')
  const hold = (orderId: string) => page.evaluate(id => localStorage.setItem('pendingOrder', JSON.stringify({ orderId: id, holdToken: id, heldUntil: new Date(Date.now() + 300000).toISOString(), event: { name: id } })), orderId)
  await hold('first-hold')
  await page.clock.runFor(1100)
  await page.locator('.pending-banner').getByRole('button', { name: 'Dismiss' }).click()
  await hold('second-hold')
  await page.clock.runFor(1100)
  await expect(page.locator('.pending-banner')).toContainText('second-hold')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pendingOrder')!).holdToken)).toBe('second-hold')
})
