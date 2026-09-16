import { test, expect } from './setup/fixtures'

for (const retry of [false, true]) {
  test(`login failures preserve diagnostics without private payloads (retry=${retry})`, async ({ page }) => {
    const privateValue = 'synthetic-private-password-6c8571'
    const consoleValues: Promise<unknown[]>[] = []
    page.on('console', message => {
      consoleValues.push(Promise.all(message.args().map(arg => arg.jsonValue().catch(() => null))))
    })
    let requests = 0
    await page.route('https://ticketremasterapi.invalid/auth/login', async route => {
      requests++
      expect(route.request().postDataJSON()).toMatchObject({
        email: 'privacy@example.invalid', password: privateValue,
      })
      await route.fulfill({
        status: retry && requests === 1 ? 503 : 401,
        json: { error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' }, privateProviderData: privateValue },
      })
    })
    await page.goto('/login')
    await page.getByLabel('Email Address').fill('privacy@example.invalid')
    await page.getByLabel('Password', { exact: true }).fill(privateValue)
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
    await expect(page.locator('.toast.error').first()).toContainText('Invalid credentials')
    expect(requests).toBe(retry ? 2 : 1)
    await expect(page).toHaveURL('/login')
    expect(await page.evaluate(() => localStorage.getItem('access_token'))).toBeNull()
    const values = await Promise.all(consoleValues)
    expect(JSON.stringify(values)).not.toContain(privateValue)
    expect(values).toContainEqual(['API request rejected', { method: 'POST', status: 401 }])
    if (retry) expect(values.some(args => args[0] === 'API retry scheduled')).toBe(true)
  })
}
