import { test, expect } from './setup/fixtures';

/**
 * Role-Based Access Control (RBAC) Tests
 *
 * Tests that routes are properly protected based on authentication and user roles.
 * Verifies that:
 * - Unauthenticated users are redirected to /login
 * - Standard users cannot access /admin/* or /staff/* routes
 * - Admin users can access admin routes but not staff routes
 * - Staff users can access staff routes but not admin routes
 */
test.describe('Role-Based Access Control', () => {

    test.describe('Unauthenticated Access', () => {
        test('should redirect unauthenticated user from /tickets to /login', async ({ page, context }) => {
            // Use fresh context with cleared storage
            await context.clearCookies();
            await context.addInitScript(() => { if (location.origin === 'http://127.0.0.1:43187') localStorage.clear() });

            await page.goto('/tickets');
            await expect(page).toHaveURL('/login');
        });

        test('should redirect unauthenticated user from /profile to /login', async ({ page, context }) => {
            await context.clearCookies();
            await context.addInitScript(() => { if (location.origin === 'http://127.0.0.1:43187') localStorage.clear() });

            await page.goto('/profile');
            await expect(page).toHaveURL('/login');
        });

        test('should redirect unauthenticated user from /checkout to /login', async ({ page, context }) => {
            await context.clearCookies();
            await context.addInitScript(() => { if (location.origin === 'http://127.0.0.1:43187') localStorage.clear() });

            await page.goto('/checkout/order123');
            await expect(page).toHaveURL('/login');
        });

        test('should redirect unauthenticated user from /credits/topup to /login', async ({ page, context }) => {
            await context.clearCookies();
            await context.addInitScript(() => { if (location.origin === 'http://127.0.0.1:43187') localStorage.clear() });

            await page.goto('/credits/topup');
            await expect(page).toHaveURL('/login');
        });

        test('should redirect unauthenticated user from /transfer/initiate to /login', async ({ page, context }) => {
            await context.clearCookies();
            await context.addInitScript(() => { if (location.origin === 'http://127.0.0.1:43187') localStorage.clear() });

            await page.goto('/transfer/initiate');
            await expect(page).toHaveURL('/login');
        });

        test('should redirect unauthenticated user from /admin routes to /login', async ({ page, context }) => {
            await context.clearCookies();
            await context.addInitScript(() => { if (location.origin === 'http://127.0.0.1:43187') localStorage.clear() });

            await page.goto('/admin/events/new');
            await expect(page).toHaveURL('/login');

            await page.goto('/admin/users');
            await expect(page).toHaveURL('/login');

            await page.goto('/admin/events/test123/dashboard');
            await expect(page).toHaveURL('/login');
        });

        test('should redirect unauthenticated user from /staff routes to /login', async ({ page, context }) => {
            await context.clearCookies();
            await context.addInitScript(() => { if (location.origin === 'http://127.0.0.1:43187') localStorage.clear() });

            await page.goto('/staff/scan');
            await expect(page).toHaveURL('/login');
        });

        test('should allow unauthenticated access to public routes', async ({ page, context }) => {
            await context.clearCookies();
            await context.addInitScript(() => { if (location.origin === 'http://127.0.0.1:43187') localStorage.clear() });

            // These routes should be accessible without auth
            await page.goto('/');
            await expect(page).toHaveURL('/');

            await page.goto('/events');
            await expect(page).toHaveURL('/events');

            await page.goto('/marketplace');
            await expect(page).toHaveURL('/marketplace');

            await page.goto('/about');
            await expect(page).toHaveURL('/about');

            await page.goto('/help');
            await expect(page).toHaveURL('/help');

            await page.goto('/terms');
            await expect(page).toHaveURL('/terms');

            await page.goto('/privacy');
            await expect(page).toHaveURL('/privacy');

            await page.goto('/careers');
            await expect(page).toHaveURL('/careers');

            await page.goto('/venues');
            await expect(page).toHaveURL('/venues');
        });
    });

    test.describe('Standard User Access', () => {
        test.beforeEach(async ({ page, context }) => {
            // Set up standard user session using addInitScript
            await context.addInitScript(() => {
      if (location.origin !== 'http://127.0.0.1:43187') return
                localStorage.setItem('access_token', 'user-token');
                localStorage.setItem('refresh_token', 'refresh-token');
                localStorage.setItem('user', JSON.stringify({
                    userId: 'user-001',
                    email: 'user@example.com',
                    role: 'user',
                }));
            });
        });

        test('standard user should access /tickets', async ({ page }) => {
            await page.goto('/tickets');
            await expect(page).toHaveURL('/tickets');
            await expect(page.locator('h1')).toContainText(/My Tickets|Tickets/);
        });

        test('standard user should access /profile', async ({ page }) => {
            await page.goto('/profile');
            await expect(page).toHaveURL('/profile');
            // Profile page h1 shows the user's email
            await expect(page.locator('h1')).toContainText(/user@example\.com|Profile/);
        });

        test('standard user should NOT access /admin/events/new', async ({ page }) => {
            await page.goto('/admin/events/new');
            // Should redirect to /events (not /login since user is authenticated)
            await expect(page).toHaveURL('/events');
        });

        test('standard user should NOT access /admin/users', async ({ page }) => {
            await page.goto('/admin/users');
            await expect(page).toHaveURL('/events');
        });

        test('standard user should NOT access /admin/events/:id/dashboard', async ({ page }) => {
            await page.goto('/admin/events/test123/dashboard');
            await expect(page).toHaveURL('/events');
        });

        test('standard user should NOT access /staff/scan', async ({ page }) => {
            await page.goto('/staff/scan');
            await expect(page).toHaveURL('/events');
        });
    });

    test.describe('Admin User Access', () => {
        test.beforeEach(async ({ page, context }) => {
            // Set up admin user session using addInitScript
            await context.addInitScript(() => {
      if (location.origin !== 'http://127.0.0.1:43187') return
                localStorage.setItem('access_token', 'admin-token');
                localStorage.setItem('refresh_token', 'refresh-token');
                localStorage.setItem('user', JSON.stringify({
                    userId: 'admin-001',
                    email: 'admin@example.com',
                    role: 'admin',
                }));
            });
        });

        test('admin user should access /admin/events/new', async ({ page }) => {
            await page.goto('/admin/events/new');
            await expect(page).toHaveURL('/admin/events/new');
            await expect(page.locator('h1')).toContainText(/Create|New Event/);
        });

        test('admin user should access /admin/users', async ({ page }) => {
            await page.goto('/admin/users');
            await expect(page).toHaveURL('/admin/users');
            await expect(page.locator('h1')).toContainText(/Users|User Management/);
        });

        test('admin user should access /admin/events/:id/dashboard', async ({ page }) => {
            await page.route('https://ticketremasterapi.invalid/admin/events/test123/dashboard', route => route.fulfill({ json: { data: { stats: { totalSeats: 10, seatsSold: 2, revenue: 200 }, attendees: [] } } }));
            await page.goto('/admin/events/test123/dashboard');
            await expect(page).toHaveURL('/admin/events/test123/dashboard');
            await expect(page.getByRole('heading', { level: 1 })).toHaveText('Event Dashboard');
        });

        test('admin user should NOT access /staff/scan', async ({ page }) => {
            await page.goto('/staff/scan');
            // Admin is not staff, should redirect to /events
            await expect(page).toHaveURL('/events');
        });

        test('admin user should access public routes', async ({ page }) => {
            await page.goto('/events');
            await expect(page).toHaveURL('/events');

            await page.goto('/marketplace');
            await expect(page).toHaveURL('/marketplace');
        });
    });

    test.describe('Staff User Access', () => {
        test.beforeEach(async ({ page, context }) => {
            // Set up staff user session using addInitScript
            await context.addInitScript(() => {
      if (location.origin !== 'http://127.0.0.1:43187') return
                localStorage.setItem('access_token', 'staff-token');
                localStorage.setItem('refresh_token', 'refresh-token');
                localStorage.setItem('user', JSON.stringify({
                    userId: 'staff-001',
                    email: 'staff@example.com',
                    role: 'staff',
                }));
            });
        });

        test('staff user should access /staff/scan', async ({ page }) => {
            await page.goto('/staff/scan');
            await expect(page).toHaveURL('/staff/scan');
            await expect(page.locator('h1')).toContainText('Fast gate verification for live events.', { timeout: 10000 });
        });

        test('staff user should NOT access /admin/events/new', async ({ page }) => {
            await page.goto('/admin/events/new');
            // Staff is not admin, should redirect to /events
            await expect(page).toHaveURL('/events');
        });

        test('staff user should NOT access /admin/users', async ({ page }) => {
            await page.goto('/admin/users');
            await expect(page).toHaveURL('/events');
        });

        test('staff user should NOT access /admin/events/:id/dashboard', async ({ page }) => {
            await page.goto('/admin/events/test123/dashboard');
            await expect(page).toHaveURL('/events');
        });

        test('staff user should access public routes', async ({ page }) => {
            await page.goto('/events');
            await expect(page).toHaveURL('/events');

            await page.goto('/marketplace');
            await expect(page).toHaveURL('/marketplace');
        });

        test('staff user should access user routes', async ({ page }) => {
            await page.goto('/tickets');
            await expect(page).toHaveURL('/tickets');

            await page.goto('/profile');
            await expect(page).toHaveURL('/profile');
        });
    });
});
