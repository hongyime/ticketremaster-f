import type { Page, Route } from '@playwright/test'
import { test, expect, seedUser } from './setup/fixtures'
const api = 'https://ticketremasterapi.invalid'

test.describe('Credit top-up frontend integration with a synthetic Stripe provider', () => {
  test.beforeEach(async ({ context }) => seedUser(context))
  test('should complete the full top-up UI and confirmation flow', async ({ page }) => {
    const requests: { path: string; body: unknown; key?: string }[] = []
    let balance = 50
    await page.route(`${api}/credits/balance`, route => route.fulfill({ json: { data: { creditBalance: balance } } }))
    await page.route(`${api}/credits/topup/*`, route => {
      const path = new URL(route.request().url()).pathname
      requests.push({ path, body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] })
      if (path.endsWith('/initiate')) return route.fulfill({ json: { data: { clientSecret: 'pi_test_secret', paymentIntentId: 'pi_123456' } } })
      balance = 150
      return route.fulfill({ json: { data: { status: 'succeeded' } } })
    })
    await page.goto('/credits/topup')
    await page.getByRole('button', { name: '$100', exact: true }).click()
    await page.getByPlaceholder('ALEXANDER VANCE').fill('Fixture Buyer')
    await page.getByRole('button', { name: 'Complete Top-up' }).click()
    await expect(page.locator('.result-msg.success')).toHaveText('Top-up of $100.00 succeeded.')
    expect(requests.map(item => ({ path: item.path, body: item.body }))).toEqual([
      { path: '/credits/topup/initiate', body: { amount: 100 } },
      { path: '/credits/topup/confirm', body: { paymentIntentId: 'pi_123456' } },
    ])
    expect(requests.every(item => Boolean(item.key))).toBe(true)
    expect(await page.evaluate(() => (window as any).__stripeCalls.length)).toBe(1)
    await expect(page.locator('.balance-value')).toContainText('150')
  })
  test('should prevent another top-up while the first request is pending', async ({ page }) => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    let attempts = 0
    await page.route(`${api}/credits/topup/initiate`, async route => {
      attempts++
      await pending
      await route.fulfill({ status: 400, json: { error: { code: 'VALIDATION_ERROR' } } })
    })
    await page.goto('/credits/topup')
    await page.getByRole('button', { name: 'Complete Top-up' }).click()
    const button = page.locator('.complete-button')
    await expect(button).toBeDisabled()
    await button.evaluate((element: HTMLButtonElement) => element.click())
    expect(attempts).toBe(1)
    release()
    await expect(page.locator('.result-msg.error')).toHaveText('Payment initiation failed.')
    await expect(button).toBeEnabled()
  })
  test('should block invalid amounts before initiating a payment', async ({ page }) => {
    let attempts = 0
    await page.route(`${api}/credits/topup/initiate`, route => { attempts++; return route.fulfill({ status: 400, json: {} }) })
    await page.goto('/credits/topup')
    await expect(page.locator('.complete-button')).toBeEnabled()
    await page.locator('input[type="number"]').fill('-50')
    await expect(page.locator('.complete-button')).toBeDisabled()
    await page.locator('.complete-button').evaluate((element: HTMLButtonElement) => element.click())
    expect(attempts).toBe(0)
  })
  test('should show a Stripe decline without confirming a top-up', async ({ page }) => {
    await page.route(`${api}/credits/topup/initiate`, route => route.fulfill({ json: { data: { clientSecret: 'pi_test_secret', paymentIntentId: 'pi_123456' } } }))
    await page.goto('/credits/topup')
    await page.evaluate(() => { (window as any).__stripeResult = { error: { message: 'Fixture card declined.' } } })
    await page.getByRole('button', { name: 'Complete Top-up' }).click()
    await expect(page.locator('.result-msg.error')).toHaveText('Fixture card declined.')
    expect(await page.evaluate(() => (window as any).__stripeCalls.length)).toBe(1)
    // Any unmocked confirmation would fail the global network guard.
  })
})

test.describe('Transfer Flow with OTP Rate Limiting', () => {
    const seedAuthSession = async (
        page: Page,
        userId = 'usr_001',
        email = 'buyer@example.com',
    ) => {
        await page.addInitScript(
            ({ sessionUserId, sessionEmail }) => {
      if (location.origin !== 'http://127.0.0.1:43187') return
                sessionStorage.removeItem('ticketremaster_demo_mode');
                sessionStorage.removeItem('demo_access_token');
                sessionStorage.removeItem('demo_user');
                sessionStorage.removeItem('demo_context');
                localStorage.setItem('access_token', 'mock-token');
                localStorage.setItem('refresh_token', 'refresh-token');
                localStorage.setItem(
                    'user',
                    JSON.stringify({
                        userId: sessionUserId,
                        email: sessionEmail,
                        role: 'user',
                    }),
                );
            },
            { sessionUserId: userId, sessionEmail: email },
        );
    };

    const stubTransferShellRequests = async (page: Page) => {
        await page.context().route('https://ticketremasterapi.invalid/credits/balance*', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: { creditBalance: 250 } }),
            });
        });

        await page.context().route('https://ticketremasterapi.invalid/transfer/pending*', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: { transfers: [] } }),
            });
        });

        await page.context().route('https://ticketremasterapi.invalid/transfer/my-pending*', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: { transfers: [] } }),
            });
        });
    };

    const enterOtp = async (page: Page, otp: string) => {
        await page.locator('.otp-grid').click();
        await page.keyboard.type(otp);
    };

    const navigateInApp = async (page: Page, path: string) => {
        await page.goto('/');
        await page.locator('main').waitFor({ state: 'visible' });
        await page.evaluate((nextPath) => {
            window.history.pushState({}, '', nextPath);
            window.dispatchEvent(new PopStateEvent('popstate'));
        }, path);
    };

    const fulfillTransferApi = async (route: Route, body: unknown) => {
        if (route.request().resourceType() === 'document') {
            await route.fallback();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });
    };

    test('should show rate limit warning after 429 response', async ({ page }) => {
        await seedAuthSession(page, 'usr_001', 'buyer@example.com');
        await stubTransferShellRequests(page);

        await page.context().route('https://ticketremasterapi.invalid/transfer/txr_001', async route => {
            await fulfillTransferApi(route, {
                data: {
                    transferId: 'txr_001',
                    status: 'pending_buyer_otp',
                    buyerId: 'usr_001',
                    sellerId: 'usr_002',
                    sellerOtpVerified: true,
                    buyerVerificationSid: 'VE_buyer_001',
                    creditAmount: 100,
                    eventName: 'Singapore Jazz Festival 2026',
                    venueName: 'Singapore Indoor Stadium',
                    seatRow: 'B',
                    seatNumber: '14',
                },
            });
        });

        await page.context().route('https://ticketremasterapi.invalid/transfer/txr_001/buyer-verify', async route => {
            await route.fulfill({
                status: 429,
                contentType: 'application/json',
                body: JSON.stringify({
                    error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait.' },
                }),
            });
        });

        await navigateInApp(page, '/transfer/txr_001');
        await expect(page.locator('.otp-layout')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('.otp-event-name')).toContainText('Singapore Jazz Festival 2026');

        await enterOtp(page, '123456');
        await page.getByRole('button', { name: 'Verify & Complete' }).click();

        await expect(page.locator('.warning-box')).toContainText('Too many attempts');
    });

    test('should hand off from buyer OTP verification to seller waiting state', async ({ page }) => {
        await seedAuthSession(page, 'usr_001', 'buyer@example.com');
        await stubTransferShellRequests(page);

        await page.context().route('https://ticketremasterapi.invalid/transfer/txr_002', async route => {
            await fulfillTransferApi(route, {
                data: {
                    transferId: 'txr_002',
                    status: 'pending_buyer_otp',
                    buyerId: 'usr_001',
                    sellerId: 'usr_002',
                    buyerVerificationSid: 'VE_buyer_002',
                    creditAmount: 100,
                    eventName: 'Neon Nights',
                    venueName: 'Esplanade Concert Hall',
                    seatRow: '12',
                    seatNumber: '08',
                },
            });
        });

        await page.context().route('https://ticketremasterapi.invalid/transfer/txr_002/buyer-verify', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        transferId: 'txr_002',
                        status: 'pending_seller_otp',
                        buyerOtpVerified: true,
                        sellerVerificationSid: 'VE_seller_002',
                        creditAmount: 100,
                        eventName: 'Neon Nights',
                        seatRow: '12',
                        seatNumber: '08',
                    },
                }),
            });
        });

        await navigateInApp(page, '/transfer/txr_002');
        await expect(page.locator('.otp-layout')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('.otp-event-name')).toContainText('Neon Nights');
        await expect(page.locator('.otp-seat')).toContainText('Row 12');

        await enterOtp(page, '123456');
        await page.getByRole('button', { name: 'Verify & Complete' }).click();

        await expect(page.getByText('Waiting for seller verification.')).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('The buyer is verified. The seller now needs to enter their OTP to complete the transfer.')).toBeVisible();
        await expect(page.locator('.otp-layout')).toHaveCount(0);
    });

    test('should show the seller OTP screen after the buyer verifies', async ({ page }) => {
        await seedAuthSession(page, 'usr_002', 'seller@example.com');
        await stubTransferShellRequests(page);

        await page.context().route('https://ticketremasterapi.invalid/transfer/txr_003', async route => {
            await fulfillTransferApi(route, {
                data: {
                    transferId: 'txr_003',
                    status: 'pending_seller_otp',
                    buyerId: 'usr_001',
                    sellerId: 'usr_002',
                    buyerOtpVerified: true,
                    sellerVerificationSid: 'VE_seller_003',
                    creditAmount: 100,
                    eventName: 'Symphony Night',
                    venueName: 'Victoria Concert Hall',
                    seatSection: 'VIP',
                    seatRow: 'C',
                    seatNumber: '21',
                },
            });
        });

        await navigateInApp(page, '/transfer/txr_003');
        await expect(page.locator('.otp-layout')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.otp-event-name')).toContainText('Symphony Night');
        await expect(page.locator('.otp-seat')).toContainText('Row C');
        await expect(page.locator('.otp-copy')).toContainText('The buyer has finished verification');
        await expect(page.getByRole('button', { name: 'Verify & Continue' })).toBeVisible();
    });

    test('should complete the transfer after seller verification', async ({ page }) => {
        await seedAuthSession(page, 'usr_002', 'seller@example.com');
        await stubTransferShellRequests(page);
        let completed = false;

        await page.context().route('https://ticketremasterapi.invalid/transfer/txr_005', async route => {
            await fulfillTransferApi(route, {
                data: {
                    transferId: 'txr_005',
                    status: completed ? 'completed' : 'pending_seller_otp',
                    buyerId: 'usr_001',
                    sellerId: 'usr_002',
                    buyerOtpVerified: true,
                    sellerVerificationSid: 'VE_seller_005',
                    creditAmount: 100,
                    eventName: 'Afterglow Arena',
                    seatRow: 'F',
                    seatNumber: '03',
                },
            });
        });

        await page.context().route('https://ticketremasterapi.invalid/transfer/txr_005/seller-verify', async route => {
            expect(route.request().postDataJSON()).toEqual({ otp: '654321' });
            completed = true;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        transferId: 'txr_005',
                        status: 'completed',
                        completedAt: new Date().toISOString(),
                        sellerOtpVerified: true,
                        creditAmount: 100,
                        eventName: 'Afterglow Arena',
                        seatRow: 'F',
                        seatNumber: '03',
                    },
                }),
            });
        });

        await navigateInApp(page, '/transfer/txr_005');
        await expect(page.locator('.otp-layout')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('.otp-event-name')).toContainText('Afterglow Arena');

        await enterOtp(page, '654321');
        await page.getByRole('button', { name: 'Verify & Continue' }).click();

        await expect(page.getByText('Transfer complete.')).toBeVisible({ timeout: 10000 });
        await expect(page.getByRole('button', { name: 'Back to Marketplace' })).toBeVisible();
        await expect(page.getByText('$100.00')).toBeVisible();
    });
});

test.describe('API Reliability Features', () => {
  test('should not automatically repeat rate-limited balance requests', async ({ page, context }) => {
    await seedUser(context)
    await page.clock.install()
    let attempts = 0
    await page.route(`${api}/credits/balance`, route => { attempts++; return route.fulfill({ status: 429, json: { error: { code: 'RATE_LIMITED' } } }) })
    await page.goto('/credits/topup')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Account Credits')
    // The initial route and wallet may each schedule a navbar read. After
    // startup settles, advancing time must not retry any 429 response.
    await page.clock.fastForward(1000)
    await expect.poll(() => attempts).toBeGreaterThanOrEqual(2)
    const initialAttempts = attempts
    expect(initialAttempts).toBeLessThanOrEqual(3)
    await page.clock.fastForward(60000)
    expect(attempts).toBe(initialAttempts)
    await expect(page.locator('.balance-value')).toContainText('0.00')
  })
  test('should disable credential submission after an offline fallback', async ({ page }) => {
    await page.clock.install()
    let attempts = 0
    await page.route(`${api}/events?*`, route => { attempts++; return route.fulfill({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE' } } }) })
    await page.goto('/events')
    await expect.poll(() => attempts).toBe(1)
    for (const [index, delay] of [3100, 5100, 9100].entries()) {
      await page.clock.fastForward(delay)
      await expect.poll(() => attempts).toBe(index + 2)
    }
    await expect(page.locator('.offline-banner')).toBeVisible()
    await page.getByRole('link', { name: 'Login', exact: true }).click()
    await expect(page).toHaveURL('/login')
    await expect(page.getByLabel('Email Address')).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeDisabled()
  })
})
