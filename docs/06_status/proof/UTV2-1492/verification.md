## Summary

Verification for UTV2-1492 confirms the preflight/lane-start fix is type-safe, covered by regression tests, and passes the full `pnpm verify` battery (including live-DB suites) with zero failures. Not a Codex re-attempt — this replaces the rejected PR #1175, which only made the `pnpm test:db` requirement conditional on tier without removing the underlying PX3/PX4/PX5 contradiction for T1.

## Evidence

Branch: `claude/utv2-1492-preflight-proof-lifecycle`
Pre-commit SHA binding: `121cdd8f775e0593af2e8f3dc6f5628efdcaec1d`

## Verification

### Scoped tests (run before full verify)

```
npx tsx --test scripts/ops/preflight.test.ts
# tests 7
# pass 7
# fail 0

npx tsx --test scripts/ops/lane-start.test.ts
# tests 3
# pass 3
# fail 0
```

### pnpm type-check

PASS — no output (tsc -b clean build).

### pnpm lint

PASS — no output (eslint clean, cache hit).

### pnpm verify (full pipeline)

PASS — zero failures across the entire run: `env:check`, `lint`, `pnpm type-check`, `build`, `pnpm test` (full node:test aggregate across the repo), `pnpm test:db`, `pnpm test:live-db`, `pnpm test:t1-proof:live`.

Representative live-DB suite results (this is a T2 tooling-only change — no runtime code touched — but `pnpm verify` runs the full battery unconditionally, and it is included here as evidence the change introduces no regression anywhere in the pipeline):

```
# UTV2-1136 settlement immutability suite: 4/4 pass
# T1 Proof settlement-correction suite: 4/4 pass
# UTV2-1282/1459 lookback-window suite: 3 pass, 1 skip (documented pre-existing
#   skip — provider_offer_history is currently stale/older than the 72h
#   lookback window; this is a data-freshness condition unrelated to this
#   change, not a regression it introduced)
# UTV2-1327 domainAnalysis enrichment suite: 6/6 pass
```

Zero `not ok` lines anywhere in the full verify output (`grep -c "^not ok"` = 0).

**No `pnpm test:db` proof is fabricated or claimed as this lane's own runtime evidence** — this is a T2, tooling-only change (`scripts/ops/preflight.ts`, `scripts/ops/lane-start.ts`) with no runtime/product code path of its own to exercise. The test:db/live-db results above are incidental output of `pnpm verify`'s unconditional full battery, included as regression evidence, not as this issue's required proof artifact.

## R-level compliance

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD --json
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

## Review packet — T1 lifecycle model

This is the corrected lane lifecycle, replacing the broken one that made pre-implementation planning impossible for T1:

```
Planning
  -> Outcome Contract (Issue/Objective/Success criteria/etc — Linear comment,
     zero repo artifacts required)
  -> PM Approval (Griff reviews in Linear/chat — human gate, not tooling gate)
  -> Lane Start (ops:lane-start)
       - creates manifest + worktree + lease
       - validates a T1 manifest declares at least one expected_proof_path
         (this is the corrected home for what used to be preflight's PX5 —
         checked here because a manifest actually exists at this point;
         preflight runs BEFORE any manifest exists, so it structurally
         cannot check manifest content)
       - scaffolds the empty docs/06_status/proof/<issue>/ directory inside
         the worktree (a .gitkeep placeholder, committed alongside the
         manifest/sync files) — no operator/executor ever needs to
         hand-create this directory before preflight again
  -> Implementation (code + tests + real evidence generated in-worktree)
  -> Evidence Generation (executor populates docs/06_status/proof/<issue>/
     with real content: diff-summary.md, verification.md, etc.)
  -> PR opens
  -> Verification (proof-gate.yml, CI on pull_request — validates the NOW-REAL
     proof content via proof-auditor-gate.ts / runtime-verifier-gate.ts.
     This is exactly where PX3/PX4's intent already correctly lived; nothing
     changed here — it's simply no longer duplicated at pre-lane-start time)
  -> Truth Check (ops:lane-close -> runTruthCheck in truth-check-lib.ts,
     gated behind manifest.status ∈ {merged, done} via the M4 check —
     unchanged, still the system's real proof/runtime-evidence authority)
  -> Merge (merge-gate.yml — unchanged)
```

**What changed, precisely:**
- `scripts/ops/preflight.ts`: `PX3` (proof-auditor-gate), `PX4` (runtime-verifier-gate), and `PX5` (T1 proof-dir existence) removed from `runGateEquivalentChecks`. Preflight no longer shells out to either gate script. `PX1` (verify:quick) and `PX2` (branch discipline) are unchanged — preflight's remaining job is exactly what it should be: environment/git/deps/Linear-state/docs eligibility, never proof content.
- `scripts/ops/lane-start.ts`: after manifest creation, (a) a new guard fails lane-start if a T1 manifest has zero `expected_proof_paths` (defense-in-depth; `defaultProofPaths()` already always returns a non-empty array for T1, so this only fires if some future/direct manifest-creation path bypasses that default), and (b) the empty proof directory is scaffolded inside the worktree and committed alongside the manifest/sync mirror.

**What did NOT change (per explicit AC and PM guardrails):** `proof-gate.yml`, `truth-check-lib.ts`, `lane-close.ts`, `merge-gate.yml`. All real proof/runtime-evidence enforcement remains exactly where it already correctly lived. This fix removes a duplicated, mis-timed copy of that enforcement — it does not weaken the original.

**Constitutional invariant this restores:** *Planning must never require implementation evidence.* A fresh T1 lane can now reach a passing preflight token and a started lane with zero pre-existing repo state beyond a valid Linear issue — verified directly: `pnpm ops:preflight UTV2-1492 --tier T2 ...` and the equivalent T1 path both reach PASS/lane-started without any proof directory existing beforehand.
