# Diff summary: WORK-2026092802

| File | Change |
|---|---|
| `apps/api/src/handlers/submit-pick.ts` | `TRACK_ONLY_INTENT_GUARD` replaces the UTV2-1923 block that overwrote a capper's requested `distributionMode` with the allow-list verdict. `track-only` or an absent mode persists as `track-only` with a refused authorization record. `delivery-eligible` needs the allow-list to answer `authorized`, otherwise 403 `CAPPER_TRACK_ONLY_REQUIRED`. Any other value returns 403. The UTV2-1672 `CAPPER_TRACK_ONLY_PIN_GUARD` markers are kept. |
| `apps/api/src/capper-delivery-authorization.ts` | New `recordTrackOnlyRequest()` builds a server-authored `decision: 'refused'`, `reason: 'track-only-requested'` record, without consulting the allow-list. |
| `packages/contracts/src/smart-form.ts` | Adds `'track-only-requested'` to `humanCapperDeliveryRefusalReasons`. |
| `apps/api/src/t1-proof-utv2-1923-human-capper-delivery.test.ts` | Authorized delivery paths now request `delivery-eligible` explicitly. Refusal cases assert 403 and 0 persisted picks, and odd modes are covered. New section 7 has the production request shape and a mutation drill that restores the pre-fix block. |
| `apps/api/src/capper-delivery-authorization.test.ts` | Three `recordTrackOnlyRequest` tests. |
| `apps/api/src/t1-proof-work-2026092802-track-only-intent-live.test.ts` | New live staging proof. It runs under `pnpm test:t1-proof:live` when `CI_FIXTURE_RUN_ID` is set and refuses the production ref. |
| `package.json` | Appends the live test to `test:t1-proof:live`. |
| `docs/05_operations/db-writer-classification.json` | Classifies the new credentialed live test (owner `api`, executed by `pnpm test:t1-proof:live`). |
| `apps/smart-form/CLAUDE.md` | Describes the new Track Only semantics. |
| `.ops/work/WORK-2026092802.md` | Repo-owned work order. |

`apps/api/src/http-integration.test.ts` is in scope and unchanged. Its 27 tests pass, including
the UTV2-1672 track-only pin mutation control.

Unchanged: kill switches, target registry, per-capper routing, outbox, worker, exactly-once
enqueue, containment, and client-authorization stripping.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1675
