# Unit Talk Entry Path & Invite Strategy

> **DRAFT — NOT IMPLEMENTED.** This is a pre-build design spec. The onboarding and invite entry path described here has not been built in V2. Do not treat this as current-state truth. When V2 implements an invite or entry path system, this doc should be re-evaluated as a starting point or replaced.

Version: Draft v1
Status: Design Spec
Purpose: Define how different types of users enter Unit Talk and how onboarding should account for source and role.

---

## 1. Objective

Not all users will arrive in the same way.

This strategy exists to make sure Unit Talk can:
- account for different join sources
- route users correctly
- preserve context where useful
- support both member growth and internal/staff invites

---

## 2. Main entry path types

### A. Public / cold traffic
Examples:
- website CTA
- link-in-bio
- public Discord invite
- partner/shiller invite
- organic social share

Goal:
- orient the user quickly
- establish value
- move them to access claim

### B. Warm / referred traffic
Examples:
- capper invite
- operator invite
- friend/member invite
- direct DM invite

Goal:
- preserve intent
- reduce friction
- accelerate path to value

### C. Internal / controlled traffic
Examples:
- capper invite
- staff invite
- admin/operator-created access path

Goal:
- assign correct role path immediately
- bypass consumer-style onboarding where appropriate

---

## 3. Entry-path strategy principles

1. **Track entry source where practical**
   Not every source needs a unique flow, but the system should allow source-aware routing later.

2. **Do not over-fragment invites early**
   Start with a manageable number of invite types.

3. **Separate internal invites from member invites**
   Staff and cappers should not enter through generic member paths if avoidable.

4. **Public joins should still feel premium**
   Even cold traffic should enter a controlled, clear experience.

---

## 4. Recommended initial invite model

### Invite Type 1 — Public Member Invite
Use for:
- website
- social
- public share
- partner/shiller traffic

Routes to:
- standard member onboarding
- access claim flow

### Invite Type 2 — Referred Member Invite
Use for:
- capper referrals
- member referrals
- operator personal invites

Routes to:
- member onboarding
- potentially shortened path to value later

### Invite Type 3 — Capper Invite
Use for:
- invited contributors

Routes to:
- capper onboarding path
- role assignment workflow

### Invite Type 4 — Staff Invite
Use for:
- operators
- admins
- moderators

Routes to:
- staff onboarding path
- internal setup flow

---

## 5. What should happen on join

At a minimum, the system should determine:

1. Is this a member or staff-type join?
2. If member, do they need:
   - orientation
   - trial claim
   - immediate paid routing
3. If staff/capper, should they bypass member onboarding?

---

## 6. Deferred strategy options

These should be considered later, not necessarily at launch:

- referral attribution by invite source
- source-based tailored welcome messaging
- capper-specific referral tracking
- partner/shiller performance tracking
- source-aware upgrade prompts
- source-based onboarding optimization

---

## 7. Launch recommendation

### Build now
- simple invite type separation
- member vs capper vs staff entry distinction
- standard member onboarding path
- role-appropriate routing

### Defer
- heavy attribution logic
- complex source-personalized onboarding
- advanced referral analytics
- too many invite variants

---

## 8. Success criteria

This strategy is successful if:

- public members enter a clear, premium flow
- referred users do not lose momentum
- cappers and staff avoid generic member onboarding
- invite complexity stays manageable
- future source-aware optimization remains possible
