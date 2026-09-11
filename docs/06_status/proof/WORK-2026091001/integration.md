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

1. Land the scope-authorization bootstrap (UTV2-1887) on protected `main`
   first, then resync #1556. The nine paths the trusted-base guard reports
   outside scope are the lane's own manifest and sync file plus the file-scope
   guard, the comment parser, their tests, the scope workflow and the
   return-review workflow namespace correction with its existing test file.
   They are resolved through the supported bootstrap route rather than through a
   self-authored override: the guard on `main` keys its lane-lifecycle scope
   grant on `ISSUE_ID_PATTERN = /^UTV2-\d+$/`, so a `WORK-###` lane is granted
   no lifecycle paths at all, and the change that would fix that is inside the
   PR being evaluated. UTV2-1887 carries those seven paths byte-identical to
   this lane's versions; once they are on `main` the resync drops them from this
   diff and the lifecycle grant admits the remaining two. A `scope-override/v1`
   comment remains reserved to CODEOWNERS and is not authored here, and a
   non-required check being red is not treated as authorization. Independently
   review the corrected exact head of #1556 and satisfy its existing T1 Merge
   Gate and exact-head scope controls. No approval is asserted here. The original
   admission scope is retained; no history rewrite grants authority.
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

## Repo-minted execution is mechanically blocked between the phases

Between phase 2 and phase 3 the installed consumer is still the narrow one, and
it *auto-passes* a `WORK-###` PR: the required `P0 Protocol` check concluded
`success` on this PR's own head in 10s (run `34599912852`). That window is closed
in code, not by a condition attached to a verdict:
`evaluateRepoMintedP0Coverage` (`scripts/ops/shared.ts`) reads the installed
consumer, preflight check `PW1` fails on it at every tier, and `ops:lane-start`
refuses a repo-minted identity with `p0_consumer_not_activated` before any lease,
worktree or manifest exists. The refusal is at admission rather than in a required
check because an activation-predicated required check would refuse this very PR —
the foundation whose base lacks the evaluator. Admission is a complete chokepoint:
`merge-gate.yml` resolves tier from `docs/06_status/lanes/<ID>.json`, and
`ops:lane-start` is its only writer. The block releases itself when the patch in
this directory lands, and re-arms if the delegation is removed. See
`docs/05_operations/P0_PROTOCOL_SPEC.md` § "The staged block is mechanical".

The old P0 consumer can still attempt Linear access during phase 1. If its check
cannot pass under its existing authority, that is a concrete bootstrap integration
dependency for the authorized integrator; this packet does not grant an exemption.
PRs #1491/#1492 are not prerequisites and their merge-authority redesign is excluded.
