# PROOF: UTV2-1475 Verification

Issue: UTV2-1475
Tier: T2
Branch: claude/utv2-1475-fix-l3-linear-state-check
Head SHA: d29ba27c58a54fd9ebd1cec0e168b547750aca1d

## ASSERTIONS:

- [x] L3 no longer references a nonexistent Linear state as a required precondition
- [x] L3 accepts the actual workspace PM-review state name `In PM Review`
- [x] L3 still accepts `Done`
- [x] L3 fails closed on backlog, blocked, cancelled, abandoned, and unrelated workflow states
- [x] Regression test proves `In PM Review` passes the L3 precondition
- [x] Regression test proves unrelated states still fail closed
- [x] No synthetic truth-check pass evidence was created
- [x] No manual Linear Done transition was used to bypass L3

## Verification

- `pnpm exec tsx --test scripts/ops/truth-check-lib.test.ts` — PASS (49/49, including 5 new L3 regression tests)
- `pnpm test:ops` — PASS (745/745)
- `pnpm type-check` — PASS (`tsc -b tsconfig.json`, zero errors)
- `pnpm test:db` — PASS (7/7 against live Supabase; not functionally required for a workflow-only diff, executed to satisfy the Proof Auditor Gate's unconditional `--require-executed-command "pnpm test:db"` check)

## EVIDENCE:

```text
pnpm exec tsx --test scripts/ops/truth-check-lib.test.ts
ok 45 - L3: accepts the actual workspace PM-review state "In PM Review"
ok 46 - L3: accepts "Done"
ok 47 - L3: rejects the stale "In Review" state that does not exist in this workspace
ok 48 - L3: rejects unrelated workflow states (backlog, blocked, cancelled, abandoned)
ok 49 - L3: rejects empty/unknown state
1..49
# tests 49
# pass 49
# fail 0
# skipped 0

pnpm test:ops
1..733
# tests 745
# pass 745
# fail 0
# skipped 0

pnpm type-check
> pnpm exec tsc -b tsconfig.json
(zero errors, exit 0)

pnpm test:db (live Supabase, project zfzdnfwdarxucxtaojxm)
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# pass 7
# fail 0
# skipped 0
```

## Post-merge follow-up (per lane instructions, not part of this PR's scope)

After this fix merges to main:

1. `pnpm ops:lane-close UTV2-1365 --repair-merged`
2. `pnpm ops:orchestration-reconcile`
3. `pnpm ops:lane-maximizer --from-linear`
4. Resume loop-dispatch only if Phase 0 gates are clean.
