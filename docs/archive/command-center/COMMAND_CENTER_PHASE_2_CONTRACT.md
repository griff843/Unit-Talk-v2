# COMMAND CENTER PHASE 2 CONTRACT

## Status

DRAFT — READY FOR IMPLEMENTATION

---

# 1. PURPOSE

Phase 2 expands Command Center from a lifecycle truth and settlement surface into an **operator review and performance workspace**.

Phase 2 must allow operators to:

* review system-generated picks before they are allowed to move forward
* make explicit decisions on those picks
* filter and search the pick universe efficiently
* understand capper and system performance without leaving Command Center
* audit past review decisions and use them to improve the system over time

Phase 2 builds directly on Phase 1 and does not replace it.

---

# 2. PHASE 2 NORTH STAR

> Command Center Phase 2 must let an operator actively manage system pick flow and evaluate platform performance from one place.

---

# 3. PHASE 2 SUCCESS CONDITION

An operator can:

1. Open Command Center and immediately see which system picks need review
2. Approve, deny, or hold a system-generated pick with a recorded reason
3. Revisit held picks later and resolve them
4. Filter and search picks efficiently across key operational dimensions
5. See day / week / month performance for cappers and system
6. Review prior decision history and later outcomes without needing direct DB access

---

# 4. CORE PHASE 2 CAPABILITIES

## 4.1 System Pick Review

Command Center must support a dedicated review workflow for system-generated picks.

Operators must be able to:

* approve
* deny
* hold

Each decision must record:

* operator
* timestamp
* decision
* reason

---

## 4.2 Held Pick Management

Held picks must remain visible and actionable.

Operators must be able to:

* view all held picks
* release a held pick back into review
* approve or deny a held pick later

Hold is a real tracked state, not a soft deny.

---

## 4.3 Filtering and Search

Operators must be able to narrow the pick universe quickly.

Minimum filters:

* capper
* source (capper/system)
* date / date range
* lifecycle status
* settlement status
* review status
* delivery status
* tier
* unit size
* sport

Minimum search:

* pick ID
* capper name
* event / player / team / market text

---

## 4.4 Performance Intelligence

Command Center must show internal operator performance visibility.

Required time windows:

* today
* week
* month

Required splits:

* overall
* by capper
* by system
* by sport
* by source type

Required core stats:

* total picks
* wins
* losses
* pushes
* ROI
* hit rate
* average score
* approved / denied / held counts for system picks

---

## 4.5 Decision Audit

Operators must be able to review the history and outcomes of system-pick decisions.

Must support visibility into:

* approved picks and later results
* denied picks and later results
* held picks still unresolved
* decision counts by operator
* reason history for decisions

This is the beginning of the system feedback loop.

---

# 5. REQUIRED PHASE 2 SURFACES

## 5.1 Expanded Home Surface

The Home surface must retain all Phase 1 truth/status elements and add:

* picks awaiting review
* held picks count
* picks awaiting settlement
* top current exceptions
* today / week / month performance summary

---

## 5.2 Review Queue

A dedicated queue of system-generated picks awaiting operator decision.

Each row must include:

* pick ID
* generated at
* source/model identity if available
* sport / event
* pick details
* unit size
* score
* score component summary if available
* current status
* operator action buttons

Required actions:

* approve
* deny
* hold

---

## 5.3 Held Queue

A dedicated queue of system picks in held status.

Each row must include:

* original pick details
* date held
* held by
* hold reason
* current age in held state

Required actions:

* return to review
* approve
* deny

---

## 5.4 Performance View

A dedicated surface for operator intelligence.

Must provide:

* today / week / month summaries
* capper performance table
* system performance summary
* by-sport breakdown
* source-type comparison

---

## 5.5 Decision Audit View

A dedicated surface for review history.

Must provide:

* decision history table
* decision reason visibility
* later result visibility
* ability to compare reviewed picks against actual outcomes

---

# 6. REQUIRED REVIEW STATE MODEL

Phase 2 introduces explicit review states for system picks:

* pending_review
* approved
* denied
* held

These must be separate from:

* lifecycle status
* delivery status
* settlement status

They must not be conflated.

---

# 7. OPERATOR ACTIONS (PHASE 2)

Allowed actions in Phase 2:

* approve system pick
* deny system pick
* hold system pick
* return held pick to review

Each action must:

* go through API
* record operator
* record timestamp
* record decision
* require reason input

---

# 8. REQUIRED SYSTEM QUALITIES

Phase 2 must remain:

## Truthful

No synthetic review or performance data.

## Auditable

Every operator decision is attributable.

## Searchable

Operators can find relevant picks quickly.

## Reviewable

Held and denied decisions remain visible later.

## Expandable

The Phase 2 model must support later growth into deeper intelligence and control workflows.

---

# 9. AUTHORITY MODEL

Phase 2 preserves the same architecture law as Phase 1:

* Command Center UI does not directly write canonical business state to the database
* All review-state changes and operator actions go through API-owned write paths
* API enforces validation, rules, and audit logging

---

# 10. NON-GOALS (PHASE 2)

Not included in Phase 2:

* agent pause / resume
* safe mode / freeze
* direct lifecycle force transitions
* Discord delivery replay controls
* user/capper admin
* onboarding/admin workflows
* full Outlier-style research terminal
* advanced system configuration controls

---

# 11. ACCEPTANCE CRITERIA

Phase 2 is complete when:

1. Operators can review system-generated picks in a dedicated queue
2. Operators can approve / deny / hold with audit history
3. Held picks can be revisited and resolved later
4. Filtering and search work across the required operator dimensions
5. Day / week / month performance views work for cappers and system
6. Decision history and later outcomes are visible without DB access

---

# 12. BUILD ORDER

## Phase 2A

System Pick Review Queue

* pending_review
* approve / deny / hold
* reason capture
* audit persistence

## Phase 2B

Filtering + Search

* add to queue and pick list surfaces

## Phase 2C

Performance Intelligence

* today / week / month
* capper / system / sport / source splits

## Phase 2D

Decision Audit

* operator decisions
* held / denied / approved history
* later result comparison

---

# 13. FINAL STATEMENT

Phase 2 turns Command Center from a truth-and-settlement surface into a true operator workflow layer.

If operators cannot review, decide, search, and evaluate performance from Command Center, Phase 2 has failed.
