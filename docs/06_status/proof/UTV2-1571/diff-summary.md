# UTV2-1571 Diff Summary

Issue: UTV2-1571
Tier: T1
Lane type: governance
Branch: claude/utv2-1571-file-scope-lock-history-separation
Head SHA: e99ce8b1f230f0242f0a4ce77048fea779979544
Diff base: origin/main

## Problem

UTV2-1550 is merged (PR #1239) but its lane manifest cannot reach status
`done`, because truth-check's `G4` (CI-green-on-merge-commit) can never
mechanically pass for that specific historical merge SHA — the PR's own
purpose was fixing stale/duplicate required-check identities, so its own
merge commit's check runs for the renamed required contexts are
retroactively orphaned by the very identity-mapping change it introduced
(documented as "expected and harmless" in the PR's own merged incident doc).
`scripts/ci/file-scope-guard.ts` (the CI PR gate) treated status `merged` as
active for both (1) resolving a PR's own trusted scope and (2) blocking
OTHER lanes' diffs against its `file_scope_lock` — so UTV2-1550's
perpetually-`merged` manifest permanently blocked every other lane (UTV2-1560
among them) from touching `package.json`. A prior PR (#1288) tried to fix
this by deleting `package.json` from both `file_scope_lock` and
`files_changed`; rejected, since it falsifies the shipped diff and removes
the path from post-merge touch auditing (G5/S1).

## Files changed

- `scripts/ci/file-scope-guard.ts` — splits the single `ACTIVE_STATUSES` set
  into `SELF_SCOPE_STATUSES` (includes `merged`, unchanged self-scope
  resolution behavior from UTV2-1563) and `LOCK_CONFLICT_STATUSES` (excludes
  `merged`, matches the canonical `ACTIVE_LOCK_STATUSES` already used by
  every other `scripts/ops/*.ts` consumer). Own-manifest resolution
  (`findOwnManifest`) uses the wider set; the conflict-blocking loop uses the
  narrower set. `files_changed` is never read by either role — only
  `file_scope_lock` — and that was already true before this change; the fix
  only changes which manifests' `file_scope_lock` counts as currently
  blocking.
- `scripts/ci/file-scope-guard.test.ts` — 4 new regression tests: a merged
  historical lane no longer blocks a different lane on the same path; a
  merged lane still resolves its own self-scope while simultaneously not
  blocking a foreign lane; an active continuation (`reopened`) of a
  previously-merged lane still blocks; `files_changed` is never consulted
  for conflict-blocking even when it diverges from `file_scope_lock`.
- `docs/05_operations/LANE_MANIFEST_SPEC.md` — new §17 documenting the
  self-scope/conflict-blocking split. Explicitly notes that this fix does
  **not** implement LANE_MANIFEST_SPEC §2's "Override close" event, which
  remains documented-but-unbuilt.
- `docs/06_status/lanes/UTV2-1571.json`, `.ops/sync/UTV2-1571.yml`,
  `docs/06_status/proof/UTV2-1571/**` — this lane's own manifest, sync
  metadata, and proof bundle.

## Explicitly not changed

- `docs/06_status/lanes/UTV2-1550.json` is **not modified by this PR**.
  `files_changed`, `file_scope_lock`, and `status: "merged"` all remain
  exactly as they were. This lane does not build any new closeout mechanism
  for UTV2-1550. Live `pnpm ops:truth-check UTV2-1550` (run against this
  branch, read-only, no mutation) confirms exactly 2 failures on the current
  real manifest: `L3` (Linear state `Blocked Internal`, not `In PM
  Review`/`Done`) and `G4` (required checks missing/failing on the merge
  commit: `Executor Result Validation`, `Merge Gate`, `P0 Protocol`). Both are
  pre-existing, structural, and unrelated to this fix — see `verification.md`
  for the full check output and the manual, PM-reviewed path required to
  close them. `S1` and `G5` already pass unchanged on the real manifest,
  confirming this fix's target (the CI PR gate blocking *other* lanes) was
  never actually truth-check's own S1/G5 evaluation of UTV2-1550's historical
  scope — those were already correct.
- No `--override` CLI mechanism, authorization scheme, mutex/lock handling,
  or GitHub-comment-based authority pattern is added anywhere in this PR.
  An earlier iteration of this lane built such a mechanism
  (`ops:lane-close --override`); it was descoped by explicit PM decision as
  unnecessary, privileged-surface scope creep, and is not present in this
  diff.
- No manifest schema field was redefined or made mutable in a way that
  breaks an existing reader. `file_scope_lock` keeps its `minItems: 1`
  constraint and immutable-at-lane-start semantics for every existing
  consumer (`ops:lane-start`'s overlap check, `execution-state.ts`,
  `merge-risk.ts`, `lane-maximizer.ts`, `scope-diff.ts`) — none of those
  call sites were touched.
- No R1-R5 rule matches this diff (`r-level-check` verdict: PASS, no
  artifacts required).
