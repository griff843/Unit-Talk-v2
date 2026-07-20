# UTV2-1566 — Diff Summary

Issue: UTV2-1566
Tier: T2
Lane type: governance
Branch: `claude/utv2-1566-bind-proof-sha-finalize-close`

## Why this lane exists

UTV2-1565 (PRs #1274/#1275) reconciled the lane manifests for UTV2-1424,
UTV2-1446, UTV2-1546, and UTV2-1551 from ghost `status: started` to
`status: merged` with correct `pr_url`/`commit_sha` from GitHub. It did
not reach `status: done` — `ops:truth-check` failed `P3`/`C4` (stale
proof) because each issue's proof files referenced the pre-merge
implementation SHA, not the actual merge commit SHA.

During this lane's `ops:substrate-guard` preflight, two more ghost lanes
surfaced: UTV2-1563 and UTV2-1564 (both merged — PRs #1276/#1277 — but
still `status: started` with null `commit_sha`/`pr_url`, and both
declaring worktrees that no longer exist on disk). A further sweep of
`.ops/leases/*.json` for entries not in `status: released` found UTV2-1550
also stuck `status: merged`/`closed_at: null` (same root cause), plus 7
stale dispatch leases (`stale_reclaim_required`, not tied to any live
process) that count as active capacity for `ops:substrate-guard` purposes
regardless of the underlying manifest's own status.

## What manual `workflow_dispatch` replay of `post-merge-lane-close.yml` does NOT fix

Before doing this locally, `workflow_dispatch` replay was attempted for
all four original issues (runs 29786244378, 29786257795, 29786299444,
29786330551). All four failed `stale_proof`. Root cause: the workflow's
"Bind proof artifacts to merge SHA" step passes `--merge-sha "$GITHUB_SHA"`,
which for a `workflow_dispatch` run is today's `main` HEAD, not the
historical merge SHA of the target issue's original PR — so proof gets
rebound to the wrong commit. This is a real gap in that workflow's manual
replay path (separate follow-up; out of scope here) — it works correctly
for the push-triggered case (where `github.sha` genuinely is the new merge
commit) but not for retroactively closing an already-merged ghost lane.

## Files changed

- `docs/06_status/lanes/UTV2-1424.json`, `UTV2-1446.json`, `UTV2-1546.json`,
  `UTV2-1551.json`, `UTV2-1563.json`, `UTV2-1564.json` — `status: done`,
  real `closed_at`, passing `truth_check_history` entry
- `docs/06_status/proof/UTV2-{1424,1446,1546,1551,1563,1564}/*` —
  regenerated via `pnpm ops:proof-generate <ID> --merge-sha <that issue's
  own manifest.commit_sha>` (not `github.sha`) so `P3`/`C4` pass
- `docs/06_status/proof/UTV2-1424/model-routing.json` — added a
  `merge_sha` field (established convention, see e.g.
  `docs/06_status/proof/UTV2-1264/model-routing.json`); `ops:proof-generate`
  does not manage this Codex-routing-metadata file, but it is listed in
  `UTV2-1424`'s `expected_proof_paths` and is therefore subject to the
  same `P3`/`C4` SHA-reference check
- `docs/06_status/lanes/UTV2-1550.json`, `UTV2-1551.json` — proof
  regenerated and a close attempted, but both remain genuinely blocked
  (see "Known gaps not fixed here" below); left as an honest record of
  the attempt, not silently reverted
- `docs/06_status/lanes/UTV2-1566.json`, `docs/06_status/proof/UTV2-1566/*`
  — this lane's own manifest and proof

## Known gaps not fixed here (separate follow-up work, not mechanical)

- **UTV2-1551** (T1): `ops:truth-check` fails `R1`/`R2` — its evidence
  bundle has no live `pnpm test:db` query/row-count evidence. This is a
  genuine T1 runtime-proof gap, not something to fabricate or paper over.
  Also fails `L3` (Linear state `Ready to Close` not in the allowed set)
  and `S1` (`files_changed` lists paths outside `file_scope_lock`).
- **UTV2-1550** (T1): `ops:truth-check` fails `G4` — the merge commit
  itself (`1d555828...`) has multiple *post-merge* re-runs of "Merge
  Gate"/"Executor Result Validation"/"P0 Protocol" recorded as `failure`
  on GitHub's check-runs API, alongside the original PR head SHA's
  passing runs. `evaluateRequiredChecksForSha` in `scripts/ops/truth-check-lib.ts`
  reads `commits/{merge_sha}/check-runs`, which returns every check-run
  ever associated with that commit (including re-runs triggered long
  after merge, seemingly without a live PR context) — not just the run
  from when the PR was actually merged. Root-causing whether those
  post-merge failures are meaningful or workflow-invocation noise is a
  separate investigation, not appropriate to force through here.
- **UTV2-1554 / UTV2-1560**: both have a merged original PR, a
  subsequently-closed (unmerged) close attempt, and a currently open
  "continuation" PR with real, substantive CI failures (`Merge Gate`,
  `File scope lock`, and for UTV2-1560 also `Live Schema Parity` +
  `Runtime Verifier Gate` on a `CONFLICTING`/`DIRTY` PR). These are
  pre-existing, unrelated, substantively broken lanes — flagged for
  follow-up, not folded into this mechanical reconciliation pass.

## Ghost-capacity cleanup performed alongside the manifest fixes

- Released 2 stale dispatch leases whose declared worktrees no longer
  exist (`UTV2-1563`, `UTV2-1564`)
- Released 7 more stale leases found via a full sweep of
  `.ops/leases/*.json` for `status != released`: `UTV2-1398`, `UTV2-1501`,
  `UTV2-1503`, `UTV2-1506` (manifests already `done`/gone — pure lease
  cruft), plus `UTV2-1550`, `UTV2-1551`, `UTV2-1554`
- Reclaimed/released a stale merge lock left by an interrupted prior
  session (owned by a dead PID for `UTV2-1565`)
