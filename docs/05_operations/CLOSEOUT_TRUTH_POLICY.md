# Closeout Truth Policy

Implementation lanes may move to Done only after deterministic closeout truth passes.

Required closeout semantics:

- Linear Done requires a merged PR SHA.
- Completed implementation work requires `manifest.commit_sha`.
- PR merge SHA, manifest commit SHA, and proof SHA binding must agree.
- Proof artifacts must reference the merge SHA or PR head SHA required by the lane.
- Runtime-proof lanes require live/runtime evidence such as queries, row counts, or receipts; narrative-only proof is not sufficient.
- Migration lanes may merge with an exact, receipt-backed `PENDING_POST_DEPLOY` production-parity
  obligation after their governed non-production candidate proof passes. They may not close with
  that marker: after sanctioned deployment, production Live Schema Parity must be an actual
  `PASS` with exact run/job ids. Missing, failed, skipped, malformed, or still-pending parity
  refuses closeout.
- Merged PR, manifest, proof, and Linear state may differ only inside the allowed transition window. Drift beyond that window must be reported and fail closeout.
- Closeout tooling must report missing merge SHA or missing proof truth. It must not silently repair the state and mark Done.

The deterministic implementation lives in `scripts/ops/truth-check-lib.ts` as the closeout truth gate (`C1` through `C7`) and is invoked by `ops:truth-check` / `ops:lane-close`.
