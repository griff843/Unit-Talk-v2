# Unit Talk Onboarding Architecture Spec

> **DRAFT — NOT IMPLEMENTED.** This is a pre-build design spec. The Discord onboarding flow described here has not been implemented in V2. The capper onboarding intent (separate from member onboarding) is partially real — cappers use Smart Form + Discord bot commands. Full automated member onboarding has not been built. Do not treat this as current-state truth.

Version: Draft v1
Status: Design Spec
Scope: Discord product architecture
Purpose: Define the onboarding framework for Unit Talk before finalizing channel structure, messaging, and automation.

---

## 1. Objective

Unit Talk onboarding is not just a welcome flow.

It is a routing and conversion layer that should:

1. identify who the person is
2. route them into the correct experience
3. show value quickly
4. move them to the correct next action
5. set expectations for how Unit Talk works

This spec defines the framework, not the final copy.

---

## 2. Primary onboarding goals

### Member / prospect goals
- explain what Unit Talk is at a high level
- reduce confusion
- show immediate value
- drive trial or access claim
- support upgrade conversion later
- keep the first experience clean and premium

### Capper goals
- separate cappers from member onboarding
- assign the right internal surfaces
- explain posting expectations and role boundaries
- make setup feel structured and professional

### Operator / admin goals
- separate staff from consumer onboarding
- route them into internal tools and channels quickly
- clarify internal responsibilities and access

---

## 3. Guiding principles

1. **One server, multiple onboarding experiences**
   Not every user should enter the same flow.

2. **Role before copy**
   We should know who the user is before deciding what they see.

3. **Value before explanation**
   Users should feel the value of Unit Talk early.

4. **Clean first, detailed second**
   The first experience should be simple and focused.

5. **Architecture now, final polish later**
   Final copy and automation should wait until server structure is locked.

---

## 4. User types

### A. Public member
Examples:
- website CTA
- social link
- public Discord invite
- partner/shiller invite
- organic shared invite

Goal:
- orient quickly
- explain value
- move to trial / access claim

### B. Referred member
Examples:
- capper invite
- operator invite
- friend/member invite
- private DM invite

Goal:
- preserve momentum
- reduce friction
- get them to value surfaces faster

### C. Trial user
Goal:
- expose the right surfaces quickly
- demonstrate value
- prepare upgrade conversion

### D. Paid member
Includes:
- VIP
- VIP+
- future Black Label

Goal:
- route immediately to correct tier experience
- remove redundant trial messaging

### E. Capper
Goal:
- provide contributor-specific onboarding
- clarify posting ownership and visibility
- separate from customer flow

### F. Operator / Admin / Staff
Goal:
- route to internal operations
- provide role-specific setup
- avoid consumer-facing onboarding flow

---

## 5. Onboarding tracks

### Track 1 — Member onboarding
For:
- public joins
- referred joins
- trial users
- free users
- VIP / VIP+ / future Black Label

Purpose:
- explain Unit Talk
- direct users to access
- show the board
- explain tiers
- convert

### Track 2 — Capper onboarding
For:
- invited cappers
- contributors
- future expert roles

Purpose:
- confirm role and permissions
- explain posting expectations
- route them to capper-only surfaces

### Track 3 — Staff onboarding
For:
- operators
- admins
- moderators
- internal team

Purpose:
- define tools, permissions, and responsibilities
- route them to internal surfaces
- keep them out of member onboarding

---

## 6. Arrival path model

Onboarding should account for both **entry source** and **user type**.

### Public entry paths
- website
- social
- public Discord invite
- organic invite
- partner/shiller link

### Warm/referral entry paths
- capper invite
- operator invite
- member invite
- direct referral

### Internal entry paths
- capper invite
- staff invite
- admin/operator-added user

---

## 7. Routing logic

Onboarding should answer two questions immediately:

1. What type of user is this?
2. What should they see first?

### Recommended routing model

#### Public / cold member
First destination:
- welcome
- access/trial prompt
- rules/start-here
- limited preview surfaces

#### Referred member
First destination:
- welcome
- access/trial prompt
- faster path to value
- optional referral tracking later

#### Trial user
First destination:
- main value surfaces
- board access
- recap/proof surfaces
- upgrade visibility

#### VIP / VIP+
First destination:
- correct tier surfaces immediately
- no trial messaging

#### Capper
First destination:
- capper onboarding area
- role expectations
- internal capper channels

#### Operator / admin
First destination:
- staff setup
- internal ops channels
- operator/admin instructions

---

## 8. Universal onboarding surfaces

These are the surfaces most users should touch in some form.

### 1. Welcome surface
Purpose:
- orient the user
- establish brand tone
- explain Unit Talk at a high level

### 2. Access surface
Purpose:
- claim trial
- understand tiers
- understand what unlocks what

### 3. Rules / expectations surface
Purpose:
- establish standards
- reduce confusion
- prevent support burden

### 4. First-value surface
Purpose:
- show something worth staying for

Candidate examples:
- Best Bets
- recap / proof surface
- capper board preview
- premium preview surface

---

## 9. Role-specific onboarding surfaces

### Capper onboarding surfaces
- capper welcome/setup
- posting expectations
- role boundaries
- escalation/support path

### Staff onboarding surfaces
- internal ops welcome
- permissions
- workflows
- escalation and communication standards

---

## 10. Tier implications

Current tier model:
- Free
- Trial
- VIP
- VIP+
- Black Label (reserved, not active)

### Black Label positioning
Black Label is the highest-access tier, designed for serious bettors who want a deeper level of access, insight, and edge. Coming soon.

Do not design a full Black Label onboarding flow yet.
Reserve architectural space only.

---

## 11. What must be locked before final onboarding copy

1. channel structure
2. role/access matrix
3. invite/link strategy
4. first-value surface
5. final gated vs public visibility model

---

## 12. What should be built now

Build now:
- onboarding architecture
- user-type and arrival-path logic
- access/tier framework
- role-specific onboarding framework

Do later:
- final DM copy
- final welcome embeds
- final upgrade messaging
- final automated flows
- exact CTA wording

---

## 13. Next dependent specs

This onboarding spec depends on:
1. Server Information Architecture Spec
2. Role & Access Matrix
3. Entry Path / Invite Strategy

These should be finalized before final onboarding content.

---

## 14. Support routing

Onboarding should route users to the correct support surface based on role and access level.

- public / new / free / trial users → General Support
- VIP / VIP+ users → VIP Support
- cappers / staff → internal support or ops path

Support routing should be explicit in onboarding and should reduce confusion without sending all users into the same support surface.

---

## 15. Support / help expectations

Onboarding should explicitly route users to a help/support surface when needed.

This is especially important for:
- new joins
- trial users
- paid users with access confusion
- users entering from different invite paths

Support should be treated as an explicit onboarding aid, not an assumed side channel.
