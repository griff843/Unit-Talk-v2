# PROOF: WORK-2026102906

MERGE_SHA: pending merge

Issue: WORK-2026102906
Tier: T1
Lane type: governance
result: local_static_pass_staging_deferred

## ASSERTIONS:

- [x] `codex-model-routing.json` is at policy 3.0.0. Every profile keeps its reasoning effort, permitted tiers and enabled flag. Only the model ids (`gpt-5.6-luna` → `gpt-6-luna`, `gpt-5.6-sol` → `gpt-6.1-sol`), the effort-catalog keys and `verified_against` change. `codex-astra-medium` and `codex-sol-max` stay disabled. The shipped policy loads and validates (`the real canonical policy file loads and validates`).
- [x] `reResolveModelRouting` moves a lane pinned to an older policy onto the current one under the same profile. The result passes `validatePersistedModelRouting`, which refused the same block with `POLICY_VERSION_MISMATCH` beforehand (`re-resolve moves a stranded lane to the current policy, same profile, and codex-exec then accepts it`).
- [x] It keeps `selected_by` and an audit override, and appends to earlier `re_resolutions` (`re-resolve appends to earlier re-resolutions and keeps an audit override`).
- [x] It never substitutes a profile. It refuses a profile the new policy removed (`PROFILE_UNKNOWN`), disabled (`PROFILE_DISABLED`) or gates behind PM authorization (`TRUSTED_AUTHORIZATION_UNAVAILABLE`), and one not permitted for the lane's tier (`PROFILE_NOT_PERMITTED_FOR_TIER`) (`adversarial: re-resolve never substitutes a profile ...`).
- [x] It refuses a reconciled lane and a lane already on the current policy (`re-resolve refuses a reconciled lane and a lane already on the current policy`).
- [x] `lane-manifest re-resolve-routing <ID>` writes the re-resolved block and the prior pin into the manifest, against the real shipped policy (`re-resolve-routing moves the lane to the current policy, keeps its profile and records the prior pin`).
- [x] It refuses a done lane, a non-Codex lane and a missing id, and a refused run leaves the manifest unchanged (`re-resolve-routing refuses a done lane, a non-Codex lane and a missing id, and writes nothing`).
- [x] codex-exec's `POLICY_VERSION_MISMATCH`, `MODEL_MISMATCH`, `REASONING_EFFORT_INVALID` and `RECONCILED_OBSERVATION` checks are unchanged. The mismatch message now names the runnable command.
- [x] Unchanged: the proof sidecar contract, `reconcile-routing`, merge authority and lane admission.

## EVIDENCE:

Why. Open lane manifests pinned to an older routing policy, read from each PR branch's `docs/06_status/lanes/<id>.json` on 2026-10-29 (`git show origin/<branch>:docs/06_status/lanes/<id>.json | jq .model_routing`):

```text
#1800 WORK-2026102806 started     codex-luna-medium gpt-5.6-luna 2.0.0
#1776 WORK-2026102205 started     codex-sol-high    gpt-5.6-sol  2.0.0
#1772 WORK-2026102202 started     codex-sol-medium  gpt-5.6-sol  2.0.0
#1739 UTV2-1977       in_review   codex-sol-medium  gpt-5.6-sol  2.0.0
#1775 UTV2-1980       parked      codex-sol-high    gpt-5.6-sol  2.0.0
#1556 WORK-2026091001 in_review   codex-sol-high    gpt-5.6-sol  1.0.0
#1451 UTV2-1736       parked      codex-sol-high    gpt-5.6-sol  1.0.0
```

Each of these profiles exists in 3.0.0 with the same permitted tiers. Without this lane, codex-exec refuses each lane on its next spawn with `POLICY_VERSION_MISMATCH`, and it already refuses the two 1.0.0 lanes on main.

The model ids were verified against the installed Codex 0.162.1 model catalog plus a live acceptance smoke test of each slug, as recorded in the policy's `verified_against.verification_method`.

Mutation checks were run on `2f2d42af7a3b7b9c0248a2be071c1881ff178e23`. Each mutation was applied alone to `scripts/ops/model-routing.ts`, then `model-routing.test.ts` and `lane-manifest.test.ts` were rerun and the file was restored. The only later change to that file is the wording of the mismatch message.

```text
M1 re-resolve ignores the lane's tier (always 'T2')          -> fail=1
M2 "already on the current policy" refusal removed            -> fail=2
M3 re-resolved block keeps the old model                      -> fail=3
M4 reconciled-lane refusal removed                            -> fail=1
M5 prior pin recorded wrongly (from_policy_version)           -> fail=2
```

Real CLI smoke test on `8663a9a7d`:

```text
$ pnpm -s ops:lane-manifest re-resolve-routing
re-resolve-routing is missing <issue id>. Usage: re-resolve-routing <ID> [--json]      (exit 1)
$ pnpm -s ops:lane-manifest re-resolve-routing WORK-2026102906 --json
{"ok": false, "code": "manifest_error", "message": "re-resolve-routing refused: WORK-2026102906 executor is \"claude\"; model_routing is Codex-only"}   (exit 1)
```

`git status --short` was empty after both runs.

Pre-existing and out of scope: `pnpm ops:lane-manifest -- <subcommand>` prints usage for every subcommand, because pnpm passes the `--` through. The new message and the work order use the form without `--`.

## Verification

Run on `8663a9a7db77a4d5361ffa4dce7f2a6590c8e4c6`:

- [x] `pnpm exec tsx --test scripts/ops/model-routing.test.ts`: `# tests 41`, `# pass 41`, `# fail 0`, `# skipped 0`.
- [x] `pnpm exec tsx --test scripts/ops/lane-manifest.test.ts`: `# tests 42`, `# pass 42`, `# fail 0`, `# skipped 0`.
- [x] `pnpm exec tsx --test scripts/ops/codex-exec.test.ts`: `# tests 46`, `# pass 46`, `# fail 0`, `# skipped 0`.
- [x] `pnpm type-check`: exit 0.
- [x] `pnpm test`: exit 0. Summed node:test totals across all files: `# tests 7703`, `# pass 7690`, `# fail 0`, `# skipped 13`.
- [x] `pnpm exec eslint` on the five changed `.ts` files: exit 0. Repo-wide `pnpm lint` runs in CI.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: `Verdict: PASS`, no R-level artifacts required. (Run on `2f2d42af7`; the later commit changes one message string and the work order.)
- [x] `pnpm ops:preflight WORK-2026102906 --tier T1 --branch claude/work-2026102906-codex-catalog-v3 --refresh`: `VERDICT: PASS (42 checks)`. PT1 was BLOCKED_BY_CONTAINMENT; that outcome is admitted under the ratified route B in `docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md`.
- [ ] `pnpm verify` in CI on the PR head: pending. CI `verify` is the verification of record.
- [ ] `pnpm test:db`: deferred to the protected `staging-ci` environment inside the required `verify` check. This lane accessed no database.

Runtime: this lane changes operator tooling and a policy file; it has no service runtime surface. No open lane manifest was re-resolved by this lane. Running `re-resolve-routing` on an in-flight Codex lane is a separate operator action, taken in that lane's own worktree after this merges.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 8663a9a7db77a4d5361ffa4dce7f2a6590c8e4c6
