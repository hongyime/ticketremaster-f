# Maintenance decisions

- 2026-09-13: Begin an isolated notification polling review from current main. Preserve transaction deadlines and backend infrastructure; validate with synthetic responses and record production evidence before claiming completion.
- 2026-09-13: Make the application root own notification startup. Browser fixtures exposed a second pair after a lazy notification page mounted; the navbar now consumes store state and the page initializes idempotently. Reads share requests, pause while hidden/offline, cancel stale identities, and queue one fresh pair after realtime changes. Keep the visible fallback at 30 seconds after completion and bound each read to a 30-second timeout.
- 2026-09-13: PR checks exposed conflicting default and advanced CodeQL setups. Consolidate into the repository workflow with Actions, JavaScript/TypeScript and Python coverage; verify accepted uploads before merge. No security check is bypassed.

- 2026-09-13: Started browser workflow repair after confirming false-success Firefox/WebKit jobs and suppressed build/test exits. Preserve all existing scenario intents; isolate production-build browser requests from real API, payment and OTP providers.

- 2026-09-13: Strict purchase and catalogue cases reproduced four application failures before repair. Preserve reservation tokens through timer ticks/dismissal; render all returned events; restore browser-only date filtering and accessible featured favorites. Synthetic provider tests do not establish backend payment or OTP correctness.

- 2026-09-13: Cross-browser verification exposed Safari navigation cancellation clearing a saved login and upstream camera promise failures. Ignore cancellation during page exit, preserve real outages, handle camera rejection, and add one explicit eight-second offline recovery request without automatic retry. Keep reservation storage until absolute expiry. Retain successful-asset preload timing warnings as report advisories; runtime exceptions and failed assets still fail tests. All 44 unit cases pass in a serial rerun.
