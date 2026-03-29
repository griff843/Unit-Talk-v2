# Unit Talk Role & Access Matrix

> **SUPERSEDED 2026-03-29.** This document has been demoted to historical reference. The authoritative product and business document for member tiers and access policy is now `docs/03_product/MEMBER_ROLE_ACCESS_AUTHORITY.md`. The tier taxonomy here is directionally correct but the authority doc is what counts. The channel-level visibility matrix here is design intent only — use the enforced-vs-intent table in the authority doc for current state.

Version: Draft v1
Status: Design Spec
Purpose: Define the intended role and visibility model for the Unit Talk Discord server.

---

## 1. Objective

This document defines who should see what, who should do what, and which onboarding path each role should receive.

It is a planning model and should later be aligned with actual Discord roles and permissions.

---

## 2. Role model

### Member-facing roles
- Public / New Join
- Trial
- Free
- VIP
- VIP+
- Black Label (reserved)

### Internal roles
- Capper
- Operator
- Admin
- Moderator (optional)

---

## 3. Role matrix

| Role | Primary Purpose | Core Visibility | Onboarding Track | Main CTA |
|---|---|---|---|---|
| Public / New Join | Orientation | Welcome / access / rules / limited preview | Member | Claim access |
| Trial | Evaluate value | Main board / recap / selected premium surfaces | Member | Upgrade |
| Free | Remain connected at low access | Limited surfaces / recap / announcements | Member | Upgrade |
| VIP | Main paid experience | Best Bets / recaps / capper access | Member | Stay engaged |
| VIP+ | Expanded paid experience | VIP + Trader Insights / higher-access surfaces | Member | Use premium access |
| Black Label | Highest-access experience | Reserved / future private surfaces | Member | Retain / deepen |
| Capper | Contributor role | Capper setup + internal capper surfaces + approved public/premium surfaces | Capper | Complete setup |
| Operator | Operations role | Internal ops surfaces | Staff | Complete setup |
| Admin | Full control role | Internal ops + admin surfaces | Staff | Complete setup |
| Moderator | Community enforcement | Selected internal surfaces | Staff | Complete setup |

---

## 4. Role intent notes

### Public / New Join
Should not be overwhelmed.
Must see only the minimum needed to understand Unit Talk and move to access.
Support path: **General Support**

### Trial
Should see enough to evaluate real value quickly.
This is one of the most important conversion roles.
Support path: **General Support**

### Free
Should remain connected without undermining paid value.
Support path: **General Support**

### VIP
Should feel like the main paid product tier.
Support path: **VIP Support**

### VIP+
Should feel like a meaningful expansion, not just a cosmetic badge.
Support path: **VIP Support**

### Black Label
Reserved for future use.
Do not overbuild now.
Support path: **VIP Support** (when active)

### Capper
Should have a clearly separate setup and internal path.
Do not mix with member onboarding.
Support path: **Internal capper ops surfaces** — not member support channels

### Operator / Admin
Should be routed into internal workflow immediately.
Support path: **Internal ops surfaces** — not member support channels

---

## 5. Access design principles

1. public members should not see the whole server
2. trial users should get to value quickly
3. premium tiers should feel distinct but not confusing
4. cappers should be structurally separated from members
5. staff should never depend on member onboarding surfaces

---

## 6. Open decisions

1. What exactly should Free retain?
2. How much of Trader Insights should be visible outside VIP+?
3. Should cappers have one shared contributor area or role-specific private areas?
4. Should moderators be distinct from operators at launch?
5. What future permissions should Black Label require?

---

## 7. Free vs Trial distinction

### Free
Free is the permanent low-access member state.

Free should retain:
- welcome / orientation
- access / upgrade surface
- rules / expectations
- announcements
- help / support
- limited recap / proof visibility
- limited preview surfaces if intentional

Free should not retain:
- full Best Bets access
- premium capper access
- Trader Insights
- premium-only surfaces

### Trial
Trial is a temporary premium preview state.

Trial should temporarily unlock:
- Best Bets
- Recaps
- selected capper access
- Trader Insights if included in the trial strategy
- enough real value surfaces to support upgrade conversion

### Trial expiry rule
When trial expires, temporary premium access is removed and the user falls back to the Free surface set unless they upgrade.
