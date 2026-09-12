import { test, expect } from './setup/fixtures'

// Authorization here is the frontend route contract; API authorization needs backend tests.
test.describe('Admin Operations', () => {
  test.beforeEach(async ({ context }, testInfo) => {
    await context.addInitScript(role => {
      if (location.origin !== 'http://127.0.0.1:43187') return
      localStorage.setItem('access_token', 'admin-token')
      localStorage.setItem('user', JSON.stringify({ userId: 'a1', email: 'admin@example.com', role }))
    }, testInfo.title.includes('non-admin') ? 'user' : 'admin')
  })
  test('should show event dashboard with stats', async ({ page }) => {
    await page.route('https://ticketremasterapi.invalid/admin/events/e1/dashboard', route => route.fulfill({ json: { data: {
      stats: { total_seats: 500, seats_sold: 150, revenue: 30000 },
      attendees: [{ user_id: 'u1', email: 'customer@example.com', seat_id: 's1', row_number: 'A', seat_number: 1 }],
    } } }))
    await page.goto('/admin/events/e1/dashboard')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Event Dashboard')
    await expect(page.locator('.metric-card').filter({ hasText: 'Seats sold' }).locator('strong')).toHaveText('150')
    await expect(page.locator('.metric-card').filter({ hasText: 'Occupancy' }).locator('strong')).toHaveText('30%')
    await expect(page.locator('.attendee-row')).toContainText('customer@example.com')
  })
  test('should allow creating a new event', async ({ page }) => {
    const requests: unknown[] = []
    await page.route('https://ticketremasterapi.invalid/admin/events', route => {
      requests.push(route.request().postDataJSON())
      return route.fulfill({ status: 201, json: { data: { eventId: 'new-e', seatsCreated: 500 } } })
    })
    await page.goto('/admin/events/new')
    await page.getByPlaceholder('Neon Skyline Festival').fill('New Year Concert')
    await page.locator('input[type="datetime-local"]').nth(0).fill('2030-12-31T20:00')
    await page.locator('input[type="datetime-local"]').nth(1).fill('2030-12-31T23:00')
    await page.locator('input[type="number"]').nth(0).fill('500')
    await page.locator('input[type="number"]').nth(1).fill('100')
    await page.getByRole('button', { name: 'Create Event', exact: true }).click()
    await expect(page.locator('.status-success')).toHaveText('Created new-e with 500 seats.')
    expect(requests).toEqual([expect.objectContaining({ name: 'New Year Concert', total_seats: 500, pricing_tiers: { CAT1: 100 } })])
  })
  test('should redirect a non-admin without requesting the protected dashboard', async ({ page }) => {
    let requests = 0
    await page.route('https://ticketremasterapi.invalid/admin/events/e1/dashboard', route => { requests++; return route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN' } } }) })
    await page.goto('/admin/events/e1/dashboard')
    await expect(page).toHaveURL('/events')
    await expect(page.locator('.events-page')).toBeVisible()
    expect(requests).toBe(0)
  })
})
