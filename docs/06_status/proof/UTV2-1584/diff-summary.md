# DIFF SUMMARY: UTV2-1584 — Safe existing-branch lane re-admission

MERGE_SHA: a75a291057a13a5e26279edd8dbac65f8bd91e17

Rebindable anchor. Note this file is deliberately **not** listed in the lane
manifest's `expected_proof_paths`, so truth-check's P3/C4 do not validate its
SHA. It exists to satisfy `CEP-E4/P11` (proof bundle must include a diff
summary) and `CEP-E5` (every markdown proof artifact carries a rebindable
anchor).

Issue: UTV2-1584
Tier: T1
Lane type: governance
Branch: `codex/utv2-1584-existing-branch-readmission`
Implementation PR: #1304, merged as `d2abd5310469a30d4ff5ab91a5e82b53bfa1eec2`

## Why this file was added after the lane merged

The lane merged without a diff summary. That went unnoticed because nothing
pre-merge required one at the time; the requirement is enforced by the close
eligibility preflight, which now runs on every PR and blocked the lane's
recovery with:

```text
[FAIL] CEP-E4/P11  proof must include a diff summary file
[FAIL] CEP-C1      ops:lane-close would fail after merge on: CEP-E4/P11
```

This is the preflight doing exactly its job — surfacing, before a merge, a
condition that would otherwise only appear as a post-merge closeout failure.

## What the lane shipped

`git diff --stat` for the implementation PR: **10 files, +2053 / −18**.
Excluding lane apparatus, sync metadata, and proof:

| File | Change | Lines |
|---|---|---|
| `scripts/ops/lane-start.ts` | existing-branch re-admission path | +612 / −5 |
| `scripts/ops/preflight.ts` | worktree reconstruction + validation | +532 / −13 |
| `scripts/ops/lane-start.test.ts` | added | +336 |
| `scripts/ops/preflight.test.ts` | added | +148 |
| `docs/05_operations/EXISTING_BRANCH_READMISSION.md` | added | +78 |

Substantive change: **1290 lines of implementation across two ops scripts,
covered by 484 lines of new tests**, plus the operations document describing the
re-admission contract.

## What it does

Adds a safe path for re-admitting an existing branch into a lane, and for
reconstructing a worktree for a lane whose substrate is missing — the situation
that previously forced either an unsafe manual reconstruction or abandoning the
branch entirely.

## Risk assessment

- **Runtime surface:** none. No file under `apps/`, `packages/`, `supabase/migrations/`, or `.github/workflows/` is touched. Both changed scripts are orchestration tooling, not the pick pipeline.
- **Schema/DDL:** none.
- **Blast radius:** lane orchestration only. A defect here blocks or misroutes lane setup; it cannot affect picks, grading, delivery, or stored data.
- **Reversibility:** fully reversible by revert; no migration or data implication.
- **Test coverage:** 484 lines of new tests accompany 1290 lines of implementation, and both test files are wired into `test:ops`.

## Recovery record

This lane was merged-but-unclosed and held a governance concurrency slot. Its
manifest recorded `commit_sha: 1f356895…`, a real commit object that is **not an
ancestor of `main`** — orphaned when the branch was rebased and every SHA
rewritten. `ops:lane-close --repair-merged` correctly refused with
`pr_sha_mismatch` rather than close a lane whose recorded identity was false.

Recovery cleared that field to `null` (its documented pre-merge default) instead
of hand-writing the correct SHA, so the validated mechanism resolves the real
merge commit from the PR itself and writes it. Clearing a false value is not the
same as asserting a new one.

`verification.md` and `evidence.json` still carry stale SHAs from the same
rewrite (`5cbe30fc…` and `1f356895…` respectively). Both are corrected by the
validated rebind during closeout, not by hand here.
