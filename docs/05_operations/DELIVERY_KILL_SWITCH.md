# Delivery Kill Switch

**Status:** Active upon merge (T1 merge verdict = ratification, per CLAUDE.md verification table).
**Linear:** UTV2-1427
**Scope:** internal/canary control mechanism only. No member-visible activation under this lane; the AC's default-disable flip for `best-bets`/`trader-insights` is gated separately (see §5).

---

## 1. What this is

A live, DB-backed, no-code-deploy operational control distinct from the existing `enabled`/`rolloutPct` target registry (`PROMOTION_TARGET_REGISTRY_CONTRACT.md`). The registry answers "is this target configured to receive picks at all, and at what rollout percentage" — a deploy-time/restart-time decision. The kill switch answers "should the worker actually dequeue for this target right now" — an operational, staff-toggleable decision with no deploy in between.

## 2. Storage

Table: `delivery_kill_switch` (migration `20260714120000_add_delivery_kill_switch.sql`). One row per governed target (`best-bets`, `trader-insights`, `exclusive-insights`). `killed boolean NOT NULL DEFAULT true` — the column default and the application-layer default agree: **absence of a row, or any read error, means killed.**

**Bootstrap seed (migration `20260714130000_bootstrap_delivery_kill_switch_posture.sql`):** the table starts empty on creation, and fail-closed means every governed target with no row is treated as killed. Without a seed, deploying the worker's kill-switch check would have silently disabled delivery for every governed target on day one. The bootstrap migration seeds one row per target, derived from `packages/contracts/src/promotion.ts`'s `defaultTargetRegistry` (the canonical source of truth, not an assumption):

| Target | `defaultTargetRegistry.enabled` | Seeded `killed` |
|---|---|---|
| `best-bets` | `true` | `false` (currently delivering — posture preserved) |
| `trader-insights` | `true` | `false` (currently delivering — posture preserved) |
| `exclusive-insights` | `false` (`disabledReason: "Activation contract required before live delivery"`; also listed in `blockedDiscordTargets`) | `true` (not currently approved for delivery — posture preserved) |

Each seeded row's `actor` is `system-bootstrap` and `reason` documents this provenance, so it's distinguishable from a later operator toggle. This seed changes nothing about current production delivery — it makes the kill switch's *starting* state match what's already live, rather than leaving it to default-kill everything on deploy.

## 3. Read path (worker)

`apps/worker/src/runner.ts` checks `repositories.killSwitch.isKilled(promotionTarget)` for each governed target, immediately after the existing `isTargetEnabled` registry check and before claiming any outbox row. If killed, the cycle reports `status: 'kill-switch-engaged'` and does not claim — the row stays `pending` in the outbox, so releasing the switch resumes delivery with no replay step.

## 4. Write path (staff)

`POST /api/discord/kill-switch` — `operator`-role only (reuses the existing `ROUTE_ROLES` pattern in `apps/api/src/auth.ts`, same as `/api/picks/:id/override-promotion`). Body: `{ target, killed, actor, reason? }`. Every toggle writes an `audit_log` row (`action: 'discord_kill_switch.engaged'` or `'discord_kill_switch.released'`), reusing the existing `AuditLogRepository` — same shape as other operator interventions.

`GET /api/discord/kill-switch` — `operator`-role only (this is an internal delivery control surface exposing target state, actor, reason, and timestamps — not a public status endpoint), lists current state for all targets.

Command Center surfaces the same state at `/operations/discord` (`KillSwitchPanel`), reading directly from Supabase (matching this app's existing read pattern) and writing through the API route above (matching this app's existing write pattern) — never a direct DB write from the frontend.

## 5. The one production-consequential action in this lane

This lane does **not** flip `best-bets`/`trader-insights` from their current `enabled: true` default in `packages/contracts/src/promotion.ts` — that flip is a separate, real, live change to current public Discord delivery, deliberately not bundled here, and would require its own standard T1 merge verdict as its gate.

The kill-switch's own bootstrap seed (§2) is a different thing: it does not change what's approved for delivery, it makes the kill switch's starting state match the registry's existing posture instead of silently disabling everything via fail-closed defaults on an empty table. An earlier version of this lane shipped the kill-switch table with no seed rows at all — which, combined with the fail-closed default, would have silently disabled all governed delivery on deploy despite this section's original claim of "no production-consequential default state." That gap was found via the lane's own live-DB proof test and is fixed by the bootstrap migration in §2, landed through the normal PR-governed migration path (not a manual production write).

## 6. Ops alert webhook

`UNIT_TALK_OPS_ALERT_WEBHOOK_URL` previously dropped alerts silently when unset. `apps/api/src/routes/health.ts` now reports `degraded` (HTTP 503) when the var is unset in a production-like environment (same condition as `packages/config`'s `isProductionLikeRuntime`: `UNIT_TALK_APP_ENV === 'production'|'staging'` or `NODE_ENV === 'production'` — local dev, CI, and unit tests are unaffected), with an explicit warning in the health response — matching the "health-check failure" option in this lane's acceptance criteria (a hard process-crash was the other option; a fail-loud health signal was chosen to avoid taking the whole API down over a monitoring gap).

## 7. Explicitly out of scope

- The existing `awaiting_approval` governance brake is untouched — this is additive.
- No new alerting infrastructure (on-call rotation, PagerDuty-equivalent) — tracked separately under UTV2-1448/UTV2-1499.
- No public/member-visible activation of any kind.

## 8. The first controlled `official-picks` release

**Added 2026-09-29. Prepared procedure, not a grant.** Releasing any governed target is
member-delivery activation, which `docs/mission/intent.md` reserves to Griff (`docs/mission/plan.md`
decisions 13 and 14). This section states what must be true, the exact sequence, and how to contain
a deviation. It authorizes nothing.

The goal of the first release is **exactly one** intended message in the paying-member channel:
one fresh, intentionally delivery-eligible pick, one Discord post, one receipt, and no recap, no
Track Only pick, no fixture and no duplicate.

### 8.1 Posture on 2026-09-29 (read-only production SELECT)

§2's bootstrap table records the July seed, not today. Today every governed target is killed:

| Control | `killed` | Last set by | When |
|---|---|---|---|
| `official-picks` | true | `claude:human-capper-e2e-window-close` | 2026-09-19 02:24Z |
| `best-bets` | true | `claude-session-utv2-1601-containment` | 2026-08-01 |
| `trader-insights` | true | `claude-session-utv2-1601-containment` | 2026-08-01 |
| `exclusive-insights` | true | `system-bootstrap` | 2026-07-14 |
| `human-capper-recaps` | *no row* — reads as **killed** (fail closed) | — | — |

A fixture row, `t1-proof-utv2-1427-kill-switch`, is `killed = false`. It names no delivery target
and the worker never reads it. It is not a release.

`discord:official-picks` outbox on 2026-09-29: `684ba33f` and `3447bb03` are `sent` with one receipt
each (picks `816a84c7` settled and `ed0ed43c` posted, 2026-09-18). `68f922a2` and `5005f461` are
`pending` for the two **voided** sample picks `2cc92f4b` and `c12f1e2f`; they are deliberately left
in place and must not be touched.

### 8.2 What the release depends on

The first release is permitted only on a deployed release that contains every item below. A merged
fix is not a running fix: confirm the SHA of the newest successful `Deploy` run contains it.

| Control | What it does | Where |
|---|---|---|
| **Dispatch ledger** | Before every `official-picks` POST the worker records `distribution.dispatch_started` on the outbox row; after it, `dispatch_delivered` (with the receipt), `dispatch_not_created`, or nothing when the outcome is unknown. A row with an unresolved started attempt is **dead-lettered, never posted again**. A row whose ledger says delivered is confirmed from the recorded receipt **without posting**. A row with a `sent` receipt is refused. | `apps/worker/src/distribution-worker.ts`, `packages/contracts/src/dispatch-ledger.ts` (WORK-2026092901) |
| **Discord nonce** | Every post carries `nonce` (from the outbox id) and `enforce_nonce: true`. Defence in depth under the ledger; Discord's window is minutes. | `apps/worker/src/delivery-adapters.ts` |
| **Official-pick presentation** | Footer `Unit Talk \| Official Picks`; Market, Odds, Units, Capper, Game Time, Thesis. No Canary footer, no Confidence / Edge / CLV. | `apps/worker/src/delivery-adapters.ts` |
| **Recap control** | Human-capper recap traffic (settlement recaps from settle and from automated grading, and the daily / weekly / monthly aggregate) is stopped unless **both** `official-picks` **and** `human-capper-recaps` are released. Releasing `official-picks` alone releases no recap. | `apps/api/src/human-capper-recap-gate.ts` |
| **Release reason** | `POST /api/discord/kill-switch` refuses a release (`killed: false`) without a non-empty `reason` (`400 REASON_REQUIRED`). Engaging is always allowed. | `apps/api/src/routes/kill-switch.ts` |
| **Retry guard** | `POST /api/picks/:id/retry-delivery` refuses `409 ALREADY_DELIVERED` when a sent receipt or a delivered ledger entry exists, and `409 DELIVERY_OUTCOME_AMBIGUOUS` for an unresolved attempt unless the operator attests `confirmedNotDelivered: true` (recorded as `distribution.dispatch_reconciled`). | `apps/api/src/controllers/retry-delivery-controller.ts` |
| **Replay excluded** | The worker replay CLI accepts only `discord:canary` / `discord:best-bets`; `official-picks` cannot be replayed. | `apps/worker/src/replay-failed-delivery.ts` |
| **Member pick truth** | `/live` and `/today` read `GET /api/member/picks`, which returns only `posted` / `settled` picks with `distributionMode: delivery-eligible` **and** an `authorized` delivery decision — never Track Only, fixtures or queued picks. | `apps/api/src/routes/member-picks.ts` |
| **Receipt-based freshness** | Delivery freshness is read from `distribution_receipts`, so the two skipped voided rows cannot read as deliveries. | `scripts/pipeline-health.ts` (WORK-2026092708, on `main`) |
| **Command Center stage** | A delivered pick reads "Delivered", a voided one "Voided", never "Delivery held". | `apps/command-center` (WORK-2026092902) |

**Do not use replay or retry during the first release.** Both exist for recovery, not for
delivery. If the first release needs either, it has already deviated — contain (§8.5) instead.

### 8.3 Pre-flight (all read-only; every item verified live, not recalled)

1. **Deployed code.** The newest successful `Deploy` run's SHA contains §8.2. Its
   `syndicate_machine_mode.confirmed` line reads `human-capper` with one enabled target.
2. **Baseline.** Every row of §8.1 is as stated: `official-picks` killed, `human-capper-recaps`
   absent or killed, the other three killed.
3. **Backlog.** Enumerate every `pending` or `processing` row for `discord:official-picks` with
   its pick's status. **Every such row is claimed the moment the switch is released** — the switch
   holds rows, it does not discard them (§3).
   - A row whose pick is `voided` or `settled` does not post: the worker marks it `sent`, with no
     receipt and a `distribution.skipped` audit row. Expected: `68f922a2`, `5005f461`.
   - Any other row **will post**. There must be none other than the one intended pick.
4. **Ledger baseline.** No `distribution.dispatch_%` audit rows exist for any
   `discord:official-picks` row yet. Record the count (expected 0).
5. **Member route.** `GET /api/member/picks?status=posted,settled` returns only `ed0ed43c` and
   `816a84c7` — no Track Only pick (e.g. `92789b58`), no fixture.

### 8.4 The sequence

1. **Kill-switch baseline** — §8.3 item 2, re-read immediately before step 2.
2. **One fresh intentional pick.** Griff submits one real pick through the deployed Smart Form as an
   allow-listed capper, choosing delivery. With `official-picks` killed the pick is released to
   `queued` with one `pending` outbox row, and the worker holds it (`kill-switch-engaged`). Confirm
   exactly one new `pending` row and its pick's `deliveryAuthorization.decision = authorized`.
3. **Un-kill `official-picks` only**, through Command Center `/operations/discord` or
   `POST /api/discord/kill-switch` with `{ target: "official-picks", killed: false, actor, reason }`.
   **Do not release `human-capper-recaps`.** Confirm the `discord_kill_switch.released` audit row.
4. **Observe exactly one post and one receipt**, within a few worker cycles:
   - one message in the channel, with the official-pick footer, Units, and no Canary;
   - for the new outbox row: status `sent`, exactly one `distribution_receipts` row, exactly one
     `dispatch_started` and one `dispatch_delivered` audit row, both attempt 1;
   - `68f922a2` and `5005f461` now `sent` with **no receipt** and a `distribution.skipped` row;
   - no recap message, and no `recaps` outbox row;
   - the pick `posted`, and present in `GET /api/member/picks`.
5. **Re-kill.** Engage `official-picks` again with a reason, whatever the outcome, unless Griff has
   decided to leave it released. The first release is a watched window, not a standing release.

### 8.5 Containment and rollback

**If anything deviates — a second message, an unexpected message, a recap, a missing receipt, a
dead-lettered row — re-engage `official-picks` first, investigate second.**

- **Re-engaging stops new claims only.** A row already claimed finishes its current attempt. Rows
  stay `pending` behind the switch; nothing is discarded.
- **A dead-lettered row with `distribution.dispatch_ambiguous`** means the worker could not prove
  the message was not posted — a timeout, a 5xx, a crash, or a failure before confirm. This is the
  intended fail-closed behaviour, not a bug. Check the channel:
  - **the message exists** → do not retry. The member saw the pick. Record the gap; the missing
    receipt is the only defect.
  - **no message exists** → only then retry with `confirmedNotDelivered: true` and a reason. The
    attestation is audited as `distribution.dispatch_reconciled`.
- **A pre-network adapter failure** (missing token, destination guard) also leaves an unresolved
  attempt and dead-letters the row on the next claim. Same handling.
- **A duplicate Discord message** is removed in Discord by the operator. Nothing in the database is
  deleted; the receipt and ledger rows are the record of what happened.
- **A recap that posted** means `human-capper-recaps` was released or the deployed code predates
  §8.2. Engage `human-capper-recaps` and `official-picks`.
- **Code rollback** is a deploy of an earlier SHA. Dispatching a deploy is Griff's. A rollback to a
  release older than §8.2 removes the ledger and the recap control; do it only with every governed
  control engaged.
