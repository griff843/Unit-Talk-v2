# UTV2-1551 Diff Summary

Issue: UTV2-1551
Tier: T1
Lane type: governance
Branch: `claude/utv2-1551-merge-gate-continuation`

## Why this is a fresh PR, not a continuation of the prior branch

A prior attempt at this fix (PR #1247) implemented root cause #1 (the
bot-token cascade fix below) as "part 1 of 2" and explicitly deferred root
cause #2 (the `opened` trigger) because `merge-gate.yml` was held in another
lane's file-scope lock at the time. That prior PR has since hit its T1 bounce
cap (3 CHANGES_REQUIRED verdicts) and gone `CONFLICTING` against current
`main` now that the other lane merged and released the lock. Per
instruction, this lane does not attempt to resolve those conflicts — it
reimplements both fixes cleanly from current `main` in a new branch/PR,
carrying forward the accepted part-1 content faithfully and adding part 2 on
top. PR #1247's verdict history stands as prior review record for the same
root causes; this PR supersedes it.

## Root cause #1 (carried forward from PR #1247, re-applied against current main)

- `.github/workflows/tier-label-check.yml` — the tier-label sync step now
  authenticates with `secrets.SYNC_BOT_TOKEN` instead of the implicit
  default `GITHUB_TOKEN`, with **no fallback**. Labels added via
  `GITHUB_TOKEN` don't cascade to trigger other workflows' `labeled` events
  (documented GitHub Actions behavior), so a fresh PR's tier-label sync could
  never fire Merge Gate's own `pull_request: labeled` trigger.
  `SYNC_BOT_TOKEN` is an existing PAT already used for this exact class of
  problem in `post-merge-lane-close.yml`.
- A new `Require SYNC_BOT_TOKEN` step fails the job closed with a clear
  `::error::` message if the secret is unset, rather than letting
  `actions/github-script` fail opaquely on an empty token, and rather than
  silently falling back to `GITHUB_TOKEN` (a fallback would silently
  reintroduce the exact bug this secret exists to fix).
- `docs/05_operations/REQUIRED_SECRETS.md` — added the `SYNC_BOT_TOKEN` entry
  (it was previously used by `post-merge-lane-close.yml` but never
  documented there); both consumers are now listed.
- `scripts/ops/workflow-hardening.test.ts` — regression test asserting the
  fail-closed guard step and the exact `github-token` expression with no
  fallback.

## Root cause #2 (new work in this lane)

- `.github/workflows/merge-gate.yml` — added `opened` to the `pull_request`
  trigger's `types:` list. Previously the list was
  `[synchronize, reopened, labeled, unlabeled, ready_for_review]` — a
  brand-new PR got zero Merge Gate evaluation from PR creation itself,
  relying entirely on some later push/label/review/comment event to fire it
  for the first time. The required "Merge Gate" check could sit
  never-having-run (not failed) indefinitely.
- Reviewed the full `gate` job body before making this change specifically
  to check for any step that assumes prior state exists (a tier label
  already applied, a PM verdict comment already posted) that a truly fresh
  `opened` event wouldn't have yet:
  - The job's `if:` condition already runs unconditionally for every
    `pull_request` event (`github.event_name == 'pull_request'`), so no
    separate `if:` change was needed — adding the trigger type is
    sufficient by itself.
  - Tier resolution reads the lane manifest directly via the Contents API
    (`readManifest`/`authoritativeTier`), not GitHub labels — it does not
    depend on `tier-label-check.yml`'s label sync having run first. If no
    tier label exists yet, the gate self-applies the authoritative one as
    evidence (pre-existing behavior, unchanged).
  - T1/T2 verdict checks (`validateT1Verdicts`, the T2 pm-verdict/executor
    self-attestation check) already fail closed with a clear `errors[]`
    message and a `BLOCKED` check-run conclusion when no verdict exists yet
    — exactly the correct status for a fresh PR. Nothing approves
    prematurely; a fresh PR simply gets an immediate, visible BLOCKED status
    instead of no check having run at all.
  - T3 auto-passes regardless of trigger type (pre-existing behavior,
    unchanged).
- Updated the regression test in `scripts/ops/workflow-hardening.test.ts`
  that previously asserted the opposite: `required PR check workflows do not
  create stale merge-gate contexts on opened events` (added under an earlier
  lane, UTV2-1157, on the now-superseded theory that running before GitHub
  tier labels "settle" was premature). Renamed and inverted the assertion,
  with commentary explaining why that premise didn't hold (tier resolution
  never depended on the label sync in the first place) and why the real
  effect of omitting `opened` was strictly worse (silent non-evaluation, not
  a race).
- Corrected `docs/05_operations/REQUIRED_CI_CHECKS.md`'s Merge Gate trigger
  prose, which was already stale (missing `unlabeled`/`ready_for_review`
  independent of this change) and is now accurate and includes `opened`
  with a note on why it was added.

## Explicitly not changed

- The "Comment on blocked tier state" step in `tier-label-check.yml`
  deliberately keeps the default `GITHUB_TOKEN` — posting a comment doesn't
  need to cascade anything.
- No branch-protection or repository ruleset setting.
- No required-status-check context added, removed, or renamed.
- `wfr-validators` job's own `if:` was already unconditional for
  `pull_request` events; it needed no change and was not touched.
