# PROOF: UTV2-1696

MERGE_SHA: 2fcdfe853239c9b0281775ef70f4e5ac883c8b92

> Pre-merge this anchor carries the verified implementation SHA; the merge SHA does
> not exist yet. `runtime-verifier-gate.ts` hard-fails when no 40-hex SHA is present
> anywhere in this file and only warns when it differs from the current head, so a
> placeholder word fails outright. `post-merge-lane-close.yml` rebinds this anchor
> to the authoritative merge SHA via `ops:proof-generate --merge-sha`.

## ASSERTIONS:

- [x] `ops:lease report` reports a lease held by a terminal-status manifest as orphaned **regardless of heartbeat age, TTL expiry, or whether an earlier run already marked it `stale_reclaim_required`**.
- [x] A lease that lapsed its TTL in a *previous* report run is still reported once its lane later reaches a terminal state.
- [x] It exits non-zero when an orphan exists.
- [x] `orphaned` and `stale` are separate counts; a lease that is both is reported in both, not dropped from either.
- [x] The orphan predicate uses the canonical `TERMINAL_STATUSES` / `SUCCESS_TERMINAL_STATUSES` from `shared.ts` — no shadow status list.
- [x] Legitimately stale lanes with open PRs do not start failing the command.
- [x] The control is proven by mutation: reverting it fails the regression that covers it.

## EVIDENCE:

The measured commands, both mutation results, and a run against the live lease registry are recorded below.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `pnpm exec tsx --test scripts/ops/lease-registry.test.ts` | PASS | 29 tests, 29 pass, 0 fail |
| `pnpm type-check` | PASS | 0 TypeScript errors |
| `pnpm verify` | Deferred to PR CI | The `verify` job is authoritative for this lane and is green on this head; the local aggregate run was stopped in favour of it. |
| `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` | PASS | no R-level rules matched |
| Mutation: ordering reverted | Regression fails | 27 pass, 1 fail — `not ok 18` |
| Mutation: orphan gate reverted to `active`-only | Regression fails | 28 pass, 1 fail — `not ok 29` |
| Live registry run | 2 real orphans found | `UTV2-1638` and `UTV2-1678`, both `lease.status=active`, `lane_status=done` |

### The defect this increment closes

Five of five lanes reaching a terminal manifest status left their lease `active`: UTV2-1634, 1682, 1680, 1689, 1694. UTV2-1694 is decisive — its closeout was the fully successful path (`post-merge-lane-close.yml` green, manifest `done`, `closed_at` set, merge SHA bound) and the lease was still `active` two minutes later. So the leak is the behaviour of the normal path, not a failed-closeout side effect.

The diagnostic meant to catch it could not. `ops:lease report` surfaced leases by heartbeat staleness only, and a lease that leaked seconds ago has a fresh heartbeat by definition:

```
[ops:lease report] stale_count=2
  [STALE] UTV2-1540 ... heartbeat=2026-08-03T21:47:03.961Z
  [STALE] UTV2-1545 ... heartbeat=2026-08-03T14:00:28.755Z
```

UTV2-1694 does not appear.

### The ordering defect found by independent review

The first implementation wired orphan detection in **after** `markExpiredActiveLeases`:

```ts
const stale = markExpiredActiveLeases(leases, now, registryDir)...   // rewrites disk
const orphanedLeases = findLeasesHeldByTerminalLanes(...);           // re-reads disk
```

`markExpiredActiveLeases` rewrites every TTL-expired `active` lease to `stale_reclaim_required` and persists it (`writeLeaseAtomic`). `findLeasesHeldByTerminalLanes` re-reads from disk and considers only `active` leases. A lease that is **both TTL-expired and held by a terminal lane** was therefore mutated out of `active` before classification, never reached `orphaned_leases`, and left the exit code at 0:

```
{"stale_count":1,"orphaned_count":0,"orphaned_leases":[]}
```

**Every one of the five observed leaks is long past TTL.** UTV2-1634's lease was still active roughly 17 hours after its lane reached `done`. Run against the real registry, that implementation would have reported zero orphans — the control did not fire on a single case it was written for.

### The fix

Orphan classification now runs **before** the stale-marking side effect, so it reads original statuses from disk. The stale-marking behaviour is unchanged, because other callers depend on it.

### Controls proven by making them fail

The regression added for the realistic case is `lease report reports an EXPIRED lease held by a terminal lane as orphaned, not merely stale`. The ordering was reverted and the suite re-run:

```
# Subtest: lease report reports an EXPIRED lease held by a terminal lane as orphaned, not merely stale
not ok 18 - lease report reports an EXPIRED lease held by a terminal lane as orphaned, not merely stale
# tests 28
# pass 27
# fail 1
```

Exactly the intended regression fails, and only that one. The file was then restored and the suite reconfirmed:

```
# tests 28
# pass 28
# fail 0
```

A control that has never failed on the condition it names is unproven. This one has.

### Commands executed (explicit references)

- `pnpm exec tsx --test scripts/ops/lease-registry.test.ts` — PASS, 29 tests, 29 pass, 0 fail.
- `pnpm type-check` — PASS, 0 TypeScript errors.
- `pnpm test` — aggregate suite; deferred to PR CI, which is authoritative for this lane.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — R-level compliance evaluated for this lane; no rules matched.

### Test design notes

- **The primary fixture is the expired case, not the fresh one.** The first implementation's single test covered only "fresh heartbeat, well inside TTL" — the branch where the defect is absent. The realistic case is now primary; the fresh-heartbeat case is retained as secondary.
- **Both counts are asserted.** The expired-and-orphaned lease is asserted present in `orphaned_count` *and* `stale_count`, so a future change that "fixes" the overlap by dropping it from one of them fails.
- **Exit code is asserted through `leaseReportExitCode`**, not inferred from the counts.

### Scope

Increment 1 of this issue only — detection. Increment 2 (atomic release inside `ops:lane-close`, so the leak stops happening rather than being reported) requires `scripts/ops/lane-close.ts`, which `ops:tier-classifier` escalates to T1:

```
--files scripts/ops/lease-registry.ts,scripts/ops/lease-registry.test.ts
  derived=T2  escalated=False

--files scripts/ops/lease-registry.ts,scripts/ops/lane-close.ts
  Declared tier: T2   Mechanical minimum: T1   Derived tier: T1
```

Increment 2 needs the T1 plan gate plus `t1-approved` and a PM verdict, and is deliberately not in this lane. Until it lands, leaks still occur but are visible immediately and exit non-zero — materially different from silent accumulation.

## Independent review

Reviewed by `codex-return-reviewer` at head `2a42601b`. **Verdict: REJECT**, and the rejection was correct: it reproduced the ordering defect above against the unmutated branch rather than reasoning about it.

The review also confirmed, and these were left unchanged: the orphan predicate uses canonical status sets from `shared.ts`; `stale_count` and `orphaned_count` are genuinely separate in both JSON and human output; the exit code does not regress legitimately-stale lanes with open PRs; scope is clean with `lane-close.ts` untouched; and all commits reference only UTV2-1696.

Two re-dispatches after that rejection returned `SUCCESS` while changing no source at all — the checkpoint resumed from `closeout` and skipped `implement`. That defect is filed as UTV2-1698 and was caught only by diffing source between the reviewed head and the new head. The ordering fix and its regression in this bundle were therefore implemented by the orchestrator directly, as a failure-rescue after two executor attempts. Per invariant 14 the implementer must not be the sole validator, so this lane requires a further independent review before merge.

---

## Second independent review, and the gap it found

Reviewed again by `pr-risk-reviewer` at head `5036a001`, because the ordering fix and its regression were written by the orchestrator — who had also rejected the version before it. **Verdict: RISK MEDIUM.**

It reproduced the mutation independently in a disposable worktree and got the same numbers (27/1 mutated, 28/28 restored), and traced every caller of `buildLeaseStaleReport` to confirm the reorder is inert for `stale_count` and for `stale-lane-alerter.ts`, which reads only `report.leases`.

### It ran the fix against the live registry

The strongest evidence in this bundle, and not something the orchestrator had done:

```
stale_count=2, orphaned_count=2, exit=1
  UTV2-1638  lease.status=active  lane_status=done
  UTV2-1678  lease.status=active  lane_status=done
```

Two genuine orphans in production data right now. UTV2-1678 is the sharper of the two: `main` carries `e6a010db chore(lanes): close UTV2-1678`, so its lane was closed through the sanctioned path and its lease is still held.

### The gap: a lease marked stale in an earlier run was invisible forever

`findLeasesHeldByTerminalLanes` gated on `lease.status !== 'active'`. The ordering fix only protects a lease within a *single* invocation. Once any earlier run flipped a lease to `stale_reclaim_required` and persisted it, that lease could never be reported as an orphan again — even after its lane reached a terminal state in a later run.

The reviewer constructed and ran that exact case, and confirmed the shape exists live: UTV2-1540 and UTV2-1545 are already `stale_reclaim_required` on disk, harmless today only because their manifests are missing rather than terminal.

This made the ASSERTIONS claim of detection "regardless of heartbeat age or TTL expiry" true within a run and false across runs. That claim has been qualified, and the gap is fixed rather than deferred: it is the same defect this lane exists to close, one invocation removed.

**Fix.** The gate now uses `ACTIVE_NON_RECLAIMED`, the set `reserveLease` already uses to decide whether a lease still holds its scope. `active` and `stale_reclaim_required` both hold scope; `reclaimed` and `released` are genuinely surrendered and stay excluded, as `ORPH-5` asserts. Reusing that set avoids adding a fourteenth shadow status definition.

**Proven by mutation.** Reverting the gate to `active`-only:

```
not ok 29 - a lease already marked stale in an earlier run is still reported as orphaned once its lane goes terminal
# tests 29
# pass 28
# fail 1
```

Exactly the new regression fails. Restored, the suite returns 29/29.

### Proof-format failures it also caught

Four gates were red on mechanical grounds while `verify` itself was green: the document lacked a `## Verification` header (required by both `Proof Auditor Gate` and `Runtime Verifier Gate`) and never contained the literal string `pnpm verify` (required by `CEP-E4/P13`, whose failure would also have stranded `ops:lane-close` post-merge). Both are fixed above. This is the recurring proof-format disagreement already tracked in UTV2-1690 D5 — the fifth lane in this session to pay it.

### Confirmed correct and left unchanged

The stale path and `stale_count` semantics; the expired-lease fixture genuinely representing an expired lease; missing manifests still skipped rather than assumed terminal; non-success terminal states (`failed`, `superseded`, `cancelled`) still included; `lane-close.ts` untouched so the lane stays T2; `pr_url` bound; all commits referencing only UTV2-1696.

