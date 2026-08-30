# UTV2-1745 — diff summary

MERGE_SHA: 149b60ee39eb662fe8c30757e7f1d8bbd7464814

## Files changed

| File | Lines | Purpose |
|---|---|---|
| `scripts/ops/pick-truth-audit.ts` | +1579 | Read-only retrospective audit of the production pick population. Uses its own `ReadOnlyPostgrestClient`, which exposes HTTP `GET` only and has no write method. Recomputes grades independently from `game_results.actual_value` against each pick's own line and selection side rather than trusting the stored `status`, only after proving the referenced `game_results` row belongs to the pick (P1-A), and resolves CLV against the canonical `provider_offer_history` with production's resolver semantics (P1-B). CLV failures are classified by named cause. |
| `scripts/ops/pick-truth-audit.test.ts` | +1044 | 23 tests. Original 4: selection parsing and independent grade recomputation across over/under/push; itemized grading disagreements, named CLV failures and structural blockers; `missing_closing_line` is not collapsed into `missing_event_context`; the production transport exposes only `GET` and no write method. P1-A (7): wrong-event / wrong-participant / incompatible-market referenced rows are each unresolvable under their own named reason, a proven triple recomputes, an event-level total with a legitimately null participant stays valid, plus a negative control proving the wrong-event row *would* have agreed without the check and a structural control proving pick-side identity never reads the referenced row. P1-B (7): canonical table identity, closing cutoff exclusion, latest-eligible selection, event-level null participant, participant-scoped matching, pinnacle-then-consensus preference, plus a negative control reverting the lookup to `provider_offers`. Cohort and report integrity (3): a settlement superseded by a later `corrects_id` is never an agreement, alias resolution is deterministic under `providerMarketKeyPriority`, and `read_only` is measured from the transport rather than asserted. P1-A hardening, isolated (2): the drift guard and market-identity conflict detection each get their own scenario, because the combined attack is blocked by either one alone. |
| `package.json` | +1 | Wires `scripts/ops/pick-truth-audit.test.ts` into `test:ops` so the suite actually executes under required `verify`. PM-authorized scope extension, recorded in the lane manifest's `scope_override` block. |
| `docs/06_status/lanes/UTV2-1745.json` | modified | Adds `package.json` to `file_scope_lock` plus the `scope_override` record. |
| `docs/06_status/proof/UTV2-1745/verification.md` | new | Proof bundle: verdict, assertions, live population evidence, findings. |
| `docs/06_status/proof/UTV2-1745/diff-summary.md` | new | This file. |
| `docs/06_status/proof/UTV2-1745/evidence.json` | new | Schema v2 evidence with SHA binding and live row counts. |
| `docs/06_status/proof/UTV2-1745/model-routing.json` | modified | Model routing record, bound to the merge SHA. |

## Design decisions, and what was deliberately not done

- **Read-only by construction, not by convention.** The audit's transport class
  has no write method at all, so it cannot issue a PostgREST mutation even if
  handed a service-role credential. `PickTruthAuditReport.read_only` is
  *measured* rather than asserted: it is derived from
  `ReadOnlyPostgrestClient.transportEvidence()`, a tally of the HTTP methods the
  client actually issued, so `database_writes_performed` counts non-GET requests
  instead of restating a hardcoded `0`. A literal cannot be falsified by a real
  write; a tally can.
- **Fail-closed target validation.** `parseCli` rejects any URL whose hostname is
  not `<project-ref>.supabase.co`, so a misconfigured environment cannot point
  the audit at an unintended database.
- **Independent regrade, not status trust.** Win/loss/push is derived from
  `game_results`, which is the only way a grading disagreement can be detected
  at all.
- **CLV failures are named, not collapsed.** A pick with event context but no
  closing offer is `missing_closing_line`; that distinction separates a data gap
  from a resolver bug, and collapsing it would have hidden the real cause.
- **P1-A — pick identity is established before the referenced row is used.**
  `buildPickIdentityContext` derives event, participant and market identity from
  the pick, its metadata, its `market_universe` provenance row, the canonical
  `events`/`participants` tables and `provider_market_aliases`. It takes no game
  result argument, so `gameResult.event_id` can no longer manufacture the
  identity it is then validated against. `validateGameResultIdentity` fails
  closed with `game_result_event_mismatch`,
  `game_result_participant_mismatch`, `game_result_market_mismatch` or
  `game_result_identity_unverifiable`; a wrong-but-real `game_results` id can
  never reach recomputation, so it can never be counted as an agreement.
- **P1-B — CLV reads the canonical production source.** `provider_offers` is the
  legacy/frozen surface. Production's resolver
  (`DatabaseProviderOfferRepository.findClosingLine`) reads
  `provider_offer_history`, and the audit now mirrors it filter-for-filter,
  including the `snapshot_at <= eventStartTime` closing cutoff, participant
  `eq`/`is null` semantics, `order snapshot_at desc limit 1` determinism, and
  `clv-service.ts`'s pinnacle-then-consensus preference with the
  `market_universe` fallback last. Mirroring rather than approximating is what
  keeps the audit from claiming CLV availability production would not have — or
  denying availability it would.
- **Production's drift guard and resolution order are ported, not approximated.**
  `isEventScopedTotalPick` reproduces `clv-service.ts` in full, including the
  guard that a `player_*` market, a `participant_id`, or player metadata
  disqualifies a game-total `market_type_id` from event scope — without it a
  drifted pick would be handed a null-participant `game_results` row and could
  still agree. Market identity candidates are narrowed to the pick-side provider
  key and the canonical key, and any additional non-aliasable claim fails closed
  as `game_result_identity_unverifiable`. On the CLV side, the `market_universe`
  provenance short-circuit runs *before* event context, cutoff and participant
  resolution exactly as production does, and the lookup key is resolved through
  the alias table only — never through pick metadata.
- **Every control was proven by making it fail.** Twelve mutations, each applied
  in isolation and reverted byte-exact, each turn at least one test red. An
  earlier round left two mutations surviving — removing the drift guard and
  removing conflict detection — because one combined scenario was blocked by
  either mechanism alone; two isolating tests were added to kill them. Presence
  and a green run prove nothing on their own.
- **The audit stayed read-only and self-contained.** Both corrections live
  entirely inside `scripts/ops/pick-truth-audit.ts`. Nothing under
  `packages/db/**`, `apps/api/**` or `supabase/migrations/**` is modified;
  production code is read as a reference only.
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
