import { test, expect } from './setup/fixtures';

/**
 * Client-Side Validation Tests
 *
 * Tests form validation without backend interaction:
 * - Registration form with invalid email formats
 * - Login form with empty fields
 * - Password validation
 * - Phone number validation
 */
test.describe('Client-Side Validation', () => {

    test.describe('Registration Form Validation', () => {
        test('should show error for invalid email format', async ({ page }) => {
            await page.goto('/register');

            // Fill with invalid email (no @ symbol)
            await page.fill('input[placeholder*="your name"]', 'Validation User');
            await page.fill('input[type="email"]', 'invalid-email');
            await page.fill('input[type="tel"]', '91234567');
            await page.fill('input[type="password"]', 'password123');

            // Submit the form
            await page.click('button[type="submit"]');

            // Should show validation error
            expect(await page.locator('input[type="email"]').evaluate((input: HTMLInputElement) => input.validity.typeMismatch)).toBe(true);
            await expect(page.locator('input[type="email"]')).toBeFocused();
        });

        test('should show error for empty email field', async ({ page }) => {
            await page.goto('/register');

            // Leave email empty, fill password
            await page.fill('input[placeholder*="your name"]', 'Validation User');
            await page.fill('input[type="tel"]', '91234567');
            await page.fill('input[type="password"]', 'password123');

            // Submit the form
            await page.click('button[type="submit"]');

            // Should show validation error for required field
            await expect(page.locator('.field-error:has-text("Email is required")')).toBeVisible({ timeout: 5000 });
        });

        test('should show error for empty password field', async ({ page }) => {
            await page.goto('/register');

            await page.fill('input[placeholder*="your name"]', 'Validation User');
            await page.fill('input[type="email"]', 'test@example.com');
            await page.fill('input[type="tel"]', '91234567');
            // Leave password empty

            // Submit the form
            await page.click('button[type="submit"]');

            // Should show validation error for required password
            await expect(page.locator('.field-error:has-text("Password is required")')).toBeVisible({ timeout: 5000 });
        });

        test('should show error for empty full name', async ({ page }) => {
            await page.goto('/register');

            await page.fill('input[type="email"]', 'test@example.com');
            await page.fill('input[type="tel"]', '91234567');
            await page.fill('input[type="password"]', 'password123');

            // Submit the form
            await page.click('button[type="submit"]');

            // Should show required full name error
            await expect(page.locator('.field-error:has-text("Full name is required")')).toBeVisible({ timeout: 5000 });
        });

        test('should show error for short password', async ({ page }) => {
            await page.goto('/register');

            await page.fill('input[placeholder*="your name"]', 'Validation User');
            await page.fill('input[type="email"]', 'test@example.com');
            await page.fill('input[type="password"]', '123');
            await page.fill('input[type="tel"]', '91234567');

            // Submit the form
            await page.click('button[type="submit"]');

            // Should show password length error
            await expect(page.locator('.field-error:has-text("at least 6")')).toBeVisible({ timeout: 5000 });
        });

        test('should show error for invalid phone number', async ({ page }) => {
            await page.goto('/register');

            await page.fill('input[placeholder*="your name"]', 'Validation User');
            await page.fill('input[type="email"]', 'test@example.com');
            await page.fill('input[type="password"]', 'password123');
            await page.fill('input[type="tel"]', '12345');

            // Submit the form
            await page.click('button[type="submit"]');

            // Should show phone validation error
            await expect(page.locator('.field-error:has-text("exactly 8 digits")')).toBeVisible({ timeout: 5000 });
        });
    });

    test.describe('Login Form Validation', () => {
        test('should show error for empty email on login', async ({ page }) => {
            await page.goto('/login');

            // Leave email empty
            await page.fill('input[type="password"]', 'password123');

            // Submit the form
            await page.click('button[type="submit"]');

            // Should show validation error
            await expect(page.locator('.field-error:has-text("Email is required")')).toBeVisible({ timeout: 5000 });
        });

        test('should show error for empty password on login', async ({ page }) => {
            await page.goto('/login');

            await page.fill('input[type="email"]', 'test@example.com');
            // Leave password empty

            // Submit the form
            await page.click('button[type="submit"]');

            // Should show validation error
            await expect(page.locator('.field-error:has-text("Password is required")')).toBeVisible({ timeout: 5000 });
        });

        test('should show error for invalid email format on login', async ({ page }) => {
            await page.goto('/login');

            await page.fill('input[type="email"]', 'invalid-email');
            await page.fill('input[type="password"]', 'password123');

            // Submit the form
            await page.click('button[type="submit"]');

            // Should show validation error
            expect(await page.locator('input[type="email"]').evaluate((input: HTMLInputElement) => input.validity.typeMismatch)).toBe(true);
            await expect(page.locator('input[type="email"]')).toBeFocused();
        });
    });

    test.describe('Form Accessibility', () => {
        test('registration form should have proper labels', async ({ page }) => {
            await page.goto('/register');

            // Check that form inputs have associated labels
            const emailInput = page.locator('input[type="email"]').first();
            await expect(emailInput).toBeVisible();

            await expect(page.getByLabel('Email Address')).toBeVisible();
            await expect(page.getByLabel('Full Name')).toBeVisible();
            await expect(page.getByLabel('Phone Number (Singapore)')).toBeVisible();
            await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
        });

        test('login form should have proper labels', async ({ page }) => {
            await page.goto('/login');

            const emailInput = page.locator('input[type="email"]').first();
            await expect(emailInput).toBeVisible();

            await expect(page.getByLabel('Email Address')).toBeVisible();
            await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
        });
    });
});
