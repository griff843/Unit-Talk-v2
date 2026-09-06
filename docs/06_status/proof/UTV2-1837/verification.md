# PROOF: UTV2-1837

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Issue: UTV2-1837
Tier: T2
Lane type: governance
Branch: claude/utv2-1837-tracker-independence
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1516
Execution SHA: 4873899a72f0ac6235ef18af5b82db7ff5fcff86
result: static

## ASSERTIONS:

- [x] AC1 — with no tracker credential, preflight reports PE2/PL1-PL5 as `skip`, not `fail`/`infra_error`.
- [x] AC2 — the declared `--tier` is floored by `classifyMechanicalMinimum()`; a tier below the floor is a hard `fail`.
- [x] AC3 — the manifest carries repo-owned identity (`WORK-###`) and a separate, explicitly nullable `tracker_ref`; absent is never read as `null`.
- [x] AC4 — the closeout gate skips tracker-only checks and keeps every check computable from the repo and GitHub alone.
- [x] AC5 — `lane-close` / `lane-finalize` record `tracker_sync` instead of throwing out of closeout; a working tracker still transitions.
- [x] AC6 — a first task-contract capture and candidate discovery both succeed with no tracker API.
- [x] No reserved surface changed: `git diff origin/main --name-only -- .github/` is empty.

## EVIDENCE:

```
$ pnpm type-check
tsc -b tsconfig.json — exit 0, no diagnostics

$ pnpm lint
eslint . --cache — exit 0, no findings

$ pnpm test
5941 tests, 5941 pass, 0 fail — exit 0

$ pnpm verify
reached test:live-db, then:
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
(verify is a && chain, so reaching this stage establishes verify:static exited 0.
 This lane is T2 and requires no live-DB proof; CI's `verify` in staging-ci is authoritative.)

$ pnpm exec tsx --test scripts/ops/{preflight,shared,truth-check-lib,execution-packet,lane-maximizer,lane-close,lane-finalize}.test.ts
preflight 32/32 · shared 93/93 · truth-check-lib 132/132 · execution-packet 103/103
lane-maximizer 94/94 · lane-close 180/180 · lane-finalize 27/27

$ git diff origin/main --name-only -- .github/
(empty)
```

## Summary

Makes the tracker optional across preflight, closeout, delegation and discovery, so an
ordinary task can run end to end with no tracker credential and no tracker issue. Merge
authority is untouched.

## Verification

`pnpm type-check` clean · `pnpm lint` exit 0 · `pnpm test` 5941 tests / 0 failures ·
7 mutation controls, each turning its owning suite red and reverted byte-for-byte.
Details in the sections below.

Source anchor (`sha_binding.verified_source_sha`): `4873899a72f0ac6235ef18af5b82db7ff5fcff86`

## What this lane changes

Ratified 2026-09-05, `docs/mission/intent.md` § "Execution must not depend on the
tracker": an ordinary product task must be able to proceed from discovery through
delegation, verification, PR and closeout **without tracker access and without an issue
ID**. The test is availability, not automation — automatically writing labels and states
is explicitly insufficient.

This lane implements the ops-script half of that rule. It changes **no merge authority**.

## Acceptance criteria and where each is proven

| AC | Statement | Proof |
|---|---|---|
| AC1 | With no tracker credential, `preflight` reports PE2/PL1–PL5 as `skip` rather than `fail`/`infra_error`, so no preflight token is withheld for a tracker reason | `scripts/ops/preflight.test.ts` — 32/32 |
| AC2 | The declared `--tier` is **floored**, never waived: a tier below `classifyMechanicalMinimum()` is a hard `fail` naming the offending paths | `scripts/ops/preflight.test.ts`; mutation M1 |
| AC3 | The manifest carries repo-owned identity (`WORK-###` admitted alongside `UTV2-###`) and a separate, optional, explicitly nullable `tracker_ref`; **absent is never read as `null`** | `scripts/ops/shared.test.ts` — 93/93; mutation M4 |
| AC4 | The closeout gate `skip`s the tracker-only checks and **keeps** every check computable from the repo and GitHub alone | `scripts/ops/truth-check-lib.test.ts` — 132/132; mutations M2, M2b |
| AC5 | `lane-close` / `lane-finalize` record `tracker_sync` instead of throwing out of closeout after the lease is already committed; a working tracker still transitions | `scripts/ops/lane-close.test.ts` — 180/180, `lane-finalize.test.ts` — 27/27; mutation M3 |
| AC6 | A first task-contract capture and candidate discovery both succeed with no tracker API | `scripts/ops/execution-packet.test.ts` — 103/103, `lane-maximizer.test.ts` — 91/91; mutations M5, M6 |

## Commands run

```
pnpm type-check      # clean
pnpm lint            # exit 0
pnpm test            # 5941 tests, 5941 pass, 0 fail
pnpm verify          # green through lint / type-check / build / test / verify:commands
pnpm r-level-check   # see R-level below
```

`pnpm verify` additionally invokes `test:live-db`, which **refuses to run outside the
`staging-ci` GitHub environment** by design:

```
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL ...
```

That is a containment refusal, not a test failure, and it is why CI's `verify` — which
runs in `staging-ci` with `CI_SUPABASE_*` — is the authority for that leg. This lane is
T2 and requires no live-DB proof.

## Mutation controls

Each control removes exactly one guard, runs the owning suite, and is reverted. A control
that does not turn a suite red proves nothing, so only effective controls are listed; two
attempted mutations that failed to discriminate are recorded honestly under "Not covered"
below.

| # | Mutation | Result |
|---|---|---|
| M1 | `preflight`: drop the mechanical-floor comparison so PE2 always skips | preflight 31 pass / **1 fail** |
| M2 | `truth-check-lib`: C1 reports `pass` instead of `skip` with no tracker | truth-check-lib 129 pass / **3 fail** |
| M2b | `truth-check-lib`: C7 skips wholesale, losing the manifest-Done-but-PR-unmerged mode | truth-check-lib 131 pass / **1 fail** |
| M3 | `lane-close`: let a tracker write failure escape the closeout | lane-close 179 pass / **1 fail** |
| M4 | `shared`: `resolveTrackerRef` reads an ABSENT `tracker_ref` as an explicit `null` | shared 92 pass / **1 fail** |
| M5 | `lane-maximizer`: ignore the missing credential when choosing a candidate source | lane-maximizer 90 pass / **1 fail** |
| M6 | `execution-packet`: `captureOrReadTaskContract` ignores the local work order | execution-packet 102 pass / **1 fail** |

### A real defect this lane introduced, caught by CI and repaired

The first CI run of this branch failed `verify` with **16 test failures that pass locally**,
all in `lane-maximizer.test.ts`. The cause was mine: `resolveCandidateSource` took the
tracker-credential argument as a **default parameter that probed `process.env`**, so the
source selection depended on whether the machine running the code held a credential. The CLI
chose `linear` locally and `queue` in CI, and sixteen pre-existing tests that inject a fake
tracker silently stopped exercising it.

This is worth recording rather than quietly fixing, because it is the exact hazard the change
is about: a decision that reads ambient state instead of what the caller declared. The repair
computes the decision **once**, from the deps the caller actually supplied
(`hasTrackerSource(deps)` — injected Linear deps *are* a tracker), and threads it down.
An explicit `--from-linear` now also outranks the probe in both directions: the
credential-based choice is a default, never an override.

`lane-maximizer.test.ts` went 91 → 94 tests, three of them asserting exactly this.

### Not covered — stated rather than implied

- **`truth-check-lib` L1–L4.** The `skip` branch for L1–L4 lives in the network-dependent
  runner path (`runCloseoutTruthCheck`), not in the pure gate the unit suite drives. A
  mutation there does not turn the suite red, and this bundle does not claim it does. The
  covered equivalent is C1/C7 in the pure gate, which is where the closeout verdict is
  actually computed.
- **`resolveTaskContractAcrossRoots`.** Its local-work-order fallback is exercised
  through `captureOrReadTaskContract` (M6) but has no mutation control of its own.

## Known bound — a `WORK-###` lane is not yet mergeable

`merge-gate.yml`, `p0-protocol.yml` and `executor-result-validator.yml` still resolve a
lane by `UTV2-###`. All three are **reserved surfaces** — merge authority,
`docs/mission/intent.md` reserved decision 7 — and are deliberately **not changed here**.

A `WORK-###` lane is therefore usable for discovery, delegation, verification and
closeout, and is **not yet mergeable**. That is a recorded bound, not a closed gap;
closing it is a PM decision on the merge gate, not an ordinary lane. This lane itself is
`UTV2-1837` for exactly that reason.

Also unchanged: branch protection, CODEOWNERS, required check contexts, tier risk
semantics, proof bundles and lane isolation.

## R-level

Governance/tooling change to ops scripts and their specs, no runtime or data-path
surface. `pnpm r-level-check` is run as part of `pnpm verify`; the triggered `required[]`
artifacts for this lane are the diff summary and this verification log, both present.

## Merge SHA Binding

Merge SHA: pending merge

`sha_binding.merge_sha` is `null` pre-merge. `verified_source_sha` is `4873899a72f0ac6235ef18af5b82db7ff5fcff86`,
the last non-proof commit on the branch. The binding is written after merge by
`ops:proof-generate --merge-sha`; no manual append is made here.
