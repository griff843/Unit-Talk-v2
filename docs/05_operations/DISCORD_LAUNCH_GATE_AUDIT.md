# Discord Launch Gate Audit — Unit Talk V2

**Version:** 1.0  
**Authority:** UTV2-1319 (PM-authorized audit-only)  
**Date:** 2026-06-25  
**Status:** AUDIT COMPLETE — action items identified  
**Cross-reference:** `docs/05_operations/LAUNCH_GATE_DEFINITION.md` (UTV2-1318)

---

## Audit Scope

This audit covers the current state of Discord delivery infrastructure, channel routing, governance brake enforcement, canary/public target gating, bot configuration, and claim discipline readiness as of Production Readiness GREEN (2026-06-25).

**This audit does not authorize:** public Discord activation, target expansion, customer-facing launch, P-state changes, CLV/ROI/edge claims, or any delivery beyond current governance-brake-held state.

---

## 1. Discord Bot Infrastructure

### 1.1 Bot Deployment

| Item | Status | Evidence |
|---|---|---|
| Discord bot container in `docker-compose.prod.yml` | ✅ PRESENT | `discord-bot` service, `unit-talk/discord-bot:${DISCORD_BOT_IMAGE_TAG:-latest}` |
| `DISCORD_BOT_TOKEN` configured | ✅ OPTIONAL env (deploy secrets) | `packages/config/src/env.ts` |
| `DISCORD_GUILD_ID` configured | ✅ OPTIONAL env (deploy secrets) | `packages/config/src/env.ts` |
| Role IDs configured (capper, VIP, VIP+, trial, operator) | ✅ IN CONFIG | `apps/discord-bot/src/config.ts` |
| Channel IDs configured (capperChannelId, QA channels) | ✅ IN CONFIG | `apps/discord-bot/src/config.ts` — QaChannelMap defines freePicks, vipPicks, vipPlusPicks, recap, adminOps |

### 1.2 Bot Commands Inventory

| Command | Status | Notes |
|---|---|---|
| `/pick` | PRESENT | Pick delivery via slash command |
| `/recap` | PRESENT | Settlement/CLV recap |
| `/live` | PRESENT | Live game updates |
| `/today` | PRESENT | Day's picks |
| `/stats` | PRESENT | Performance stats |
| `/leaderboard` | PRESENT | Leaderboard |
| `/trial-status` | PRESENT | Trial member status |
| `/alerts-setup` | PRESENT | Alert configuration |

**Audit note:** Commands exist and are functional. No command should present CLV/edge/ROI claims until P3 certifies. `/recap` likely touches CLV fields — pre-launch review of recap output is required before public enablement.

---

## 2. Delivery Target Architecture

### 2.1 Promotion Targets (Public Channels)

The target registry is defined in `packages/contracts/src/promotion.ts`:

| Target | Default Enabled | Status | Notes |
|---|---|---|---|
| `discord:best-bets` | **true** | 🔴 GOVERNANCE HELD | All rows `attempt_count=0`; awaiting_approval brake active |
| `discord:trader-insights` | **true** | 🔴 GOVERNANCE HELD | All rows `attempt_count=0`; awaiting_approval brake active |
| `discord:exclusive-insights` | **false** | 🔒 DISABLED | Requires explicit `UNIT_TALK_ENABLED_TARGETS` activation + "activation contract" per code comment |

### 2.2 Non-Promotion Targets

| Target | Status | Notes |
|---|---|---|
| `discord:canary` | ✅ ACTIVE | Canonical canary lane; `isSupportedNonPromotionTarget` returns true; fail-closed fallback in local env |
| `discord:<numericChannelId>` | ✅ SUPPORTED | Direct numeric channel delivery supported |

### 2.3 Critical Finding — Default-Enabled Public Targets

**`best-bets` and `trader-insights` are enabled by default** (`enabled: true`, `rolloutPct: 100`) in `defaultTargetRegistry`. This means if `UNIT_TALK_ENABLED_TARGETS` is not set, the target registry treats both targets as live-eligible.

**The ONLY gate between governance-brake-held picks and live public delivery is:**
1. Phase 7A: pick lifecycle `awaiting_approval` → `distribution-service` blocks enqueue at the code level
2. The operator approval action that transitions `awaiting_approval` → `qualified`

If an operator approval is accidentally granted, picks would immediately flow to `best-bets` and `trader-insights` with no additional gate.

**Action required (Tier A prerequisite):** Before any Tier A delivery enablement, confirm that:
- `UNIT_TALK_DISTRIBUTION_TARGETS` is explicitly limited to canary targets only
- OR a rollout config override explicitly sets `best-bets` and `trader-insights` to `enabled: false`
- OR an explicit `UNIT_TALK_ENABLED_TARGETS` value is set that excludes public targets

---

## 3. Governance Brake Status

### 3.1 Phase 7A Enforcement

The governance brake is enforced at two layers:

**Layer 1 — Code-level block:**
```typescript
// apps/api/src/distribution-service.ts
if (pick.lifecycleState === 'awaiting_approval') {
  throw new Error(
    `Distribution blocked: pick ${pickId} is in awaiting_approval lifecycle state. ...`
  );
}
```

**Layer 2 — Fail-closed routing:**
- In `local` env: `resolveDeliveryTarget` redirects any non-canary discord target → `discord:canary`
- In `production`: uses actual target, but Layer 1 still blocks `awaiting_approval` picks

### 3.2 Current Queue State

| Queue | Count | Classification | True Failures |
|---|---|---|---|
| `distribution_outbox` pending | 594 | ALL `bucket:governance_hold` (`attempt_count=0`) | 0 |
| `dead_letter` | 946 | ALL `bucket:governance_hold` (`attempt_count=0`) | 0 |

Source: `readiness-score.json` (UTV2-1320 bucket semantics).

**Verdict: Governance brake is operational and enforced.** No picks have been delivered to public targets.

---

## 4. Paused Feature Assessment

### 4.1 Game-Thread Routing (UTV2-885)

**Status:** PAUSED — do not dispatch.

Game-thread routing would deliver picks into live game Discord threads. This feature requires:
- Public Discord Tier B approval (per LAUNCH_GATE_DEFINITION.md)
- Separate PM authorization
- This audit does not unblock or authorize dispatch

### 4.2 Member DM Routing (UTV2-884)

**Status:** PAUSED — do not dispatch.

Direct-message routing to individual Discord members. This feature requires:
- Public Discord Tier B approval
- Support/moderation coverage
- Separate PM authorization

**Both features remain PAUSED. This audit does not change that.**

---

## 5. Readiness Assessment by Launch Gate Tier

### Tier A — Controlled Internal Delivery

| Requirement | Status | Notes |
|---|---|---|
| Production readiness GREEN | ✅ MET | 2026-06-25T17:08:00Z |
| P2 ACTIVE_CERTIFIED | ✅ MET | Governance brake certified |
| Canary target configured + isolated | ✅ MET | `discord:canary` supported and fail-closed |
| Governance brake active | ✅ MET | All sources `awaiting_approval`, 0 deliveries |
| **Incident response runbook** | ❌ MISSING | No runbook exists — required before Tier A |
| **Rollback procedure** | ❌ MISSING | No rollback steps documented — required before Tier A |
| **Public target default-enabled risk mitigated** | ❌ UNCONFIRMED | `best-bets` + `trader-insights` are `enabled: true` by default — requires explicit suppression before canary delivery |
| Claim discipline checklist | ⚠️ PARTIAL | No CLV/edge/ROI in bot commands verified at code level; `/recap` output pre-launch review required |
| PM Tier A approval | ❌ NOT YET REQUESTED | Requires above items resolved first |

**Tier A verdict: NOT READY.** Two required items missing (incident runbook, rollback), one critical risk unconfirmed (default-enabled public targets).

### Tier B — Canary/Selective Public Delivery

| Requirement | Status | Notes |
|---|---|---|
| All Tier A gates | ❌ NOT YET MET | See Tier A above |
| Tier A ran successfully with no incidents | ❌ NOT YET | Tier A hasn't run |
| Monitoring dashboards confirmed live | ❌ UNCONFIRMED | No confirmed monitoring spec |
| Support/moderation coverage | ❌ UNDEFINED | No coverage definition exists |
| P3 data-gate verdict rendered | ❌ OPEN | UTV2-1042 dispatch open; verdict not rendered |
| Queue semantics (UTV2-1320) | ✅ DONE | Merged 2026-06-25 |
| This Discord audit (UTV2-1319) | ✅ IN PROGRESS | |
| Canary audience defined | ❌ NOT DEFINED | Who is in the canary audience? Not documented |
| PM Tier B approval | ❌ NOT YET REQUESTED | |

**Tier B verdict: NOT READY.** Multiple prerequisite gates open.

### Tier C — Full Public Launch

**Tier C verdict: BLOCKED.** Requires Tier B + burn-in PASS + P3 cert + P4/P5. All blocked. Not assessed further.

---

## 6. Blocker Table

| # | Blocker | Tier Blocked | Required Action | Executor |
|---|---|---|---|---|
| B1 | No incident response runbook | Tier A | Create runbook defining alert, escalation, rollback triggers for Discord delivery | Claude |
| B2 | No rollback procedure | Tier A | Document step-by-step rollback for each launch tier (disable targets, drain queue, revert) | Claude |
| B3 | `best-bets` + `trader-insights` default-enabled | Tier A | Confirm explicit env suppression or rollout config override before any canary delivery | PM + Deploy |
| B4 | `/recap` command CLV/edge output unreviewed | Tier A | Review `/recap` embed output; confirm no CLV/edge/ROI claims surfaced to users before P3 cert | Claude |
| B5 | Monitoring dashboards undefined | Tier B | Define what metrics are watched and by whom during canary period | Claude |
| B6 | Canary audience undefined | Tier B | Document who is in canary group, how they're gated | PM |
| B7 | Support/moderation coverage undefined | Tier B | Define who handles Discord incidents during canary | PM |
| B8 | P3 data-gate verdict not rendered | Tier B | UTV2-1042 honest pass/fail/defer evaluation against live evidence | Claude/Griff |
| B9 | UTV2-884 Member DM routing paused | Tier B+ | Do not dispatch; feature requires separate PM authorization for Tier B |
| B10 | UTV2-885 Game-thread routing paused | Tier B+ | Do not dispatch; feature requires separate PM authorization for Tier B |

---

## 7. What Is Ready

| Item | Status |
|---|---|
| Discord bot deployed in production | ✅ |
| Role-gating (capper, VIP, VIP+, trial) configured | ✅ |
| `discord:canary` target functional and fail-closed | ✅ |
| Phase 7A governance brake enforced at code level | ✅ |
| `exclusive-insights` target correctly disabled by default | ✅ |
| Zero true delivery failures in queue | ✅ |
| Queue semantics classified (UTV2-1320) | ✅ |
| Launch Gate Definition established (UTV2-1318) | ✅ |

---

## 8. Follow-Up Lanes

The following lanes are required to clear Tier A blockers:

| Lane | Blocker(s) | Tier | Priority | Executor |
|---|---|---|---|---|
| UTV2-XXXX | Incident response runbook (B1) | Tier A | High | Claude |
| UTV2-XXXX | Rollback procedure (B2) | Tier A | High | Claude |
| UTV2-XXXX | `/recap` output CLV/edge claim review (B4) | Tier A | High | Claude |
| UTV2-XXXX | Monitoring dashboard spec (B5) | Tier B | Medium | Claude |
| UTV2-1042 | P3 data-gate honest verdict (B8) | Tier B | Medium | Claude/Griff |

PM-only resolutions (not Claude lanes):
- B3: Confirm `best-bets`/`trader-insights` env suppression at deploy time — PM + deploy action
- B6: Define canary audience — PM decision
- B7: Define moderation/support coverage — PM decision

---

## 9. Claim Discipline Verification

The following claims were checked in Discord bot code and are confirmed ABSENT from user-facing output (as of this audit):

- P3 certification ✅ ABSENT (no "proven edge" or "certified" claims in bot embeds reviewed)
- CLV/ROI/edge assertions ✅ ABSENT from command names and top-level handlers (note: `/recap` content requires deeper review — see B4)
- P5/treasury/capital claims ✅ ABSENT

**This audit does not certify P3/P4/P5.** It confirms that no claims are being actively made via Discord at the time of audit.

---

## 10. What This Audit Does NOT Authorize

- Public Discord activation (any tier)
- Removal of governance brake
- Operator approval of `awaiting_approval` picks
- Dispatch of UTV2-884 or UTV2-885
- P-state certification
- CLV/edge/ROI claims

---

## Document Authority

This document is the authoritative audit record for UTV2-1319. It supplements:
- `docs/05_operations/LAUNCH_GATE_DEFINITION.md` — Tier gate requirements (UTV2-1318)
- `docs/05_operations/QUEUE_READINESS_SEMANTICS.md` — Queue bucket classification (UTV2-1320)
- `docs/06_status/CURRENT_STATE.md` — Current program states
- `docs/06_status/PHASE7R_RATIFICATION.md` — Governance brake specification
