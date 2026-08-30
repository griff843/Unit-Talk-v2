# UTV2-1745 — diff summary

MERGE_SHA: 149b60ee39eb662fe8c30757e7f1d8bbd7464814

## Files changed

| File | Lines | Purpose |
|---|---|---|
| `scripts/ops/pick-truth-audit.ts` | +1105 | Read-only retrospective audit of the production pick population. Uses its own `ReadOnlyPostgrestClient`, which exposes HTTP `GET` only and has no write method. Recomputes grades independently from `game_results.actual_value` against each pick's own line and selection side rather than trusting the stored `status`, and classifies CLV failures by named cause (`missing_event_context` vs `missing_closing_line`). |
| `scripts/ops/pick-truth-audit.test.ts` | +270 | 4 tests: selection parsing and independent grade recomputation across over/under/push; itemized grading disagreements, named CLV failures and structural blockers; `missing_closing_line` is not collapsed into `missing_event_context`; the production transport exposes only `GET` and no write method. |
| `package.json` | +1 | Wires `scripts/ops/pick-truth-audit.test.ts` into `test:ops` so the suite actually executes under required `verify`. PM-authorized scope extension, recorded in the lane manifest's `scope_override` block. |
| `docs/06_status/lanes/UTV2-1745.json` | modified | Adds `package.json` to `file_scope_lock` plus the `scope_override` record. |
| `docs/06_status/proof/UTV2-1745/verification.md` | new | Proof bundle: verdict, assertions, live population evidence, findings. |
| `docs/06_status/proof/UTV2-1745/diff-summary.md` | new | This file. |
| `docs/06_status/proof/UTV2-1745/evidence.json` | new | Schema v2 evidence with SHA binding and live row counts. |
| `docs/06_status/proof/UTV2-1745/model-routing.json` | modified | Model routing record, bound to the merge SHA. |

## Design decisions, and what was deliberately not done

- **Read-only by construction, not by convention.** The audit's transport class
  has no write method at all, so it cannot issue a PostgREST mutation even if
  handed a service-role credential. `PickTruthAuditReport.read_only` is typed
  with the literals `database_writes_performed: 0`,
  `write_method_reachable: false`, and `transport_method: 'GET'`, so relaxing
  any of them fails type-check rather than silently changing the contract.
- **Fail-closed target validation.** `parseCli` rejects any URL whose hostname is
  not `<project-ref>.supabase.co`, so a misconfigured environment cannot point
  the audit at an unintended database.
- **Independent regrade, not status trust.** Win/loss/push is derived from
  `game_results`, which is the only way a grading disagreement can be detected
  at all.
- **CLV failures are named, not collapsed.** A pick with event context but no
  closing offer is `missing_closing_line`; that distinction separates a data gap
  from a resolver bug, and collapsing it would have hidden the real cause.
- **No remediation of any kind.** No regrade write, backfill, CLV persistence,
  replay, production mutation, or schema change. The 107,858 historical picks
  are not repaired and must not be represented as trustworthy.
- **Forward-flow trustworthiness is out of scope.** It is a separate successor
  and requires explicit event identity, participant identity, standardized
  selection, line and source provenance, settlement traceability, and
  closing-line capture as first-class admission-time fields.

## Blast radius

None. Merging this PR adds a read-only script and its tests. No production
mutation is performed or enabled, and no runtime path changes.

## Main synchronization (2026-08-30)

Merge commit `149b60ee39eb662fe8c30757e7f1d8bbd7464814` merges
`origin/main` (`e9f62e5e164edd861606334d479eb4c7ef1762f3`) into this lane.

| File | Change | Purpose |
|---|---|---|
| `package.json` | 1 line | Sole conflict. Resolved to current main's complete `scripts.test:ops` (130 entries, incl. `scripts/ops/outbox-triage.test.ts` from UTV2-1744) plus this lane's `scripts/ops/pick-truth-audit.test.ts` = 131 entries. Nothing removed. |

The merge's combined diff contains that one file and nothing else: no content
inherited from `main` was re-authored, and no other lane's proof bundle was
touched. Proof artifacts were re-anchored to the merge commit
(`verified_source_sha` `daad7b00` -> `149b60ee`) and `sha_binding.merge_sha`
remains `null` pre-merge. Production counts from the 2026-08-26 read-only
measurement are unchanged.
