# Approval carry-forward — Merge Gate integration, prepared for reserved review

**Status: PREPARED AND VERIFIED, NOT APPLIED.** Merge authority is reserved decision 7 in
`docs/mission/intent.md`. Nothing in this packet is on `main`, and the four required checks
behave today exactly as they did before it was written.

**Patch:** `docs/05_operations/proposals/carry-forward-merge-gate.patch` — 3 files, +171/-18,
applies clean at `cf16fa4c4`. It is checked in as an inert `.patch` file precisely so it can be
reviewed as a diff without being applied; `git apply` it only after PM ratifies reserved decision 7.

---

## What it does

`validateT1Verdicts` currently returns an array of message strings. The Merge Gate cannot tell
"the reviewed content is unchanged, only the head moved" apart from "there is no verdict at
all" without matching on prose. The patch attaches a machine-readable code to each error and
lets the gate consult the already-merged collector (`scripts/ops/carry-forward-collect.ts`)
**only** when every remaining T1 error is staleness.

Message text is byte-identical: verified by running the original and patched
`validateT1Verdicts` over nine input shapes and diffing the returned arrays — **identical in
all nine**.

## The four hunks

| # | File | Change | Reserved surface? |
|---|---|---|---|
| 1 | `scripts/ops/merge-gate-verdict.cjs` | `STALE_HEAD` code + `withCodes()`; every error carries a code on **every** return path | Merge-authority input |
| 2 | `.github/workflows/merge-gate.yml` (evaluator) | consult the collector when and only when `onlyStaleness`; fail closed otherwise | **Merge authority** |
| 3 | `.github/workflows/merge-gate.yml` (job) | `fetch-depth: 0`, pnpm/node setup + install, and a bare `git fetch` of the PR head | **Trust posture of a required check** |
| 4 | `scripts/ops/workflow-hardening.test.ts` | widen two assertions to admit exactly hunks 1 and 3 | **Security assertion** |

## The fail-open this preparation found and closed

The first draft read `(t1Errors.codes || []).every(c => c === 'stale_head')`. When `codes` is
absent that is `[].every(...)` — **vacuously true** — so `onlyStaleness` would be true for
every error the early-return paths produce: *no verdict at all*, and *unauthorized author*.
The gate would have carried an approval forward on PRs that were never approved.

Two independent repairs, both in the patch:

- `withCodes()` attaches `codes` on every return path and **throws** if the two lists ever
  desynchronise.
- The workflow reads `codes` with **no `|| []` fallback**, and additionally requires
  `codes.length === t1Errors.length`.

Measured after the repair (`errors` / `codes` / `onlyStaleness`):

| Input | errors | codes | onlyStaleness |
|---|---|---|---|
| stale head only | 1 | `["stale_head"]` | **true** |
| no verdict at all | 1 | `[null]` | false |
| bot author | 2 | `[null,null]` | false |
| 3× CHANGES_REQUIRED | 2 | `[null,null]` | false |
| stale + PR mismatch | 2 | `[null,"stale_head"]` | false |
| missing `Head SHA:` | 1 | `[null]` | false |
| fresh verdict | 0 | `[]` | false |

`onlyStaleness` is true in exactly one of seven shapes.

## Integration effects — measured, not predicted

1. **The gate job could not have run the collector at all.** It has no Node or pnpm setup and
   no `pnpm install`, so `pnpm exec tsx …` would have failed. Fail-closed means the feature
   would simply never fire — safe, and silently inert. Hunk 3 adds the toolchain, which makes
   a **required** check depend on a `pnpm install`. That is a real latency cost on every PR.

2. **`require('child_process')` breaks a hardening assertion.**
   `workflow-hardening.test.ts:191` asserted the evaluator requires exactly one specifier.
   Hunk 4 widens it to an explicit two-entry allowlist and stubs `spawnSync` to return a
   non-zero status, so the harness exercises the fail-closed branch. The protected property —
   the gate never requires anything PR-supplied — still holds and is still asserted.

3. **The collector needs PR-head blobs, and the gate job is forbidden to fetch them.**
   `workflow-hardening.test.ts:1150` — *"merge-gate.yml gate job never fetches or executes
   content keyed on pull_request.head.sha"* — fails on hunk 3's fetch step. This is the one
   substantive policy question in the packet, and it cannot be engineered away: proving the
   reviewed content survived a head move requires reading the head's blobs.

   The amendment distinguishes **fetching inert objects** from **materializing files**:
   `git fetch` writes only to the object store and moves no ref the job reads, while
   `git show` / `git checkout` / `curl` / `wget` / any redirect into `scripts/` remain
   forbidden, and a head-sha fetch is admitted **only** as a bare single-command
   `git fetch --no-tags origin <head sha>`.

   Mutation-tested — each of these still fails the amended assertion:

   | Mutation | Result |
   |---|---|
   | `git show <head>:scripts/ops/merge-gate-verdict.cjs > scripts/ops/merge-gate-verdict.cjs` | **caught** |
   | `git fetch <head>` followed by `git checkout <head> -- scripts/` | **caught** |
   | `curl …<head> -o scripts/ops/x.cjs` | **caught** |

   The executed tree is still `base.sha`. What changes is that head commits become readable as
   data. **This is a deliberate narrowing of an existing security assertion and is exactly what
   needs a decision**, not an implementation detail.

## Conflict resolution, policy changes, approval withdrawal

- **Conflict resolution.** The collector's C2 compares blob identity per path and C3 admits
  paths only by explicit rule; a conflict resolution that changes reviewed content changes a
  blob and refuses. A merge commit that resolves nothing (`mergeOwnContent`) is admitted.
- **Policy changes.** Reserved paths in `RESERVED_RISK_SURFACES` are evaluated **before** the
  allowlist, so a later widening of the allowlist cannot admit one. `docs/` and `.ops/` are
  **not** blanket-exempt — they are enumerated as leaf patterns, per the standing instruction.
- **Approval withdrawal — blocked at two independent layers.** First, a `CHANGES_REQUIRED`
  verdict fails inside `validateT1Verdicts` before any of this runs (`Most recent PM verdict
  is "…"`), carries a `null` code, and therefore makes `onlyStaleness` false — verified as
  row 4 of the table above. Second, even if that layer were bypassed, C4
  (`approval-carry-forward.ts:430-433`) refuses on **any** withdrawal signal timestamped after
  the approval, from either surface (`WithdrawalSignal.source`). A withdrawn approval blocks
  exactly as it does today.
- **The original verdict is never edited.** On success the gate pushes a `notes` line naming
  the original verdict SHA and its comment URL. The receipt is separate, mechanically
  computed, and additive.

## What is NOT claimed

- Not run in CI. It has never evaluated a real PR; the gate job's own behaviour under hunk 3
  is argued from the workflow definition and the tests, not observed.
- Not proven to reduce round trips. The measured cost it targets (a readiness-ledger commit
  invalidating a head-pinned verdict) is real and recorded, but no post-change measurement
  exists.
- The `pnpm install` latency added to a required check is not measured.

## Verification performed

- `git apply --check` at `cf16fa4c4` — clean.
- Patched workflow parses as YAML; its embedded `github-script` body passes `node --check`.
- `scripts/ops/merge-gate-verdict.test.ts` — 20/20 pass with the patch applied.
- `scripts/ops/workflow-hardening.test.ts` — 66/66 pass with the patch applied.
- Message parity across nine verdict shapes — identical to the unpatched module.
- Three hostile mutations of the fetch step — all caught by the amended assertion.
- `eslint` on both touched source files — clean.
- Working tree reverted to clean; nothing applied.
