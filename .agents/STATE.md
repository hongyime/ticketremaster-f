# API diagnostic privacy

Branch `fix/api-error-logging` targets `main`. Synthetic failures reproduced private request/response values in console diagnostics and retry URLs; retries also ignored the silent-log option. Keep only recognized HTTP method/status and numeric retry metadata. Five view handlers now log constant context without raw API errors.

Validation: the original implementation failed 11 privacy regressions. All 40 focused API/notification unit cases, application and browser-test type checks, the production build, and two local Chromium login failure/retry scenarios now pass. Request payloads, user-facing errors, session rules and retry policy are preserved. CI now includes the API regression suite.

Next: pass all required hosted workflows, release, and verify both production aliases with intercepted synthetic providers. Backend transaction integration, telemetry configuration and the full portfolio remain open. Bundle-report build optimization is a separate focused change.
