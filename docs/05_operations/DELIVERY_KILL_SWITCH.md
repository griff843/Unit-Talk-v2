# Delivery Kill Switch

**Status:** Active upon merge (T1 merge verdict = ratification, per CLAUDE.md verification table).
**Linear:** UTV2-1427
**Scope:** internal/canary control mechanism only. No member-visible activation under this lane; the AC's default-disable flip for `best-bets`/`trader-insights` is gated separately (see §5).

---

## 1. What this is

A live, DB-backed, no-code-deploy operational control distinct from the existing `enabled`/`rolloutPct` target registry (`PROMOTION_TARGET_REGISTRY_CONTRACT.md`). The registry answers "is this target configured to receive picks at all, and at what rollout percentage" — a deploy-time/restart-time decision. The kill switch answers "should the worker actually dequeue for this target right now" — an operational, staff-toggleable decision with no deploy in between.

## 2. Storage

Table: `delivery_kill_switch` (migration `20260714120000_add_delivery_kill_switch.sql`). One row per governed target (`best-bets`, `trader-insights`, `exclusive-insights`). `killed boolean NOT NULL DEFAULT true` — the column default and the application-layer default agree: **absence of a row, or any read error, means killed.**

## 3. Read path (worker)

`apps/worker/src/runner.ts` checks `repositories.killSwitch.isKilled(promotionTarget)` for each governed target, immediately after the existing `isTargetEnabled` registry check and before claiming any outbox row. If killed, the cycle reports `status: 'kill-switch-engaged'` and does not claim — the row stays `pending` in the outbox, so releasing the switch resumes delivery with no replay step.

## 4. Write path (staff)

`POST /api/discord/kill-switch` — `operator`-role only (reuses the existing `ROUTE_ROLES` pattern in `apps/api/src/auth.ts`, same as `/api/picks/:id/override-promotion`). Body: `{ target, killed, actor, reason? }`. Every toggle writes an `audit_log` row (`action: 'discord_kill_switch.engaged'` or `'discord_kill_switch.released'`), reusing the existing `AuditLogRepository` — same shape as other operator interventions.

`GET /api/discord/kill-switch` — unauthenticated read (matches this codebase's convention for other GET status routes), lists current state for all targets.

Command Center surfaces the same state at `/operations/discord` (`KillSwitchPanel`), reading directly from Supabase (matching this app's existing read pattern) and writing through the API route above (matching this app's existing write pattern) — never a direct DB write from the frontend.

## 5. The one production-consequential action in this lane

Building the mechanism above does **not** require flipping `best-bets`/`trader-insights` from their current `enabled: true` default in `packages/contracts/src/promotion.ts`. That flip is a real, live change to current public Discord delivery and is deliberately **not** included in this lane's default state — it requires the standard T1 merge verdict (`t1-approved` label + `pm-verdict/v1` APPROVED) as its gate, not a pre-approval baked into this document. See the UTV2-1427 Linear thread for the explicit call-out.

## 6. Ops alert webhook

`UNIT_TALK_OPS_ALERT_WEBHOOK_URL` previously dropped alerts silently when unset. `apps/api/src/routes/health.ts` now reports `degraded` (HTTP 503) when the var is unset in a production-like environment (same condition as `packages/config`'s `isProductionLikeRuntime`: `UNIT_TALK_APP_ENV === 'production'|'staging'` or `NODE_ENV === 'production'` — local dev, CI, and unit tests are unaffected), with an explicit warning in the health response — matching the "health-check failure" option in this lane's acceptance criteria (a hard process-crash was the other option; a fail-loud health signal was chosen to avoid taking the whole API down over a monitoring gap).

## 7. Explicitly out of scope

- The existing `awaiting_approval` governance brake is untouched — this is additive.
- No new alerting infrastructure (on-call rotation, PagerDuty-equivalent) — tracked separately under UTV2-1448/UTV2-1499.
- No public/member-visible activation of any kind.
