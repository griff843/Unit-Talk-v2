# PROOF: UTV2-1787

MERGE_SHA: pending merge

> Pre-merge the merge anchor is intentionally empty; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-08-30T12:55:34.894Z
Issue: UTV2-1787
Tier: T1
Lane type: runtime
Branch: codex/utv2-1787-smart-form-phase-1
PR URL: N/A
Head SHA: b18a0b829d1804eb604cf03dacba2b0454ae6431
result: passed_with_staging_db_pending

## ASSERTIONS:

- [x] SF-01: approved capper authentication is enforced and the server binds submission identity to the authenticated capper.
- [x] `griffadavi@gmail.com` is approved and resolves to the existing canonical capper ID `griff843`.
- [x] SF-02: structured matchup, team, and player selection preserves canonical IDs and server-side relationship validation.
- [x] SF-10: Track Only submissions persist picks without creating distribution outbox work; enqueue, retry, and requeue remain blocked.
- [x] SF-11: manual participant override is explicit, unresolved, and persists without fabricated canonical participant IDs.
- [x] Mobile NCAAF moneyline/player-prop and desktop MLB submission paths pass browser verification.
- [x] Member delivery remains disabled.

## EVIDENCE:

```
$ pnpm verify:static
PASS: env:check, lint, type-check, build, monorepo tests, smart-form verification, command checks

$ pnpm type-check
PASS

$ pnpm test
PASS

$ pnpm exec tsx --test apps/api/src/smart-form-validation.test.ts
PASS: 14/14

$ pnpm exec tsx --test apps/api/src/http-integration.test.ts
PASS: 21/21

$ pnpm --filter @unit-talk/smart-form test
PASS: 116/116

$ pnpm --filter @unit-talk/smart-form exec playwright test
PASS: 22/22

$ pnpm qa:experience --surface smart_form --persona operator --flow submit_pick --mode observe --env local
PASS: route 200, Auth.js session 200, required controls rendered, no HTTP 5xx

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 40
Rules matched: operator-ui

$ pnpm test:db
REFUSED before write: local environment targets production project zfzdnfwdarxucxtaojxm;
T1 writable DB proof must run in staging project xskgrzbteyqdufktjrjx in CI.
```

## Verification
- [x] `pnpm verify:static`: passed
- [x] Focused API validation and integration tests: passed (35/35)
- [x] Smart Form unit tests: passed (116/116)
- [x] Smart Form Playwright tests: passed (22/22)
- [x] Experience QA Agent: passed against source SHA `b18a0b82`
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: passed
- [ ] `pnpm test:db`: pending staging CI; the local production-target guard correctly refused before any write

## Runtime Verification
- Production-mode Smart Form served `/submit` and `/api/auth/session` with HTTP 200 on port 4100.
- Playwright exercised authenticated recovery access, canonical participant selection, duplicate-side prevention, team/player reset, sport reset, manual unresolved override, and Track Only submissions.
- Experience QA Agent recorded PASS with no 5xx responses and stable control selectors.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Approved PR head: pending merge
Execution SHA: b18a0b829d1804eb604cf03dacba2b0454ae6431
