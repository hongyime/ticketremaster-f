import { test, expect } from './setup/fixtures'
import type { Page } from '@playwright/test'
const destination = { User: '/events', Admin: '/admin/events/new', Staff: '/staff/scan' }
async function login(page: Page, role: keyof typeof destination = 'User') {
  await page.goto('/demo-login')
  await page.getByRole('button', { name: new RegExp(`Demo ${role}`) }).click()
  await expect(page).toHaveURL(destination[role])
}

test.describe('Demo Mode', () => {
  test('should display all three seeded personas', async ({ page }) => {
    await page.goto('/demo-login')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Select Your Persona')
    await expect(page.locator('.persona-card strong')).toHaveText(['Demo User', 'Demo Admin', 'Demo Staff'])
  })
  test('should use a seeded demo identity without storing a real credential', async ({ page }) => {
    await login(page)
    const state = await page.evaluate(() => ({ user: JSON.parse(sessionStorage.getItem('demo_user')!), token: localStorage.getItem('access_token') }))
    expect(state.user).toMatchObject({ userId: 'demo-user-001', email: 'user@ticketremaster.local', role: 'user' })
    expect(state.token).toBeNull()
  })
  test('should log in as a demo user and show the event catalogue', async ({ page }) => {
    await login(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Curated Experiences')
    await expect(page.locator('.event-card-feature h2')).toHaveText('Taylor Swift | The Eras Tour')
  })
  test('demo user should access tickets', async ({ page }) => {
    await login(page)
    await page.goto('/tickets')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My Tickets')
    await expect(page.locator('.ticket-card').first()).toBeVisible()
  })
  test('demo user should access their profile', async ({ page }) => {
    await login(page)
    await page.getByRole('link', { name: 'Profile', exact: true }).click()
    await expect(page).toHaveURL('/profile')
    await expect(page.getByLabel('Email Address')).toHaveValue('user@ticketremaster.local')
  })
  for (const path of ['/admin/events/new', '/staff/scan']) {
    test(`demo user should not access ${path}`, async ({ page }) => {
      await login(page)
      await page.goto(path)
      await expect(page).toHaveURL('/events')
      await expect(page.locator('.events-page')).toBeVisible()
    })
  }
  test('should log in as a demo admin', async ({ page }) => {
    await login(page, 'Admin')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create New Event')
  })
  test('demo admin should access user management', async ({ page }) => {
    await login(page, 'Admin')
    await page.goto('/admin/users')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('User Management')
    await expect(page.locator('.user-card').first()).toBeVisible()
  })
  test('demo admin should access event creation', async ({ page }) => {
    await login(page, 'Admin')
    await expect(page.getByRole('button', { name: 'Create Event', exact: true })).toBeEnabled()
    await expect(page.getByPlaceholder('Neon Skyline Festival')).toBeVisible()
  })
  test('demo admin should not access staff scanning', async ({ page }) => {
    await login(page, 'Admin')
    await page.goto('/staff/scan')
    await expect(page).toHaveURL('/events')
  })
  test('should log in as demo staff', async ({ page }) => {
    await login(page, 'Staff')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fast gate verification for live events.')
  })
  test('demo staff should not access admin routes', async ({ page }) => {
    await login(page, 'Staff')
    await page.goto('/admin/events/new')
    await expect(page).toHaveURL('/events')
  })
  test('demo staff must select an event before manual scanning is enabled', async ({ page }) => {
    await login(page, 'Staff')
    const manual = page.getByPlaceholder('Ticket ID')
    await expect(manual).toBeDisabled()
    const venue = page.locator('select').first()
    await venue.selectOption('ven_001')
    await page.locator('select').nth(1).selectOption({ index: 1 })
    await page.getByRole('button', { name: /Confirm selection|Reconfirm selection/ }).click()
    await expect(manual).toBeEnabled()
    await expect(page.getByText('Scanning session', { exact: true })).toBeVisible()
  })
  test('should render concrete mock event cards', async ({ page }) => {
    await login(page)
    await expect(page.locator('.event-card').first()).toContainText('Taylor Swift | The Eras Tour')
    await expect(page.locator('.event-card')).toHaveCount(10)
  })
  test('should render concrete mock venues', async ({ page }) => {
    await login(page)
    await page.goto('/venues')
    await expect(page.getByRole('heading', { name: 'Esplanade Concert Hall' })).toBeVisible()
    await expect(page.locator('.venue-card')).toHaveCount(5)
  })
  test('should render concrete mock resale listings', async ({ page }) => {
    await login(page)
    await page.goto('/marketplace')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Authentic Access.')
    await expect(page.locator('.listing-card').first()).toContainText('Coldplay: Music of the Spheres')
    await expect(page.locator('.listing-card').first().getByRole('button', { name: 'Listed', exact: true })).toBeDisabled()
  })
})
