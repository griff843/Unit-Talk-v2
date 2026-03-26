# Unit Talk Onboarding Content Architecture
Version: Draft v1
Status: Design Spec
Authority: Planning / product architecture — not implementation truth
Depends on:
- ONBOARDING_ARCHITECTURE_SPEC.md
- ONBOARDING_FLOW_MAP.md
- SERVER_INFORMATION_ARCHITECTURE_SPEC.md
- ROLE_ACCESS_MATRIX.md
- ENTRY_PATH_INVITE_STRATEGY.md

---

## 1. Objective

This document defines the content surfaces, message types, trigger points, and content responsibilities for Unit Talk's onboarding system.

It does not define final copy. Final copy is deferred until surfaces and trigger model are confirmed.

---

## 2. Content architecture principles

1. **Content should follow flow.** Each surface maps to a specific moment in the user's progression. Content that appears out of step creates confusion.

2. **Every content surface has one main job.** Welcome, orient, explain access, route to support — not all at once.

3. **Universal first, role-specific second.** All users receive a consistent baseline. Role and state-specific content layers on top.

4. **Support clarity beats cleverness.** Tone should be direct and functional. This is not a marketing surface.

5. **Content should reinforce value and access.** Each touchpoint should remind the user what they can do and what they stand to gain.

6. **Final copy is last.** Structure and ownership are finalized first. Polished language follows implementation.

---

## 3. Main content surface types

| Type | Description |
|---|---|
| Static channel surfaces | Pinned or permanent content in dedicated channels (rules, start-here, etc.) |
| Triggered join/role messages | Automated DM or in-server messages sent on join or role assignment |
| Reminder/transition messages | Time-based or state-based messages (trial expiry, upgrade prompt) |
| Support-routing content | Channel intros and prompts that route users to the correct support path |
| Role-specific setup content | Onboarding content sent only to cappers, staff, or operators |

---

## 4. Universal onboarding content set

All users, regardless of role or access tier, should encounter:

| Surface | Purpose |
|---|---|
| Welcome content | Confirm they're in the right place; set tone |
| Get Access content | Explain access tiers, trial path, paid options |
| Rules / Start Here content | Community standards, posting rules, channel guide |
| Help / Support content | How to get help and where to go |
| First-value orientation content | Direct users to the first thing they should see or do |

---

## 5. Role-specific onboarding content sets

### Member content set
- Trial activation path
- VIP/VIP+ unlock confirmation
- Paid tier orientation
- Upgrade pathway from free/trial

### Capper content set
- Capper welcome and role confirmation
- Posting expectations and channel access
- Internal tool orientation (if applicable)
- Capper-specific rules and conduct expectations

### Staff content set
- Staff/operator welcome
- Access confirmation and role boundaries
- Internal channel and tool orientation
- Escalation and responsibility overview

---

## 6. Content by user state

| User State | Required Content |
|---|---|
| Public / New Join | Welcome, Rules/Start Here, Get Access, Help routing |
| Free | Welcome (confirmed), Get Access (trial CTA), first-value orientation |
| Trial | Trial unlock confirmation, what they can access, trial expiry awareness |
| VIP new join | Paid welcome, VIP orientation, support routing (VIP Support) |
| VIP+ new join | Paid welcome, VIP+ orientation, support routing (VIP Support) |
| In-server upgrade | Upgrade confirmation, new access orientation, no full re-onboarding |
| Capper | Capper welcome/setup, expectations, internal orientation |
| Staff | Staff welcome/setup, internal orientation, access confirmation |

---

## 7. Required onboarding content surfaces

| Surface | Purpose | Audience |
|---|---|---|
| Welcome surface | First touchpoint; confirm right place; set tone | All new joins |
| Get Access surface | Explain tiers and trial path | Public, Free |
| Rules / Start Here surface | Community rules, channel guide, conduct expectations | All |
| General Support surface | Routing for free/trial/public support requests | Public, Free, Trial |
| VIP Support surface | Routing for paid tier support requests | VIP, VIP+ |
| Trial unlock content | Confirm trial activation; explain what's accessible | Trial |
| Trial expiry content | Notify of expiry; present upgrade path | Trial (expiring) |
| Paid unlock content | Confirm paid access; orient to paid experience | VIP, VIP+ |
| Capper welcome/setup surface | Role confirm; posting expectations; internal access | Capper |
| Staff welcome/setup surface | Role confirm; internal channels; responsibility overview | Staff, Operator, Admin |

---

## 8. Universal vs role-specific content

### Universal (all users receive)
- Welcome message
- Rules/Start Here
- Help/Support routing (general)
- First-value orientation

### Role-specific (state or role-gated)
- Trial activation / expiry messages
- Paid unlock messages
- VIP Support routing
- Upgrade prompt content
- Capper setup sequence
- Staff setup sequence
- In-server upgrade confirmation

---

## 9. Trigger model

| Trigger | Content fired |
|---|---|
| New member join | Welcome, Rules/Start Here, Get Access |
| Trial activation | Trial unlock confirmation, what's accessible, expiry window |
| Trial approaching expiry | Expiry reminder (timing TBD — see open questions) |
| Trial expiry | Expiry notice, upgrade path, access downgrade explanation |
| Paid new join | Paid welcome, VIP/VIP+ orientation, VIP Support routing |
| Paid upgrade inside server | Upgrade confirmation, new access summary (no full re-onboard) |
| Capper invite accepted | Capper welcome, setup content, posting expectations |
| Staff invite accepted | Staff welcome, internal orientation, access confirmation |

---

## 10. Free vs Trial content requirements

### Free content must communicate:
- What free access includes
- What is not included
- How to start a trial or upgrade
- Where to get help

### Trial content must communicate:
- Trial is active and time-limited
- What they now have access to
- How long the trial lasts
- What happens when it expires
- How to upgrade before expiry

### Trial-expiry content must communicate:
- Trial has ended
- Access has changed (what they lost)
- Upgrade path is available
- No punitive framing — clear and functional

---

## 11. Support content model

Support routing should reflect the actual server architecture:

| Tier | Support path |
|---|---|
| Public / New Join / Free / Trial | General Support channel |
| VIP / VIP+ (and future Black Label) | VIP Support channel |
| Capper | Internal capper support path |
| Operator / Admin | Internal ops path |

Each support surface should have a brief channel intro or pinned message that tells the user: what this channel is for, who to ping, and what to include in a support request.

---

## 12. Content ownership model

Every onboarding content surface must define:

| Field | Description |
|---|---|
| Purpose | What job this surface does |
| Audience | Who receives or sees it |
| Owner | Who is responsible for keeping it current |
| Update trigger | What event should prompt a content review |
| Archive/deprecation rule | When this surface is retired and what replaces it |

Ownership should be assigned before any surface goes live. A surface with no owner should not be published.

---

## 13. What should be finalized now vs later

### Finalize now
- Content surface list (this document)
- Content purpose per surface
- Trigger model
- Universal vs role-specific split
- Free vs Trial content requirements
- Support content structure

### Defer until surfaces are confirmed
- Final polished copy
- Exact DM/embed wording
- Final CTA language
- Advanced personalization
- Source-specific content variants (e.g. different copy for cold join vs paid link)
- Final automation sequencing

---

## 14. Launch recommendation

### Build first
- Welcome surface
- Rules / Start Here surface
- Get Access surface
- General Support routing surface
- Trial unlock and expiry content
- Paid unlock content

### Defer
- VIP Support surface (build when VIP channel activation is live)
- Capper setup sequence (build alongside capper invite flow)
- Staff setup sequence (build alongside staff onboarding)
- In-server upgrade content (build alongside upgrade automation)
- Advanced reminder sequences

---

## 15. Success criteria

- Every major user state (Public, Free, Trial, VIP, VIP+, Capper, Staff) has clearly defined content surfaces
- Support routing is explicit — no user lands somewhere with no guidance on where to go
- Free vs Trial distinction is clear in all relevant surfaces
- Paid unlock works without requiring a full re-onboarding
- Capper and staff content is separated cleanly from member-facing content
- Every surface has an assigned owner before launch

---

## 16. Open implementation questions

1. Which surfaces are static channel-based vs triggered-message-based?
2. Should trial activation and expiry messages be delivered via DM or in-server notification?
3. How many trial-expiry reminders are needed, and at what intervals?
4. How much of the proof/recap content should Free users permanently see?
5. How does upgrade-inside-server get detected and trigger content without re-running full onboarding?
6. Should capper and staff onboarding use the same message format as member onboarding, or a distinct internal template?
7. Is there a difference in content for VIP vs VIP+ beyond channel access?

---

## 17. Recommended next step

Before building any individual content surface or writing copy:

**Do one server architecture refinement pass first.**

Confirm the channel structure, support lanes, and role model are stable. Then return to this document to produce an implementation-ready surface map with final owners, trigger wiring, and copy briefs.

Starting copy before structure is confirmed wastes effort and creates drift.
