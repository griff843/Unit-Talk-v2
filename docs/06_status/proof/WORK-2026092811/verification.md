# PROOF: WORK-2026092811

MERGE_SHA: pending merge

Issue: WORK-2026092811
Tier: T2
Lane type: governance
Branch: claude/work-2026092811-receipt-freshness
Head SHA: d9b27e5b10f645166c751d8d0303ab59f661c720
result: pass

## ASSERTIONS:

- [x] `newestDeliveredReceiptAt` (`scripts/ops/pipeline-health-classification.ts`) returns the newest
      `recorded_at` among `governed` and `control` receipts; `simulated` and `unrecognized` never count.
- [x] `pipeline-health.ts` passes that value to `evaluateQueueHealth` in place of the newest `sent`
      outbox row. An incomplete receipt read reports no delivery.
- [x] `newestGovernedReceiptByTarget` gives the per-target readout.
- [x] Scope: 3 files under `scripts/`. No runtime app, DB, delivery, containment or kill-switch change,
      and no production write.

## EVIDENCE:

### Tests

```
$ pnpm exec tsx --test scripts/ops/pipeline-health-classification.test.ts
# tests 35
# pass 35
# fail 0
```

### Mutation drill

Letting every receipt class count toward freshness turned 2 of the new tests red. With the file restored,
all 35 pass.

### Production read (read-only SQL, 2026-09-28)

Receipts in the last 30 days: `discord:official-picks`, 2, newest 2026-09-18 23:37:46Z. `sent` rows in
the last 30 days: 2, both with receipts, newest 2026-09-18 23:37:46Z. The two readers agree today; they
diverge only once a voided pick's row is marked `sent` without a receipt.

## Verification

- [x] `pnpm exec tsx --test scripts/ops/pipeline-health-classification.test.ts`: 35 pass, 0 fail
- [x] eslint on the three changed files: exit 0
- [x] esbuild parse of `scripts/pipeline-health.ts`: ok
- [x] Mutation drill: 2 tests red
- [x] `pnpm verify` passed in the required CI `verify` context on the merged head `cd844586bfd277ed414121ea52fac85e7eafcdf1` (run 36477702603).
- [x] `pnpm type-check` is included in that `pnpm verify` run and passed.
- [x] `pnpm test` is included in that `pnpm verify` run and passed.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base 3b071d9d6514cc9943a4e875371940337f38b600^ --head 3b071d9d6514cc9943a4e875371940337f38b600`: Verdict PASS, 8 changed files, no rule matched. Recorded after merge by WORK-2026092813.

## Runtime Verification

T2 static proof. The script is an operator monitor and is not run by this lane; the production read
above shows the input it will judge.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1684
Execution SHA: d9b27e5b10f645166c751d8d0303ab59f661c720
