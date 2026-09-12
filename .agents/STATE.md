# Browser workflow maintenance

Current task: restore meaningful browser gates and repair reproduced frontend defects from main 98e12d9. Production has not changed yet.

- Confirmed false-success CI: build/test errors were suppressed and Firefox/WebKit projects were absent. The replacement defines all three browsers, checks test types, fails on test/build errors and bounds jobs/report retention.
- All 14 browser specs now exercise actual UI behavior against isolated synthetic API, Socket.IO and Stripe providers; no live transaction providers are called.
- Repairs implemented: new reservation preservation, complete returned event pages, accessible favorites, calendar date controls, handled camera rejection, and bounded manual offline recovery.
- Chromium covers 134 scenarios across a 133-pass full run and a corrected native-XHR deadline check. Firefox/WebKit first full run passed 258/268. Navigation cancellation, precise expiry and narrowly classified synthetic failures are repaired; all affected cases are being rechecked. Successful-asset preload timing advisories remain attached to browser reports.
- Source and browser-test type checking plus workflow lint pass. All 44 unit cases pass on the final serial rerun; the previous concurrent dynamic-import timeout is recorded.

Next: finish cross-browser verification and verify hosted gates and exact production commit, then publish PostPlan 67. No environment files or production data were changed. Backend transaction integration remains separately unverified. The full portfolio goal remains active.
