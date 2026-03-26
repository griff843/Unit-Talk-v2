# Discord Embed System Spec — Unit Talk

> **DESIGN INTENT — NOT YET IMPLEMENTED.**
> This spec defines target-state rules for Discord embed consistency. It is not currently implemented in V2 runtime. The V2 worker delivers embeds via `sendEmbed(channelId, embed)` without enforcing this spec. Use this document to guide bot implementation when development begins.
> To audit current embed output against this spec: `.claude/skills/embed-parity-audit/`

## Purpose

Define the visual, structural, and behavioral rules for all Discord embeds used by Unit Talk.

This spec exists to ensure:

- consistency across all Discord outputs
- premium, syndicate-level presentation
- clean separation between internal truth and public-facing display
- repeatable rendering rules for bot implementation

This document governs **how embeds should look and behave**, not the underlying scoring or routing logic.

---

## Design Goals

### 1. High-signal presentation
Embeds should surface only the information that helps the user act.

### 2. Consistency
Every Unit Talk message should feel like it came from one system, not multiple bots or ad hoc posts.

### 3. Trust
Embeds must never show fake precision, placeholder data, or misleading labels.

### 4. Clear hierarchy
A user should be able to identify:
- what kind of message it is
- why it matters
- whether action is needed
- how strong the opportunity is

### 5. Premium feel
The output should feel professional, disciplined, and sharp — not noisy, gimmicky, or over-designed.

---

## Global Embed Rules

### 1. Common Structure

Every embed should follow this general structure:

1. **Header** — message family label; optional tier/badge; optional urgency indicator
2. **Primary body** — the core pick, alert, or recap content; the most important action-driving information
3. **Supporting fields** — only the highest-value secondary details; keep concise and consistent
4. **Footer** — source identity; time context; optional status context

---

### 2. Tone Rules

Embeds must be:
- concise
- disciplined
- premium
- confident without sounding hype-driven
- readable in fast-moving Discord environments

Avoid:
- emoji spam
- excessive exclamation marks
- retail-betting slang overload
- gimmicky "LOCK OF THE CENTURY" style copy
- overexplaining obvious details

---

### 3. Visibility Rules

**Never show:**
- `pick_id`
- `event_id`
- raw lifecycle state
- dedupe/routing metadata
- internal model/debug fields
- internal disagreement markers on capper picks

**Show only when useful:**
- unit size
- tier
- EV / edge
- rationale
- start time
- book
- alert trigger details

**Ticket type rule:**
Do not label a single-pick bet as `Single`. Show ticket type only for multi-pick structures:
- Parlay
- Teaser
- Round Robin
- other multi-leg bets

---

### 4. Timestamp Rules

Every embed must include time context in one of these forms:
- event date
- event time (if available and useful)
- publish timestamp
- recap coverage period
- alert trigger time

**Source-aware rule:**
- provider/API picks may show event time
- capper/manual picks require date only, unless later enriched

---

### 5. Footer Rules

Footer must be consistent and quiet.

Recommended patterns:
- `Unit Talk`
- `Unit Talk • Posted <time context>`
- `Unit Talk • Recap`
- `Unit Talk • Operator Alert`

Do not overload the footer with metadata.

---

### 6. Field Count Rule

Target: **3–6 meaningful fields maximum.**

If something requires more explanation:
- use a button
- use a follow-up interaction
- use a thread
- use a recap/detail surface

---

### 7. Public vs Internal Rule

**Public/premium member embeds:** clean, concise, action-oriented, no internal system noise.

**Internal/operator embeds:** diagnostic detail allowed; may include failure reason, route, retry state, severity.

---

## Embed Families

### 1. Capper Pick Post

**Purpose:** Canonical visible post for a capper-originated pick.

**Audience:** Capper lane; premium lane as applicable.

**Required visible content:**
- sport
- matchup or player context
- pick / line
- odds
- unit size
- capper name
- date
- optional short rationale

**Recommended title:** `Capper Pick` or `[Capper Name] Pick`

**Suggested fields:**

| Field | Required |
|-------|----------|
| Pick | Yes |
| Odds | Yes |
| Units | Yes |
| Capper | Yes |
| Date | Yes |
| Notes | Optional |

**Optional fields:** tier (internal-first; public only where policy allows), book, stat type, player/team context.

**Never show:** model disagreement, internal score breakdown, internal suppression reason.

---

### 2. Best Bet

**Purpose:** Highest-quality, system-qualified opportunity.

**Audience:** VIP+, Black Label, and other approved top-tier surfaces.

**Promotion rule:** Only model-qualified picks during the interim V2 period. See `pick_promotion_interim_policy.md`.

**Required visible content:**
- clear Best Bet identity
- pick / line
- odds
- unit size
- why it qualifies at a high level
- date/time context

**Recommended title:** `Best Bet`

**Suggested fields:**

| Field | Required |
|-------|----------|
| Pick | Yes |
| Odds | Yes |
| Units | Yes |
| Game Date/Time | Yes |
| Tier | Optional (if public display enabled) |
| EV / Edge | Optional (if real and approved) |

**Optional supporting line (examples):**
- `Strong system alignment with premium edge profile`
- `Qualified through top-tier promotion rules`
- `High-quality signal with full model support`

**Rules:**
- must feel more selective than VIP picks
- must not look visually identical to a standard capper post
- must remain rare enough to feel meaningful

---

### 3. VIP Pick / Premium Pick

**Purpose:** Core paid picks surface.

**Audience:** VIP and above.

**Required visible content:** pick / line, odds, unit size, capper or source, date, optional rationale.

**Recommended title:** `VIP Pick` (or omit if channel context makes it obvious)

**Suggested fields:**

| Field | Required |
|-------|----------|
| Pick | Yes |
| Odds | Yes |
| Units | Yes |
| Source | Yes |
| Date | Yes |
| Notes | Optional |

**Rules:** broader than Best Bets; may include manual/capper lane picks; must still look disciplined and premium.

---

### 4. Daily Recap

**Purpose:** Summarize prior settled day performance.

**Schedule:** Daily at 11:00 AM.

**Audience:** Premium audience.

**Required visible content:** overall record, net units, ROI, top highlight(s), brief summary of day quality.

**Recommended title:** `Daily Recap`

**Suggested fields:**

| Field | Required |
|-------|----------|
| Record | Yes |
| Net Units | Yes |
| ROI | Yes |
| Top Play | Yes |
| Notes / Summary | Optional |

**Optional additions:** by-tier summary, best capper, strongest sport, streak note.

**Rules:** no manual tallying language; must reflect settled truth only; must not hide losses.

---

### 5. Weekly Recap

**Purpose:** Weekly rollup of performance.

**Schedule:** Monday at 5:00 PM.

**Recommended title:** `Weekly Recap`

**Suggested fields:**

| Field | Required |
|-------|----------|
| Record | Yes |
| Net Units | Yes |
| ROI | Yes |
| Top Segment | Yes |
| Key Takeaway | Yes |

---

### 6. Monthly Recap

**Purpose:** Monthly rollup of performance and trend.

**Schedule:** First Monday of the month at 5:00 PM.

**Recommended title:** `Monthly Recap`

**Suggested fields:**

| Field | Required |
|-------|----------|
| Record | Yes |
| Net Units | Yes |
| ROI | Yes |
| Best Segment | Yes |
| Monthly Takeaway | Yes |

**Collision rule:** If monthly recap falls on the same Monday as weekly recap, publish one combined `Weekly + Monthly Recap` — do not publish both separately.

---

### 7. Combined Weekly + Monthly Recap

**Purpose:** Handle recap collision cleanly.

**Recommended title:** `Weekly + Monthly Recap`

**Suggested fields:**

| Field | Required |
|-------|----------|
| Weekly Record | Yes |
| Weekly Net Units | Yes |
| Monthly Record | Yes |
| Monthly Net Units | Yes |
| Top Highlight | Yes |
| Key Takeaway | Yes |

**Rule:** must feel intentional, not like a merged dump.

---

### 8. Market / Line Movement Alert

**Purpose:** Surface meaningful market movement.

**Audience:** Premium audience; exact tiers per routing policy.

**Required visible content:** what moved, direction of movement, why it matters, timing context.

**Recommended title:** `Market Alert` or `Line Movement Alert`

**Suggested fields:**

| Field | Required |
|-------|----------|
| Market | Yes |
| Movement | Yes |
| Current View | Yes |
| Time | Yes |
| Notes | Optional |

**Rules:** high-signal only; no spam; must explain why the alert matters, not just that something moved.

---

### 9. Injury / Availability Alert

**Purpose:** Surface material status changes that affect decision-making.

**Recommended title:** `Injury Alert` or `Availability Alert`

**Suggested fields:**

| Field | Required |
|-------|----------|
| Player / Team | Yes |
| Status Change | Yes |
| Impact | Yes |
| Relevant Game | Yes |
| Notes | Optional |

**Rules:** only meaningful impact alerts; no generic injury feed spam.

---

### 10. Hedge Alert

**Purpose:** Surface hedge opportunities.

**Recommended title:** `Hedge Alert`

**Suggested fields:**

| Field | Required |
|-------|----------|
| Current Position | Yes |
| Hedge Opportunity | Yes |
| Why It Matters | Yes |
| Suggested Window | Yes |
| Notes | Optional |

**Rules:** advanced surface; concise and actionable.

---

### 11. Middling Alert

**Purpose:** Surface middle opportunities.

**Recommended title:** `Middling Alert`

**Suggested fields:**

| Field | Required |
|-------|----------|
| Original Position | Yes |
| Middle Opportunity | Yes |
| Middle Range | Yes |
| Market Context | Yes |
| Notes | Optional |

**Rules:** advanced surface; analytical tone, not gimmicky.

---

### 12. Upgrade / Onboarding DM

**Purpose:** Help convert, onboard, or route users.

**Audience:** New members, free users, trial users, upgrade targets.

**Recommended title:** `Welcome to Unit Talk` or `Upgrade to Unlock More`

**Suggested sections:**
- what this gives you
- what to do next
- one clear CTA

**Rules:** do not overload; one main CTA only; must feel premium, not spammy.

---

### 13. Operator Alert

**Purpose:** Internal operational awareness.

**Audience:** Operator/Admin only.

**Required visible content:** severity, issue type, affected surface, action status.

**Recommended title:** `Operator Alert`

**Suggested fields:**

| Field | Required |
|-------|----------|
| Severity | Yes |
| Issue | Yes |
| Surface | Yes |
| Status | Yes |
| Next Action | Yes |

**Rules:** diagnostic detail allowed; fast scan priority.

---

### 14. Delivery Failure / Incident Alert

**Purpose:** Internal failure visibility for posting/delivery issues.

**Recommended title:** `Delivery Failure` or `Incident Alert`

**Suggested fields:**

| Field | Required |
|-------|----------|
| Failure Type | Yes |
| Destination | Yes |
| Retry Status | Yes |
| Last Attempt | Yes |
| Notes | Optional |

**Rules:** internal only; must support action, not just logging.

---

## Display Policies

### Tier Display Policy

Tiers are internal-first. See `docs/02_architecture/tier_system_design_spec.md`.

**Internal use:** audit, ranking, promotion support, recap segmentation, capper review.

**Public use (controlled):** Best Bets, recap summaries, selective premium surfaces where policy allows.

**Not allowed:** publicly surfacing tiers that contradict or undermine capper picks in-channel.

---

### EV / Edge Display Policy

**EV/edge in V2 is `metadata.domainAnalysis.edge` = `confidence − impliedProbability`.**

**Required preconditions (both must be true):**
- `pick.confidence` is present and in (0, 1) range — stored as a fraction, e.g. 0.65
- `pick.odds` is present and valid (used by domain analysis at submission time)

If either precondition is absent, edge was not computed — **hide EV/edge entirely**. Do not substitute a fallback or estimated value.

**Smart Form picks currently never satisfy these preconditions.** `confidence` is not sent by Smart Form V1. Edge is never computed. EV/edge must not be displayed for Smart Form picks.

**Display rules:**
- Show only when both preconditions are confirmed met
- Show only on approved surfaces (Best Bets, Trader Insights, advanced premium surfaces)
- Do not show on manual/capper lane picks unless edge was explicitly computed
- Do not infer or approximate EV from odds alone

**Avoid:** displaying EV on fallback-scored picks; using "EV" as generic marketing language; showing edge scores derived from the confidence fallback chain (50/50 default).

---

### Unit Size Display Policy

Unit size is the primary public conviction signal.

**Rules:**
- always show on pick surfaces
- keep formatting consistent
- do not pair with fake "confidence" language

---

### Rationale Display Policy

**Public rationale:** short, 1–3 lines maximum, action-oriented.

**Deep rationale:** use future buttons/modals/threads for expanded explanation. Do not overload main embeds with long explanations.

---

## Interaction Readiness

This spec should support future components such as:

- `Track This`
- `Why This Qualified`
- `See Recap`
- `View Capper`
- `Upgrade`
- `Open Thread`

Embed layout must leave room for buttons without becoming cluttered.

---

## Consistency Rules

Every embed family must have:
- one standard title pattern
- one standard field order
- one standard footer style
- one standard level of detail
- one standard behavior for missing data

No one-off formatting by channel or by bot module.

---

## Missing Data Rules

If required visible data is missing:
- do not fabricate it
- suppress the field cleanly
- degrade gracefully
- surface the problem internally if the missing data should not be missing

Do not show placeholders (`N/A`, `Unknown`, empty fake values) unless explicitly approved for internal/operator surfaces.

---

## Open Decisions

The following remain intentionally open for later docs or implementation:

- exact color system
- exact badge text system
- exact public tier display policy per surface
- whether recaps use one channel or multiple
- whether alerts are consolidated or split
- exact button set per message family

---

## Authority References

| Document | Role |
|----------|------|
| `docs/discord/discord_embed_system_spec_addendum_assets.md` | Headshot, logo, and visual asset rules |
| `docs/discord/pick_promotion_interim_policy.md` | Interim lane and promotion rules |
| `docs/discord/submitted_pick_contract_baseline.md` | Required pick fields and embed visibility rules |
| `docs/discord/daily_cadence_spec.md` | Posting schedules and event-driven triggers |
| `docs/02_architecture/tier_system_design_spec.md` | Tier definitions and display governance |

---

## Summary

This embed system is designed to:
- keep Discord outputs consistent across all surfaces
- preserve member trust through honest, clean presentation
- support both manual and model-qualified pick flows
- allow silent internal scoring without public contradiction
- create a premium, syndicate-level user experience
