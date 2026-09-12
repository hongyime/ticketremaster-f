import type { BrowserContext } from '@playwright/test'

type BrowserMessage = { type: string; message: string; url: string }

// Scope allowances to observed synthetic API failures. JavaScript exceptions,
// Vue warnings and local asset errors are never covered by a broad allowlist.
export function monitorConsole(context: BrowserContext) {
  const messages: BrowserMessage[] = []
  let failedApiRequest = false
  const loadedAssets = new Set<string>()
  const isApi = (url: string) => {
    try { return new URL(url).origin === 'https://ticketremasterapi.invalid' } catch { return false }
  }
  context.on('response', response => {
    if (isApi(response.url()) && response.status() >= 400) failedApiRequest = true
    if (response.ok() && /^http:\/\/127\.0\.0\.1:43187\/assets\/[^?#]+\.(?:js|css)$/.test(response.url())) loadedAssets.add(response.url())
  })
  context.on('requestfailed', request => { if (isApi(request.url())) failedApiRequest = true })
  context.on('page', page => {
    page.on('pageerror', error => messages.push({ type: 'exception', message: error.message, url: page.url() }))
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') messages.push({ type: message.type(), message: message.text(), url: message.location().url })
    })
  })
  // WebKit may report delayed module preloads under CPU load. Retain these
  // advisory timings in the report; failed assets and runtime warnings still fail.
  const isPreloadAdvisory = (item: BrowserMessage) => {
    const match = /^The resource (http:\/\/127\.0\.0\.1:43187\/assets\/[^ ]+\.(?:js|css)) was preloaded using link preload but not used within a few seconds from the window's load event\. Please make sure it wasn't preloaded for nothing\.$/.exec(item.message)
    return item.type === 'warning' && !!match && loadedAssets.has(match[1]!)
  }
  return { advisories: () => messages.filter(isPreloadAdvisory), errors: () => messages.filter(item => {
    if (item.type === 'exception') return true
    if (isPreloadAdvisory(item)) return false
    if (item.message === 'Service Worker registration blocked by Playwright') return false
    if (failedApiRequest && /^API (?:error|request rejected)\b/.test(item.message)) return false
    if (failedApiRequest && /^(?:AxiosError|Error: Request failed with status code)/.test(item.message)) return false
    const corsResource = /^\[JavaScript Error: "Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at (https:\/\/\S+)\. \(Reason: CORS request did not succeed\)\. Status code: \(null\)\."\]$/.exec(item.message)
    if (failedApiRequest && corsResource && isApi(corsResource[1]!)) return false
    const apiResource = !item.url || isApi(item.url)
    if (failedApiRequest && apiResource && /Failed to load resource|net::ERR_|NS_ERROR_/.test(item.message)) return false
    return true
  }) }
}
