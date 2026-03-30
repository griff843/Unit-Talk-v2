# COMMAND CENTER REDESIGN CONTRACT (V1.1 — FINAL)

## Status

FINAL — APPROVED FOR IMPLEMENTATION

---

# 1. PURPOSE

Command Center is the internal operator control and intelligence surface for Unit Talk.

It is the single place where an operator:

* verifies system truth
* monitors lifecycle health
* intervenes when automation fails
* settles and corrects picks
* confirms that results propagate into stats

Command Center replaces the need for direct database access for operational workflows.

---

# 2. PHASE 1 NORTH STAR

> Command Center must allow an operator, in the blink of an eye, to determine what parts of the Unit Talk lifecycle are working and what parts are not.

---

# 3. PHASE 1 SUCCESS CRITERIA

After a full end-to-end test pick:

An operator must be able to instantly determine:

* submission status
* scoring status
* promotion status
* Discord delivery status
* settlement status
* stats propagation status
* exact failure point (if any)

No external tools (DB, logs) are required.

---

# 4. SYSTEM HEALTH SIGNALS (REQUIRED)

Command Center must expose the following top-level signals:

## 4.1 Signals

* Submission
* Scoring
* Promotion
* Discord Delivery
* Settlement
* Stats Propagation

## 4.2 Status Values

Each signal must be one of:

* WORKING
* DEGRADED
* BROKEN

## 4.3 Definitions

### WORKING

* expected flow is occurring with no failures

### DEGRADED

* partial success OR delayed behavior OR intermittent failures

### BROKEN

* expected flow is not occurring OR consistently failing

## 4.4 Detection Basis

Each signal must be derived from actual system data:

* Submission → recent picks exist
* Scoring → picks have scores populated
* Promotion → picks reach promotion states
* Discord → delivery receipts exist
* Settlement → picks move from pending to settled
* Stats → stat values update after settlement

No hardcoded or fake signals allowed.

---

# 5. PHASE 1 CORE CAPABILITIES

For every pick, Command Center must support:

1. Immediate visibility after submission
2. Clear lifecycle state
3. Promotion + Discord delivery visibility
4. Pick detail + score visibility
5. Manual settlement
6. Correction after settlement
7. Final result visibility
8. Stats update confirmation

---

# 6. REQUIRED PHASE 1 SURFACES

## 6.1 System Truth Summary

Top-level dashboard showing:

* each health signal
* current status (WORKING / DEGRADED / BROKEN)
* simple explanation (e.g. "no receipts in last X mins")

---

## 6.2 Pick Lifecycle Table

This is the primary operating surface.

### Required Columns

* pick_id
* submitted_at
* submitter (capper or system)
* source (capper/system)
* sport / event
* pick_details (market, selection, line, odds)
* unit_size
* score
* lifecycle_status
* delivery_status
* settlement_status
* result (if settled)

### Requirements

* most recent picks visible
* no pagination required for Phase 1
* sorting optional (default: newest first)

---

## 6.3 Pick Detail View

Must display full trace:

### Required Sections

* submission details
* lifecycle transitions
* promotion state
* Discord delivery status
* score + metadata
* settlement records
* correction history
* operator/system action history

No hidden steps in lifecycle.

---

## 6.4 Manual Settlement Surface

Operators must be able to:

* mark: win / loss / push / void

### Requirements

* confirmation required before submit
* must record:

  * operator
  * timestamp
  * result

---

## 6.5 Correction Surface

Operators must be able to correct a settled pick.

### Rules

* original settlement remains stored
* correction creates a new record
* corrected result becomes effective
* correction requires confirmation

---

## 6.6 Stats Summary

Must display:

* total picks
* wins
* losses
* pushes
* ROI

### Requirements

* stats update immediately after settlement
* no delay or batch refresh dependency
* visible confirmation after action

---

# 7. REQUIRED STATE MODEL

Each pick must expose separate states:

## 7.1 Lifecycle Status

* submitted
* validated
* queued
* posted
* settled
* voided

## 7.2 Delivery Status

* not_promoted
* queued
* delivered
* failed
* dead_letter

## 7.3 Settlement Status

* pending
* settled
* corrected
* manual_review

These must be displayed independently.

---

# 8. OPERATOR ACTIONS (PHASE 1)

Allowed actions:

* manual settlement
* correction

### Requirements

All actions must:

* go through API (no direct DB writes)
* record:

  * operator
  * action
  * timestamp
  * target pick
* be reversible via correction (where applicable)

---

# 9. STATS PROPAGATION REQUIREMENT

After settlement:

* pick must be included in stats immediately
* stats must reflect:

  * total picks
  * win/loss/push counts
  * ROI impact

### Definition of "correct"

Stats are correct when:

* counts match number of settled picks
* result type is reflected
* ROI changes accordingly

---

# 10. EXCEPTION VISIBILITY

Command Center must surface:

* picks pending settlement too long
* failed Discord deliveries
* stuck lifecycle states
* missing scores
* missing results
* correction conflicts

These must be visible without manual investigation.

---

# 11. AUTHORITY MODEL

Command Center is NOT a direct database writer.

### Rules

* all writes go through API
* API enforces:

  * lifecycle rules
  * validation
  * audit logging

Command Center:

* initiates actions
* displays results

---

# 12. NON-GOALS (PHASE 1)

Not included:

* filtering system
* advanced analytics
* system pick approval workflow
* capper/user admin
* agent control
* safe mode / freeze
* research tools

---

# 13. ACCEPTANCE CRITERIA

Phase 1 is complete when:

1. A pick can be tracked from submission to settlement entirely in Command Center
2. An operator can instantly identify lifecycle failures
3. Manual settlement works reliably
4. Corrections preserve full history
5. Stats update immediately and correctly
6. No external tools are required

---

# 14. FINAL STATEMENT

Command Center Phase 1 is the **truth and control surface for the Unit Talk lifecycle**.

If an operator cannot instantly determine what is working and what is broken, the system has failed.

---

# 15. IMPLEMENTATION STACK

Phase 1 Command Center will be implemented as a dedicated application using the following stack:

### Frontend Framework
- Next.js (App Router)
- TypeScript

### UI System
- Tailwind CSS
- Component-based architecture (reusable UI primitives)

### Architecture Rules

1. Command Center is a standalone application surface
   - It must not be treated as an extension of the existing `apps/operator-web` service
   - It represents the long-term internal control plane

2. Separation of responsibilities must be preserved:
   - Command Center (UI) = display + operator actions
   - API = validation + business logic + database writes

3. No direct database writes from the UI
   - All state-changing actions (settlement, correction) must go through canonical API endpoints

4. Read data must come from governed sources
   - API endpoints or controlled read queries
   - No ad hoc direct database coupling

5. The existing `apps/operator-web` service may remain temporarily
   - It can continue serving as a lightweight monitoring/debug surface
   - It is not the long-term Command Center architecture
