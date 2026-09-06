# UTV2-1837 — Verification

ISSUE: UTV2-1837
TIER: T2
LANE_TYPE: governance
MERGE_SHA: pending merge

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
pnpm test            # 5938 tests, 5938 pass, 0 fail
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

`sha_binding.merge_sha` is `null` pre-merge and `verified_source_sha` is the last
non-proof commit on the branch. The binding is written after merge by
`ops:proof-generate --merge-sha`; no manual append is made here.
