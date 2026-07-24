# Autonomy Program Status

**Program:** Autonomous Delivery Control Plane (AUT-1 .. AUT-6)
**Last updated:** 2026-07-23 (UTV2-1577 / AUT-1 opened for review)

This is a status/index doc — a *view*, not truth, per `EXECUTION_TRUTH_MODEL.md` §1 ("`ISSUE_QUEUE.md`,
`PROGRAM_STATUS.md`, and similar docs are views, not truth"). Lane state lives in the lane manifests
(`docs/06_status/lanes/*.json`); this document summarizes program-level progress for quick orientation only.

---

## Lane status

| Lane | Scope | Status | Notes |
|---|---|---|---|
| **AUT-1** (UTV2-1577) | Contracts, state machine, threat model (`docs/05_operations/autonomy/**`, this doc) | **In review** — PR open, awaiting Codex adversarial review + PM sign-off (T1, Tier C) | Docs-only, no code. See `docs/05_operations/autonomy/README.md` for the full contract set. |
| **AUT-2** | Kernel implementation (`scripts/autonomy/**`) — Codex lane, concurrent with AUT-1 | Not started / in progress elsewhere | Treats AUT-1's contracts as its integration contract. Not this lane's scope to track in detail. |
| **AUT-3** | Bootstrap fix | Not started | |
| **AUT-4** | Scheduler (scheduled workflow wrapping `/loop-dispatch`'s gate sequence — `COMPATIBILITY_MAP.md`) | Not started | |
| **AUT-5** | Execution (T3-live rollout) | Not started | |
| **AUT-6** | Execution (T2/T3-live rollout, certification support) | Not started | |

## Program completion

Not complete. See `docs/05_operations/autonomy/PROGRAM_COMPLETION_DEFINITION.md` for the full, falsifiable
10-row checklist — no row is currently satisfied, since no kernel code exists yet. Program completion
requires, at minimum, a real 30-consecutive-day `t2t3_live` operating window plus a written Griff sign-off;
neither is possible before AUT-2 through AUT-6 ship.

## What to read first

`docs/05_operations/autonomy/README.md` is the canonical entry point for the contract set. This document
(`docs/06_status/autonomy/STATUS.md`) is only a program-tracking view and will be updated as subsequent
AUT-lanes land — it is not itself a source of truth for lane state (see `EXECUTION_TRUTH_MODEL.md` §1).
