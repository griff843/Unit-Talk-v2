# PROOF: WORK-2026111101

MERGE_SHA: pending merge

Issue: WORK-2026111101
Tier: T2
Lane type: governance
result: documentation plus one audit allow-list line, verified on `6b0ca0e4979605f1db95610fb1c1749caedaaf3b`; the provider-scope audit adds no new drift but does not exit 0, because `main` already carries 61 pre-existing drift hits outside this lane's scope (see Known gap)

## ASSERTIONS:

- [x] The A1 block sits directly after "Canonical Authority Statement" and reads "Ratified: 2026-11-11 by Griff". The SGO Pro integration reference table is byte-identical to `main`.
- [x] The draft's section 2 wording edits are applied to the canonical statement, its paragraph, the Fail-Closed Rule and "What Constitutes Stale Drift".
- [x] `PROGRAM_STATUS.md` carries the Provider row; `PROVIDER_DATA_DECISION_RECORD.md` carries the dated A1 entry with Griff's ratification, the PM recommendation, the rationale and the cost envelope.
- [x] `scripts/audit-provider-scope.ts` gains exactly one allow-list pattern. It matches no tracked path today (`git ls-files | grep -c` on the pattern text: 0), so it exempts nothing until an A1 game-score file is added.
- [x] This lane adds zero active-work drift: the sorted drift list at this head is identical to the list on `main` `a82fd3b16` (`diff` exit 0, 61 lines each).
- [ ] The audit does not exit 0. That acceptance criterion is not met on this branch, for the pre-existing reason below.

## EVIDENCE:

```text
$ tsx scripts/audit-provider-scope.ts        # on main a82fd3b16
Total ... references found: 133
  allowed-historical: 72
  active-work-drift:  61
exit 1

$ tsx scripts/audit-provider-scope.ts        # on this head 6b0ca0e49
Total ... references found: 142
  allowed-historical: 81
  active-work-drift:  61
exit 1

$ diff <(drift lines on main) <(drift lines on head)
exit 0 (identical)
```

The 9 new allowed-historical hits are in `PROVIDER_AUTHORITY_LOCK.md` (+3), `PROVIDER_DATA_DECISION_RECORD.md` (+4) and `audit-provider-scope.ts` (+2), all already allow-listed files.

The 61 pre-existing drift hits are in historical proof and lane files under `docs/06_status/proof/` and `docs/06_status/lanes/` (UTV2-1084, -1085, -1155, -1242, -1286, -1822, -698, -679, -915, -1002), `docs/06_status/audits/participant-system-audit.md`, four `docs/05_operations/` files and three `scripts/` files. None is in this lane's scope.

## Verification

Run on `6b0ca0e4979605f1db95610fb1c1749caedaaf3b`:

- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: `Verdict: PASS`, `Rules matched: (none)`.
- [x] `pnpm type-check`: exit 0.
- [x] `pnpm test`: exit 0. Summed `# pass 7909`, `# fail 0`, no `not ok` line.
- [x] `pnpm ops:preflight WORK-2026111101 --tier T2 ...`: verdict PASS.
- [ ] `tsx scripts/audit-provider-scope.ts`: exit 1, with no drift added by this lane (above).

## Known gap

The work order requires the audit to exit 0. `main` already fails it with 61 hits, so it cannot pass here without editing files outside this lane's scope or broadening the allow-list. Neither is done. Whether to accept A1 on a no-new-drift basis, or to clean the pre-existing drift first in a separate lane, is a decision for Griff or the PM.

## Runtime Verification

None applicable. No runtime, database, key, ingestion, workflow or deployment surface is touched.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
