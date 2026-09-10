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

1. Independently review the corrected exact head of #1556. Satisfy its existing
   T1 Merge Gate and exact-head scope controls. No approval is asserted here.
   The scope override must name the existing lane's own manifest and sync file,
   plus the file-scope guard, comment parser, their tests, scope workflow and
   return-review workflow namespace correction.
   The original admission scope is retained; no history rewrite grants authority.
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

The old P0 consumer can still attempt Linear access during phase 1. If its check
cannot pass under its existing authority, that is a concrete bootstrap integration
dependency for the authorized integrator; this packet does not grant an exemption.
PRs #1491/#1492 are not prerequisites and their merge-authority redesign is excluded.
