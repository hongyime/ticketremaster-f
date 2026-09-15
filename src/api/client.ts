import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
  type AxiosError,
} from 'axios'

// Extend InternalAxiosRequestConfig to include metadata
interface InternalAxiosRequestConfigWithMetadata extends InternalAxiosRequestConfig {
  metadata?: {
    cachedKey?: string
    idempotencyKey?: string
  }
  suppressErrorToast?: boolean
  suppressErrorLog?: boolean
  skipRetry?: boolean
}
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { setDemoMode, isDemoMode } from '@/services/mockData'
import type { ApiError } from '@/types'

const api: AxiosInstance = axios.create()
const apiKey: string = import.meta.env.VITE_KONG_API_KEY || ''

// A browser cancels pending requests when navigating away. That is not an outage
// and must not replace a saved login with an offline demo account.
let pageLeaving = false
window.addEventListener('beforeunload', () => { pageLeaving = true })
window.addEventListener('pagehide', () => { pageLeaving = true })
window.addEventListener('pageshow', () => { pageLeaving = false })

let offlineNotified = false
let demoModeEnabled = false
;(window as unknown as Record<string, unknown>).__apiOffline = false

// Exponential backoff configuration for retry
const MAX_RETRY_ATTEMPTS = 3
const INITIAL_BACKOFF_MS = import.meta.env.PROD ? 2000 : 500
const MAX_BACKOFF_MS = import.meta.env.PROD ? 15000 : 3000
const RETRYABLE_STATUS_CODES = [503, 408, 504]

const calculateBackoff = (attempt: number): number => {
  const exponentialDelay = INITIAL_BACKOFF_MS * Math.pow(2, attempt)
  const jitter = Math.random() * 1000
  return Math.min(exponentialDelay + jitter, MAX_BACKOFF_MS)
}

// Idempotency key cache to prevent duplicate operations within TTL
const idempotencyCache = new Map<
  string,
  { response: unknown; timestamp: number }
>()
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours as per FRONTEND.md

// Paths that require idempotency keys (state-changing operations)
const IDEMPOTENCY_REQUIRED_PATHS = [
  '/purchase/hold/',
  '/purchase/confirm/',
  '/credits/topup/initiate',
  '/credits/topup/confirm',
  '/transfer/initiate',
  '/transfer/',
]

const needsIdempotencyKey = (url: string, method: string): boolean => {
  if (!['POST', 'PUT', 'DELETE'].includes(method.toUpperCase())) return false
  return IDEMPOTENCY_REQUIRED_PATHS.some((path) => url.includes(path))
}

const generateIdempotencyKey = (config: InternalAxiosRequestConfig): string => {
  const url = config.url || ''
  const method = config.method || 'POST'
  const body = config.data ? JSON.stringify(config.data) : ''
  const timestamp = Date.now()
  const keyBase = `${method}:${url}:${body}:${timestamp}`
  let hash = 0
  for (let i = 0; i < keyBase.length; i++) {
    const char = keyBase.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return `idem_${Math.abs(hash).toString(36)}_${timestamp}`
}

const emitOffline = (message: string) => {
  if (offlineNotified) return
  offlineNotified = true
  demoModeEnabled = true
  setDemoMode(true)
  ;(window as unknown as Record<string, unknown>).__apiOffline = true
  window.dispatchEvent(
    new CustomEvent('api:offline', { detail: { message } })
  )
}

const emitOnline = () => {
  if (!offlineNotified) return
  offlineNotified = false
  demoModeEnabled = false
  setDemoMode(false)
  ;(window as unknown as Record<string, unknown>).__apiOffline = false
  window.dispatchEvent(new Event('api:online'))
}

const resolveUrl = (config: InternalAxiosRequestConfig | AxiosRequestConfig): string => {
  const url = config?.url || ''
  if (url.startsWith('http')) return url
  const base = config?.baseURL || ''
  return `${String(base).replace(/\/$/, '')}/${String(url).replace(/^\//, '')}`
}

interface ApiErrorDetails {
  method: string
  status?: number
}

// Do not copy Axios configuration or provider text into console diagnostics:
// request bodies, headers, URLs and responses can contain credentials or OTPs.
const requestDiagnostics = (config: AxiosRequestConfig, status?: number): ApiErrorDetails => {
  const method = String(config.method || 'GET').toUpperCase()
  return {
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method) ? method : 'OTHER',
    status: typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined,
  }
}

const logApiError = (error: AxiosError<ApiError>) => {
  const config = error?.config || {} as InternalAxiosRequestConfig
  if ((config as InternalAxiosRequestConfigWithMetadata).suppressErrorLog) return
  const details = requestDiagnostics(config, error?.response?.status)
  if (details.status && details.status >= 400 && details.status < 500) {
    console.warn('API request rejected', details)
    return
  }
  console.error('API error', details)
}

// Check if this is a read-only endpoint that can use mock data
const canUseMockData = (url: string, method: string): boolean => {
  if (method.toUpperCase() !== 'GET') return false
  const readOnlyPaths = [
    '/events',
    '/venues',
    '/marketplace',
    '/tickets',
    '/users',
    '/auth/me',
    '/credits/balance',
    '/credits/transactions',
    '/admin/users',
    '/admin/events/',
  ]
  return readOnlyPaths.some(path => url.includes(path))
}

// Request Interceptor: Dynamically route requests to the correct Orchestrator
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const url = config.url || ''

    config.baseURL = import.meta.env.VITE_API_BASE_URL

    const auth = useAuthStore()
    if (auth.state.accessToken) {
      config.headers.Authorization = `Bearer ${auth.state.accessToken}`
    }
    if (apiKey && !config.headers.apikey) {
      config.headers.apikey = apiKey
    }

    // Add idempotency key for state-changing operations
    if (needsIdempotencyKey(url, config.method || '')) {
      // Clean expired cache entries
      for (const [key, cached] of idempotencyCache.entries()) {
        if (Date.now() - cached.timestamp > IDEMPOTENCY_TTL_MS) {
          idempotencyCache.delete(key)
        }
      }

      // Generate deterministic cache key
      const cachedKey = `${config.method}:${url}:${JSON.stringify(config.data)}`

      // Generate and set idempotency key
      const idemKey = generateIdempotencyKey(config)
      config.headers['Idempotency-Key'] = idemKey

      // Store request metadata for potential retry
      ;(config as InternalAxiosRequestConfigWithMetadata).metadata = {
        ...(config as InternalAxiosRequestConfigWithMetadata).metadata,
        idempotencyKey: idemKey,
        cachedKey,
      }
    }

    return config
  },
  (error) => Promise.reject(error)
)

api.interceptors.response.use(
  (response: AxiosResponse) => {
    emitOnline()
    // Cache successful responses for idempotent operations
    const config = response.config as InternalAxiosRequestConfig & {
      metadata?: { cachedKey?: string }
    }
    if (
      config.metadata?.cachedKey &&
      response.status >= 200 &&
      response.status < 300
    ) {
      idempotencyCache.set(config.metadata.cachedKey, {
        response: response.data,
        timestamp: Date.now(),
      })
    }
    return response
  },
  async (error: AxiosError<ApiError>) => {
    if (pageLeaving || axios.isCancel(error)) return Promise.reject(error)
    logApiError(error)
    const toast = useToast()
    const status = error?.response?.status
    const data = error?.response?.data
    const errorCode =
      data?.error?.code ||
      data?.error_code
    const errorMessage =
      data?.error?.message ||
      data?.message
    const original = error.config as (InternalAxiosRequestConfigWithMetadata & {
      __retryCount?: number
      __useMockData?: boolean
    }) || {}
    const isNetworkError =
      !error?.response || error?.code === 'ERR_NETWORK'

    // Initialize retry count if not present
    if (original && !original.__retryCount) {
      original.__retryCount = 0
    }

    // Check if we can return a cached response for idempotent retry
    if (
      original.metadata?.cachedKey &&
      (status === 408 ||
        status === 504 ||
        isNetworkError)
    ) {
      const cached = idempotencyCache.get(original.metadata.cachedKey)
      if (cached && Date.now() - cached.timestamp < IDEMPOTENCY_TTL_MS) {
        // Return cached response instead of failing
        return Promise.resolve({ data: cached.response, status: 200 } as AxiosResponse)
      }
    }

    // Exponential backoff retry for retryable status codes
    const retryCount = original.__retryCount || 0
    if (
      !original.skipRetry &&
      (status && RETRYABLE_STATUS_CODES.includes(status)) &&
      retryCount < MAX_RETRY_ATTEMPTS
    ) {
      original.__retryCount = retryCount + 1
      const delay = calculateBackoff(retryCount)
      
      if (!original.suppressErrorLog) {
        console.log('API retry scheduled', {
          ...requestDiagnostics(original, status),
          attempt: retryCount + 1,
          maxAttempts: MAX_RETRY_ATTEMPTS,
          delayMs: delay,
        })
      }
      
      // Wait for backoff delay then retry
      await new Promise(resolve => setTimeout(resolve, delay))
      return api(original)
    }

    // Detect backend unavailability and enable demo mode
    if (
      isNetworkError ||
      status === 408 ||
      status === 502 ||
      status === 503 ||
      status === 504
    ) {
      if (!demoModeEnabled && canUseMockData(original.url || '', original.method || '')) {
        emitOffline('Backend unavailable. Showing demo data for UI development.')
        // Mark this request to use mock data on retry
        original.__useMockData = true
      }
    }

    // Since backend has no refresh tokens, we simply clear session and bounce to login
    // Skip this for auth/login itself — wrong password returns 401 and should be handled in LoginView
    const isLoginRequest = error?.config?.url?.includes('/auth/login')
    if (status === 401 && !isLoginRequest) {
      if (isDemoMode()) {
        return Promise.reject(error)
      }
      const auth = useAuthStore()
      auth.clearSession()
      window.location.href = '/login'
      return Promise.reject(error)
    }

    // If the current user's own record returns 404, their account no longer exists — force logout
    if (status === 404) {
      if (isDemoMode()) {
        return Promise.reject(error)
      }
      const auth = useAuthStore()
      const userId = auth.state.user?.userId
      const url = error.config ? resolveUrl(error.config as InternalAxiosRequestConfig) : ''
      if (
        userId &&
        url.includes(`/users/${userId}`)
      ) {
        auth.clearSession()
        window.location.href = '/login'
        return Promise.reject(error)
      }
    }

    // Map common HTTP errors to user-facing messages
    const isScanRoute = error.config ? resolveUrl(error.config as InternalAxiosRequestConfig).includes('/verify/') : false
    if (status && status >= 400 && !isScanRoute) {
      const codeMessage =
        errorCode === 'SERVICE_TIMEOUT'
          ? 'The request took too long. Please try again.'
          : errorCode === 'SEAT_UNAVAILABLE' || errorCode === 'SEAT_NOT_AVAILABLE'
          ? 'Seat is currently unavailable.'
          : errorCode === 'SEAT_ALREADY_SOLD'
          ? 'Seat has already been sold.'
          : errorCode === 'SEAT_NOT_FOUND'
          ? 'Seat not found.'
          : errorCode === 'EVENT_NOT_FOUND'
          ? 'Event not found.'
          : errorCode === 'EVENT_ENDED'
          ? 'Event has ended.'
          : errorCode === 'HOLD_EXPIRED'
          ? 'Your seat hold expired.'
          : errorCode === 'INSUFFICIENT_CREDITS'
          ? 'Not enough credits for this action.'
          : errorCode === 'OTP_REQUIRED'
          ? 'OTP verification required.'
          : errorCode === 'OTP_INVALID'
          ? 'OTP code is incorrect.'
          : errorCode === 'OTP_EXPIRED'
          ? 'OTP code has expired.'
          : errorCode === 'OTP_MAX_RETRIES'
          ? 'Too many OTP attempts.'
          : errorCode === 'TRANSFER_IN_PROGRESS'
          ? 'A transfer is already pending.'
          : errorCode === 'TRANSFER_INVALID_STATE'
          ? 'Transfer is not in the expected state.'
          : errorCode === 'TRANSFER_NOT_FOUND'
          ? 'Transfer not found.'
          : errorCode === 'NOT_SEAT_OWNER'
          ? 'You do not own this ticket.'
          : errorCode === 'SELF_TRANSFER'
          ? 'You cannot transfer to yourself.'
          : errorCode === 'EMAIL_ALREADY_EXISTS'
          ? 'This email is already registered.'
          : errorCode === 'UNVERIFIED_ACCOUNT'
          ? 'Please verify your phone number.'
          : errorCode === 'VALIDATION_ERROR'
          ? 'Please check your input.'
          : ''
      const message =
        errorMessage ||
        codeMessage ||
        (status === 408
          ? 'The request timed out. Please try again.'
          : status === 429
          ? 'You are doing that too fast. Please wait a moment before trying again.'
          : status === 403 && !errorCode
          ? 'Access denied. Unusual activity detected.'
          : status === 401
          ? 'Please login to continue.'
          : status === 402
          ? 'Not enough credits for this action.'
          : status === 404
          ? 'Requested data was not found.'
          : status === 409
          ? 'This action conflicts with current state.'
          : status === 410
          ? 'This action has expired.'
          : 'Something went wrong. Please try again.')
      if (message && !original.suppressErrorToast) toast.push(message, 'error')
    }
    return Promise.reject(error)
  }
)

// Export demo mode status for components
export { isDemoMode }

export default api
