# PROOF: UTV2-1533
MERGE_SHA: c9ddd22d7a22342c2a65cd17f5e2012536dfb4c0

ASSERTIONS:
- [x] Base concurrency ceiling raised to 10 active lanes (4 Claude + 6 Codex) in docs/governance/CONCURRENCY_CONFIG.json, with audited safety rationale (no external mechanical constraint on the prior 6-lane cap; merge-train serialization and the WSL2 full-verify semaphore, the two real constraints, are untouched)
- [x] Hygiene<=4 / Governance<=3 / Delivery-UI<=1-per-app / Verification<=1-per-target caps mechanically enforced in checkConcurrencyLimits() (scripts/ops/lane-start.ts), not left as prose
- [x] Delivery/UI app identity derived deterministically from file_scope_lock (deriveDeliveryUiApp(), scripts/ops/shared.ts) -- no free-text inference
- [x] Verification target identity backed by a new schema-validated verification_target manifest field, schema_version-2-gated, mirroring the existing model_routing/UTV2-1526 enforcement pattern
- [x] verification_target is resume-safe: ops:lane:resume backfills it from the existing manifest and excludes the incoming issue's own active manifest from the conflict-search set
- [x] A malformed --verification-target is validated before createBranchAndWorktree/reserveLease run, preventing orphaned branch/worktree/lease state
- [x] T1 evidence.json bundle exists at docs/06_status/proof/UTV2-1533/evidence.json, satisfying the T1 Proof Gate's C6 expected_proof_paths check
- [x] 128/128 targeted tests pass across concurrency-simulation.test.ts, shared.test.ts, lane-start.test.ts, lane-maximizer.test.ts
- [x] pnpm verify passes clean end to end (multiple independent runs)
- [x] R-level check reports no triggered R1-R5 rules for this diff (governance config/docs + ops-tooling only, no DB/runtime code)
- [x] 8 of 9 review threads across PR #1213 (4, all resolved) and PR #1215 (5, 4 resolved) replied to with file:line evidence and resolved; 1 (lane-maximizer's advisory verification-target guess) deliberately left unresolved and deferred to the pre-existing UTV2-1535 follow-up, not a mechanical safety gap
- [ ] Round 8: Branch Discipline Guard -- fixed everything within unilateral authority (this continuation's own stray commit-message references) via a message-only history rewrite (accepted_pr_head_sha and everything before it untouched); still RED because the two origin/main merges pulled in individual commits from other already-shipped lanes as ancestors, and one pre-existing accepted-history commit (343735ba) independently references UTV2-1526 -- none of these are removable without a rebase that would change accepted_pr_head_sha's own SHA, which the continuation directive explicitly forbids. Full breakdown in evidence.json round_8_fix. PM-arbitrable, not self-resolved.

EVIDENCE:
```text
$ npx tsx --test scripts/ops/concurrency-simulation.test.ts scripts/ops/shared.test.ts scripts/ops/lane-start.test.ts scripts/ops/lane-maximizer.test.ts scripts/codex-dispatch.test.ts
...
# tests 128
# suites 0
# pass 128
# fail 0
# cancelled 0
# skipped 0
# todo 0

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 17
Rules matched: (none) — no R-level artifacts required for this diff

$ pnpm type-check
(exit 0, no output)

$ pnpm exec tsx scripts/ops/execution-state.ts --json | jq .dispatch_slots
{
  "claude": { "used": 1, "max": 4, "available": 3 },
  "codex": { "used": 0, "max": 6, "available": 6 }
}
```

---

# Verification — UTV2-1533

## Summary

Raises the ratified base concurrency ceiling from 6 (2 Claude + 4 Codex) to 10 (4 Claude + 6 Codex) active lanes, and mechanically enforces the per-type distribution caps (Hygiene<=4, Governance<=3, Delivery/UI<=1-per-app, Verification<=1-per-target) that were previously prose-only. Round 4 recorded the branch continuation from PR #1213 (`griffadavi/utv2-1533-post-lock-concurrency-ramp`) to this canonical `claude/utv2-1533-post-lock-concurrency-ramp` branch — required because `griffadavi/...` can never satisfy `Executor Result Validation`'s ratified `claude/`- or `codex/`-prefixed branch contract. Rounds 5–7 (this document) fix 4 real bugs surfaced by three independent Codex review passes on the replacement PR (#1215) itself, and defer 1 advisory-quality finding to the pre-existing UTV2-1535 follow-up (not a mechanical safety gap). The core implementation is unchanged from the accepted PR #1213 head (`24696311888e8c24beb530d557efe3e95ee4aa52`) except for these real bug fixes found by review, not a redesign.

**Status: PR not merged.** No merge SHA is invented anywhere in this bundle. The `MERGE_SHA:` field above (required by `executor-result-validator.yml`'s proof-file contract) references the last substantive implementation commit (`c9ddd22d`), which is an ancestor of this PR's head — the validator explicitly supports this pattern ("allows proof files to reference the implementation commit SHA rather than their own commit SHA, avoiding the SHA preimage circular dependency"). `evidence.json`'s `sha_binding.merge_sha` remains `null`.

## Evidence

Full command outputs, config-change table, safety rationale, and acceptance-criteria mapping: `docs/06_status/proof/UTV2-1533/evidence.json`. Diff breakdown by round: `docs/06_status/proof/UTV2-1533/diff-summary.md`.

## Verification

### R-level check

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 17
Rules matched: (none) — no R-level artifacts required for this diff
```

No R1–R5 rule paths matched the changed files (governance config/docs, `docs/05_operations/` manifest schema/spec, and `scripts/ops/*.ts` orchestration tooling + tests). No mandatory artifacts triggered.

### Targeted tests

```
$ npx tsx --test scripts/ops/concurrency-simulation.test.ts scripts/ops/shared.test.ts scripts/ops/lane-start.test.ts scripts/ops/lane-maximizer.test.ts scripts/codex-dispatch.test.ts
...
# tests 128
# suites 0
# pass 128
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Breakdown:
- `concurrency-simulation.test.ts`: 39/39 (23 pre-existing + 14 PM-requested distribution-cap tests against a `PROD_POLICY` fixture matching the real shipped 10/4/6 + `type_caps` numbers + 2 round-5 tests for the Delivery/UI undetermined-active-lane fail-closed fix).
- `shared.test.ts`: 37/37 (26 pre-existing + 9 verification_target/deriveDeliveryUiApp tests + 2 round-6 tests for the UTV2-only verification_target pattern).
- `lane-start.test.ts`: 10/10 (7 pre-existing, unaffected by the `checkConcurrencyLimits()` signature extension, + 2 round-3 regression tests for the resume-backfill and early-validation fixes + 1 round-5/6 test for the verification-target normalization fix, updated in round 6 to assert the stricter `requireVerificationTarget()` helper).
- `lane-maximizer.test.ts`: 28/28 (2 pre-existing fixtures updated for the corrected advisory `--verification-target` suggestion).
- `codex-dispatch.test.ts`: 14/14 (13 pre-existing + 1 round-7 regression test for the `--verification-target` threading fix into `pnpm codex:dispatch`'s real execution path).

Re-confirmed clean on PR #1215's final head before this packet was assembled.

### Runtime confirmation (execution-state)

```
$ pnpm exec tsx scripts/ops/execution-state.ts --json
...
"dispatch_slots": {
  "claude": { "used": 1, "max": 4, "available": 3 },
  "codex":  { "used": 0, "max": 6, "available": 6 }
}
```

Confirms `getEffectiveConfig()` picks up the new base limits. Also covered by dedicated test 14, which imports `execution-state.ts`'s `MAX_CLAUDE_LANES`/`MAX_CODEX_LANES` directly and asserts `4`/`6`.

### Type-cap enforcement — isolated proof

Two of the 14 new tests assert an **exact** violation-code array (`assert.deepStrictEqual`, not just `.includes`), to prove genuine isolation rather than coincidental pass via some other cap: "fifth Hygiene lane rejected" (4 active hygiene lanes, well under executor caps → adding a 5th produces exactly `['hygiene_type_cap_exceeded']`) and "fourth Governance lane rejected" (analogous). Test 13 is the adversarial trial-isolation proof: a trial-active config with 14-lane/9-codex headroom still rejects a 5th hygiene lane, proving `type_caps` is not widened by trial mode.

### pnpm test:db / runtime proof

No file in this diff's scope touches DB schema, DB queries, or Supabase-connected code — governance config/docs and TypeScript ops-orchestration tooling (lane-lifecycle scripts and their unit tests, in-memory manifest fixtures) only. The R-level check independently confirms no rule requiring `pnpm test:db` was triggered by these file paths. `pnpm test:db` was not separately invoked by the executor locally for that reason. Separately: **the T1 Proof Gate itself runs in CI on every push and did execute against this diff** (see CI check "T1 Proof Gate" on this PR) — that CI-run gate is the applicable T1 runtime verification step for this diff's scope, and its execution is not being denied or hidden here.

### Full verify

```
$ pnpm verify
```

Ran clean end to end at least three times across this issue's rounds (round 2 commit `343735ba`/`e8835a4a`, round 3 commit `c9ddd22d`, and again in this continuation worktree before opening the replacement PR) — zero `not ok` lines, zero `ELIFECYCLE` failures each time. One isolated live-DB flake hit once early on (`apps/api/src/t1-proof-utv2-1116-artifact-sha-immutability.test.ts`, an unrelated `model_registry` unique-constraint race; no file in this diff touches that code path) — re-ran standalone clean, never reproduced since.

## Commit SHA reference

Branch HEAD (replacement PR head) at final packet assembly: `5a48c51d57c34e6d2db28a8088578921044bd09d` — round 8's message-only history rewrite (`git filter-branch --msg-filter`, non-interactive, restricted to the range `accepted_pr_head_sha..HEAD`) applied on top of round 7's fix commit `f9a06c98`, round 5's fix commit `ba5d67c9`, two merges with `origin/main` (unrelated concurrent lanes landing during this continuation), the manifest-repair commit `c32e3a95`, and the accepted implementation at `24696311888e8c24beb530d557efe3e95ee4aa52` / substantive code at `c9ddd22d7a22342c2a65cd17f5e2012536dfb4c0`. Round 8 touched only commit messages (removing stray UTV2-1396/1484/1535 references to satisfy Branch Discipline Guard) — every commit tree/diff in the range is byte-identical before and after, and `accepted_pr_head_sha` remains an exact, unmodified ancestor.

## Merge SHA reference

Not applicable yet — **the replacement PR is not merged.** No merge SHA is invented here (`evidence.json`'s `sha_binding.merge_sha` stays `null`). Will be populated post-merge via `ops:proof-generate --merge-sha` (automated, `post-merge-lane-close.yml`), per this repo's standard closeout automation. The `MERGE_SHA:` field at the top of this document is a separate, intentional exception documented above — it satisfies `executor-result-validator.yml`'s proof-file contract by referencing the last substantive implementation commit, not a real merge.
