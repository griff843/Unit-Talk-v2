# PROOF: UTV2-1462 Verification

Issue: UTV2-1462
Tier: T2
Branch: claude/utv2-1462-ci-bookkeeping-path-filter
MERGE_SHA: e75608f46957a6c4974de2fb0c482472f8e511be

The SHA above is the implementation commit; post-merge closeout rebinds proof to the squash-merge SHA via `ops:proof-generate --merge-sha`.

## ASSERTIONS:

- [x] Push-triggered `verify` on main skips when a push touches ONLY `docs/06_status/lanes/**`, `docs/06_status/proof/**`, or `.ops/sync/**` (`paths-ignore` on the `push` trigger)
- [x] Fail-closed by construction: a push touching ANY path outside the ignore list still triggers the full verify chain — GitHub `paths-ignore` skips only when every changed file matches
- [x] PR-triggered runs unchanged: the filter is scoped to the `push` event; the required `verify` PR context and its concurrency group are untouched
- [x] Workflow YAML parses clean; workflow-hardening guard suite green
- [x] `pnpm type-check` passes; r-level-check matches no rules (workflow-only diff)

## Verification

Executed 2026-07-04 from the lane worktree; raw output in EVIDENCE below.

- workflow YAML parse + trigger-shape assertion — PASS
- `pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts` — PASS (0 failures)
- `pnpm type-check` — PASS
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS (no rules matched)
- `pnpm test:db` — PASS (7/7 against live Supabase; not functionally required for a workflow-only diff, executed to satisfy the Proof Auditor Gate's unconditional `--require-executed-command "pnpm test:db"` check)
- `pnpm verify` (branch CI) — the required `verify` context runs on this PR itself, demonstrating PR-trigger behavior is unaffected

## EVIDENCE:

```text
node -e "YAML.parse(ci.yml)" →
yaml ok; push filter: ["docs/06_status/lanes/**","docs/06_status/proof/**",".ops/sync/**"]

pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts
# fail 0
# skipped 0

pnpm type-check → PASS (tsc -b tsconfig.json, zero errors)
npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
→ Verdict: PASS; Changed files: 2; no R1-R5 rules matched

pnpm test:db (live Supabase, project zfzdnfwdarxucxtaojxm)
# tests 7
# pass 7
# fail 0
# skipped 0
```

## Post-merge runtime acceptance

The behavioral acceptance criteria are only observable after merge, on the next closeout cycle:
1. A bookkeeping-only `chore(lanes)` push to main produces NO new push-triggered CI run for the `CI` workflow.
2. The next mixed/source push to main produces a full verify run.
Both observations are to be appended to this proof at closeout (run URLs), completing the acceptance evidence.
