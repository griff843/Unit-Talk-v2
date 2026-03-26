# Unit Talk Discord Launch Surface Map
Version: Draft v1
Status: Design Spec
Authority: Planning / product architecture — not implementation truth
Depends on:
- SERVER_INFORMATION_ARCHITECTURE_SPEC.md
- ROLE_ACCESS_MATRIX.md
- ENTRY_PATH_INVITE_STRATEGY.md
- ONBOARDING_ARCHITECTURE_SPEC.md
- ONBOARDING_FLOW_MAP.md
- ONBOARDING_CONTENT_ARCHITECTURE.md

---

## 1. Objective

This document defines the minimum viable Discord surface set for Unit Talk's launch.

It is not the full long-term Discord vision. Its job is to prevent over-building at launch while ensuring every user state has a clear, functional experience.

Launch scope means: only surfaces with a defined job, a defined audience, and a clear reason to exist before launch.

---

## 2. Design principles

1. **Launch only what has a clear job.** If a surface does not have a defined purpose and owner, it does not go live.

2. **Reduce clutter.** Fewer focused surfaces are more valuable than many low-signal channels. Every channel a new user sees is a cognitive cost.

3. **Public surfaces should orient, not overwhelm.** The first thing a new join sees should tell them: what this is, how to get access, and where to start.

4. **Premium surfaces should feel meaningful.** Paid access should feel like it unlocks something real. Do not let premium surfaces sit empty or feel identical to free.

5. **Internal surfaces stay separate.** Capper, staff, and operator surfaces must not bleed into member-facing categories.

6. **Onboarding uses both persistent and triggered surfaces intentionally.** Not every onboarding moment belongs in a permanent channel. Some belong in triggered messages.

---

## 3. Launch surface layers

### Layer 1 — Public / Pre-access
**Audience:** Anyone who joins before claiming trial or paid access.
**Purpose:** Orient, explain, and route toward access.
**Surfaces:** Orientation channels (welcome, rules, get-access, announcements, general support).
**Constraint:** This layer must be clean and minimal. It is the product's first impression. Nothing extraneous should appear here.

### Layer 2 — Member / Trial / Entry value
**Audience:** Users with trial or Free access.
**Purpose:** Deliver the first wave of real product value and set expectations.
**Surfaces:** Main board surfaces (Best Bets, Recaps), entry-level capper visibility where applicable.
**Constraint:** Trial access is time-limited. This layer must demonstrate value quickly and clearly.

### Layer 3 — Paid / Premium
**Audience:** VIP, VIP+, and future Black Label users.
**Purpose:** Deliver the full paid experience. Premium surfaces should be clearly distinct from free access.
**Surfaces:** Trader Insights, VIP-only analysis, VIP+ surfaces, VIP Support.
**Constraint:** Do not activate paid surfaces that have no content or delivery pipeline yet.

### Layer 4 — Internal / Staff / Capper
**Audience:** Cappers, operators, admins, moderators.
**Purpose:** Internal coordination, capper contribution flow, operations.
**Surfaces:** Internal capper channels, staff/ops coordination, internal logs.
**Constraint:** These surfaces must not be visible to members. No crossover.

---

## 4. Launch-critical persistent channel surfaces

The following are the minimum viable persistent channels for launch.

| Surface | Purpose | Audience | Launch status | Why persistent |
|---|---|---|---|---|
| Welcome | Confirm they're in the right place; set tone | All | Launch | Every user sees it first; needs permanent presence |
| Get Access | Explain tiers, trial path, how to claim | Public, Free | Launch | Always-on reference; users return to it |
| Rules / Start Here | Community conduct, channel guide | All | Launch | Permanent reference; must exist before any content goes live |
| Announcements | Server-wide updates and product news | All | Launch | Controlled broadcast; must be live from day one |
| General Support | Help routing for public/free/trial users | Public, Free, Trial | Launch | Always-on; users need a known support entry point |
| Best Bets | Main board — qualified picks | Trial, VIP, VIP+ | Launch | Core product surface; must be live with active delivery |
| Recaps | Proof/results surface | Trial, VIP, VIP+ | Launch | Establishes track record; high conversion and retention value |
| VIP Support | Paid-tier help routing | VIP, VIP+ | Launch | Paid users need a dedicated support path |
| Capper board surface | Public/premium pick visibility for specific cappers | VIP, VIP+ (scope TBD) | Launch or shortly after | Required for capper program to have product presence |
| Trader Insights | Premium analysis channel (VIP+) | VIP+ | Launch if delivery pipeline is live | Do not activate if picks are not flowing yet |
| Internal capper channel | Capper coordination, submission feedback | Capper | Launch | Required from first capper invite |
| Staff / ops channel | Internal coordination | Staff, Operator, Admin | Launch | Required before any staff are invited |

Surfaces marked "launch or shortly after" should not be created empty. They go live when their content pipeline is ready.

---

## 5. Triggered onboarding / transition surfaces

The following should be delivered as triggered messages, not always-on channels.

| Surface | Trigger | Audience | Purpose | Why triggered |
|---|---|---|---|---|
| Trial unlock message | Trial role assigned | New trial user | Confirm access, explain what's available, state expiry window | Specific to moment of activation; wrong as a permanent channel |
| Trial expiry reminder | N days before expiry (TBD) | Active trial user | Warn of expiry, present upgrade path | Time-sensitive; must reach the user at the right moment |
| Trial expiry fallback | Trial expiry event | Expired trial user | Confirm expiry, explain access change, provide upgrade path | One-time state change notification |
| Paid tier unlock message | VIP or VIP+ role assigned | New paid user | Confirm paid access, orient to paid surfaces, route to VIP Support | Confirms a real transaction; should be immediate and specific |
| In-server upgrade confirmation | Upgrade event inside server | Upgrading member | Confirm new tier, no full re-onboard | Already oriented; only new access delta needs to be communicated |
| Capper welcome/setup | Capper invite accepted | New capper | Welcome, role confirm, setup expectations, internal access overview | Private to the individual; not appropriate as a permanent channel |
| Staff welcome/setup | Staff invite accepted | New staff/operator | Welcome, internal channel orientation, responsibilities | Private to the individual; operationally sensitive |

---

## 6. Free vs Trial vs Paid surface behavior

### Free
- Permanently sees: Layer 1 (Welcome, Rules, Get Access, Announcements, General Support)
- Does not see: Board surfaces (Best Bets, Recaps), paid surfaces
- Purpose: Preserve access to orientation and upgrade path; do not strand free users

### Trial
- Temporarily sees: Layer 1 + Layer 2 (Best Bets, Recaps) during trial window
- Does not see: Layer 3 premium surfaces
- On expiry: Layer 2 access revoked; returns to Free state (Layer 1 only)
- What remains after expiry: Layer 1 surfaces only

### Paid (VIP)
- Sees: Layer 1 + Layer 2 + VIP-only Layer 3 surfaces + VIP Support
- Does not see: VIP+-exclusive surfaces

### Paid (VIP+)
- Sees: Layer 1 + Layer 2 + full Layer 3 (including Trader Insights) + VIP Support
- Full paid experience

### What is removed on trial expiry
- Best Bets visibility
- Recaps visibility
- Any other Layer 2 surfaces unlocked during trial

### What remains after expiry
- Welcome, Rules, Get Access, Announcements, General Support
- Upgrade path must remain visible

---

## 7. Support surface model at launch

| Support path | Who uses it | Delivery | Notes |
|---|---|---|---|
| General Support | Public, Free, Trial | Persistent channel | Primary support intake; routing instructions pinned |
| VIP Support | VIP, VIP+ | Persistent channel | Paid-tier support; higher-touch expectation |
| Internal capper support | Capper | Via internal capper channel or DM | Not a public channel; handled within internal Layer 4 |
| Operator/admin support | Staff, Operator, Admin | Via staff/ops channel | Internal only |

Each persistent support surface should have a pinned channel intro covering: what this channel is for, who to contact, and what to include in a request.

Triggered messages for trial expiry and paid unlock should include a direct support routing line (where to go if there is an issue).

---

## 8. Launch exclusions / deferred surfaces

The following should not be part of launch:

| Deferred surface | Reason |
|---|---|
| Full Black Label architecture | Not defined; no content pipeline; reserved |
| Community / general chat channels | Low signal at launch; adds clutter without current value |
| Strategy room or coaching surfaces | DM delivery not implemented in V2 runtime |
| Game-day / event discussion channels | Thread routing not implemented; high coordination cost |
| Too many capper-specific board channels | Start with one or two defined surfaces; expand based on volume |
| Source-specific onboarding variants | Complexity without launch-critical benefit |
| Large invite variant sets | Defer beyond minimal invite strategy |
| Forum/thread-based surfaces | Adds implementation complexity; assess after persistent channels are stable |

If a surface is not on the launch map, it requires a new contract before it can be added.

---

## 9. Channel lifecycle governance at launch

Every surface that launches must have the following defined before it goes live:

| Field | Description |
|---|---|
| Purpose | What job this surface does |
| Owner | Who is responsible for it |
| Audience | Who can see and use it |
| Success condition | How we know it is doing its job |
| Archive/deprecation rule | When and how this surface gets retired |

**Before launch:** Apply this model to every surface in the launch map. Do not create channels that cannot fill all five fields.

**After launch:** Review active surfaces at a regular cadence. A surface with no content activity and no owner is a candidate for archival. Do not let the server accumulate dead channels.

A surface with no owner and no active content should be closed or repurposed rather than left open.

---

## 10. Recommended launch surface map

### Public / Pre-access
- welcome
- get-access
- rules / start-here
- announcements
- general-support

### Member / Trial
- best-bets
- recaps

### Paid / Premium
- trader-insights (when delivery pipeline is live)
- vip-analysis (if VIP-specific content is ready)
- vip-support

### Internal / Staff / Capper
- capper-board or capper-picks (scoped to launch capper set)
- capper-internal (coordination and feedback)
- staff-ops (internal coordination, no member visibility)

This is a practical starting point. Every surface on this list should be confirmed against §9 (lifecycle governance) before it is created.

---

## 11. Open decisions

The following unresolved questions affect launch surface design:

1. **Capper surface structure at launch:** How many capper channels? One shared board or per-capper? Forum vs flat channel?
2. **Trader Insights trial visibility:** Is Trader Insights visible to trial users at launch, or is it paid-only from day one?
3. **Free recap/proof access:** How much of Best Bets history and Recaps should Free users permanently see, if any?
4. **Forum vs channel for certain surfaces:** Should Recaps or capper boards use Discord forums/threads, or standard channels at launch?
5. **VIP vs VIP+ surface distinction:** Is there a distinct VIP-only surface at launch, or does VIP+ simply unlock Trader Insights on top of a shared VIP channel?
6. **DM vs in-server delivery for triggered messages:** Trial unlock, expiry, and paid unlock — in-server notification channel, direct DM, or both?
7. **Capper board visibility gating:** Which tiers can see capper-contributed picks at launch? Trial, VIP, VIP+, all?

These must be resolved before building channel structure or writing onboarding content for affected surfaces.

---

## 12. Success criteria

The launch surface map is successful if:

- Every user state (Public, Free, Trial, VIP, VIP+, Capper, Staff) has clearly defined surfaces and a clear path
- No surface exists without a purpose, owner, and defined audience
- Free users can always access the upgrade path; they are never stranded
- Trial expiry is handled without manual intervention
- Premium surfaces feel meaningfully different from free access
- Internal surfaces are not visible to members
- The server can be used on day one without channel clutter confusing new joins
- Every launched surface satisfies the §9 lifecycle governance model

---

## 13. Recommended next step

**Refine the actual server category and channel structure from this launch map.**

Use this document to produce a concrete server structure proposal: exact category names, channel names, permission model per surface, and confirmation of the five governance fields for each.

Once the structure is confirmed, return to `ONBOARDING_CONTENT_ARCHITECTURE.md` and write final content/copy briefs for the launch-approved surfaces only.

Do not write copy for surfaces that are not yet confirmed as launch scope.
