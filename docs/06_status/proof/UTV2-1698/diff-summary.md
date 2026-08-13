# Diff summary: UTV2-1698

MERGE_SHA: 971d18226c73ae234537330f2a21c5e0577810f7

Execution-truth guards for `codex-exec`. No runtime, domain, DB, delivery or workflow-authority code.

| File | Change |
|---|---|
| `scripts/ops/codex-exec.ts` | `evaluateExecutionTruth` gains three guards and loses its `phase` parameter. Takes `issueId` and reads the checkpoint itself, so a stale phase cannot be supplied by any caller. Rules 1 and 3 are scope-aware, with scope read from the base ref via `readAuthoritativeFileScope`. `shouldInvalidateForRework` extracted so dry-run purity is reachable from a regression. |
| `scripts/ops/codex-exec.test.ts` | Regressions for all three rules, the scope trust boundary, fail-closed scope reads, conservative classification, dry-run purity, the production call site, and the assertion that a genuine run reaching implementation still succeeds. |
| `scripts/ops/execution-checkpoint.ts` | Supporting checkpoint surface for the above. |
| `scripts/ops/execution-checkpoint.test.ts` | Coverage for the checkpoint changes. |

## The three rules

1. **`REWORK_NO_SOURCE_CHANGE`** — a rework carrying findings that changes zero source files. Catches the two re-dispatches that returned SUCCESS having changed nothing.
2. **`INCOMPLETE_PHASE_PROGRESSION`** — `completed_phases` does not contain `implement`. Catches the fresh lane that stopped at `plan` and reported completed.
3. **`IMPLEMENTATION_CLAIMED_WITHOUT_CHANGE`** — the implement phase is marked complete but no source changed. Catches a self-reported phase with no real diff, which neither of the other two can see.

`countSourceFilesChanged` excludes `docs/` and `.ops/`: a proof-only or manifest-only commit is not implementation.

Rules 1 and 3 are scope-aware. A lane whose **authoritative** `file_scope_lock` is entirely `docs/`/`.ops/` completes, and can be reworked, by changing that declared deliverable — proof rejected, proof rewritten, work done. Every other lane must change real source.

## The scope trust boundary

Scope is read with `git show <base>:docs/06_status/lanes/<ID>.json`, never from the working tree. The working-tree manifest sits on the executor's own branch, so trusting it would let an executor rewrite its scope to docs-only and exempt itself — the self-attestation defect one level up. Missing, malformed or unreadable authoritative scope fails closed to source-required, which is the common case for a new lane whose manifest is not yet on `main`. Classification is conservative: every entry must be explicitly inside `docs/` or `.ops/`, so mixed scope, bare or leading globs, parent traversal, absolute paths, repository roots, `scripts/**`, `.github/**`, configuration and package files all stay source or control-plane required.

A regression asserts the **production call site**, not only the function — the function being correct does not stop one line in `main()` from bypassing it, which is exactly how defect 1 shipped.

## Three defects found in review, all in the orchestrator's own addition

1. The rule was fed a **pre-spawn** phase snapshot, always `orient` on a fresh lane, so every first-attempt dispatch would have failed. Fixed by removing the parameter, not by adding a test — a test could not guard a wrong call site.
2. `checkpoint.phase` is the **next** phase to work on, not the ending phase, so a run that completed `plan` would have passed. Fixed by gating on `completed_phases`.
3. `completed_phases` is **written by the executor**, so claiming `implement` with no diff passed. Fixed by corroborating the claim against a real diff.

## Mutation results

| Mutation | Result |
|---|---|
| A · Rule 2, completed-phases removed | `not ok 25` — 64 pass / 1 fail |
| B · Rule 1, rework removed | `not ok 22`, `28`, `34`, `36` — 61 pass / 4 fail |
| C · gate on `checkpoint.phase` | `not ok 25` — 64 pass / 1 fail |
| D · Rule 3, self-attestation cross-check removed | `not ok 26`, `32`, `33` — 62 pass / 3 fail |
| E · dry-run purity removed | `not ok 29` — 64 pass / 1 fail |
| F · Rule 3 declared-deliverable scope ignored | `not ok 31`, `35` — 63 pass / 2 fail |
| G · source counting includes `docs/`, `.ops/` | `not ok 24` — 64 pass / 1 fail |
| H · proof-only rework support removed | `not ok 35` — 64 pass / 1 fail |
| I · scope read from branch working tree | `not ok 37` — 64 pass / 1 fail |
| J · permissive fallback on missing scope | `not ok 38` — 64 pass / 1 fail |
| K · call site wired to branch manifest | `not ok 40` — 64 pass / 1 fail |
| Restored | **65 / 65** across both modules, 0 skipped |

Eleven groups, no survivors.

## Known limitations, deliberately not addressed here

- `pnpm type-check` does not compile `scripts/ops/**`; `tsconfig.json` references only `packages/*` and `apps/*`. Tracked under a separate ticket per PM sequencing.
- A legitimate no-op run stays fail-closed per PM decision. A future `NO_CHANGE_REQUIRED` disposition with independent confirmation is required, and must never masquerade as SUCCESS.
