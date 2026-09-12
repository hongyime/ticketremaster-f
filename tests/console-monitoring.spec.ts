import { test, expect } from './setup/fixtures';

/**
 * Browser Console Monitoring Tests
 *
 * These tests verify that the application does not produce console errors
 * during normal operation. Console monitoring is active for all tests.
 */
test.describe('Browser Console Monitoring', () => {

    test('should have no console errors on landing page', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('h1')).toBeVisible();
    });

    test('should have no console errors on events page', async ({ page }) => {
        await page.goto('/events');
        // Events page uses a toolbar with tabs, not an h1
        await expect(page.locator('.events-page')).toBeVisible();
        // Check for the All tab button
        await expect(page.locator('button.filter-chip:has-text("All Categories")')).toBeVisible();
    });

    test('should have no console errors on login page', async ({ page }) => {
        await page.goto('/login');
        await expect(page.locator('h1')).toHaveText('Welcome Back');
    });

    test('should have no console errors on register page', async ({ page }) => {
        await page.goto('/register');
        await expect(page.locator('h1')).toContainText(/Register|Sign Up|Create Account/);
    });

    test('should have no console errors on demo login page', async ({ page }) => {
        await page.goto('/demo-login');
        await expect(page.locator('h1')).toHaveText('Select Your Persona');
    });

    test('should have no console errors on about page', async ({ page }) => {
        await page.goto('/about');
        await expect(page.locator('h1')).toContainText(/About/);
    });

    test('should have no console errors on help page', async ({ page }) => {
        await page.goto('/help');
        await expect(page.locator('h1')).toHaveText(/Support\s*Center/);
    });

    test('should have no console errors on terms page', async ({ page }) => {
        await page.goto('/terms');
        await expect(page.locator('h1')).toContainText(/Terms/);
    });

    test('should have no console errors on privacy page', async ({ page }) => {
        await page.goto('/privacy');
        await expect(page.locator('h1')).toContainText(/Privacy/);
    });

    test('should have no console errors on careers page', async ({ page }) => {
        await page.goto('/careers');
        await expect(page.locator('h1')).toContainText(/Careers/);
    });
});
