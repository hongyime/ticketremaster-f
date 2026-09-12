# Notification polling maintenance

Current task: trace and repair unnecessary notification requests while preserving transaction deadlines and current user flows.

- [x] Trace notification and realtime fallback ownership.
- [x] Reproduce background, overlapping and stale-session requests with offline fixtures.
- [x] Repair the request lifecycle without changing transfer, reservation or QR deadlines.
- [ ] Run relevant tests/build checks and verify the production release.
- [ ] Record preservation and update the portfolio report.

The working branch starts from current main `3bd16d2`. The original checkout is clean and remains untouched during implementation. Existing dependency updates are retained. Tests must use synthetic responses, with no live payments, OTPs or outbound notifications.

The production owner is the Pinia notification store. The older seller hook is test-only. Ten lifecycle cases failed before repair; all 21 now pass, plus 23 existing targeted UI tests. Type checking and the production build pass. Desktop/mobile fixtures each start with two reads, make none during 90 seconds hidden, catch up once on return, then resume the 30-second fallback. Baseline confirms old logging/style assertions and a randomized invalid-date fixture remain separate issues. CI explicitly gates types and the notification contract. The existing browser workflow suppresses failures and needs a separate repair. Next: verify hosted checks and production, then synchronize the preserved original checkout and report the release.
