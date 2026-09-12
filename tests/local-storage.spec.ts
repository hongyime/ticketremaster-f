import { test, expect } from './setup/fixtures'
import type { Page } from '@playwright/test'
const api = 'https://ticketremasterapi.invalid'
async function signIn(page: Page) {
  await page.route(`${api}/auth/login`, route => route.fulfill({ json: { data: { token: 'persistent-token', refreshToken: 'persistent-refresh', user: { userId: 'usr_001', email: 'test@example.com', role: 'user' } } } }))
  await page.goto('/login')
  await page.getByLabel('Email Address').fill('test@example.com')
  await page.getByLabel('Password', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page).toHaveURL('/events')
}

test.describe('Local State Persistence', () => {
  test('should save a favorite event to localStorage', async ({ page }) => {
    await page.goto('/events')
    await page.getByRole('button', { name: 'Favorite Taylor Swift', exact: true }).click()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('favoriteEvents')!))).toEqual(['evt_001'])
  })
  test('should persist favorites after page reload', async ({ page }) => {
    await page.goto('/events')
    await page.getByRole('button', { name: 'Favorite Taylor Swift', exact: true }).click()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Favorite Taylor Swift', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Favorites', exact: true }).click()
    await expect(page.locator('.event-card')).toHaveCount(1)
  })
  test('should toggle a favorite off and persist the empty selection', async ({ page }) => {
    await page.goto('/events')
    const favorite = page.getByRole('button', { name: 'Favorite Taylor Swift', exact: true })
    await favorite.click()
    await expect(favorite).toHaveAttribute('aria-pressed', 'true')
    await favorite.click()
    await expect(favorite).toHaveAttribute('aria-pressed', 'false')
    await page.reload()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('favoriteEvents')!))).toEqual([])
  })
  test('should persist a real login across reload without re-seeding storage', async ({ page }) => {
    let holdingBalance = true
    let pendingBalances = 0
    await page.route(`${api}/credits/balance`, route => {
      if (holdingBalance) { pendingBalances++; return }
      return route.fallback()
    })
    await signIn(page)
    await expect.poll(() => pendingBalances).toBeGreaterThan(0)
    holdingBalance = false
    // Reload with an actual outstanding XHR; WebKit reports its cancellation as
    // a network failure, which must not erase the successfully saved session.
    await page.reload()
    await expect(page.getByRole('link', { name: 'Profile', exact: true })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('access_token'))).toBe('persistent-token')
  })
  test('should maintain the logged-in state across protected page navigation', async ({ page }) => {
    await signIn(page)
    await page.goto('/tickets')
    await expect(page.locator('.tickets-page')).toBeVisible()
    await page.goto('/profile')
    await expect(page).toHaveURL('/profile')
    await expect(page.getByRole('button', { name: 'Log Out', exact: true })).toBeVisible()
  })
  test('should clear authentication on logout while retaining favorites', async ({ page }) => {
    await page.route(`${api}/auth/logout`, route => route.fulfill({ json: { data: {} } }))
    await signIn(page)
    await page.evaluate(() => localStorage.setItem('favoriteEvents', '["evt_001"]'))
    await page.goto('/profile')
    await page.getByRole('button', { name: 'Log Out', exact: true }).click()
    await expect(page).toHaveURL('/login')
    expect(await page.evaluate(() => localStorage.getItem('access_token'))).toBeNull()
    expect(await page.evaluate(() => localStorage.getItem('user'))).toBeNull()
    expect(await page.evaluate(() => localStorage.getItem('favoriteEvents'))).toBe('["evt_001"]')
    await page.goto('/tickets')
    await expect(page).toHaveURL('/login')
  })
  // The current product has one theme and English copy; the old optional
  // theme/language-toggle tests asserted nothing when their controls were absent.
  test('should retain the fixed Prawn palette after reload', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome Back')
    const colors = () => page.evaluate(() => ['--primary', '--background'].map(key => getComputedStyle(document.documentElement).getPropertyValue(key).trim()))
    expect(await colors()).toEqual(['#f97316', '#191210'])
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome Back')
    expect(await colors()).toEqual(['#f97316', '#191210'])
  })
  test('should retain the documented English UI after reload', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome Back')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible()
  })
})
