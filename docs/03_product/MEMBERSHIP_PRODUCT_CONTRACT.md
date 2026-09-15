# Unit Talk Membership Product Contract

## Metadata

| Field | Value |
| --- | --- |
| Owner | Griff |
| Status | RATIFIED |
| Ratified | 2026-09-10 |
| Type | Product authority |
| Scope | Final membership product, tier entitlements, public promises, and activation rules |
| Readiness authority | docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md |
| Runtime access authority | docs/03_product/MEMBER_ROLE_ACCESS_AUTHORITY.md |
| Surface registry | docs/03_product/PLATFORM_SURFACES_AUTHORITY.md |

## 1. Purpose

This contract defines what Unit Talk is intended to become and the membership experience that the website, Discord server, applications, data model, commands, alerts, onboarding, support, and marketing must collectively deliver.

It is the canonical product destination for all LLMs, agents, designers, engineers, operators, and reviewers. Product plans and implementation choices must move Unit Talk toward this contract unless Griff ratifies a change.

This contract defines customer promises. It does not claim that every promise is implemented, deployed, connected, or production-ready today.

## 2. Product Promise

Unit Talk is a trustworthy sports-betting intelligence and pick-tracking platform delivered primarily through Discord and supported by web and operator surfaces.

Its core customer value is:

1. Fast and dependable access to official capper picks.
2. Complete and transparent settled results.
3. Traceable capper performance and honest statistics.
4. Actionable market, line-movement, injury, hedge, and middle intelligence.
5. Personalized decision-support and bankroll tools at higher tiers.
6. A coherent community, education, and support experience.

Unit Talk does not ship decorative features merely to expand a feature list. Every activated feature must be useful, understandable, reliable, supported by truthful data, and observable by operators.

## 3. Interpretation Rules

### 3.1 Final product versus current availability

Every capability has two independent truths:

- Product commitment: whether this contract includes it in the intended final product.
- Activation state: whether live evidence proves it is safe and usable now.

A capability in this contract must not be advertised as live merely because code, schema, tests, a specification, or a Discord channel exists.

Allowed activation states are:

| State | Meaning |
| --- | --- |
| Future | Committed product destination; implementation may not exist |
| Foundation | Some code, schema, or design exists; no complete usable product |
| Implemented | Intended implementation exists but is not proven in its real integration path |
| Pilot | Available only to an explicitly bounded test population |
| Live | Deployed, connected, operator-observable, and behaviorally proven |
| Production-ready | Meets every applicable requirement of the production-readiness contract |
| Parked | Intentionally disabled or unavailable |
| Retired | No longer part of the product |

Current activation state must come from live runtime, database, deployment, Discord, and exact-SHA evidence. It must never be inferred from this contract.

### 3.2 Entitlement authority

For final membership entitlements and customer-facing promises, this contract supersedes conflicting entitlement descriptions in older product or operational documents, including:

- docs/03_product/MEMBER_ROLE_ACCESS_AUTHORITY.md
- docs/05_operations/PS_M1_COMMERCIAL_FOUNDATION_CONTRACT.md
- docs/03_product/PLATFORM_SURFACES_AUTHORITY.md
- docs/03_product/DISCORD_COMMAND_CATALOG.md
- docs/discord/*.md

Those documents remain authoritative within their proper scope for implemented runtime behavior, surface mechanics, message contracts, or current access until reconciled. When present runtime differs from this contract, agents must report a product gap; they must not rewrite this contract to match incomplete implementation.

### 3.3 Public transparency rule

All members, including Free and Trial, may see the complete settled record after a pick is settled.

The complete settled record includes, where applicable:

- every settled official pick
- capper identity
- sport, event, market, selection, and recorded odds
- result: win, loss, push, void, or correction
- stake in units
- units won or lost
- capper record
- ROI
- CLV only when supported by canonical evidence
- daily, weekly, and monthly recaps
- corrections and their audit history

Free access to settled results never grants access to an active paid pick before settlement. Active picks, live advice, and premium alerts remain controlled by tier.

No losing pick may be hidden, deleted, relabeled, or omitted to improve perceived performance. Corrections must preserve the original record and disclose the correction.

## 4. Membership Model

The customer membership progression is:

Free → Trial → VIP → VIP+ → Black Label

Capper and Operator are internal functional roles, not customer pricing tiers. A person may hold an internal role and a customer membership simultaneously.

### 4.1 Free

Purpose: demonstrate trust, provide community value, and let prospective members verify Unit Talk's complete historical performance without receiving the paid live feed.

Entitlements:

- general chat and community threads
- public announcements and major service alerts
- free picks or parlay previews when explicitly enabled
- educational samples, server rules, FAQs, guides, and public resources
- basic onboarding, auto-welcome, server map, and information center
- suggestions and feedback
- all settled picks, recaps, results, corrections, capper records, units, and ROI
- truthful CLV fields where canonical evidence exists
- public or Free-authorized help, results, recap, and statistics surfaces

Restrictions:

- no access to active official paid picks before settlement
- no premium real-time pick alerts
- no VIP or VIP+ private discussion surfaces
- no advanced alert or personalized decision-support entitlement unless separately made public

### 4.2 Trial

Purpose: give a prospective member the genuine VIP experience before conversion.

Commercial policy:

- seven consecutive days
- introductory price: $1
- exact billing, renewal, cancellation, eligibility, and abuse-prevention mechanics are implemented through the approved commerce system and must be disclosed clearly
- repeat-trial eligibility is not promised and must be governed by an approved policy

Entitlements while active:

- every Free entitlement
- full VIP access
- all official capper picks in real time
- all VIP alerts, channels, commands, capper surfaces, education, events, and support
- all settled recaps and results

Restrictions:

- Trial does not include VIP+ or Black Label entitlements
- expiry must fail closed and remove paid access through the intended commerce-to-role lifecycle
- trial expiration must not erase the member's historical identity or settled activity

### 4.3 VIP

Price: $49.99 per month unless Griff ratifies a pricing change.

Purpose: the primary paid membership for official picks, transparent performance, community access, and dependable real-time delivery.

Entitlements:

- every Free entitlement
- every official capper pick across supported sports
- real-time Discord alerts for official picks
- Capper Corner and capper-specific pick, discussion, or Q&A surfaces
- complete daily, weekly, and monthly recaps
- graded performance by capper, sport, market, and ticket type where supported
- private VIP community, insights, strategy, and live-event surfaces
- early access to general giveaways, contests, promotions, podcasts, and community sessions
- sport and alert-type notification roles
- core member commands, including applicable recap, result, leaderboard, and capper-stat commands
- Education Vault
- onboarding and upgrade support

VIP delivery must be complete and timely. “All official picks” means every pick designated for the official paid feed is either delivered successfully or appears in an operator-visible exception with an explicit failure state.

### 4.4 VIP+

Price: reserved for Griff's approval; no agent may invent or publish a price.

Purpose: add actionable market intelligence, deeper analytics, expanded personalization, and premium access on top of VIP.

Final entitlements:

- every VIP entitlement
- real-time steam and material line-movement alerts
- trustworthy injury alerts tied to affected events, players, markets, or active picks
- hedge alerts and middle opportunities
- personalized hedge or profit-protection triggers when member ticket data supports them
- personal bet tracking and ROI analytics by sport, market, capper, and time period
- AI-assisted ticket analysis and actionable decision support
- advanced analytics, trends, probabilities, and market context
- hot/cold streak tracking with sample-size and recency context
- AI-powered streak and fade signals with transparent basis and limitations
- VIP+ giveaways and contests
- Strategy Lab or Syndicate Room access, including live calls, roundtables, and recorded workshops
- early beta access to new tools
- personalized recaps and capper comparisons
- priority support
- expanded notification filters by sport, capper, alert type, and delivery preference
- approved external notification methods such as email, SMS, or WhatsApp
- advanced commands such as edge tracking, AI assistance, trend analysis, and expected-value reports when individually activated

A VIP+ capability must not be advertised merely because detection logic exists. Personalized claims require member-specific persisted data and proof that the output is calculated for that member.

### 4.5 Black Label

Status: committed future tier; PARKED FOR SALE AND ACTIVATION.

Price: reserved. Griff may later choose a price within or outside the previously considered range. No price is authoritative until ratified.

Purpose: a limited, high-touch elite tier combining advanced software, individualized risk controls, data access, and human or AI concierge service.

Final intended entitlements:

- every VIP+ entitlement
- bankroll tracking and staking recommendations using flat, Kelly, fractional-Kelly, or approved custom policies
- overexposure, concentration, drawdown, and cold-streak warnings
- real-time multi-book line shopping and odds comparison
- alerts when a materially better line becomes available
- personalized 1:1 betting concierge or advanced contextual AI
- private invite-only Syndicate Room
- small-group calls, Q&A, workshops, and live market sessions
- customer data export and approved API or Google Sheets integration
- referral and rewards dashboard
- alpha access to selected products
- expanded white-glove notification and support options
- optional periodic portfolio review by an assigned human or approved AI risk officer

Black Label may not be sold, advertised as available, assigned as a live role, or exposed as a purchasable website plan until Griff separately approves activation after evidence shows:

- VIP and VIP+ operate reliably
- member ticket, bankroll, and exposure data are trustworthy
- staking and risk outputs include appropriate controls and explanations
- privacy, retention, security, responsible-gambling, and legal requirements are approved
- concierge and support capacity exist
- every activated Black Label promise has an operator owner and failure path
- applicable production-readiness evidence passes

## 5. Cross-Tier Entitlement Matrix

| Capability | Free | Trial | VIP | VIP+ | Black Label |
| --- | --- | --- | --- | --- | --- |
| Community and public information | Yes | Yes | Yes | Yes | Yes |
| All settled picks and complete results | Yes | Yes | Yes | Yes | Yes |
| All recaps and corrections | Yes | Yes | Yes | Yes | Yes |
| Active official picks before settlement | No | Yes | Yes | Yes | Yes |
| Real-time official pick alerts | No | Yes | Yes | Yes | Yes |
| VIP private community and education | No | Yes | Yes | Yes | Yes |
| Steam and advanced market alerts | No | No | No | Yes | Yes |
| Injury intelligence | No | No | No | Yes | Yes |
| Hedge and middle intelligence | No | No | No | Yes | Yes |
| Personal bet tracking and analytics | No | No | No | Yes | Yes |
| AI ticket assistance | No | No | No | Yes | Yes |
| External notification methods | No | No | No | Yes | Yes |
| Bankroll and staking system | No | No | No | No | Yes |
| Advanced line shopping | No | No | No | No | Yes |
| 1:1 concierge and portfolio review | No | No | No | No | Yes |
| Customer export/API | No | No | No | No | Yes |

A “Yes” defines the final entitlement. It is not evidence of current activation.

## 6. Product-Wide Requirements

Every customer-facing feature must satisfy all applicable requirements below before activation:

1. A clear user problem and expected outcome.
2. A canonical data source and truthful provenance.
3. A defined schema and lifecycle.
4. Correct tier, role, command, route, and channel authorization.
5. Safe failure behavior with no silent success.
6. Operator visibility into success, suppression, delay, and failure.
7. Idempotency or duplicate protection where repeated delivery is possible.
8. Auditability and correction semantics.
9. Monitoring and actionable alerting.
10. A tested rollback, disable control, or containment path.
11. Accurate website, Discord, onboarding, help, and upgrade language.
12. Behavior-level proof through the intended real integration path.
13. Compliance with the production-readiness contract where applicable.

Features that cannot meet these conditions remain Future, Foundation, Implemented, Pilot, or Parked.

## 7. Truthful Analytics and Responsible Use

- Records, ROI, units, streaks, CLV, edge, expected value, probabilities, and recommendations must be derived from canonical persisted data.
- Missing evidence must render as unavailable or unproven, never as zero, success, or a fabricated value.
- Sample size, measurement window, and material limitations must accompany performance or streak claims.
- Simulation and backtesting must be labeled and must not be presented as live performance.
- AI output is decision support, not certainty. It must expose its basis and limitations.
- Personalized staking or hedge advice requires the relevant member inputs and current position data.
- Unit Talk must not encourage chasing losses, reckless staking, or misleading guarantees.
- No feature may claim guaranteed profit except a mathematically verified arbitrage calculation whose prices remain executable; even then, execution and availability risks must be disclosed.

## 8. Product Surface Alignment

The following must be derived from this contract and kept consistent:

- public website pricing and feature comparison
- purchase and upgrade pages
- Discord categories, channels, roles, and permissions
- Whop products and role mappings
- onboarding and trial-expiry journeys
- Smart Form and capper workflows
- member commands and command visibility
- Command Center operator views
- notification preferences
- schema and member identity model
- analytics and recap presentation
- support documentation and FAQs
- product roadmaps and acceptance criteria

Discord is the primary delivery surface, not the source of product truth. Manual Discord configuration must be audited against this contract.

## 9. Required Derived Contracts and Audits

This contract requires, but does not itself contain:

1. A Discord information-architecture and permissions contract.
2. A live Discord configuration audit against that contract.
3. A website information architecture, pricing, and claims contract.
4. A Whop billing, trial, role-sync, cancellation, and entitlement contract.
5. A canonical feature capability ledger mapping each entitlement to code, schema, runtime, proof, owner, and activation state.
6. A member identity, ticket, notification-preference, and analytics data contract.
7. Individual activation contracts for high-risk or advanced features.
8. Reconciliation updates to older tier, command, channel, and surface documents that conflict with this contract.

## 10. Change Control

Griff is the final authority for:

- tier creation or removal
- pricing
- trial commercial policy
- moving a capability between tiers
- changing public settled-result transparency
- activating Black Label
- customer-money, automated wagering, or execution features
- materially changing public product promises

Agents may design and implement within this contract, but they may not silently narrow, expand, reinterpret, or advertise its promises.

Changes require an explicit owner decision and a governed repository change. Chat history, marketing drafts, implementation convenience, current technical limitations, or agent preference do not override this contract.

## 11. Acceptance Test for Product Alignment

A website, Discord design, feature specification, or implementation plan aligns with this contract only when:

- every displayed tier matches the entitlement matrix
- Free and Trial can access all settled recaps and results
- Free cannot access active paid picks before settlement
- Trial receives the complete VIP experience and no automatic VIP+ entitlement
- VIP remains the complete official-pick membership
- VIP+ capabilities are not described as personalized without member-specific data
- Black Label is shown only as future or unavailable until separately activated
- unproven capabilities are not marketed as live
- prices are not invented
- analytics and performance claims remain evidence-backed
- actual runtime and Discord access gaps are reported rather than concealed
