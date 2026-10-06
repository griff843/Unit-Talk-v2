# Bounded review input for WORK-2026100603

These are parent review findings within the unchanged frozen work order. They do not
replace task authority or permit admission/product/workflow changes. Inspect the partial
four-file patch already preserved in the worktree; finish it rather than reproducing the
entire initial investigation. Do not run whole-file formatting or dump large diffs.

The prior closed epoch and real failed machine results are retained alongside this file.
An operator cancellation was recorded to load measured review findings before verification.
The existing cancellation path requires clearing closed state and a genuinely fresh dispatch;
no prior phase completion is to be imported or fabricated. Record every actually completed
new executor phase with --summary, including the pre-merge review-packet closeout phase.
Post-merge lane closure, truth-check, PM approval and merge remain separate pending duties.
Do not publish READY_FOR_REVIEW from the child; the outer mandatory verdict must pass first.

Required corrections to the initial patch:

1. Freeze authorization at ORIGINAL admission/first epoch baseline across rework. The
   current rework baseline is only for measuring NEW implementation changes. It cannot
   authorize a wider scope or new rehashed task contract from the rejected PR HEAD.
   A stable intermediate guard snapshot was tested with original scope scripts/**, a
   rejected HEAD injecting an external artifact scope and valid rehashed contract, then
   rework changing only that unassigned artifact. Expected fail-closed; actual intermediate
   result SUCCESS, source0/artifact1. Add the permanent negative regression and make it fail
   closed. Repro /tmp/work-2026100603-rework-authority-snapshot-repro.ts and its sibling JSON;
   intermediate source SHA256 a80b3bb86bdf2dea6f2df181e9caa4b9567bd1508af6398267de14dbaf133eb4.
2. Preserve canonical scope matching/normalization. Direct inspection confirms the canonical
   matchesLockPattern supports exact/directory/double-star semantics, not arbitrary single-star
   globs; do not broaden semantics. Inherited repaired-main source outside a proof-only lane's
   frozen scope cannot earn source implementation credit. Source and evidence counters differ.
3. Reject scalar/array JSON masquerading as evidence. Require real existing regular JSON
   object artifacts. Cosmetic ordering/whitespace must not earn credit; comparison must be
   deterministic. Missing/new/deleted/symlink/invalid artifacts stay rejected.
4. Exact criterion path matching must reject evidence.json.backup as authorization for
   evidence.json. Sentence-final punctuation after the actual path followed by whitespace
   may match. Add negative boundary coverage.
5. Keep the four-file implementation reviewable. Avoid unrelated formatting of unchanged
   declarations/tests; preserve all existing test names/semantics. The current clean partial
   patch removed earlier full-file formatting churn.

Run the focused suites and required pnpm verify, record containment deferral truthfully,
prepare a draft tier:T1 PR and evidence. Finish genuine executor phases and return for the
outer verdict/persistence. Final exact-HEAD protected staging/T1 CI and genuine human PM
merge approval remain required. Never manufacture approval or apply t1-approved yourself.
