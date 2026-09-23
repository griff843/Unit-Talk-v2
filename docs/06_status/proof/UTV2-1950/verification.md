# PROOF: UTV2-1950

MERGE_SHA: pending merge
Execution SHA: 81db253d5cf649be721753c1e8df70d4b2a1f70e

Re-anchored after merge. The verification below was executed at `522ef1cc1` on
`codex/utv2-1950-command-center-recovery`; #1624 squash-merged that branch, so
`522ef1cc1` is in no history and a validator comparing it to any current ref
reports `diverged`. `81db253d5` is the squash commit and carries the same tree.

Command Center recovery, readmitted as a `delivery-ui` T2 lane scoped to
`apps/command-center/**`. This is a recovery checkpoint plus the review/held queue
repair, not full Command Center launch acceptance. Remaining launch work is enumerated
in HANDOFF.md and is deliberately not claimed here.

## Verification

ASSERTIONS:
- [x] Ordinary browser sign-in and session refusal/logout are exercised without injected credentials.
- [x] Governed pick detail and operator counts reconcile with scoped source data.
- [x] Performance resolves complete immutable settlement chains before aggregation.
- [x] Recap outcomes preserve per-pick provenance and uncertainty instead of inferring historical publication.
- [x] Provider telemetry labels source windows and distinguishes stored offers from requests.
- [x] The review and held queues take their exact count from the same population they render, with the governed/fixture partition pushed into the query rather than applied after the page.
- [x] The regression guard for that partition was mutation-tested: removing either push-down fails it.

EVIDENCE:
```text
pnpm test:command-center: 659 passed, 0 failed, 0 skipped
pnpm type-check: exit 0
pnpm build: exit 0
Review queue partition mutation drill: 2 fail on removal, 2 pass on restore
Production reconciliation: governed_total=8, governed_in_review=0, governed_held=0
Route latency: /review 9.9s -> 0.56s, /held 10.0s -> 0.48s
scripts/ci/r-level-check.ts --head 81db253d5 --base 81db253d5^: Verdict PASS, 115 changed files, rules matched operator-ui
```

The route latencies and the production reconciliation are local read-only measurements
against production data through a diagnostic proxy. They do not establish deployed
performance, and no production write, deployment, ingestion activation, kill-switch
change or member-facing delivery was performed by this lane. The full working/verified
Command Center goal remains incomplete; HANDOFF.md lists the concrete continuation work.

13 runtime/deploy files carried on this branch at `716b698fb` were reverted in
`b09afe0b1` and are preserved for a sibling `runtime` lane — see diff-summary.md.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1624
