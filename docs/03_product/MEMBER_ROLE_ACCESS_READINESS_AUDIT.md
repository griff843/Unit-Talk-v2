# Member Role Access — Readiness Audit

## Metadata

| Field | Value |
|---|---|
| Type | Readiness Audit / Gap Analysis |
| Issue | UTV2-163 |
| Status | **UPDATED 2026-03-29 — 6/8 hard gates PASS — 1 remaining blocker** |
| Audited | 2026-03-29 |
| Audited against | `main` (commit `c3664c4`); updated against `f40845d` (2026-03-29) |
| Does not supersede | `docs/03_product/ROLE_ACCESS_MATRIX.md` (remains the design-intent reference) |
| Does not supersede | `docs/05_operations/MEMBER_TIER_MODEL_CONTRACT.md` (remains the implementation contract) |

---

## Purpose

This document audits the current state of member role and access implementation on `main` to answer:

1. What is currently **enforced truth** regarding member tiers, Discord roles, trial/upgrade behavior, capper/operator access, and channel/surface access?
2. What remains **design intent only** (docs without implementation)?
3. What **exact prerequisites** must land before `MEMBER_ROLE_ACCESS_AUTHORITY.md` can be written and ratified?

This is a readiness gate, not an authority document. Do not cite this file as the access model.

---

## 1. Currently Enforced Truth on `main`

### 1.1 Tier Resolution (Discord-live, stateless)

**File:** `apps/discord-bot/src/tier-resolver.ts`

`resolveMemberTier()` resolves a member's tier at query time by checking Discord role cache against env-var-supplied role IDs. This is stateless — no DB read, no history.

**Enforced tier values:**

| Tier | Resolved when |
|---|---|
| `vip_plus` | Member holds `DISCORD_VIP_PLUS_ROLE_ID` |
| `vip` | Member holds `DISCORD_VIP_ROLE_ID` (and not VIP+) |
| `trial` | Member holds `DISCORD_TRIAL_ROLE_ID` (optional env var; if absent, trial is never resolved) |
| `free` | No paid role match |
| `black_label` | In the type definition — no role ID mapped, not resolvable in current config |

**Priority order is enforced:** vip_plus > vip > trial > free. A member with both VIP+ and VIP roles resolves as `vip_plus`.

**`isCapper` flag** is a separate boolean (`DISCORD_CAPPER_ROLE_ID` present), independent of tier.

**What this does NOT enforce:**
- `black_label` tier has no env var in config and no resolution path
- Tier is not persisted anywhere — stale Discord role = stale tier
- No audit trail for tier transitions

---

### 1.2 Role Guard (Command-level, enforced at dispatch)

**Files:** `apps/discord-bot/src/role-guard.ts`, `apps/discord-bot/src/router.ts`

`checkRoles(interaction, requiredRoles)` checks `interaction.member.roles.cache` against a list of required Discord role IDs. Any single match passes.

**Enforcement surface:** `router.ts` calls `checkRoles()` before `execute()` when a command declares `requiredRoles`. On failure, ephemeral "You don't have access to this command" is returned.

**Currently gated commands:**

| Command | Gate | Role source |
|---|---|---|
| `/alerts-setup` | Operator only | `requireOperatorRole(config)` → `[config.operatorRoleId]` |

**No other commands are currently role-gated.** `/pick`, `/stats`, `/recap`, `/leaderboard`, `/trial-status`, `/upgrade`, `/heat-signal` all have `requiredRoles: undefined`.

**Enforcement gap:** `/pick` (capper pick submission) has no capper role guard. Any Discord member who can invoke the slash command can call `POST /api/submissions`.

---

### 1.3 Capper Onboarding Handler (Event-driven, no DB write)

**File:** `apps/discord-bot/src/handlers/capper-onboarding-handler.ts`

`createCapperOnboardingHandler()` listens for `guildMemberUpdate` events. When the capper role is added to a member, it posts a welcome embed to `DISCORD_CAPPER_CHANNEL_ID`.

**Enforced behavior:**
- Detects capper role addition (not removal)
- Posts welcome embed to capper channel
- Idempotent (no-op if role not in added set)
- Errors swallowed — never crashes bot process

**What this does NOT do:**
- Does NOT write to `member_tiers` table (table does not exist)
- Does NOT detect VIP, VIP+, or trial role changes
- Does NOT deactivate any tier on role removal

---

### 1.4 Bot Config / Env Vars (Startup-enforced)

**File:** `apps/discord-bot/src/config.ts`
**Source:** `.env.example`

Role IDs enforced at startup (bot exits if missing):

| Env var | Required | Purpose |
|---|---|---|
| `DISCORD_CAPPER_ROLE_ID` | **Yes** | Capper role detection |
| `DISCORD_VIP_ROLE_ID` | **Yes** | VIP tier resolution |
| `DISCORD_VIP_PLUS_ROLE_ID` | **Yes** | VIP+ tier resolution |
| `DISCORD_TRIAL_ROLE_ID` | No (optional) | Trial tier resolution; if absent, no member ever resolves as trial |
| `DISCORD_OPERATOR_ROLE_ID` | No (optional) | Operator command gate; if absent, `requireOperatorRole()` uses sentinel `__operator_role_not_configured__` — effectively blocking all |
| `DISCORD_CAPPER_CHANNEL_ID` | **Yes** | Capper onboarding welcome channel |

**`DISCORD_OPERATOR_ROLE_ID` is NOT in `.env.example`.** It is in `config.ts` as an optional read, but operators must add it manually to `local.env` for the operator gate to work with a real role ID.

---

### 1.5 Trial / Upgrade Surface (Display only, no enforcement)

**Files:** `apps/discord-bot/src/commands/trial-status.ts`, `upgrade.ts`

`/trial-status` and `/upgrade` read the member's tier via `resolveMemberTier()` and return an ephemeral embed describing their access and upgrade path.

**Enforced:** Tier display and upgrade messaging are correct per the tier hierarchy.
**Not enforced:** These commands do not unlock or restrict any actual surface access. They are informational only.

Trial expiry is not enforced anywhere in V2. `trialRoleId` resolves as `trial` only for as long as Discord has the role attached. When the role is removed by an operator, the next `resolveMemberTier()` call returns `free`. There is no scheduled expiry job, no DB state for trial end date, no audit event.

---

### 1.6 Channel / Surface Access (Discord server config — not V2 runtime)

The channel visibility model described in `ROLE_ACCESS_MATRIX.md` (Free sees limited surfaces, Trial sees VIP-level surfaces, VIP sees Best Bets, VIP+ sees Trader Insights) is enforced **by Discord server channel permission configuration**, not by any V2 runtime code.

V2 has no mechanism to enforce channel access beyond:
- Slash command role guards (see §1.2 above)
- Bot not posting to channels in the `distribution_contract.md` blocked target list

**The V2 bot does not grant, revoke, or audit Discord channel permissions.** That is entirely a manual Discord admin operation.

---

### 1.7 Operator / Admin Surface (operator-web, read-only)

`apps/operator-web` has no member tier exposure. It does not query `member_tiers` (the table does not exist). There is no tier count, no member roster, no role audit surface in the operator dashboard.

The `OperatorSnapshot` type does not include a `memberTiers` field. The spec for this field exists only in `MEMBER_TIER_MODEL_CONTRACT.md` — it is design intent, not runtime truth.

---

## 2. Design Intent Only (Not Implemented)

The following are described in contracts or specs but have no corresponding implementation on `main`:

### 2.1 `member_tiers` DB Table

**Contract:** `docs/05_operations/MEMBER_TIER_MODEL_CONTRACT.md`
**Migration expected:** `supabase/migrations/202603200017_member_tiers.sql`
**Status:** Migration does not exist. Table is not in live DB. Not in `database.types.ts`. Not in `packages/db/src/repositories.ts`.

Everything downstream of this table — `MemberTierRepository`, `DatabaseMemberTierRepository`, `InMemoryMemberTierRepository`, `getTierCounts()`, `getActiveTiers()`, `getTierHistory()` — is also absent.

### 2.2 `MemberTier` Type in `@unit-talk/contracts`

**Contract:** `MEMBER_TIER_MODEL_CONTRACT.md` — defines `memberTiers` const and `MemberTier` union type
**Status:** Not exported from `packages/contracts/src/index.ts`. The type in `tier-resolver.ts` is a local inline union — not the canonical contracts type.

Note: `tier-resolver.ts` uses `'vip_plus'` (underscore); the contract uses `'vip-plus'` (hyphen). These do not match.

### 2.3 General Member Tier Sync (all tiers on role change)

**Contract:** `MEMBER_TIER_MODEL_CONTRACT.md` §Discord Role → Tier Mapping
**Expected:** `guildMemberUpdate` handler syncs all tier-relevant role changes (VIP, VIP+, trial, capper, operator) to `member_tiers` rows
**Status:** Only the capper role add is handled (`capper-onboarding-handler.ts`). VIP, VIP+, trial, and operator role events are not handled. Role removals (deactivateTier) are not handled for any role.

### 2.4 Trial Expiry Enforcement

**Contract / issue:** UTV2-150 (upgrade/trial audit trail)
**Status:** No expiry logic. No scheduled job. No `effective_until` field (table doesn't exist). Trial expires only when an operator manually removes the Discord role.

### 2.5 Operator Snapshot Tier Counts

**Contract:** `MEMBER_TIER_MODEL_CONTRACT.md` §Operator Snapshot
**Status:** `OperatorSnapshot` has no `memberTiers` field. `createOperatorSnapshotProvider()` does not query tier data. Not present in `apps/operator-web`.

### 2.6 State Machine Enforcement (UTV2-155)

**Status:** No state machine for tier transitions. The append-only semantics of `member_tiers` are described but not enforced (table absent). Valid/invalid transition rules from UTV2-155 are entirely design intent.

### 2.7 Capper Role Guard on `/pick`

**Design intent:** Only cappers should submit picks via `/pick`
**Status:** `/pick` has no `requiredRoles`. Any Discord member can invoke it. This is a gap between the channel-level role model (Capper has pick submission access) and actual V2 command enforcement.

### 2.8 `black_label` Tier

**Design intent:** Reserved highest-access tier
**Status:** Present in `MemberTierContext` type and tier display color map, but no env var maps to it, no Discord role ID resolves it, and no command surface references it. Exists as a type placeholder only.

### 2.9 `DISCORD_OPERATOR_ROLE_ID` in `.env.example`

**Status:** The env var is read by `config.ts` but is absent from `.env.example`. Operators must configure it manually. Its absence means the operator role gate on `/alerts-setup` silently uses a sentinel that blocks all.

---

## 3. Contradictions and Gaps

| Item | Issue |
|---|---|
| `vip_plus` vs `vip-plus` | `tier-resolver.ts` uses underscore; `MEMBER_TIER_MODEL_CONTRACT.md` uses hyphen. When the contracts type lands, these will conflict. |
| `/pick` has no capper gate | Any member can call `POST /api/submissions` via the bot. The design intent (capper-only) is not enforced. |
| `DISCORD_TRIAL_ROLE_ID` is optional | If not set, no member ever resolves as trial — silently. The env example lists the var without documenting this behavior. |
| `DISCORD_OPERATOR_ROLE_ID` absent from `.env.example` | No default or documentation. New deployments will have a non-functional operator gate unless the operator discovers and adds this var. |
| Linear UTV2-149 marked Done | Linear shows `completedAt: 2026-03-29T05:40:45.359Z` but no implementation artifacts exist on `main`. Linear status is stale. |

---

## 4. Prerequisites for `MEMBER_ROLE_ACCESS_AUTHORITY.md`

The following must land on `main` before a final authority doc can be written. Each item is a hard gate — partial implementation is insufficient.

### Hard Gates (all required)

> Updated 2026-03-29 at `f40845d`. ✅ = verified on main. ❌ = still missing.

- [x] ✅ **Migration `202603200017_member_tiers.sql`** applied to live DB and `pnpm supabase:types` run — PR #76 + live `supabase db push` 2026-03-29
- [x] ✅ **`MemberTier` type** (`'free' | 'trial' | 'vip' | 'vip-plus' | 'capper' | 'operator'`) exported from `@unit-talk/contracts` — `packages/contracts/src/index.ts`
- [x] ✅ **`MemberTierRepository` interface** in `packages/db/src/repositories.ts` with `activateTier`, `deactivateTier`, `getActiveTiers`, `getTierHistory`, `getActiveMembersForTier`, `getTierCounts`
- [x] ✅ **`InMemoryMemberTierRepository`** and **`DatabaseMemberTierRepository`** implemented and tested — 7 tests in `packages/db/src/member-tier-repository.test.ts`
- [ ] ❌ **General tier sync handler** — `guildMemberUpdate` syncs VIP, VIP+, trial, capper, operator add/remove to `member_tiers` rows. **Blocker:** `@unit-talk/db` is forbidden in `apps/discord-bot` per `DISCORD_BOT_FOUNDATION_SPEC.md`. Requires `POST /api/member-tiers` API endpoint first, then bot handler calls that endpoint. See UTV2-163 ISSUE_QUEUE entry.
- [x] ✅ **Operator snapshot tier counts** — `OperatorSnapshot.memberTiers.counts` populated by live `member_tiers` query — `apps/operator-web/src/server.ts`
- [x] ✅ **`pnpm verify` passes** — CI confirmed PR #76; type-check confirmed on committed state `f40845d`
- [x] ✅ **Tests:** activate/deactivate/idempotent/active-filter/history — 7 tests pass (InMemory layer verified; DB smoke test not run for this slice)

### Recommended (not hard gates, but needed for the authority doc to be complete)

- [x] ✅ **Capper role guard on `/pick`** — `requiredRoles: [capperRoleId]` — PR #75
- [x] ✅ **`DISCORD_OPERATOR_ROLE_ID` added to `.env.example`** — PR #75
- [x] ✅ **`vip_plus` / `vip-plus` naming resolved** — all `vip_plus`/`black_label` normalized to `vip-plus`/`black-label` in `tier-resolver.ts`, `trial-status.ts`, `upgrade.ts` — PR #75
- [ ] **Trial expiry behavior documented as enforced** — still Open. No scheduled expiry job. Manual Discord role removal is the only enforcement path. Must be explicitly ratified as V2 behavior before the authority doc covers trial. (UTV2-150 scope)

---

## 5. UTV2-163 Disposition

**Recommendation: BLOCKED — keep in Backlog until hard gates above are satisfied.**

A narrow authority section for the purely Discord-runtime enforcement model (tier resolution via `resolveMemberTier()`, role guard via `checkRoles()`, capper onboarding handler) could be written now. However, this would cover less than 30% of the intended access model and would need heavy revision when `member_tiers` lands. The cost of premature publication outweighs the benefit.

**Updated 2026-03-29:** UTV2-149 Codex work landed (PRs #75/#76). 6 of 8 hard gates pass. One remaining blocker:

**Remaining path to unblocking UTV2-163:**
1. Ship `POST /api/member-tiers` API endpoint (or equivalent write path not requiring `@unit-talk/db` in discord-bot)
2. Wire `guildMemberUpdate` handler to call that endpoint for all tier-relevant role changes (VIP, VIP+, trial, capper, operator — both add and remove)
3. Confirm at least one real role-change event writes a row to the live `member_tiers` table (pnpm test:db or live DB proof)
4. Explicitly ratify trial expiry behavior (manual-removal-only or UTV2-150 scheduler)
5. Re-run this proof — if clean, open UTV2-163 as an authority-doc lane

**Current docs to treat as authoritative (within their stated scope):**

| Document | Scope | Status |
|---|---|---|
| `ROLE_ACCESS_MATRIX.md` | Tier taxonomy, design intent, role purpose notes | DRAFT — do not cite as enforced truth |
| `MEMBER_TIER_MODEL_CONTRACT.md` | `member_tiers` schema, sync logic, repository contract | RATIFIED — implementation pending |
| `docs/05_operations/discord_routing.md` | Live channel targets, delivery modes, architectural gaps | AUTHORITATIVE |
| `writer_authority_contract.md` | `apps/discord-bot` write authority (delegated to `member_tiers`) | RATIFIED |

---

## Appendix: Evidence Commands

To verify this audit against a future state of `main`:

```bash
# Check migration exists
ls supabase/migrations/ | grep member_tier

# Check DB type generated
grep "member_tiers" packages/db/src/database.types.ts

# Check contracts type
grep "MemberTier" packages/contracts/src/index.ts

# Check repository interface
grep "MemberTierRepository" packages/db/src/repositories.ts

# Check tier sync handler covers all roles
grep -n "vipRoleId\|vipPlusRoleId\|trialRoleId" apps/discord-bot/src/handlers/

# Check /pick has capper gate
grep "requiredRoles" apps/discord-bot/src/commands/pick.ts
```
