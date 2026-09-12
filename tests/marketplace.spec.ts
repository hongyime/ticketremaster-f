import { test, expect, seedUser } from './setup/fixtures'
const api = 'https://ticketremasterapi.invalid'
const listings = [
  { listingId: 'lst_001', ticketId: 'tkt_001', eventName: 'Taylor Swift', price: 300, sellerId: 'seller', status: 'ACTIVE', eventDate: '2030-06-15T19:00:00Z' },
  { listingId: 'lst_002', ticketId: 'tkt_002', eventName: 'Coldplay', price: 100, sellerId: 'seller', status: 'ACTIVE', eventDate: '2030-06-16T19:00:00Z' },
  { listingId: 'lst_003', ticketId: 'tkt_003', eventName: 'Jazz Night', price: 200, sellerId: 'seller', status: 'ACTIVE', eventDate: '2030-06-17T19:00:00Z' },
]

test.describe('Marketplace Flow', () => {
  test.beforeEach(async ({ page, context }) => {
    await seedUser(context)
    await page.route(`${api}/marketplace?*`, route => route.fulfill({ json: { data: { listings, pagination: { total: 3 } } } }))
  })
  test('should show active listings', async ({ page }) => {
    await page.goto('/marketplace')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Authentic Access.')
    await expect(page.locator('.listing-card h3')).toHaveText(['Taylor Swift', 'Coldplay', 'Jazz Night'])
    await expect(page.locator('.listing-card .listing-price')).toHaveText(['SGD 300', 'SGD 100', 'SGD 200'])
  })
  test('should initiate a purchase and open buyer verification', async ({ page }) => {
    const payloads: unknown[] = []
    const transfer = { transferId: 'txr_001', status: 'pending_buyer_otp', buyerId: 'usr_001', sellerId: 'seller', buyerVerificationSid: 'VE_fixture', creditAmount: 300, eventName: 'Taylor Swift' }
    await page.route(`${api}/transfer/initiate`, route => { payloads.push(route.request().postDataJSON()); return route.fulfill({ json: { data: transfer } }) })
    await page.route(`${api}/transfer/txr_001`, route => route.fulfill({ json: { data: transfer } }))
    await page.goto('/marketplace')
    await page.locator('.listing-card').filter({ hasText: 'Taylor Swift' }).getByRole('button', { name: 'Buy Ticket' }).click()
    await expect(page).toHaveURL('/transfer/txr_001')
    await expect(page.locator('.otp-layout')).toBeVisible()
    await expect(page.locator('.otp-event-name')).toHaveText('Taylor Swift')
    expect(payloads).toEqual([{ listingId: 'lst_001' }])
  })
  test('should handle buying with insufficient credits (402)', async ({ page }) => {
    let attempts = 0
    await page.route(`${api}/transfer/initiate`, route => { attempts++; return route.fulfill({ status: 402, json: { error: { code: 'INSUFFICIENT_CREDITS', message: 'Not enough credits' } } }) })
    await page.goto('/marketplace')
    await page.locator('.listing-card').first().getByRole('button', { name: 'Buy Ticket' }).click()
    await expect(page.locator('.toast.error').first()).toContainText('Not enough credits')
    await expect(page).toHaveURL('/marketplace')
    expect(attempts).toBe(1)
  })
  test('should filter listings by search', async ({ page }) => {
    await page.goto('/marketplace')
    await expect(page.locator('.listing-card h3')).toHaveCount(3)
    await page.getByPlaceholder('Search events, artists, or venues...').fill('coldPLAY')
    await expect(page.locator('.listing-card h3')).toHaveText(['Coldplay'])
    await page.getByPlaceholder('Search events, artists, or venues...').fill('missing artist')
    await expect(page.locator('.listing-card h3')).toHaveCount(0)
    await expect(page.locator('.empty-card')).toContainText('No listings available')
  })
  test('should sort listings by price in both directions', async ({ page }) => {
    await page.goto('/marketplace')
    await expect(page.locator('.listing-card h3')).toHaveCount(3)
    await page.getByRole('button', { name: /^Price/ }).click()
    await expect(page.locator('.listing-card h3')).toHaveText(['Coldplay', 'Jazz Night', 'Taylor Swift'])
    await page.getByRole('button', { name: /^Price/ }).click()
    await expect(page.locator('.listing-card h3')).toHaveText(['Taylor Swift', 'Jazz Night', 'Coldplay'])
  })
})
