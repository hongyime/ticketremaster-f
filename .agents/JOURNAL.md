# Maintenance decisions

- 2026-09-13: Begin an isolated notification polling review from current main. Preserve transaction deadlines and backend infrastructure; validate with synthetic responses and record production evidence before claiming completion.
- 2026-09-13: Make the application root own notification startup. Browser fixtures exposed a second pair after a lazy notification page mounted; the navbar now consumes store state and the page initializes idempotently. Reads share requests, pause while hidden/offline, cancel stale identities, and queue one fresh pair after realtime changes. Keep the visible fallback at 30 seconds after completion and bound each read to a 30-second timeout.
- 2026-09-13: PR checks exposed conflicting default and advanced CodeQL setups. Consolidate into the repository workflow with Actions, JavaScript/TypeScript and Python coverage; verify accepted uploads before merge. No security check is bypassed.
