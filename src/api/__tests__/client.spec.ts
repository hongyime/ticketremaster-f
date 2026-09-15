import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError } from 'axios'
import type { InternalAxiosRequestConfig, AxiosResponseHeaders } from 'axios'

const toastPush = vi.fn()
const clearSession = vi.fn()
const consoleError = vi.fn()
const consoleWarn = vi.fn()
const consoleLog = vi.fn()
const setDemoMode = vi.fn()

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    state: {
      accessToken: 'test-token',
      user: null,
    },
    clearSession,
  }),
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    push: toastPush,
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}))

vi.mock('@/services/mockData', () => ({
  setDemoMode,
  isDemoMode: vi.fn(() => false),
}))

const { default: api } = await import('@/api/client')

function createTransferNotFoundError(config: InternalAxiosRequestConfig) {
  return new AxiosError(
    'Request failed with status code 404',
    'ERR_BAD_REQUEST',
    config,
    {},
    {
      status: 404,
      statusText: 'Not Found',
      config,
      headers: {} as AxiosResponseHeaders,
      data: {
        error: {
          code: 'TRANSFER_NOT_FOUND',
          message: 'Transfer not found.',
        },
      },
    },
  )
}

function createRateLimitError(config: InternalAxiosRequestConfig) {
  return new AxiosError(
    'Request failed with status code 429',
    'ERR_BAD_REQUEST',
    config,
    {},
    {
      status: 429,
      statusText: 'Too Many Requests',
      config,
      headers: {} as AxiosResponseHeaders,
      data: {
        error: {
          code: 'OTP_RATE_LIMIT_EXCEEDED',
          message: 'Account locked. Try again in 900 seconds.',
        },
      },
    },
  )
}

describe('api client silent background requests', () => {
  beforeEach(() => {
    toastPush.mockReset()
    clearSession.mockReset()
    consoleError.mockReset()
    consoleWarn.mockReset()
    consoleLog.mockReset()
    setDemoMode.mockReset()
    vi.spyOn(console, 'error').mockImplementation(consoleError)
    vi.spyOn(console, 'warn').mockImplementation(consoleWarn)
    vi.spyOn(console, 'log').mockImplementation(consoleLog)
    api.defaults.adapter = async (config) => {
      throw createTransferNotFoundError(config)
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('suppresses toast for silent background polling requests', async () => {
    await expect(api.get('/transfer/my-pending', { suppressErrorToast: true } as any)).rejects.toBeInstanceOf(AxiosError)

    expect(toastPush).not.toHaveBeenCalled()
  })

  it('keeps toast behavior for normal requests', async () => {
    await expect(api.get('/transfer/my-pending')).rejects.toBeInstanceOf(AxiosError)

    expect(toastPush).toHaveBeenCalledWith('Transfer not found.', 'error')
    expect(consoleWarn).toHaveBeenCalled()
  })

  it('suppresses console logging for silent background polling requests', async () => {
    await expect(
      api.get('/purchase/hold/resume/evt_001', { suppressErrorToast: true, suppressErrorLog: true } as any),
    ).rejects.toBeInstanceOf(AxiosError)

    expect(consoleError).not.toHaveBeenCalled()
    expect(consoleWarn).not.toHaveBeenCalled()
    expect(consoleLog).not.toHaveBeenCalled()
  })

  it('does not retry 429 responses', async () => {
    const adapter = vi.fn(async (config) => {
      throw createRateLimitError(config)
    })
    api.defaults.adapter = adapter

    await expect(api.post('/transfer/demo-transfer-001/seller-verify', { otp: '123456' })).rejects.toBeInstanceOf(AxiosError)

    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it('does not switch transfer detail requests into demo mode on network errors', async () => {
    api.defaults.adapter = async () => {
      throw new AxiosError('Network Error', 'ERR_NETWORK')
    }

    await expect(api.get('/transfer/demo-transfer-001')).rejects.toBeInstanceOf(AxiosError)

    expect(setDemoMode).not.toHaveBeenCalled()
  })

  const privateValue = 'SYNTHETIC_PRIVATE_PAYLOAD_67dcb'
  const privateUrl = `/auth/login/${privateValue}?token=${privateValue}#${privateValue}`
  function sensitiveFailure(config: InternalAxiosRequestConfig, status?: number) {
    return new AxiosError(privateValue, privateValue, config, {}, status === undefined ? undefined : {
      status,
      statusText: privateValue,
      config,
      headers: { 'set-cookie': privateValue } as unknown as AxiosResponseHeaders,
      data: { error: { code: privateValue, message: privateValue }, accessToken: privateValue },
    })
  }

  it.each([400, 401, 403, 429, 500, 502, 503, 504, undefined])(
    'keeps private request and response values out of status %s diagnostics', async (status) => {
      let failure: AxiosError | undefined
      api.defaults.adapter = async (config) => {
        failure = sensitiveFailure(config, status)
        throw failure
      }
      const result = await api.post(privateUrl, { password: privateValue, otp: privateValue }, {
        headers: { apikey: privateValue, 'X-Private-Test': privateValue },
        params: { credential: privateValue }, skipRetry: true,
      } as any).catch(error => error)
      expect(result).toBe(failure)
      expect(JSON.stringify([consoleError.mock.calls, consoleWarn.mock.calls, consoleLog.mock.calls]))
        .not.toContain(privateValue)
      const sink = status !== undefined && status < 500 ? consoleWarn : consoleError
      expect(sink).toHaveBeenCalledWith(
        status !== undefined && status < 500 ? 'API request rejected' : 'API error',
        { method: 'POST', status },
      )
      expect(clearSession).not.toHaveBeenCalled()
    },
  )

  it.each([false, true])('keeps retries private with suppressErrorLog=%s', async (silent) => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (adapter.mock.calls.length === 1) throw sensitiveFailure(config, 503)
      return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config }
    })
    api.defaults.adapter = adapter
    const request = api.get(privateUrl, { suppressErrorLog: silent } as any)
    await vi.runAllTimersAsync()
    expect((await request).data).toEqual({ ok: true })
    expect(adapter).toHaveBeenCalledTimes(2)
    expect(JSON.stringify([consoleError.mock.calls, consoleWarn.mock.calls, consoleLog.mock.calls]))
      .not.toContain(privateValue)
    if (silent) {
      expect(consoleError).not.toHaveBeenCalled()
      expect(consoleLog).not.toHaveBeenCalled()
    } else {
      expect(consoleLog).toHaveBeenCalledWith('API retry scheduled', {
        method: 'GET', status: 503, attempt: 1, maxAttempts: 3, delayMs: 500,
      })
    }
  })

  it.each([NaN, 999, privateValue])('does not log unrecognized method/status values (%s)', async (status) => {
    api.defaults.adapter = async (config) => { throw sensitiveFailure(config, status as number) }
    await expect(api.request({ url: privateUrl, method: privateValue as any, skipRetry: true } as any))
      .rejects.toBeInstanceOf(AxiosError)
    expect(consoleError).toHaveBeenCalledWith('API error', { method: 'OTHER', status: undefined })
    expect(JSON.stringify([consoleError.mock.calls, consoleWarn.mock.calls, consoleLog.mock.calls]))
      .not.toContain(privateValue)
  })
})
