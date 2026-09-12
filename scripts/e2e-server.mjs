import { spawn } from 'node:child_process'
import { preview } from 'vite'

// Keep synthetic provider settings out of production artifacts. Process values
// override developer .env files loaded by Vite.
const env = { ...process.env }
for (const key of Object.keys(env)) if (key.startsWith('VITE_')) env[key] = ''
Object.assign(env, {
  VITE_API_BASE_URL: 'https://ticketremasterapi.invalid',
  VITE_WS_URL: 'wss://ticketremasterws.invalid',
  VITE_KONG_API_KEY: '',
  VITE_STRIPE_PUBLIC_KEY: 'pk_test_browser_fixture',
  VITE_SENTRY_DSN: '',
  VITE_POSTHOG_API_KEY: '',
  VITE_ENABLE_VUE_DEVTOOLS: 'false',
})

const vite = 'node_modules/vite/bin/vite.js'
const build = spawn(process.execPath, [vite, 'build', '--mode', 'e2e', '--outDir', 'dist-e2e'], { env, stdio: 'inherit', windowsHide: true })
build.on('error', error => { console.error(error); process.exit(1) })
build.on('exit', async code => {
  if (code !== 0) process.exit(code ?? 1)
  // Vite normally inherits server.proxy in preview. No project configuration is
  // loaded here: this server must serve SPA routes without contacting a backend.
  const server = await preview({
    configFile: false,
    build: { outDir: 'dist-e2e' },
    preview: { host: '127.0.0.1', port: 43187, strictPort: true, proxy: {} },
  })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.httpServer.close(() => process.exit(0)))
})
