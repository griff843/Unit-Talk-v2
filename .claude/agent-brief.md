# Unit Talk V2 — Agent Brief

> **Prepend this file to every bounded agent dispatch.** It is the repo-specific gotcha list that every lane needs to know before touching code. Re-discovering these pitfalls each session is a waste of context and has caused real production incidents.
>
> Last updated: 2026-04-11. Update when a new drift class is discovered or a policy changes.

This brief is **in addition to** `CLAUDE.md` (execution model, tier/lane rules, merge policy). Read CLAUDE.md for process; read this for the repo's actual traps.

---

## 1. InMemory-vs-Database drift is a recurring quality hole

**The trap:** unit tests run under InMemory repositories. InMemory does NOT enforce Postgres CHECK constraints, NOT_PENDING-style promotion-pipeline state, audit cascades, or atomic-RPC semantics. Tests pass, production breaks.

**Incidents:**
- **UTV2-519** — UTV2-491 shipped with a broken `pick_lifecycle_to_state_check` constraint. Unit tests passed. Live DB rejected every brake attempt. 24+ stranded rows.
- **UTV2-521** — UTV2-509 shipped with the review controller's NOT_PENDING guard unreachable for brake picks (because `submit-pick-controller` sets `approval_status='approved'` via the promotion pipeline). Unit tests set `approval_status='pending'` on hand-built fixtures and never observed production state. Review lane was dead code for autonomous-source picks.

**Rule:** any T1 runtime change that touches lifecycle, promotion, audit, distribution, or review flow **must** land with a corresponding `pnpm test:db` case that exercises the change against live Postgres *via the real submission/review pipeline* (not hand-built fixtures). The `proof-coverage-guard` CI workflow enforces this.

**Pattern to follow:** `apps/api/src/t1-proof-awaiting-approval.test.ts` and `t1-proof-awaiting-approval-review.test.ts`. Both import the actual controllers in-process, submit through the real pipeline, and assert against live DB state.

---

## 2. Worktree credential transport — use the helper, never copy

**The trap:** agents sometimes copy `local.env` into their worktree so `pnpm test:db` can find credentials. On 2026-04-10 this caused `SYSTEM_PICK_SCANNER_ENABLED` to silently revert from `false` to `true` mid-session — the copy shadowed the main worktree's quiesced state.

**Rule:** do NOT copy `local.env`. Do NOT copy `supabase/.temp/**`. Do NOT touch env files in worktrees at all.

**Helper:** `scripts/link-worktree-env.ts`. Symlinks (not copies) the whitelisted credential files from the main worktree. Idempotent. Safe. Documented usage:
```bash
npx tsx scripts/link-worktree-env.ts <worktree-path>
```

**When your packet says "do NOT copy local.env":** it means exactly that. Use the helper or run the live-DB step from the main worktree after diff review.

---

## 3. Scanner quiescence posture (as of Phase 7A)

`SYSTEM_PICK_SCANNER_ENABLED=false` in `local.env` with an inline do-not-revert comment on line 60. The scheduled `system-pick-scanner` in `apps/api/src/index.ts` runs on API startup when this flag is `true`.

**Why it's off:** every API bounce with it on produces autonomous-source picks that trigger the Phase 7A brake path. Any drift in the brake path accumulates stranded rows in production. Until the full UTV2-494 evidence bundle is accepted and stranded-row remediation lands, the scanner stays quiesced.

**Rule:** do NOT flip this flag. Do NOT re-enable the scanner without explicit PM directive. If your task requires the scanner to run for verification, stop and ask.

---

## 4. Stranded rows — do not touch

24+ rows exist in `picks.status='awaiting_approval'` without corresponding `pick_lifecycle` events. These are artifacts of the pre-UTV2-519 broken brake path. Remediation policy is approved (hybrid: delete 5 proof fixtures, backfill 19 production rows with `pick.governance_brake.corrective_backfill` audit action) but execution is deferred until after UTV2-494 bundle acceptance.

**Rule:** your task cannot mutate stranded rows. No UPDATE, DELETE, INSERT, or backfill on any `picks` row with `status='awaiting_approval'` unless your packet explicitly authorizes it. If your test creates fresh fixtures, that's fine — those are your rows. Do not touch anyone else's.

---

## 5. Merge → deploy discipline

**Policy:** never apply migrations or DDL directly to the live Supabase project before merge. The correct flow is:
1. Author the migration locally
2. Test against a Supabase branch if you need pre-merge verification
3. Open PR + get approval
4. Merge
5. Deploy migration via the normal `pnpm supabase:db push` or equivalent

**Incident:** UTV2-519 executed migrations via the Supabase Management API before PR merge so that `pnpm test:db` could run. Recorded as a policy breach. Not to be repeated. Remediation and tech guard tracked under UTV2-520 Part 1.

**Rule:** if your packet involves migrations and you genuinely cannot run `test:db` without pre-merge apply, stop and escalate. The orchestrator will run the live-DB step from the main worktree post-review, or set up a Supabase branch. Do not solve this problem yourself by reaching into the Management API.

---

## 6. Lifecycle state vs approval/promotion state — separate dimensions

`picks.status` is the **lifecycle FSM state**: `draft → validated → queued → posted → settled` (plus `awaiting_approval` gated by Phase 7A brake; plus `voided` as a sink from most states).

`picks.approval_status` is the **promotion gate**: `pending | approved | rejected | hold`. It is set by the promotion pipeline at submission time. For brake-source picks (`system-pick-scanner`, `alert-agent`, `model-driven`), the promotion pipeline produces `promotion_status='not_eligible'` and sets `approval_status='approved'` as the "no further promotion decision needed" terminal value.

**These are different dimensions and must not be collapsed.** The Phase 7A review lane is triggered by `status='awaiting_approval'` regardless of `approval_status` (see UTV2-521).

**Rule:** when your task touches either column, be explicit about which dimension you're changing and why. Do not reinterpret the other column's value as a substitute signal.

---

## 7. `GOVERNANCE_BRAKE_SOURCES` — canonical set

Defined in `apps/api/src/distribution-service.ts`:

```ts
export const GOVERNANCE_BRAKE_SOURCES: ReadonlySet<PickSource> = new Set<PickSource>([
  'system-pick-scanner',
  'alert-agent',
  'model-driven',
]);
```

**`board-construction` is INTENTIONALLY NOT in this set.** It is operator-triggered, not autonomous. PM correction 2026-04-10.

**Rule:** do not add `board-construction` to the brake set. Do not remove any of the three autonomous sources. Do not create a parallel brake set elsewhere.

---

## 8. Atomic lifecycle transitions — use the RPC path

`transitionPickLifecycle` in `packages/db/src/lifecycle.ts` calls `repo.transitionPickLifecycleAtomic(...)` first (via the UTV2-519 atomic RPC) and falls back to the sequential two-write path only when the repository bundle is InMemory.

**Rule:** when you need to move a pick between lifecycle states, always go through `transitionPickLifecycle`. Never write `picks.status` + `pick_lifecycle` directly from application code — that path is not atomic and has left orphaned rows in production before.

**Optional-method gotcha:** `PickRepository.transitionPickLifecycleAtomic` is currently **optional** on the interface because updating `FakePickRepository` in `apps/worker/src/worker-runtime.test.ts` was out of scope for UTV2-519. Lane tests must either check `typeof repo.transitionPickLifecycleAtomic === 'function'` before invoking directly, or use `.call()` with a non-null assertion after an `assert.ok` check (see `apps/api/src/t1-proof-awaiting-approval.test.ts:248-266` for the working pattern). Tightening this to required is tracked under UTV2-520 Part 2.

---

## 9. Schema invariants — get these right on first touch

- `picks.status` = lifecycle column. **NOT** `lifecycle_state`.
- `pick_lifecycle` = events table. **NOT** `pick_lifecycle_events`.
- `audit_log.entity_id` = FK to the primary entity of the event (lifecycle event id, promotion history id, outbox row id). **NOT** the pick id.
- `audit_log.entity_ref` = pick id as text. Used for "find all audit rows for this pick" queries.
- `audit_log.payload->>'pickId'` = also set for some action types (e.g. `pick.governance_brake.applied`). Match on this when `entity_ref` is null.
- `submission_events.event_name`. **NOT** `event_type`.
- `settlement_records.corrects_id` = self-referencing FK for corrections. Original row is **never mutated**.
- `picks.source` = typed union from `pickSources` in `packages/contracts/src/submission.ts`.
- `provider_offers.is_opening` — required for CLV and scanner operation.

If your task reads or writes any of these, double-check the column names before authoring SQL or types.

---

## 10. Idempotency collisions in proof scripts

`computeSubmissionIdempotencyKey` in `apps/api/src/submission-service.ts:65` hashes:

```
source | market | selection | line | odds | eventName
```

**The trap:** a proof script with a static payload shape will collide with its own prior fixtures on the second run, return the existing pick (in whatever state it ended up in), and the controller will try a transition based on stale caller state. This produces spurious `INVALID_LIFECYCLE_TRANSITION` errors or HTTP 400s that look like regressions but are test-hygiene bugs.

**Rule:** any proof script or `test:db` case that submits picks against live DB must include a per-run unique marker in at least one of those six fields. Cleanest approach: inject `randomUUID()` into `selection`. See UTV2-522 for the canonical fix pattern, and `apps/api/src/scripts/utv2-494-phase7a-proof-a-brake.ts` for the working example.

---

## 11. Dangling commit trap (worktrees + origin divergence)

`git worktree add` creates a new worktree from the specified branch, which is typically `origin/main` or the current tracked branch. **If a prior lane committed a file to your local main without pushing, new worktrees will NOT see that file** — they branch from origin.

**Incident:** UTV2-522 Lane A lane stopped because the Lane A proof script existed only on a local-only commit (`d6ab6a3`). The worktree branched from origin/main and the file wasn't there. Fixed by bringing the script to origin via the UTV2-522 PR.

**Rule:** before dispatching a worktree lane that references an existing file, verify the file is on `origin/main`:
```bash
git ls-tree -r origin/main --name-only | grep <path>
```
If the file is only on local main, either push it first (via a proper PR) or transport it explicitly via the task packet.

---

## 12. `pnpm --filter @unit-talk/api test` has known pre-existing failures

42 tests fail under `pnpm --filter @unit-talk/api test` due to missing `UNIT_TALK_ACTIVE_WORKSPACE` env var. These are reproducible on baseline (`git stash -u && pnpm --filter @unit-talk/api test`). They are NOT caused by your changes.

**Rule:** when verifying your work, prefer `pnpm test` (root aggregate — resolves env correctly) or `UNIT_TALK_APP_ENV=local pnpm --filter @unit-talk/api test`. Do NOT try to fix these failures as part of your task — they are tracked separately. Do NOT mask them in reports — flag them as "pre-existing, reproduced on baseline, unrelated to this PR".

---

## 13. Test runner is `node:test` + `tsx --test`

Not Jest. Not Vitest. Not `describe/it/expect` from Jest.

- `import { test } from 'node:test'`
- `import assert from 'node:assert/strict'`
- `assert.equal`, `assert.deepEqual`, `assert.ok`, `assert.throws`, `assert.rejects`
- Run single file: `npx tsx --test apps/api/src/some-file.test.ts`
- Run via filter: `pnpm --filter @unit-talk/<pkg> test`

Do not introduce Jest or Vitest. Do not use `beforeEach`/`afterEach` from Jest (use `node:test` hooks via the context object).

---

## 14. SGO market key formats

Live SGO keys use underscore_camelCase for MLB/NHL/NFL (`batting_homeRuns-all-game-ou`, `shots_onGoal-all-game-ou`, `passing_yards-all-game-ou`), `+` separator for combo stats (`points+rebounds+assists-all-game-ou`), camelCase for NBA specials (`threePointersMade-all-game-ou`).

`SGO_MARKET_KEY_TO_CANONICAL_ID` map in `results-resolver.ts` uses these exact formats.

**Rule:** do not use old hyphen-only formats. Do not invent new key shapes. Before adding a new market key, grep the resolver map for the canonical form.

---

## 15. Pre-existing debt to NOT fix while checking

These are known, tracked, and out of scope for incidental repair:

- 42 `@unit-talk/api` filter-test failures (see #12)
- 3 failures in `apps/api/src/promotion-edge-integration.test.ts` (documented in `apps/api/CLAUDE.md`)
- `alert-agent` cross-app imports from `apps/api/src/` (documented drift)
- 24+ stranded `awaiting_approval` rows (see #4)
- `transitionPickLifecycleAtomic?` optional on interface (see #8; tracked under UTV2-520 Part 2)
- Worker DOWN status during proof work (worker is not in the brake path; scanner quiesced covers the risk)

**Rule:** your task does not fix these. Your task does not mention these as blockers unless your specific slice directly depends on one of them. If you encounter something that looks like a new failure, check baseline first (`git stash -u && <verification command>`). If it reproduces on baseline, it's pre-existing — flag it and move on.

---

## 16. Stop conditions — when to report truth

Per CLAUDE.md execution model: stop and report, do not "fix while checking", when any of the following occur:

- Scope is ambiguous or overlaps with active work
- Your task requires a missing contract or file
- Baseline is failing in a new way (not on the known-drift list above)
- You discover a schema gap, a runtime bug, or an unreachable code branch
- You need to touch a file outside your allowed list to complete the task
- Verification fails after your changes and the cause is not obvious

A bounded stop with precise evidence is strictly better than a wider blast radius. The orchestrator reshapes the issue or opens a corrective; you do not.

---

## 17. This brief is append-only

When a new drift class is found, add a numbered section. Do not delete sections without PM approval — they exist because an incident happened. If a gotcha is fully remediated (e.g. the constraint is now enforced at CI time), mark it `[REMEDIATED: <date> via <issue>]` and keep the section as historical context.
