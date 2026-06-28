# UTV2-1349 Diff Summary

## Change
Proof-only lane for M4 capper attribution evidence.

## Files
- `docs/06_status/proof/UTV2-1349/diff-summary.md` documents the proof scope and observed evidence.
- `docs/06_status/proof/UTV2-1349/verification.md` records verification commands and outcomes.

## Runtime Diff Under Proof
No runtime code changed in this lane.

The capper attribution runtime change is already present from UTV2-1346:

```text
apps/api/src/submission-service.ts:332: ...(payload.submittedBy ? { capper: payload.submittedBy } : {}),
apps/api/src/submission-service.ts:541: ...(payload.submittedBy ? { capper: payload.submittedBy } : {}),
```

This maps `payload.submittedBy` to `metadata.capper` in both primary and shadow submission paths. The smart-form payload builder already sends `submittedBy` from the selected capper:

```text
apps/smart-form/lib/form-utils.ts:306: submittedBy: values.capper,
```

## Live Data Note
The existing read-only live proof script `apps/api/src/scripts/utv2-1346-capper-attribution-proof.ts` did not complete because Supabase canceled its broad ordered smart-form query with statement timeout. Narrow read-only REST queries completed and showed historical smart-form rows containing `metadata.submittedBy`; no sampled row with `metadata.capper` was returned.

No live rows were created or mutated for this proof.
