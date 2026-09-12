import { test, expect, event, seedUser } from './setup/fixtures'
import type { Page } from '@playwright/test'
const api = 'https://ticketremasterapi.invalid'

async function exhaustRetries(page: Page, attempts: () => number) {
  await expect.poll(attempts).toBe(1)
  for (const [index, delay] of [3100, 5100, 9100].entries()) {
    await page.clock.fastForward(delay)
    await expect.poll(attempts).toBe(index + 2)
  }
  await page.clock.fastForward(1000)
}

async function failCatalogue(page: Page) {
  await page.route(`${api}/events?*`, route => route.abort('internetdisconnected'))
  await page.goto('/events')
  await expect(page.locator('.offline-banner')).toBeVisible()
  await expect(page.locator('.event-card-feature h2')).toHaveText('Taylor Swift | The Eras Tour')
}

test.describe('Simulated network failures', () => {
  test('should show an offline explanation after bounded 503 retries', async ({ page }) => {
    await page.clock.install()
    let attempts = 0
    await page.route(`${api}/events?*`, route => { attempts++; return route.fulfill({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE' } } }) })
    await page.goto('/events')
    await exhaustRetries(page, () => attempts)
    await expect(page.locator('.offline-banner')).toContainText('Offline Demo Mode')
    await expect(page.locator('.event-card-feature h2')).toHaveText('Taylor Swift | The Eras Tour')
    await page.clock.fastForward(60000)
    expect(attempts).toBe(4)
  })
  test('should show fallback listings after a 503 outage', async ({ page }) => {
    await page.clock.install()
    let attempts = 0
    await page.route(`${api}/marketplace?*`, route => { attempts++; return route.fulfill({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE' } } }) })
    await page.goto('/marketplace')
    await exhaustRetries(page, () => attempts)
    await expect(page.locator('.offline-banner')).toBeVisible()
    await expect(page.locator('.listing-card').first()).toContainText('Coldplay: Music of the Spheres')
  })
  test('should retry a transient 503 and render the recovered response', async ({ page }) => {
    await page.clock.install()
    let attempts = 0
    await page.route(`${api}/events?*`, route => {
      attempts++
      return attempts === 1 ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: { data: { events: [{ ...event, name: 'Recovered Event' }] } } })
    })
    await page.goto('/events')
    await expect.poll(() => attempts).toBe(1)
    await page.clock.fastForward(3100)
    await expect(page.locator('.event-card-feature h2')).toHaveText('Recovered Event')
    expect(attempts).toBe(2)
    await expect(page.locator('.offline-banner')).toHaveCount(0)
  })
  test('should show a rate-limit message for a 429 catalogue response', async ({ page }) => {
    await page.route(`${api}/events?*`, route => route.fulfill({ status: 429, json: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait.' } } }))
    await page.goto('/events')
    await expect(page.locator('.toast').filter({ hasText: /Too many requests|rate limit/i }).first()).toBeVisible()
    await expect(page.locator('.event-card-feature h2')).toHaveText('Taylor Swift | The Eras Tour')
  })
  test('should report login rate limiting without retrying the credentials', async ({ page }) => {
    let attempts = 0
    await page.route(`${api}/auth/login`, route => { attempts++; return route.fulfill({ status: 429, json: { error: { code: 'RATE_LIMITED' } } }) })
    await page.goto('/login')
    await page.getByLabel('Email Address').fill('test@example.com')
    await page.getByLabel('Password', { exact: true }).fill('password123')
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
    await expect(page.locator('.toast.error').first()).toContainText(/wait|many|rate/i)
    await expect(page).toHaveURL('/login')
    expect(attempts).toBe(1)
  })
  test('should leave a 429 response to user retry instead of automatically adding requests', async ({ page }) => {
    await page.clock.install()
    let attempts = 0
    await page.route(`${api}/events?*`, route => { attempts++; return route.fulfill({ status: 429, json: { error: { code: 'RATE_LIMITED' } } }) })
    await page.goto('/events')
    await expect.poll(() => attempts).toBe(1)
    await page.clock.fastForward(60000)
    expect(attempts).toBe(1)
    await expect(page.locator('.event-card-feature')).toBeVisible()
  })
  test('should finish bounded retries after a gateway timeout', async ({ page }) => {
    await page.clock.install()
    let attempts = 0
    await page.route(`${api}/events?*`, route => { attempts++; return route.fulfill({ status: 504, json: { error: { code: 'GATEWAY_TIMEOUT' } } }) })
    await page.goto('/events')
    await exhaustRetries(page, () => attempts)
    await expect(page.locator('.offline-banner')).toBeVisible()
    await expect(page.locator('.loading-grid')).toHaveCount(0)
  })
  test('should preserve usable seat selection after a gateway timeout', async ({ page, context }) => {
    await seedUser(context)
    await page.clock.install()
    let attempts = 0
    await page.route(`${api}/events/evt_001`, route => { attempts++; return route.fulfill({ status: 504, json: { error: { code: 'GATEWAY_TIMEOUT' } } }) })
    await page.goto('/events/evt_001/seats')
    await exhaustRetries(page, () => attempts)
    await expect(page.locator('.offline-banner')).toBeVisible()
    await expect(page.locator('.seat-tile.available').first()).toBeVisible()
    expect(await page.evaluate(() => sessionStorage.getItem('demo_context'))).toBe('offline')
  })
  test('should explain an unavailable network while preserving an interactive catalogue', async ({ page }) => {
    await failCatalogue(page)
    await page.getByRole('button', { name: 'Favorites', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'No events found.' })).toBeVisible()
  })
  test('should recover from offline demo mode through the retry control', async ({ page }) => {
    await failCatalogue(page)
    await page.route(`${api}/events?*`, route => route.fulfill({ json: { data: { events: [{ ...event, name: 'Recovered Live Event' }] } } }))
    await page.getByRole('button', { name: 'Retry connection' }).click()
    await expect(page.locator('.event-card-feature h2')).toHaveText('Recovered Live Event')
    await expect(page.locator('.offline-banner')).toHaveCount(0)
    expect(await page.evaluate(() => sessionStorage.getItem('ticketremaster_demo_mode'))).toBeNull()
  })
  test('should retain cached events when a catalogue refresh fails', async ({ page }) => {
    await page.goto('/events')
    await expect(page.locator('.event-card-feature h2')).toHaveText('Taylor Swift')
    await page.route(`${api}/events?*`, route => route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR' } } }))
    await page.reload()
    await expect(page.locator('.event-card-feature h2')).toHaveText('Taylor Swift')
    await expect(page.locator('.toast').filter({ hasText: 'Showing cached events.' })).toBeVisible()
  })
  test('should clear the loading state after a failed uncached request', async ({ page }) => {
    await page.route(`${api}/events?*`, route => route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR' } } }))
    await page.goto('/events')
    await expect(page.locator('.event-card-feature h2')).toHaveText('Taylor Swift | The Eras Tour')
    await expect(page.locator('.loading-grid')).toHaveCount(0)
  })
  test('should keep a retry control after reloading an offline session', async ({ page }) => {
    await failCatalogue(page)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible()
    let attempts = 0
    await page.route(`${api}/events?*`, route => { attempts++; return route.fulfill({ status: 503, json: {} }) })
    await page.getByRole('button', { name: 'Retry connection' }).click()
    await expect(page.locator('.retry-error')).toContainText('still unavailable')
    await expect(page.getByRole('button', { name: 'Retry connection' })).toBeEnabled()
    expect(attempts).toBe(1)
  })
})


test('manual recovery stops after its eight-second deadline without overlapping retries', async ({ page }) => {
  await failCatalogue(page)
  let attempts = 0
  await page.route(`${api}/events?*`, () => { attempts++ }) // Hold the synthetic request open.
  await page.getByRole('button', { name: 'Retry connection' }).click()
  await expect(page.getByRole('button', { name: 'Retrying...' })).toBeDisabled()
  await page.getByRole('button', { name: 'Retrying...' }).evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.locator('.retry-error')).toContainText('still unavailable', { timeout: 11000 })
  await expect(page.getByRole('button', { name: 'Retry connection' })).toBeEnabled()
  expect(attempts).toBe(1)
})
