# PS-M1: Commercial Foundation Contract

**Status:** RATIFIED 2026-04-03  
**Linear:** UTV2-365  
**Lane:** claude (contract)  
**Tier:** DOCS

---

## Context

PS-M1 establishes the canonical commercial foundation for Unit Talk V2: member tier registry,
trial policy, and channel-access business rules. This document reconciles what is enforced in
code and schema against the business intent.

---

## Member Tier Registry

**Authority:** `packages/contracts/src/index.ts` — `memberTiers` array  
**Enforced by:** `member_tiers` table constraint (`202603200017_member_tiers.sql`)

```
'free' | 'trial' | 'vip' | 'vip-plus' | 'capper' | 'operator'
```

Contracts and DB constraint are **in sync**. The `member_tiers_tier_check` Postgres constraint
enforces this exact set. No other tier values are accepted at write time.

### Tier Semantics

| Tier | Description |
|------|-------------|
| `free` | No paid membership. Default for new Discord members. |
| `trial` | Time-limited access (7 days default). Automated expiry via `runTrialExpiryPass()`. |
| `vip` | Standard paid membership. Access to VIP channels. |
| `vip-plus` | Elevated paid membership. Access to VIP+ channels (best-bets, trader-insights). |
| `capper` | Content contributor role. Has submitter access to picks via Smart Form. |
| `operator` | Internal admin. Full command access including operator-gated actions. |

---

## Trial Policy

**Source:** `apps/api/src/trial-expiry-service.ts`

- Duration: **7 days** (configurable via `TRIAL_DURATION_DAYS` env var)
- Automated expiry: `runTrialExpiryPass()` scans `member_tiers` for rows where
  `effective_until IS NOT NULL AND effective_until < now()` and deactivates them
- Scheduler: active in `apps/api/src/index.ts`
- Tier assignment is append-only — expiry sets `effective_until`, never deletes or mutates

---

## Channel Access Rules

Access is enforced at the Discord command layer via role IDs, not at the DB layer.

**Role gate source:** `apps/discord-bot/src/role-guard.ts` — `checkRoles()`

- Role IDs are configured via env vars (never hardcoded in source)
- `requireOperatorRole()` returns `['__operator_role_not_configured__']` as a safe
  default when operator role env var is absent — all operator commands default-deny
- Zero required roles = command is open to all members (`requiredRoles.length === 0`)

**Channel access by tier:**

| Tier | Best Bets | Trader Insights | Recaps | Commands |
|------|-----------|-----------------|--------|----------|
| `free` | — | — | — | help, today, live |
| `trial` | Read (role-gated) | — | — | help, today, live, my-picks |
| `vip` | Read | — | Read | + pick, recap, results, stats, leaderboard |
| `vip-plus` | Read | Read | Read | + heat-signal |
| `capper` | Read | Read | Read | + pick submission access |
| `operator` | All | All | All | All commands including alerts-setup |

*Channel access is enforced by Discord role membership, not by application code directly.*

---

## Discord Bot Command Count

**Authoritative:** `apps/discord-bot/command-manifest.json` — **13 commands**

```
alerts-setup, heat-signal, help, leaderboard, live, my-picks,
pick, recap, results, stats, today, trial-status, upgrade
```

> **Known drift:** `apps/discord-bot/CLAUDE.md` states "9 commands" — this is stale.
> The manifest is authoritative. CLAUDE.md drift does not affect runtime.

---

## Known Drift: `tier-resolver.ts`

`apps/discord-bot/src/tier-resolver.ts` — `MemberTierContext.tier` type includes `'black-label'`:

```typescript
tier: 'free' | 'trial' | 'vip' | 'vip-plus' | 'black-label';
```

`'black-label'` does not exist in:
- `packages/contracts/src/index.ts` `memberTiers`
- `member_tiers` table DB constraint

**Assessment:** Type-only drift. `resolveMemberTier()` never returns `'black-label'` — it returns
`'vip-plus' | 'vip' | 'trial' | 'free'` only. The type union is a dead branch. No runtime or DB
impact. Cleanup is deferred as a T3 issue.

---

## What This Establishes

- **Tier registry**: 6 tiers, locked in contracts + DB constraint, in sync
- **Trial policy**: 7-day automated expiry, append-only history, audited
- **Role-based access**: Discord role ID gates, env-configured, fail-closed defaults
- **No pricing model in code**: Pricing (e.g., subscription cost) is out-of-scope for this
  contract and managed externally. Code only enforces access, not billing.

---

## What This Does NOT Cover

- Billing / payment processing — external to Unit Talk V2
- Tier upgrade flows — `/upgrade` command currently reads from API; upgrade logic is
  manual/operator-driven at PS-M1
- Black label tier activation — `'black-label'` is not a valid tier in v2

---

## Cross-References

- `packages/contracts/src/index.ts` — `memberTiers` canonical array
- `supabase/migrations/202603200017_member_tiers.sql` — DB constraint authority
- `apps/api/src/trial-expiry-service.ts` — trial duration + expiry pass
- `apps/discord-bot/src/tier-resolver.ts` — Discord role → tier mapping
- `apps/discord-bot/src/role-guard.ts` — command access gate
- `apps/discord-bot/command-manifest.json` — 13 registered commands
