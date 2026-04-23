# SGO Contract Hardening

## Purpose

This document is the working contract for how Unit Talk integrates SportsGameOdds (SGO) data across ingestion, canonicalization, grading, settlement, CLV, and historical replay.

It exists to stop repeated "small fix" loops caused by unstated or drifting assumptions about:

* market-key normalization
* participant requirements by market family
* event completion/finalization semantics
* open/close odds requirements for CLV
* historical replay gradeability
* malformed legacy row repair behavior

This is not a product-readiness document. It is the provider-contract and execution-hardening document that upstream work must obey.

## Program Truth

The current system foundation is directionally correct:

* canonical picks exist
* repository abstractions exist
* provider offers, aliases, results, events, and participant joins exist
* grading and settlement are separate concerns

The main gap is not "wrong architecture." The main gap is insufficient contract hardening between SGO reality and Unit Talk canonical truth.

In plain terms:

* the frame is good
* the invariants are still too loose
* real SGO data keeps finding the unguarded edges

## Scope

This hardening effort covers:

1. SGO request/response contract usage
2. provider-to-canonical identity rules
3. event and participant linkage rules
4. CLV-required data guarantees
5. settlement-required data guarantees
6. historical replay admissibility rules
7. repair/backfill rules for malformed legacy rows
8. provider contract tests and replay audit proof

This effort does **not** own:

* elite/syndicate trust conclusions
* final model graduation decisions
* broad production-readiness closeout language

Those are downstream of this hardening work.

## Core Invariants

### 1. Market normalization must be deterministic

Every SGO market that enters the system must map through one canonical normalization path used consistently by:

* ingestion
* persistence
* grading
* CLV
* replay tooling
* proof queries

No service may maintain a private interpretation of provider market keys.

### 2. Participant rules must be explicit by market family

Every canonical market family must declare whether `participant_id` is:

* required
* optional
* forbidden

Game-line markets must not be treated like player props.
Player props must not silently degrade into event-only joins.

### 3. Event completion must be provider-grounded

Settlement and grading must only rely on event states that are explicitly proven safe against SGO semantics.

Current working rule:

* use the SGO-backed completed/finalized contract already established by recent fix work
* do not introduce looser grading gates without provider proof

### 4. CLV requires open/close fidelity

A row is not CLV-gradeable unless the provider fetch path and persistence path preserve the open/close fields required for the selected market/book/time slice.

If SGO requires request flags like `includeOpenCloseOdds=true`, the contract must state that explicitly.

### 5. Historical replay is admissible only when identity is sound

Historical rows count only when we can prove:

* event identity
* market identity
* participant identity where required
* result identity
* bookmaker/open/close provenance where CLV is being claimed

### 6. Legacy malformed rows must have declared repair rules

When malformed historical rows are tolerated, the repair path must be explicit and tested.

Examples:

* `totals -> game_total_ou`
* event name recovery from thesis text for legacy malformed smart-form rows

## Known Contract Classes

### A. Provider request contract

Questions this class answers:

* Which query params are mandatory for live ingest?
* Which query params are mandatory for historical replay?
* Which flags are required for close/open odds?
* Which pagination fields must always be honored?

### B. Canonical identity contract

Questions this class answers:

* How does provider market key map to canonical market key?
* What is the canonical participant join key?
* What makes a row replay-gradeable versus only displayable?

### C. Settlement contract

Questions this class answers:

* When is an event safe to grade?
* Which result fields are authoritative?
* Which markets are settleable today versus unsupported?

### D. CLV contract

Questions this class answers:

* Which rows have valid opening and closing prices?
* Which rows are safe to include in CLV reporting?
* Which missing fields should fail closed rather than silently degrade?

### E. Legacy repair contract

Questions this class answers:

* Which historical malformed rows are repaired in place by logic?
* Which require backfill?
* Which are permanently unsupported and must be excluded from proof math?

## Workstreams

### WS1. Provider Standard and Matrix

Owner: Claude  
Tier: `DOCS/T1`

Deliverables:

* provider contract matrix
* settleable market matrix
* participant-required matrix
* open/close field requirements
* request-flag requirements

### WS2. Canonicalization and Identity Enforcement

Owner: Codex  
Tier: `T1`

Deliverables:

* one normalization path for provider market keys
* explicit participant-required vs forbidden rules
* alias and canonical join repair where needed
* tests across domain/db/api layers

### WS3. Historical CLV Fidelity

Owner: Codex  
Tier: `T1`

Deliverables:

* historical fetch correctness
* open/close persistence correctness
* closing-line carry-forward correctness
* replay-gradeable coverage proof

### WS4. Settlement and Results Fidelity

Owner: Codex  
Tier: `T1`

Deliverables:

* finalized/completed-safe grading inputs
* result join correctness
* posted-pick auto-settle correctness
* bounded repair/backfill tooling where needed

### WS5. Downstream Proof and Readiness Consumption

Owner: Claude  
Tier: `T2`

Deliverables:

* consume hardening outputs into trust/readiness framing
* keep readiness gates blocked until hardening proof is truly complete

## Lane Policy

### Codex lane

Codex owns:

* code
* migrations
* repository changes
* runtime invariants
* provider normalization
* backfills/repair tooling
* tests
* proof commands

### Claude lane

Claude owns:

* provider standards extraction from docs/MCP
* execution framing
* written standards and ratified guidance
* readiness consumption
* closeout language

### Shared but sequenced

Shared work is allowed only when the active next step is explicit.
Provider standards should land before downstream policy claims.
Implementation proof should land before readiness language changes.

## Issue Policy

An issue belongs in this project if it changes or proves one of these:

* SGO request contract
* canonical provider mapping
* participant/event identity
* CLV field fidelity
* grading/settlement admissibility
* historical replay admissibility
* malformed-row repair/backfill

An issue does **not** belong in this project if it is only:

* a broad readiness verdict
* a product/UI feature unrelated to provider contract truth
* a model-readiness decision that consumes but does not define contract truth

## Exit Criteria

The SGO Contract Hardening effort is complete only when:

1. the provider matrix is written and current
2. all active SGO ingest/grading/CLV code paths obey the same normalization rules
3. participant requirements are explicit and enforced by market family
4. historical open/close odds contract is proven with code and evidence
5. auto-settle uses provider-safe event/result truth
6. legacy malformed rows are either repaired, backfilled, or explicitly excluded
7. provider contract tests exist for the major supported market families
8. downstream readiness issues can point to this project as the canonical upstream truth
