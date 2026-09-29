# Diff summary: WORK-2026092901

Official-picks first controlled release: exactly-once delivery, a server-side member pick route,
the official-pick presentation, and a separate recap control. No migration, no kill switch, no
containment setting and no deploy is touched.

| File | Change |
|---|---|
| `packages/contracts/src/dispatch-ledger.ts` (new) | Dispatch ledger vocabulary and reader: `distribution.dispatch_started` / `_not_created` / `_delivered` / `_reconciled` / `_ambiguous` audit actions, and the resolution of an attempt history into `clear`, `delivered`, `unresolved` or `malformed`. |
| `packages/contracts/src/distribution.ts`, `promotion.ts`, `index.ts` | Export the ledger; `humanCapperRecapControl` (`human-capper-recaps`) and `deliveryControlKeys` (delivery targets plus the recap control). |
| `packages/contracts/src/smart-form.ts` | `isMemberVisibleOfficialPick`: `posted`/`settled`, `delivery-eligible`, and a strictly-read `authorized` delivery decision. |
| `packages/db/src/repositories.ts`, `runtime-repositories.ts` | `picks.listMemberVisibleOfficialPicks` (query narrowing plus the contract predicate as authority); `audit.listByEntity` (ordered, refuses a possibly truncated read). |
| `apps/worker/src/distribution-worker.ts` | Human-delivery targets dispatch under the ledger: a sent receipt refuses; an unresolved attempt dead-letters and never posts again; a `delivered` attempt confirms with no POST; `started` is written before the POST. |
| `apps/worker/src/delivery-adapters.ts` | Dispatch outcomes `not-sent` / `rejected` / `ambiguous` / `delivered`; every Discord post carries `nonce` + `enforce_nonce: true`; the official-picks embed (footer "Unit Talk \| Official Picks"; Market, Odds, Units, Capper, Game Time, Thesis). |
| `apps/api/src/routes/member-picks.ts` (new), `routes/index.ts`, `server.ts` | `GET /api/member/picks`: only member-visible official picks, member-safe metadata projection. |
| `apps/api/src/controllers/retry-delivery-controller.ts`, `routes/picks.ts` | Retry refuses `ALREADY_DELIVERED`, `DELIVERY_OUTCOME_AMBIGUOUS` (unless an audited `confirmedNotDelivered`) and `DISPATCH_LEDGER_MALFORMED` with 409; an unreadable ledger is 503. |
| `apps/api/src/human-capper-recap-gate.ts` (new), `recap-service.ts`, `settle-pick-controller.ts`, `grading-service.ts` | Recaps about human-capper picks need both `official-picks` and `human-capper-recaps` released; a missing row is killed. Covers the settle path, the previously ungated automated-grading path and the daily/weekly/monthly aggregates. |
| `apps/api/src/routes/kill-switch.ts` | Accepts `deliveryControlKeys`; a release requires a non-empty reason. |
| Tests (new): `official-picks-exactly-once.test.ts` (23), `official-picks-embed.test.ts` (7), `dispatch-ledger.test.ts` (10), `member-picks.test.ts` (10), `official-picks-release-controls.test.ts` (18); `replay-failed-delivery.test.ts` (+2 pins) | Behavior and failure-mode tests, including the double-post window. |
| `apps/api/src/t1-proof-work-2026092802-track-only-intent-live.test.ts` | Two read-only live cases added to the existing, already-classified Track Only live proof: the member read returns only member-visible picks and never that run's own Track Only or queued fixtures; the ledger read works with its prefix filter. Runs under `test:t1-proof:live` against staging. |
| `package.json` | Registers the new tests. |
| `apps/api/src/t1-proof-utv2-1923-human-capper-delivery.test.ts` | Two existing tests pinned the old rule that releasing `official-picks` alone releases recaps. Their "released" state now releases both `official-picks` and `human-capper-recaps`, which keeps each test's intent under the new gate. No assertion is weakened, and the "stopped" tests are unchanged. |

Out of scope, recorded as follow-ups: the Discord bot's `/live` and `/today` switching to
`/api/member/picks` (`apps/discord-bot/**` is file-scope-locked by another open lane), and listing
the recap control in Command Center's kill-switch panel.

## SHA Binding

Merge SHA: pending merge
PR: pending
