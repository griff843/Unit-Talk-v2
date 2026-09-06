# UTV2-1847 — Diff Summary

Generated at: 2026-09-06T22:52:30.316Z  
Tier: T2 · Lane type: delivery-ui  
Branch: `codex/utv2-1847-smart-form-e2e-ci`  
Execution SHA: `3518fef1c120187c1acf3be38fc01a8c109eed14`

This delivery-ui slice repairs the substantive browser-to-API path. CI workflow wiring is the
separately scoped hygiene slice named by the work order; this branch does not touch `.github/**` or
the root `package.json`.

| File | Change |
|---|---|
| `apps/smart-form/playwright.config.ts` | Starts an isolated in-memory API on `127.0.0.1:4000` and the Next dev server on `127.0.0.1:4100`. The API readiness URL is required before any spec runs, production credentials are blanked, delivery/scanner controls are disabled, and CI refuses to reuse an unrelated process. |
| `apps/smart-form/e2e/phase-one.spec.ts` | Converts canonical structured fallback and manual coverage-gap submissions from mocked POSTs to the real local API; reads each pick back; checks signed `-3.5` / `+105`, canonical IDs or honest null IDs/provenance, and no Track Only outbox row. Also asserts a past event requests `recentSince`. |
| `apps/smart-form/e2e/real-reference.spec.ts` | Uses an explicit deterministic browser session without mocking canonical reference-data requests. |
| `apps/smart-form/e2e/smart-form-submission.spec.ts` | Uses the same explicit session fixture and makes event-browse intercepts query-aware so freshness parameters cannot bypass fixtures as dates age. |

Application diff measured from `origin/main` to the implementation commit:

```
 apps/smart-form/e2e/phase-one.spec.ts             | 134 ++++++++++++++-------
 apps/smart-form/e2e/real-reference.spec.ts        |   9 ++
 apps/smart-form/e2e/smart-form-submission.spec.ts |  31 +++--
 apps/smart-form/playwright.config.ts              |  57 +++++++--
 4 files changed, 170 insertions(+), 61 deletions(-)
```

No API source, domain/contracts, database, worker, migration, production target, or containment
configuration changed.

## SHA Binding

Head SHA: `3518fef1c120187c1acf3be38fc01a8c109eed14`  
Merge SHA: pending merge
