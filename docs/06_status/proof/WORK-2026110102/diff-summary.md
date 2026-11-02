# Diff summary: WORK-2026110102

Source commit: `4856c23593c326059d920bcddb09b469c1fa1b63`

The operator pick detail now labels staff-canary and unrecognized/mismatched audiences using persisted pick and outbox pins. Legacy/member picks add no markup; their recap copy stays byte-identical.

| File | Change |
|---|---|
| `src/lib/data/queues.ts` | Add only `payload` to the detail outbox select and preserve its raw value in the response. |
| `src/lib/delivery-audience-label.ts` | Pure label resolver using shared audience helpers; explicit conflicting or invalid pins fail closed. |
| `src/components/GovernedPickTruth.tsx` | Render the conditional text label above submission truth. |
| `src/app/picks/[id]/page.tsx` | Pass existing outbox payloads to the label and shared visibility result to the settlement form. |
| `src/components/SettlementForm.tsx` | Supply that visibility to recap presentation. |
| `src/lib/human-capper-recap.ts` | Private/non-member outcomes name the private staff destination. |
| `src/lib/delivery-audience-label.test.ts` | Members/absence, all canary placements, unknown/non-string pins, malformed containers and disagreement. |
| `src/lib/human-capper-recap.test.ts` | Existing member copy plus private and fail-closed recap outcomes. |
| `src/lib/data/queues-governed-population.test.ts` | Exact select/filter/order and payload handoff; GET requests only. |

Paths in the table are relative to `apps/command-center/`. Eight tests were added and none removed. The page and settlement-form wiring are necessary within the packet's allowed `apps/command-center/**` scope. This proof updates only the four explicitly required proof files; pre-existing lane/sync metadata is retained.

No production writes, authorization change, query filter/order change, list population change, deployment, tracker completion, merge or lane finalization was performed.

## SHA Binding

Verified source SHA: 4856c23593c326059d920bcddb09b469c1fa1b63
Merge SHA: pending merge
PR: pending — Production Claude owns opening after staging capacity is free
