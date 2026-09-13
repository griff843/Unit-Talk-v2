# Tracker independence staged integration

MERGE_SHA: pending merge

## Summary

PR #1556 is the evaluator foundation and local workflow cutover. Its P0 Actions
consumer remains byte-for-byte equal to the current base version. The full cutover
is not complete until the consumer activation and post-merge workflow checks below
pass. This document records sequencing in the existing lane, not a new framework.

## Verification

The activation diff is `p0-consumer-activation.patch` in this directory. SHA-256:
`18627b665169de19a037fecb49d086de33b79d641d6f141808c549c7e5ff5ac9`.
`git apply --check` passes against the foundation tree. It changes only
`.github/workflows/p0-protocol.yml`; the evaluator and classification registry are
already supplied by the foundation. The consumer reads the protected main SHA,
checks out that trusted base, and evaluates the candidate without running its code.

## Integration order

1. Land the foundation through the **established bootstrap route**. An earlier
   revision of this step named a scope-authorization bootstrap lane, UTV2-1887;
   no such lane, branch or PR exists, and the step is corrected here rather than
   carried. #1556 is keyed to `WORK-2026091001`, and `Merge Gate` on it fails
   with *"No issue ID found in PR branch or title. Cannot resolve authoritative
   tier."* — the gate resolves only tracker-keyed identifiers, and that surface
   is reserved. The foundation therefore reaches `main` as a **tracker-keyed
   lane carrying this reviewed head's diff**, whose tier `Merge Gate` resolves
   from its own manifest, with its own independent review and required CI; if
   the concurrency caps refuse that lane, the route is a
   `docs/governance/BOOTSTRAP_AUTHORIZATIONS.json` entry authorized by Griff and
   read from the base, as `merge-gate.yml` already does. The nine paths the
   trusted-base scope guard reports outside this lane's scope are the lane's own
   manifest and sync file plus the file-scope guard, the comment parser, their
   tests, the scope workflow and the return-review workflow namespace
   correction with its existing test file; the guard on `main` keys its
   lifecycle grant on `ISSUE_ID_PATTERN = /^UTV2-\d+$/`, so a `WORK-###` lane is
   granted no lifecycle paths, and a tracker-keyed replacement lane is granted
   them ordinarily. A `scope-override/v1` comment remains reserved to CODEOWNERS
   and is not authored here, and a non-required check being red is not treated
   as authorization. Independently review the exact head of #1556; no approval
   is asserted here, no history rewrite grants authority, and no required check
   or branch-protection setting changes.
2. Integrate #1556 through the existing serialized merge wrapper after required
   checks pass. Verify its merge is reachable from protected `main` and that
   `scripts/ops/tracker-independence/p0-workflow.cjs` exists at that exact SHA.
3. Resume this same supporting workstream through sanctioned lane tooling for the
   consumer follow-up. Apply the recorded patch with `git apply --check` followed
   by `git apply`; review any base drift before applying. Run the classifier and
   workflow regression tests, `pnpm verify`, and required CI. Obtain the follow-up's
   existing review and merge authorizations. Do not disable the old required check
   to make either phase pass.
4. Verify the installed workflow on a new ordinary task and an existing PR with
   stale Linear credentials; verify protected and unresolved classifications still
   refuse progression without the applicable evidence. Recover mission and active
   work in fresh and compacted sessions using repository state. Capture real merged
   workflow evidence before claiming tracker independence or closing this lane.

## Repo-minted execution is refused by local controls between the phases

Between phase 2 and phase 3 the installed consumer is still the narrow one, and
it *auto-passes* a `WORK-###` PR: the required `P0 Protocol` check concluded
`success` on this PR's own head in 10s (run `34599912852`). Three local controls
refuse repo-minted execution while that is true, and each one reads the
**installed trusted base**, never the working tree or a branch head:

- `evaluateRepoMintedP0Coverage` (`scripts/ops/shared.ts`) runs
  `git show origin/main:.github/workflows/p0-protocol.yml` and parses it: coverage
  is a live, non-ignorable step of the `P0 Protocol` job on a `pull_request`
  trigger whose comment-stripped body invokes
  `scripts/ops/tracker-independence/p0-workflow.cjs`, with the evaluator present
  at the same base commit. The review's mutation — appending a comment naming the
  evaluator to the narrow consumer — returns `covered: false`, as does the
  activation applied only on a branch. The receipt records the ref and commit.
- preflight check `PW1` fails on it at every tier, and `ops:lane-start` refuses a
  new repo-minted lane with `p0_consumer_not_activated` before any lease,
  worktree or manifest exists.
- the merge wrapper's `pre-merge-authorization` refuses a repo-minted head ref
  whose trusted-base coverage is absent, so a candidate manifest that already
  exists on a branch — which never passes admission again — is held to the same
  line on the sanctioned merge path.

These are **not** required-check enforcement, and this packet no longer claims
that admission is "a complete chokepoint" because `ops:lane-start` is the only
writer of the lane manifest: `merge-gate.yml` reads whatever manifest the
candidate head carries, and any committer can write one. The controls guarantee
that the repository's own admission tooling refuses to open or authorize a
repo-minted lane unless the consumer installed on `origin/main` contains a live
`actions/github-script` step in the `P0 Protocol` job that `require`s the
evaluator and calls `evaluatePullRequest` at statement level. A shell `run:`
never counts: the evaluator has no CLI entry point. Refused shapes the tests
enumerate (three review rounds): any shell form, comment-only references,
strings and multi-line template literals, nested `require`, a bare `require`
with no call, a shadowed or redefined entry point, a reassigned `let` binding,
a forked `actions/github-script-*` action, suffix paths, literal-false `if:`,
non-false `continue-on-error` at step or job level, `needs:` on a disabled or
absent job, an empty or any-`exclude` matrix, a duplicate `P0 Protocol` job,
candidate-only activation and existing candidate manifests. Not assessed:
JavaScript control flow, runtime `if:` expressions, `timeout-minutes`, and the
same check name reported by another workflow — none introducible by a WORK PR
author, since the predicate never reads candidate content. The foundation itself
reaches `main` through the bootstrap route in step 1 above, and the block
releases only when the activation is installed on the base — re-arming if a
later base commit removes the delegation. See
`docs/05_operations/P0_PROTOCOL_SPEC.md` § "The staged block is mechanical".

The old P0 consumer can still attempt Linear access during phase 1. If its check
cannot pass under its existing authority, that is a concrete bootstrap integration
dependency for the authorized integrator; this packet does not grant an exemption.
PRs #1491/#1492 are not prerequisites and their merge-authority redesign is excluded.
