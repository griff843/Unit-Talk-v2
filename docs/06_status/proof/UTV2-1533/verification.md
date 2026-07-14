# Verification — UTV2-1533

**Issue:** UTV2-1533 — Post-lock concurrency ramp: raise ceiling to 10 active lanes (4 Claude + 6 Codex)
**Tier:** T1 (governance-critical config/enforcement-code change; no runtime/DB/pick-pipeline code touched)
**Round:** 2 (PM review CHANGES REQUIRED response — P1 evidence bundle + P2 mechanical type-cap enforcement)
**Status:** PR #1213 **not merged**. This document reflects the commit SHA below, not a completed lane.

## Verification

## R-level check

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 16
Rules matched: (none) — no R-level artifacts required for this diff
```

No R1–R5 rule paths matched the changed files (governance config/docs, `docs/05_operations/` manifest schema/spec, and `scripts/ops/*.ts` orchestration tooling + tests). No mandatory artifacts triggered.

## Targeted tests

```
$ npx tsx --test scripts/ops/concurrency-simulation.test.ts scripts/ops/shared.test.ts scripts/ops/lane-start.test.ts scripts/ops/lane-maximizer.test.ts
...
# tests 107
# suites 0
# pass 107
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Breakdown:
- `concurrency-simulation.test.ts`: 37/37 (23 pre-existing + 14 new PM-requested distribution-cap tests against a new `PROD_POLICY` fixture matching the real shipped 10/4/6 + `type_caps` numbers). One pre-existing test's fixture ("trial mode: 7th lane allowed when trial active") was rebalanced — it had 4 active hygiene lanes before adding a 5th, valid before hygiene had its own cap, invalid after; rebalanced to preserve the original test's intent (prove total/executor headroom under trial) without violating the new hygiene cap.
- `shared.test.ts`: 35/35 (26 pre-existing + 9 new: `verification_target` enforcement in `createManifest`/`validateManifest` mirroring the existing `model_routing` test pattern exactly — required/legacy-compatible/deletion-attack/forbidden-on-wrong-type/malformed — plus 4 `deriveDeliveryUiApp` tests: single-app, empty-scope, multi-app, out-of-root-path).
- `lane-start.test.ts`: 7/7, unaffected by the `checkConcurrencyLimits()` signature extension (new 5th param is optional, defaults preserve old behavior).
- `lane-maximizer.test.ts`: 28/28 — 2 pre-existing fixtures asserting the exact advisory `dispatch_command` string updated to include the new `--verification-target` suggestion.

## Runtime confirmation (execution-state)

```
$ pnpm exec tsx scripts/ops/execution-state.ts --json
...
"dispatch_slots": {
  "claude": { "used": 1, "max": 4, "available": 3 },
  "codex":  { "used": 0, "max": 6, "available": 6 }
}
```

Confirms `getEffectiveConfig()` picks up the new base limits from the working-tree config. Also covered by dedicated test 14 (`concurrency-simulation.test.ts`), which imports `execution-state.ts`'s `MAX_CLAUDE_LANES`/`MAX_CODEX_LANES` directly and asserts `4`/`6`.

## Type-cap enforcement — isolated proof

Two of the 14 new tests assert an **exact** violation-code array (`assert.deepStrictEqual`, not just `.includes`), to prove genuine isolation rather than coincidental pass via some other cap:

- Test 4 ("fifth Hygiene lane rejected"): 4 active hygiene lanes (2 claude + 2 codex, well under executor caps) → adding a 5th hygiene lane produces **exactly** `['hygiene_type_cap_exceeded']`, nothing else.
- Test 5 ("fourth Governance lane rejected"): 3 active governance lanes (2 claude + 1 codex) → adding a 4th produces **exactly** `['governance_type_cap_exceeded']`.

Test 13 is the adversarial trial-isolation proof: a trial-active config with 14-lane/9-codex headroom (well above what would trip total/executor caps) still rejects a 5th hygiene lane with `hygiene_type_cap_exceeded`, proving `type_caps` is not widened by trial mode.

## pnpm test:db / runtime proof

**Not applicable to this lane.** Every file in this diff's scope is governance config/docs or TypeScript ops-orchestration tooling (lane-lifecycle scripts and their unit tests, all using in-memory manifest fixtures, no Supabase connection). The R-level check above independently confirms no rule requiring `pnpm test:db` or a runtime evidence bundle was triggered. `pnpm test:db` was **not run** for this lane — this is a factual statement about scope, not a claim of execution, and not a tier-skip (R-level check is file-path-triggered, not tier-label-driven).

## Full verify

```
$ pnpm verify
```

Run against commit `343735ba3ab1751f4a71815f7c9d606eb3574bc4`. **PASS** — full chain (sync-check, system-alignment-check, automation-coverage-check, env:check, lint, type-check, build, `test:apps`/`test:verification`/domain suites/`test:qa-agent`/`test:ut-cli`/`test:ops`/`test:t1-proof:local`, smart-form verify, `verify:commands`, then `verify:static && test:live-db` → `test:db && test:t1-proof:live`) completed with zero `not ok` lines and zero `ELIFECYCLE` failures across the full captured log. Ran concurrently with 3 other active lanes' own `pnpm verify` runs (UTV2-1499, UTV2-1427, UTV2-1264) contending for the shared full-verify semaphore (§10a) — slower than solo, still clean. Full detail: `docs/06_status/proof/UTV2-1533/evidence.json` (`static_proof.pnpm_verify`).

An earlier `pnpm verify` attempt on this branch (round 1, prior commit) hit one isolated live-DB flake (`apps/api/src/t1-proof-utv2-1116-artifact-sha-immutability.test.ts`, unrelated `model_registry` unique-constraint race, no file in this diff touches that code path) — re-ran standalone clean, then re-ran the full chain clean end to end. Not reproduced in this round's run.

## Commit SHA reference

Branch HEAD commit at time of this verification round: `343735ba3ab1751f4a71815f7c9d606eb3574bc4`.

## Merge SHA reference

Not applicable yet — **PR #1213 is not merged.** No merge SHA is invented here. Will be populated post-merge via `ops:proof-generate --merge-sha` (automated, `post-merge-lane-close.yml`), per this repo's standard closeout automation.
