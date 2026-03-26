# Unit Talk Server Information Architecture Spec
Version: Draft v1
Status: Design Spec
Scope: Discord server structure
Purpose: Define the intended Discord information architecture for Unit Talk before finalizing channel names, automation, and onboarding copy.

---

## 1. Objective

The Unit Talk Discord server should function as a structured product surface, not a loose collection of channels.

The information architecture should:

- make the server easy to understand quickly
- reduce clutter and confusion
- separate public, paid, and internal surfaces clearly
- support onboarding and conversion
- support future scale without constant restructuring

---

## 2. Design principles

1. **Clarity over channel count**
   Fewer high-value surfaces are better than many low-signal channels.

2. **Core surfaces first**
   The first channels a new user sees should explain the product and move them toward value.

3. **Visibility should match role**
   Free, trial, paid, capper, and staff users should not all see the same server.

4. **Discord should reflect product structure**
   Channel categories should map to actual user journeys and workflows.

5. **Keep expansion room**
   Reserve space for future surfaces without building all of them now.

---

## 3. Recommended top-level category model

### A. Entry / orientation
Purpose:
- first touchpoint for members
- explain what Unit Talk is
- move users into access flow

Candidate surfaces:
- welcome
- get-access
- rules / start-here
- announcements

### B. Core product surfaces
Purpose:
- the main member-facing product experience

Candidate surfaces:
- Best Bets
- Recaps
- premium analysis preview
- future command/help surface

### C. Capper surfaces
Purpose:
- capper boards and contributor-facing public/premium visibility

Candidate surfaces:
- capper channels
- capper-specific forum/thread structure
- future capper performance/proof surfaces

### D. Premium / tiered surfaces
Purpose:
- isolate higher-access experiences by tier

Candidate surfaces:
- VIP-only analysis
- VIP+-only analysis
- Trader Insights
- future Black Label private surfaces

### E. Community / engagement surfaces
Purpose:
- support retention and activity without distracting from the core board

Candidate surfaces:
- limited discussion/chat
- strategy discussion later if justified
- event/game-day discussion later if justified

### F. Internal operations
Purpose:
- staff, operator, and admin surfaces

Candidate surfaces:
- operator channels
- admin channels
- capper onboarding/private channels
- internal logs / coordination / support

---

## 4. Recommended visibility layers

### Layer 1 — Public / pre-access
Visible to new joins before trial or paid access.

Should include only:
- orientation
- access prompt
- rules
- limited trust-building surfaces

Goal:
- explain the server
- reduce confusion
- drive access claim

### Layer 2 — Trial / member value
Visible once trial or relevant access is granted.

Should include:
- main board surfaces
- recap/proof surface
- selected capper access
- selected premium previews if intentional

Goal:
- show real value quickly

### Layer 3 — Paid tier expansion
Visible based on tier:
- VIP
- VIP+
- future Black Label

Goal:
- make access differences visible and understandable
- avoid overwhelming lower tiers

### Layer 4 — Internal only
Visible only to:
- cappers
- operators
- admins
- moderators if used

Goal:
- keep internal workflow separate from customer-facing UX

---

## 5. Core surface definitions

### Welcome
Purpose:
- orient users
- establish brand and expectations

### Get Access
Purpose:
- claim trial
- view tier/access options
- move users into the right experience

### Rules / Start Here
Purpose:
- server expectations
- product usage expectations
- support burden reduction

### Best Bets
Purpose:
- primary board surface
- central value surface for members

### Recaps
Purpose:
- results
- proof
- performance visibility
- trust-building

### Trader Insights
Purpose:
- higher-access analysis surface
- premium value layer

### Capper surfaces
Purpose:
- give members direct access to specific cappers
- preserve capper identity within Unit Talk structure

---

## 6. Open architectural decisions

These must be resolved before final server buildout:

1. **How many capper surfaces should exist at launch?**
2. **Should cappers use channels, threads, or forums?**
3. **How much community/chat surface should exist early?**
4. **How visible should premium tiers be to lower tiers?**
5. **Should Trader Insights remain a distinct surface or be merged into premium analysis architecture?**
6. **How should future Game Day Live / event-based surfaces fit into the server?**
7. **What is the minimum viable public layer before access claim?**

---

## 7. Launch recommendation

### Build now
- entry/orientation layer
- access layer
- core board surface(s)
- recap/proof surface
- minimal capper architecture
- internal ops separation

### Defer
- broad community/chat sprawl
- full Black Label architecture
- complex event/day structures
- extra low-signal channels
- highly customized onboarding copy tied to channels not yet locked

---

## 8. Success criteria

The architecture is successful if:

- a new join can understand where to go within 30–60 seconds
- trial or paid users can reach value quickly
- premium members understand what they unlocked
- cappers and staff are separated cleanly from member flow
- the server can grow without major restructuring

---

## 9. Support surfaces

Unit Talk should explicitly support more than one help/support surface.

### General Support
Audience:
- public/new joins
- free users
- trial users
- general members

Purpose:
- onboarding questions
- access issues
- where-to-go questions
- general troubleshooting
- basic command/help routing

### VIP Support
Audience:
- VIP
- VIP+
- future Black Label if needed

Purpose:
- premium support needs
- tier/access troubleshooting
- premium workflow questions
- faster support routing for paid users

Design rule:
Support should match access level. Public and trial users should have a clear general support path, while paid users should have a more premium support experience.

---

## 10. Help / Support surface

A dedicated help/support surface should exist explicitly in the server architecture.

Purpose:
- answer common user questions
- reduce onboarding confusion
- handle access/tier issues
- provide a clear route for support without cluttering product channels

This surface should support:
- access questions
- trial issues
- upgrade questions
- where-to-go questions
- command/help routing

It should be easy to find, but should not overshadow the core product surfaces.

---

## 11. Channel lifecycle governance

Every channel or major Discord surface must have:

- Purpose
- Owner
- Audience
- Success condition
- Archive/deprecation rule

No channel should be launched without all five.

This rule exists to prevent Discord sprawl, dead channels, abandoned experiments, and low-signal clutter.

Channels that no longer meet their success condition or no longer serve a clear audience should be archived, merged, or deprecated intentionally rather than left in place indefinitely.
