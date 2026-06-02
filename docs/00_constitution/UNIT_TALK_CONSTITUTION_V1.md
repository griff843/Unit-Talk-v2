# Unit Talk Constitution

## Institutional Decision Intelligence Operating Constitution

**Version:** 1.0  
**Status:** Ratification-ready reconstructed constitutional source of truth  
**System:** Unit Talk v2  
**Primary Authority:** Institutional Decision Intelligence Operating Blueprint, Constitutional Compliance Audit, Constitutional Convergence Roadmap, Program 1 execution record, Board Execution Runtime decisions, Workflow Runtime v2 decisions  
**Purpose:** Define the non-negotiable laws, runtime architecture, governance model, proof framework, operating model, maturity model, and implementation roadmap required to build Unit Talk into a syndicate-grade decision intelligence operating system.

---

# 0. Preamble

Unit Talk is not a picks platform.

Unit Talk is not a Discord bot.

Unit Talk is not a dashboard.

Unit Talk is not a generic sports betting tool.

Unit Talk is not an AI wrapper.

Unit Talk is an institutional-grade decision intelligence operating system.

Its purpose is to ingest truth, preserve truth, generate decisions, validate decisions, govern decisions, execute decisions, audit decisions, replay decisions, attribute outcomes, certify readiness, and improve over time under institutional constraints.

The constitution exists so the system cannot silently lie.

The system must prioritize:

- truth over prediction
- determinism over automation
- governance over velocity
- replayability over convenience
- auditability over opacity
- fail-closed behavior over silent degradation
- institutional confidence over short-term shipping speed
- proof over narrative
- runtime enforcement over process memory
- constitutional convergence over local optimization

No system component, agent, workflow, operator, dashboard, automation, optimization, model, pipeline, repository, or deployment topology may violate this constitution.

---

# 1. Constitutional Objective

The constitutional objective is to create a system capable of:

```text
institutional-grade probabilistic decision intelligence
```

This means the system must be able to answer, mechanically and reproducibly:

```text
What did we know?
When did we know it?
Where did that truth come from?
What did we decide?
Why did we decide it?
What risk state existed at the time?
What policy authorized the decision?
Who or what executed it?
What happened afterward?
Can the system replay the full path?
Can the system prove the result?
Can the system detect if it would decide differently now?
Can the system certify its own readiness without relying on narrative?
```

The system is only trusted when these questions can be answered through executable proof, structured state, and replayable evidence.

---

# 2. Constitutional Principles

## 2.1 Truth Before Prediction

Truth is upstream of intelligence.

No prediction, score, edge calculation, promotion, execution, delivery, settlement, attribution, or certification may be trusted unless the truth it depends on is canonical, lineage-complete, immutable where required, and reconstructable.

The system may not improve model sophistication at the expense of truth integrity.

A sophisticated model operating on unverifiable truth is constitutionally unsafe.

## 2.2 Determinism Before Automation

Automation is prohibited where deterministic behavior is not understood.

A runtime that cannot be replayed cannot be trusted.

A decision that cannot be reproduced cannot be certified.

A workflow that cannot explain its own state cannot govern production.

## 2.3 Fail Closed

Silent degradation is prohibited.

When a required dependency, truth source, provider, proof artifact, gate, secret, snapshot, replay input, certification, review, or governance approval is missing or invalid, the system must stop, reject, quarantine, escalate, or fail.

The system must not silently continue in degraded mode while presenting itself as healthy.

## 2.4 Immutable History

Historical truth must not be overwritten.

Corrections append.

Revisions create new records.

Invalidations preserve prior evidence.

The system may supersede historical facts, but it may not erase them.

## 2.5 Explicit Authority

Every privileged action must have explicit authority.

No hidden authority paths may exist.

No agent, operator, service, workflow, CI job, bot, script, or automation may perform privileged action without a traceable authority source.

## 2.6 Replayability

Every critical decision and runtime transition must be replayable.

Replay must reconstruct raw inputs, canonical truth, features, model versions, scores, risk state, decisions, execution intent, delivery result, settlement, proof state, and governance state.

Replay divergence is a constitutional event.

## 2.7 Auditability

Every meaningful system action must leave evidence.

Audit evidence must be structured, durable, timestamped, attributable, queryable, and linked to runtime state.

No invisible system behavior is allowed.

## 2.8 Separation of Duties

No actor may implement, review, approve, and certify the same work.

No model may self-certify.

No workflow may self-authorize.

No reviewer may certify their own patch.

No automation may replace PM authority.

## 2.9 Human Governance

Humans retain constitutional authority.

Automation may prepare, validate, enforce, block, recommend, and route.

Automation may not replace accountable governance authority.

## 2.10 Labels and Comments Are Evidence, Not Truth

GitHub labels, PR comments, Linear labels, status text, and dashboard states are evidence surfaces.

They are not canonical truth by themselves.

Canonical truth must derive from structured state, lane manifests, proof artifacts, runtime records, reviewed artifacts, and validated governance contracts.

## 2.11 Proof Over Narrative

A system claim is not valid because it is written down.

A system claim is valid only when mechanically proven.

Screenshots, markdown, labels, PR summaries, and verbal assertions may support proof, but they cannot replace executable evidence.

## 2.12 Revocable Trust

Certification is not permanent.

Trust can expire.

Trust can be revoked.

Any stale proof, replay divergence, governance bypass, invariant violation, settlement inconsistency, or unverifiable runtime state can revoke certification.

## 2.13 Adversarial Validation

Happy-path validation is insufficient.

All constitutional surfaces must be tested adversarially.

The system must assume failure, drift, bypass, stale state, missing proof, and operator error unless mechanically disproven.

## 2.14 No Self-Certification

No model, workflow, agent, or operator may certify its own work.

Implementation and verification must be separated.

Reviewer-as-fixer is permitted only when another independent authority re-reviews the fix.

---

# 3. System Mission and Scope

## 3.1 Mission

Unit Talk exists to produce institutionally governed sports decision intelligence.

The mission is to build a system that can:

- ingest market and event truth
- preserve immutable source lineage
- generate edge-aware decisions
- enforce risk controls
- distribute decisions safely
- settle outcomes accurately
- attribute performance honestly
- replay history deterministically
- certify system readiness
- scale without losing trust

## 3.2 Non-Goals

The system must not become:

- a hype-driven pick feed
- a model-only scoring tool
- a Discord-only experience
- a dashboard without governance
- a black-box prediction engine
- a capital deployment system without certification
- an automation stack without replay
- a CI system that confuses green checks with institutional readiness
- a workflow that depends on human memory to remain safe

## 3.3 Strategic End State

The end state is a syndicate-grade decision intelligence operating system capable of:

- deterministic replay
- institutional governance
- runtime certification
- audited execution
- performance attribution
- adversarial survivability
- capital deployment readiness

---

# 4. System Capability Layers

The system is composed of 19 first-class constitutional capability layers.

Each layer must define its purpose, responsibilities, required components, capabilities, invariants, failure behavior, proof requirements, and certification conditions.

These layers are not optional. They are the canonical capability model.

---

## 4.1 Data Acquisition Layer

### Purpose

Acquire external truth from providers, books, feeds, schedules, results, and supporting data systems.

This layer is the system's first contact with external reality.

### Responsibilities

- provider authentication
- provider request execution
- raw response capture
- provider identity tracking
- provider health tracking
- source timestamp capture
- ingestion timestamp capture
- missing-secret detection
- request failure classification
- empty-cycle detection

### Required Components

- provider clients
- provider credential validators
- raw response capture mechanism
- ingestion run identity
- provider health state
- provider error classifier
- missing-secret fail-closed guard

### Required Capabilities

- capture provider payloads before transformation
- detect missing credentials before looping empty
- classify provider failures
- distinguish no-data response from failed ingestion
- preserve provider lineage
- emit structured ingestion events

### Required Invariants

```text
No provider cycle may appear healthy while ingesting nothing because of missing required credentials.
No provider response may be transformed before raw payload capture.
No ingestion run may lack provider identity and timestamp lineage.
```

### Failure Behavior

- missing required credential: fail closed
- provider unreachable: classify and escalate
- malformed provider payload: archive raw payload, then quarantine if needed
- empty cycle without valid reason: fail or escalate

### Required Proof

- test proving missing API key fails closed
- test proving raw payload capture precedes transformation
- test proving provider failure is visible
- runtime proof showing provider freshness is honest

### Certification Conditions

Data Acquisition Certification requires proof that provider data is captured, classified, and surfaced without silent empty cycles.

---

## 4.2 Canonical Data Truth Layer

### Purpose

Convert external provider data into canonical system truth.

This layer determines what the system believes about market state.

### Responsibilities

- raw payload persistence
- pre-transformation hashing
- immutable odds snapshots
- correction lineage
- market identity mapping
- point-in-time reconstruction
- derived projection demotion

### Required Components

- raw_payloads
- odds_snapshots
- snapshot corrections
- point-in-time query interface
- provider_offer_current as derived projection
- canonical market identity mapping

### Required Capabilities

- preserve raw provider body
- compute SHA-256 before transformation
- append immutable snapshot rows
- block update/delete at DB layer
- reconstruct market state at timestamp T
- demote mutable projections from truth status

### Required Invariants

```text
Raw provider payloads are archived before transformation.
Odds snapshots are append-only.
Mutable provider projections are not canonical truth.
Every snapshot links to raw payload lineage.
```

### Failure Behavior

- raw archive write failure: block ingestion by default
- snapshot write failure: block downstream truth consumption
- mutation attempt: reject at database layer
- missing lineage: fail proof and block certification

### Required Proof

- live DB proof for update/delete rejection
- raw payload hash proof
- snapshot append-only proof
- point-in-time reconstruction proof
- correction lineage proof

### Certification Conditions

Canonical Data Truth Certification requires immutable raw payload lineage, immutable snapshot lineage, and successful point-in-time reconstruction.

---

## 4.3 Feature Engineering Layer

### Purpose

Generate model-ready feature vectors from canonical truth without leakage, silent imputation, or schema ambiguity.

### Responsibilities

- feature extraction
- feature schema versioning
- source lineage binding
- missing-value handling
- leakage detection
- feature vector persistence

### Required Components

- FeatureVector entity
- feature schema registry
- feature extractor contracts
- future-leakage detector
- imputation policy
- feature lineage metadata

### Required Capabilities

- persist feature vectors
- bind features to snapshot IDs
- enforce schema versioning
- detect future leakage
- represent missing inputs explicitly
- retire or integrate dead extractors

### Required Invariants

```text
Feature generation may not use future information.
Missing inputs may not be silently imputed.
Feature vectors must bind to source truth lineage.
```

### Failure Behavior

- leakage detected: block feature generation
- missing required input: explicit null or reject
- unknown schema: reject
- dead extractor: retire or integrate before claiming coverage

### Required Proof

- future-leakage adversarial test
- feature schema version proof
- missing input proof
- lineage reconstruction proof

### Certification Conditions

Feature Certification requires deterministic generation, schema versioning, source lineage, and no future leakage.

---

## 4.4 Modeling and Prediction Layer

### Purpose

Generate predictions using versioned, traceable, reproducible model artifacts.

### Responsibilities

- model version management
- artifact SHA tracking
- inference execution
- shadow inference
- rollback path
- model deployment state

### Required Components

- ModelVersion entity
- model artifact registry
- inference runtime
- artifact SHA verifier
- shadow inference path
- rollback runtime

### Required Capabilities

- immutable model deployment records
- SHA verification at inference
- shadow model comparison
- rollback to prior active model
- inference traceability

### Required Invariants

```text
No inference may occur without model version identity.
No model artifact may execute without SHA verification.
Shadow outputs may not be presented as active decisions.
```

### Failure Behavior

- SHA mismatch: block inference
- missing model version: block inference
- rollback unavailable: block active deployment certification
- shadow divergence: classify and report

### Required Proof

- SHA verification proof
- immutable ModelVersion proof
- shadow inference proof
- rollback proof

### Certification Conditions

Model Certification requires artifact identity, reproducible inference, rollback path, and model lineage.

---

## 4.5 Calibration and Model Governance Layer

### Purpose

Ensure predicted confidence is reliable, monitored, and governance-bound.

### Responsibilities

- calibration measurement
- cohort-level calibration
- model holds
- breach routing
- advisory path removal
- shadow-to-active promotion gates

### Required Components

- calibration reports
- cohort metrics
- breach detector
- deployment hold state
- model promotion gate
- calibration certification record

### Required Capabilities

- measure calibration by cohort
- hold models on breach
- prevent critical models from continuing active scoring
- enforce shadow-to-active gates
- eliminate advisory-only calibration claims

### Required Invariants

```text
A critical calibration breach must block active deployment.
Model promotion requires calibration evidence.
Advisory calibration cannot be represented as enforcement.
```

### Failure Behavior

- breach: hold or revoke model deployment
- missing calibration report: block promotion
- advisory-only path: fail certification

### Required Proof

- breach-to-hold test
- cohort calibration proof
- shadow-to-active gate proof
- advisory-path removal proof

### Certification Conditions

Calibration Certification requires current calibration evidence, cohort analysis, breach handling, and active enforcement.

---

## 4.6 Edge Detection Layer

### Purpose

Determine whether a market opportunity has positive expected value using fresh, valid, canonical market truth.

### Responsibilities

- edge computation
- price freshness enforcement
- negative-EV rejection
- market quality analysis
- CLV awareness
- market resistance evaluation

### Required Components

- edge calculator
- price freshness validator
- EV rejection router
- market resistance module
- source quality metadata

### Required Capabilities

- reject stale prices
- reject negative EV
- preserve edge calculation lineage
- bind edge to canonical snapshots
- distinguish unknown edge from zero edge

### Required Invariants

```text
Edge may not be computed from stale price truth.
Negative EV must route to rejected state.
Unknown edge may not be represented as zero edge.
```

### Failure Behavior

- stale price: reject or quarantine
- negative EV: reject
- missing source lineage: block edge claim

### Required Proof

- stale price rejection proof
- negative-EV routing proof
- edge lineage proof
- market source proof

### Certification Conditions

Edge Certification requires fresh source truth, reproducible calculation, rejection routing, and lineage.

---

## 4.7 Risk Management Layer

### Purpose

Constrain individual decisions according to risk, confidence, volatility, and local safety rules.

### Responsibilities

- risk scoring
- stake sizing constraints
- local exposure checks
- circuit breaker integration
- risk breach routing

### Required Components

- risk score engine
- computeRiskScore
- stake policy
- local breaker
- risk decision metadata

### Required Capabilities

- compute deterministic risk score
- block risk breach
- integrate circuit breaker state
- produce risk lineage
- support fail-closed risk state

### Required Invariants

```text
No decision may promote without risk evaluation.
Risk breach must block or quarantine, not merely warn.
Risk score must be reproducible.
```

### Failure Behavior

- missing risk score: block decision
- risk breach: block or quarantine
- stale risk input: reject or quarantine

### Required Proof

- risk score proof
- risk breach blocking proof
- circuit breaker fail-closed proof

### Certification Conditions

Risk Certification requires deterministic scoring, enforced breach behavior, and risk lineage.

---

## 4.8 Portfolio and Exposure Management Layer

### Purpose

Manage aggregate exposure, concentration, correlation, drawdown, and portfolio-level systemic risk.

### Responsibilities

- central exposure state
- serializable exposure reads
- drawdown monitoring
- concentration enforcement
- correlation management
- portfolio halt

### Required Components

- PortfolioExposure store
- exposure consistency mechanism
- drawdown monitor
- concentration hard blocks
- portfolio halt state

### Required Capabilities

- calculate aggregate exposure
- maintain central exposure truth
- enforce drawdown halt
- block concentration breaches
- preserve portfolio lineage

### Required Invariants

```text
Portfolio exposure must be globally consistent.
Concentration breach must block, not merely penalize.
Drawdown halt must apply atomically.
```

### Failure Behavior

- inconsistent exposure: block promotion
- drawdown breach: halt
- concentration breach: reject

### Required Proof

- serializable exposure proof
- drawdown halt proof
- concentration block proof
- portfolio replay proof

### Certification Conditions

Portfolio Certification requires central exposure truth, enforced blocks, drawdown halt, and replayability.

---

## 4.9 Decision Engine Layer

### Purpose

Transform evaluated opportunity into canonical, immutable decision truth.

### Responsibilities

- DecisionRecord creation
- decision routing
- rejection routing
- exception linkage
- promotion state
- decision replay

### Required Components

- DecisionRecord entity
- decision router
- rejection states
- exception reference
- decision lineage

### Required Capabilities

- create immutable decisions
- route rejected candidates
- bind decisions to features, model, edge, and risk
- prevent re-promotion bypass
- support decision replay

### Required Invariants

```text
No execution may occur without canonical decision record.
Decision records are immutable.
Bypasses require GovernanceException linkage.
```

### Failure Behavior

- missing decision record: block execution
- mutation attempt: reject
- bypass without exception: reject and audit

### Required Proof

- immutable DecisionRecord proof
- negative-EV rejection proof
- forcePromote exception proof
- decision replay proof

### Certification Conditions

Decision Certification requires immutable decision state, routing determinism, and governed exceptions.

---

## 4.10 Execution and Distribution Layer

### Purpose

Deliver decisions to downstream systems, users, bots, channels, execution surfaces, or automation targets while preserving execution truth.

### Responsibilities

- ExecutionIntent creation
- delivery routing
- receipt capture
- retry management
- dead-letter handling
- delivery audit

### Required Components

- ExecutionIntent entity
- ExecutionReceipt entity
- delivery queue
- dead-letter queue
- recovery policy
- receipt validator

### Required Capabilities

- enforce idempotent delivery
- create true receipts
- avoid fabricated receipt objects
- gate dead-letter recovery
- audit delivery state

### Required Invariants

```text
Every execution must derive from a canonical decision.
Every execution attempt must produce a true receipt or classified failure.
Dead-letter recovery requires governance.
```

### Failure Behavior

- missing intent: block delivery
- missing receipt: classify failure
- dead-letter: require exception-gated recovery

### Required Proof

- idempotent delivery proof
- receipt integrity proof
- dead-letter recovery proof
- execution replay proof

### Certification Conditions

Execution Certification requires idempotency, receipt integrity, recovery governance, and replayability.

---

## 4.11 Settlement and Outcome Verification Layer

### Purpose

Establish final outcome truth and preserve immutable settlement history.

### Responsibilities

- settlement record creation
- result verification
- correction management
- dual-authorized corrections
- settlement replay

### Required Components

- SettlementRecord entity
- settlement immutability trigger
- correction entity
- correction authorization
- settlement source lineage

### Required Capabilities

- append settlement truth
- block mutation
- record corrections
- enforce dual authorization where required
- replay settlement history

### Required Invariants

```text
Settlement truth is append-only.
Settlement corrections must not mutate original settlement records.
Critical corrections require authority.
```

### Failure Behavior

- update/delete attempt: reject
- correction without authority: reject
- unverifiable result: hold or escalate

### Required Proof

- settlement immutability proof
- correction lineage proof
- dual authorization proof
- settlement replay proof

### Certification Conditions

Settlement Certification requires immutable records, correction lineage, and source verification.

---

## 4.12 Performance Evaluation Layer

### Purpose

Measure whether the system is actually generating valid decision quality and economic value.

### Responsibilities

- ROI calculation
- CLV calculation
- win-rate analysis
- calibration analysis
- cohort analysis
- model performance tracking

### Required Components

- performance cohorts
- CLV records
- ROI reports
- calibration reports
- attribution inputs

### Required Capabilities

- generate reproducible performance windows
- compute verified CLV only
- distinguish realized performance from expected edge
- separate variance from quality
- preserve cohort lineage

### Required Invariants

```text
Performance claims require reproducible evidence.
CLV requires verified closing source.
Opening-line proxy may not be represented as verified CLV.
```

### Failure Behavior

- unverifiable CLV: mark unverified or reject metric
- missing cohort definition: reject report
- stale performance proof: fail certification

### Required Proof

- cohort reproducibility proof
- verified CLV source proof
- performance window proof
- attribution input proof

### Certification Conditions

Performance Certification requires reproducible cohorts, verified inputs, and metric lineage.

---

## 4.13 Runtime Integrity Layer

### Purpose

Ensure runtime behavior matches declared constitutional guarantees.

### Responsibilities

- invariant evaluation
- runtime violation detection
- replay validation
- quarantine
- escalation
- false-confidence removal

### Required Components

- invariant registry
- InvariantEngine
- violation events
- quarantine routing
- replay invariant evaluator
- runtime integrity reports

### Required Capabilities

- evaluate runtime-evaluable invariants
- emit violations synchronously
- evaluate replay contexts
- distinguish advisory from enforced invariants
- block or quarantine on critical violation

### Required Invariants

```text
Runtime violations must not disappear silently.
Advisory-only checks may not be presented as enforcement.
Runtime invariant enforcement must be mechanically testable.
```

### Failure Behavior

- critical invariant violation: quarantine or halt
- advisory-only coverage: mark advisory explicitly
- missing evaluator: fail runtime certification

### Required Proof

- invariant engine proof
- runtime violation proof
- replay violation proof
- false-confidence removal proof

### Certification Conditions

Runtime Certification requires enforced invariants, violation visibility, quarantine semantics, and replay integration.

---

## 4.14 Observability Layer

### Purpose

Make runtime state, failure state, proof state, and operational health visible.

### Responsibilities

- structured logging
- metrics
- alerting
- dashboards
- freshness reports
- worker health
- queue health
- proof visibility

### Required Components

- structured logger
- metric collectors
- alert rules
- stage freshness command
- health endpoint
- operator dashboard

### Required Capabilities

- detect stale providers
- detect worker degradation
- detect queue failures
- expose proof state
- distinguish healthy from looping-empty
- alert on silent failure risks

### Required Invariants

```text
Critical runtime failures must be observable.
A daemon looping empty must not appear healthy.
Freshness status must reflect truth, not assumptions.
```

### Failure Behavior

- stale data: alert and classify
- missing provider writes: alert
- degraded worker: alert
- observability unavailable: mark operationally degraded

### Required Proof

- freshness command proof
- alert proof
- worker health proof
- stale data detection proof

### Certification Conditions

Observability Certification requires accurate health, freshness, and failure visibility.

---

## 4.15 Governance and Certification Layer

### Purpose

Enforce institutional authority and certify system readiness.

### Responsibilities

- Certification entity
- certification lifecycle
- proof validation
- PM approval
- revocation
- dependent gates

### Required Components

- Certification table/entity
- certification state machine
- proof validator
- PM verdict validator
- revocation triggers
- dependency gates

### Required Capabilities

- create certification records
- expire stale certification
- revoke invalid certification
- block dependent operations
- verify PM authority

### Required Invariants

```text
Certification is runtime state, not a label.
Stale proof invalidates certification.
Certification must be revocable.
PM authority cannot be delegated to automation.
```

### Failure Behavior

- stale proof: expire or block
- invalid certification: revoke
- missing PM authority: block
- bypass attempt: audit and fail

### Required Proof

- certification entity proof
- lifecycle proof
- revocation proof
- dependent gate proof

### Certification Conditions

Governance Certification requires proof runtime, certification lifecycle, authority validation, and revocation support.

---

## 4.16 Human Operations Layer

### Purpose

Define controlled human authority, operational escalation, manual approvals, and exception handling.

### Responsibilities

- PM gates
- operator actions
- escalation routing
- manual override governance
- authority matrices
- runbooks

### Required Components

- authority matrix
- PM verdict schema
- escalation policy
- runbooks
- exception records
- operator audit log

### Required Capabilities

- authorize T1 approvals
- approve waivers
- classify admin bypasses
- execute incident actions
- preserve human accountability

### Required Invariants

```text
PM approval is required for constitutional authority gates.
Admin bypass is an exceptional governance event.
Human override must leave durable evidence.
```

### Failure Behavior

- missing approval: block
- unauthorized approval: reject
- bypass without record: governance violation

### Required Proof

- PM verdict proof
- actor authorization proof
- waiver proof
- bypass audit proof

### Certification Conditions

Human Operations Certification requires explicit authority, auditability, and PM-controlled gates.

---

## 4.17 Capital Operations and Treasury Layer

### Purpose

Govern capital, reserves, scaling, treasury operations, and capital-level risk.

### Responsibilities

- capital ledger
- reserves
- capital drawdown
- treasury operations
- scaling authorization
- dual authorization

### Required Components

- immutable capital ledger
- reserve tracker
- treasury operation records
- capital drawdown monitor
- scaling authorization runtime
- dual-authorized treasury flow

### Required Capabilities

- track capital truth
- prevent unauthorized treasury action
- enforce capital drawdown limits
- gate scaling
- preserve treasury auditability

### Required Invariants

```text
Capital operations require explicit treasury authority.
Capital scaling requires certification.
Treasury actions require audit and, where specified, dual authorization.
```

### Failure Behavior

- unauthorized treasury operation: reject
- capital drawdown breach: halt
- scaling without certification: block

### Required Proof

- capital ledger immutability proof
- reserve tracking proof
- dual-authorization proof
- scaling gate proof

### Certification Conditions

Capital Scaling Certification requires treasury truth, drawdown control, survivability gates, and burn-in evidence.

---

## 4.18 Market Adversarial Intelligence Layer

### Purpose

Detect adversarial market behavior, provider anomalies, manipulation, survivability risk, and escalation conditions.

### Responsibilities

- independent data path
- provider anomaly detection
- manipulation detection
- adversarial escalation
- market survivability checks

### Required Components

- independent adversarial data path
- anomaly detector
- manipulation detector
- escalation wiring
- survivability gates

### Required Capabilities

- detect provider drift
- detect market manipulation patterns
- compare independent sources
- escalate high-confidence findings
- gate capital scaling on survivability

### Required Invariants

```text
Adversarial findings must not remain advisory when confidence is high.
Market survivability must be proven before scaling.
Provider anomaly detection must operate independently where required.
```

### Failure Behavior

- high-confidence anomaly: escalate
- provider poisoning risk: quarantine
- survivability failure: block scaling

### Required Proof

- independent data path proof
- anomaly detection proof
- escalation proof
- survivability proof

### Certification Conditions

Adversarial Certification requires independent checks, anomaly detection, escalation wiring, and survivability evidence.

---

## 4.19 Economic Attribution and Performance Decomposition Layer

### Purpose

Explain where performance comes from and distinguish edge from variance, execution quality, market movement, and model quality.

### Responsibilities

- attribution engine
- reproducible cohorts
- edge decay detection
- performance decomposition
- capital efficiency analysis

### Required Components

- AttributionEngine
- PerformanceCohort
- edge decay detector
- variance decomposition
- performance reports

### Required Capabilities

- attribute profit/loss to components
- detect edge decay
- reproduce cohort analysis
- decompose execution vs prediction
- support capital scaling evidence

### Required Invariants

```text
Profit alone is not proof of edge.
Attribution must be reproducible.
Edge decay must be detected before scaling claims.
```

### Failure Behavior

- unreproducible cohort: reject report
- edge decay detected: escalate or reduce scaling readiness
- attribution missing: block capital certification

### Required Proof

- attribution proof
- cohort reproducibility proof
- edge decay proof
- variance decomposition proof

### Certification Conditions

Economic Attribution Certification requires reproducible cohorts, attribution logic, edge decay detection, and performance decomposition.

---

# 5. Component Architecture

## 5.1 Purpose

The component architecture defines the system's physical and logical runtime structure.

It specifies how capability layers are implemented through services, stores, jobs, queues, workflows, agents, and governance systems.

## 5.2 Core Architectural Principle

The system must separate truth, decisioning, execution, replay, governance, and certification into explicit domains.

No component may silently assume authority outside its domain.

## 5.3 Runtime Domains

### 5.3.1 Ingestion Domain

Responsible for provider access, raw payload capture, snapshot creation, provider freshness, and quarantine integration.

### 5.3.2 Truth Domain

Responsible for raw payload truth, immutable snapshots, point-in-time reconstruction, derived projections, and canonical market state.

### 5.3.3 Decision Domain

Responsible for features, models, scores, edge detection, risk evaluation, and decision records.

### 5.3.4 Execution Domain

Responsible for execution intents, delivery, receipts, retries, dead letters, and execution audit.

### 5.3.5 Settlement Domain

Responsible for outcome truth, settlement records, correction lineage, and settlement replay.

### 5.3.6 Replay Domain

Responsible for isolated replay, frozen replay state, divergence detection, and production-write rejection.

### 5.3.7 Governance Domain

Responsible for proof, review, PM verdicts, lane authority, workflow gates, exceptions, and certifications.

### 5.3.8 Operator Domain

Responsible for dashboards, command center, alerts, runbooks, and human operational controls.

## 5.4 Boundary Rules

- Ingestion may write raw truth and snapshots, but may not certify truth.
- Decision runtime may create decisions, but may not execute without authorized intent.
- Execution runtime may deliver decisions, but may not invent decisions.
- Replay runtime may read historical truth, but may not write production.
- Governance runtime may block progression, but may not alter facts without authority.
- Operator surfaces may display truth, but may not be canonical truth.

## 5.5 Component Proof

Each runtime component must expose proof of:

- authority boundary
- source lineage
- failure behavior
- replay behavior where applicable
- audit event emission

---

# 6. Technical Stack Requirements

## 6.1 Purpose

The technical stack must support deterministic, auditable, fail-closed, replayable operation.

Technology choices are subordinate to constitutional requirements.

## 6.2 Required Stack Capabilities

The stack must provide:

- transactional database storage
- append-only truth surfaces
- DB-level immutability triggers
- row-level security where appropriate
- structured proof artifacts
- typed repository contracts
- CI gate enforcement
- live DB proof capability
- runtime observability
- workflow automation
- replay isolation
- structured logs
- durable artifacts

## 6.3 Database Requirements

The database must support:

- immutable tables
- foreign key lineage
- migration reversibility
- live proof testing
- role-scoped access
- audit records
- point-in-time reconstruction queries

## 6.4 CI/CD Requirements

CI must enforce:

- migration rollback presence
- schema round-trip proof
- proof binding
- proof audit
- runtime verification
- tier sync
- lane authority
- R-level compliance
- Merge Gate

CI must fail closed.

## 6.5 Runtime Requirements

Production runtime must enforce:

- missing secret fail-closed behavior
- provider freshness truth
- quarantine behavior
- worker health visibility
- no silent empty loops

## 6.6 Proof Requirements

Proof must be:

- machine-readable
- SHA-bound
- current
- tied to issue and PR
- tied to merge SHA after merge
- validated by tooling

---

# 7. Canonical Domain Model

## 7.1 Purpose

The domain model defines the nouns of the system.

Every critical runtime concept must have an explicit entity, lifecycle, owner, and authority boundary.

## 7.2 Core Entities

### 7.2.1 Provider

External source of truth.

Fields include provider key, type, status, credential state, freshness state, and health.

### 7.2.2 RawPayload

Untransformed provider payload.

Fields include id, provider_key, run_id, payload_hash, raw body, captured_at, and created_at.

### 7.2.3 OddsSnapshot

Immutable observed market state.

Fields include id, provider_key, market_key, league, run_id, raw_payload_id, snapshot_at, price_blob, prior_snapshot_id, and created_at.

### 7.2.4 ProviderSnapshotCorrection

Append-only correction linking a superseded snapshot to a new snapshot.

### 7.2.5 Market

Canonical representation of a market opportunity.

### 7.2.6 FeatureVector

Versioned feature input set generated from canonical truth.

### 7.2.7 ModelVersion

Immutable model artifact reference with deployment state and artifact SHA.

### 7.2.8 Prediction

Model output tied to model version and feature vector.

### 7.2.9 RiskAssessment

Risk evaluation result tied to candidate decision.

### 7.2.10 PortfolioExposure

Global exposure state.

### 7.2.11 CandidateDecision

Pre-decision object before promotion/rejection.

### 7.2.12 DecisionRecord

Immutable canonical decision fact.

### 7.2.13 ExecutionIntent

Authorized intent to deliver or execute.

### 7.2.14 ExecutionReceipt

Result of execution attempt.

### 7.2.15 SettlementRecord

Immutable outcome truth.

### 7.2.16 CLVRecord

Closing-line value measurement tied to verified closing source.

### 7.2.17 PerformanceCohort

Reproducible performance analysis window.

### 7.2.18 GovernanceException

Controlled bypass with scope, reason, authority, and expiration.

### 7.2.19 ProofBundle

Structured evidence artifact.

### 7.2.20 Certification

Runtime certification state.

### 7.2.21 AuditEvent

Durable audit record for meaningful system action.

## 7.3 Entity Invariants

```text
No critical entity may lack lineage.
No historical truth entity may be silently mutated.
No decision may execute without canonical decision lineage.
No certification may exist without proof linkage.
```

---

# 8. Contracts and Interfaces

## 8.1 Purpose

Contracts define how system components communicate without ambiguity.

Contracts must preserve type safety, versioning, lineage, and failure behavior.

## 8.2 Required Contract Classes

- provider contracts
- raw payload contracts
- snapshot contracts
- feature contracts
- model contracts
- prediction contracts
- risk contracts
- decision contracts
- execution contracts
- settlement contracts
- proof contracts
- certification contracts
- governance exception contracts
- audit event contracts

## 8.3 Contract Requirements

Every contract must define:

- schema version
- required fields
- optional fields
- source lineage
- timestamp semantics
- failure behavior
- migration path

## 8.4 Interface Requirements

Repository interfaces must not weaken runtime guarantees.

In-memory repositories may support tests but may not mask production failure semantics.

Production repositories must throw or fail closed when required writes fail.

## 8.5 Contract Invariants

```text
No runtime contract may silently drop lineage.
No optional field may carry required truth without validation.
No test-only interface may redefine production safety behavior.
```

---

# 9. Operating Model

## 9.1 Purpose

The operating model defines how humans, agents, workflows, and runtime systems collaborate safely.

## 9.2 Operating Roles

### PM

Final governance authority for activation, sequencing, T1 approval, waivers, and certification.

### Claude

Architecture implementer, broad-system implementation agent, board-organization agent, and structured plan generator.

### Codex

Adversarial reviewer, runtime semantic verifier, proof and CI hardening agent, and edge-case implementation agent.

### Operator

Human responsible for runtime actions, infrastructure, secrets, and production state.

### Reviewer

Independent party responsible for review and contradiction.

### Certification Authority

Authority responsible for validating readiness based on proof.

## 9.3 Workflow Rules

- implementer cannot self-certify
- reviewer cannot certify own patch
- PM authority cannot be replaced by automation
- T1 lanes require adversarial review
- T2/T3 lanes may use lighter governance but must remain auditable

## 9.4 T1/T2/T3 Operating Modes

### T1/T0 Constitutional Lanes

- serial where dependencies require
- adversarial review required
- PM verdict required
- proof bundle required
- live DB proof where applicable
- fail-closed gates

### T2 Lanes

- parallel-safe if not touching constitutional surfaces
- structured review required
- PM or codeowner approval according to gate

### T3 Lanes

- lightweight workflow/tooling changes
- still require CI and scope integrity

---

# 10. Proof and Certification Framework

## 10.1 Purpose

Proof and certification establish trust.

A claim is valid only when proven.

## 10.2 ProofBundle Requirements

A ProofBundle must include:

- issue ID
- PR number
- source SHA
- evidence commit SHA
- current PR head SHA
- merge SHA after merge
- gate results
- reviewer verdict
- PM verdict
- test results
- runtime proof where required
- created timestamp

## 10.3 Proof Freshness

Proof is stale if:

- PR head changes after proof
- review predates latest head
- evidence changes after review
- gate results change
- merge SHA binding is missing after merge

## 10.4 Certification Classes

The system recognizes certification classes:

- Data Truth Certification
- Feature Certification
- Model Certification
- Calibration Certification
- Edge Certification
- Risk Certification
- Portfolio Certification
- Decision Certification
- Execution Certification
- Settlement Certification
- CLV Certification
- Replay Certification
- Runtime Certification
- Governance Certification
- Burn-In Certification
- Capital Scaling Certification

## 10.5 Certification Lifecycle

Certification states:

- pending
- active
- expired
- revoked
- superseded

## 10.6 Revocation Triggers

Certification may be revoked by:

- stale proof
- replay divergence
- invariant violation
- governance bypass
- invalid runtime state
- settlement inconsistency
- unauthorized authority use

---

# 11. Security and Trust Architecture

## 11.1 Purpose

Security protects truth, authority, proof, and capital readiness.

## 11.2 Zero Implicit Trust

No credential, runtime, workflow, service role, operator, or automation is implicitly trusted.

## 11.3 Role-Based Access Control

Roles must map to authority domains.

## 11.4 Service Role Constraints

Service role must not become an unrestricted bypass surface.

Service role behavior must be audited and scoped.

## 11.5 Secrets

Missing required secrets must fail closed.

Secrets must not be printed or exposed.

## 11.6 Dual Authorization

Critical actions require dual authorization where specified.

## 11.7 Admin Bypass

Admin bypass must be recorded as exceptional governance event.

---

# 12. Infrastructure and Runtime Topology

## 12.1 Purpose

Infrastructure topology must preserve runtime boundaries, isolation, replayability, and blast-radius containment.

## 12.2 Runtime Placement Principles

Services should be placed according to responsibility, not convenience.

Hetzner may host:

- ingestor daemon
- workers
- replay workers
- background jobs

Hetzner should not blindly host every system surface.

## 12.3 Domain Separation

The system must separate:

- ingestion
- truth
- replay
- governance
- execution
- treasury
- operator surfaces

## 12.4 Deployment Requirements

Deployments must support:

- rollback
- proof binding
- health verification
- stale-state detection
- auditability

## 12.5 Disaster and Recovery Requirements

Recovery operations must preserve:

- truth lineage
- proof lineage
- merge history
- lane history
- audit history

---

# 13. Organizational and Governance Structure

## 13.1 Purpose

Organizational governance defines authority, escalation, approval, and responsibility.

## 13.2 Authority Classes

- PM Authority
- Operator Authority
- Reviewer Authority
- Certification Authority
- Executor Authority
- Treasury Authority

## 13.3 Authority Matrix

Every privileged action must map to:

- who can request
- who can execute
- who can review
- who can approve
- who can certify

## 13.4 Escalation

Escalation is required for:

- invariant violations
- replay divergence
- provider quarantine
- proof invalidation
- admin bypass
- capital risk

## 13.5 Waivers

Waivers must include:

- reason
- scope
- authorizer
- expiration
- audit record

---

# 14. Multi-Agent and Automation Architecture

## 14.1 Purpose

Multi-agent architecture defines how Claude, Codex, PM, and workflow automation cooperate.

## 14.2 Agent Responsibilities

### Claude

Best suited for:

- broad implementation
- architecture realization
- documentation
- board organization
- structured planning
- code changes across many files

### Codex

Best suited for:

- adversarial review
- semantic edge cases
- proof validation
- CI/gate hardening
- fail-closed enforcement
- runtime correctness

### PM

Responsible for:

- sequencing
- activation
- final approval
- waivers
- stage certification
- governance policy

## 14.3 Dual-Adversarial Model

```text
Claude implements → Codex reviews
Codex implements → Claude reviews
```

## 14.4 Reviewer-as-Fixer

Reviewer may patch blockers they discovered.

Reviewer may not certify their own patch.

Independent re-review remains required.

## 14.5 Workflow Runtime

The workflow itself is a governed runtime.

Dispatch, review, proof, PM approval, merge, lane close, and certification must become deterministic infrastructure.

## 14.6 Validator-First Principle

Build validators first.

Build orchestration second.

Automation without validators becomes governance bypass automation.

---

# 15. Temporal and Consistency Architecture

## 15.1 Purpose

The system must preserve time semantics and consistency across truth, decisions, replay, and settlement.

## 15.2 Time Semantics

Every critical record must define:

- observed_at
- captured_at
- created_at
- effective_at
- settled_at where applicable

## 15.3 Point-in-Time Truth

Market truth must be reconstructable at timestamp T.

## 15.4 Freshness Semantics

Freshness must be computed from actual timestamp lineage, not assumptions.

## 15.5 Replay Consistency

Replay must use historical time and must not leak future state.

## 15.6 Consistency Invariants

```text
No replay may use future truth.
No decision may rely on stale truth without explicit stale state.
No projection may override immutable truth.
```

---

# 16. Maturity Model

## 16.1 Stage 1 — Immutable Market Truth

Requires:

- raw payload archive
- immutable odds snapshots
- point-in-time reconstruction
- freshness honesty
- provider quarantine

## 16.2 Stage 2 — Runtime Integrity

Requires:

- replay harness
- invariant engine
- replay validators
- divergence engine
- runtime integration

## 16.3 Stage 3 — Governance Runtime

Requires:

- certification entity
- proof runtime
- governance exceptions
- authority enforcement

## 16.4 Stage 4 — Decision Integrity

Requires:

- feature governance
- model governance
- calibration enforcement
- decision immutability
- portfolio runtime

## 16.5 Stage 5 — Execution and Economic Truth

Requires:

- execution intent
- settlement hardening
- CLV truth
- attribution

## 16.6 Stage 6 — Institutional Runtime

Requires:

- treasury
- adversarial intelligence
- burn-in
- capital scaling
- simulation runtime

---

# 17. Audit Framework

## 17.1 Purpose

Audit exists to challenge claims and expose false confidence.

## 17.2 Audit Types

- Constitutional Compliance Audit
- Blueprint Gap Audit
- Runtime Truth Audit
- Replay Audit
- Proof Audit
- Governance Audit
- Board Execution Runtime Audit
- CI/Gate Audit
- Security Audit
- Capital Readiness Audit

## 17.3 Audit Requirements

Audits must identify:

- missing enforcement
- advisory-only claims
- stale proof
- hidden bypasses
- false confidence
- governance drift
- runtime ambiguity
- unverifiable assumptions

## 17.4 Audit Output

Audit output must include:

- executive verdict
- blocking findings
- non-blocking findings
- acceptance matrix
- proof assessment
- merge recommendation or certification recommendation

---

# 18. Implementation Roadmap

## 18.1 Roadmap Philosophy

The roadmap is a constitutional convergence plan.

Its purpose is to converge implementation reality toward constitutional blueprint reality.

## 18.2 Roadmap Principles

- truth before capability
- eliminate false confidence first
- runtime enforcement over process
- immutable truth before replay
- replay before certification
- governance before scale
- runtime integrity before AI sophistication
- adversarial validation mandatory
- maturity claims must be earned

## 18.3 Programs

### Program 1 — Truth Convergence

- raw payloads
- odds snapshots
- point-in-time reconstruction
- freshness honesty
- replay substrate
- invariant runtime

### Program 2 — Governance Convergence

- certification runtime
- proof runtime
- governance exceptions
- authority enforcement

### Program 3 — Decision Integrity Convergence

- feature governance
- model governance
- calibration enforcement
- decision immutability
- portfolio runtime

### Program 4 — Execution and Economic Truth Convergence

- execution runtime
- settlement hardening
- CLV truth
- attribution

### Program 5 — Institutional Runtime Convergence

- treasury
- adversarial intelligence
- burn-in
- capital scaling

---

# 19. Workflow Runtime Addendum

## 19.1 Purpose

The workflow runtime governs how the system builds itself.

It must reduce human orchestration burden without weakening constitutional rigor.

## 19.2 Required Workflow Validators

- proof-check
- tier-sync
- review-state validation
- PM-verdict readiness validation
- merge-gate validation
- lane-lock validation
- reconcile validation

## 19.3 Review State

Structured review state must track:

- issue ID
- PR number
- executor
- reviewer
- reviewed head SHA
- blocking findings
- resolved findings
- re-review count
- verdict
- PM status

## 19.4 Tier Sync

Linear or lane manifest tier is authoritative.

GitHub labels are synchronized evidence.

Tier drift blocks merge.

## 19.5 Merge Gate

Merge Gate must fail if:

- proof stale
- review stale
- unresolved blocker exists
- tier mismatch exists
- PM verdict missing
- required CI not green
- lane lock invalid
- actor authorization invalid

## 19.6 Reconciliation Runtime

Lane reconciliation must handle:

- stale leases
- missing manifests
- orphan branches
- closed lanes
- proof drift
- external lookup failures

Reconciliation must be idempotent.

---

# 20. Board Execution Runtime Addendum

## 20.1 Board Is Runtime

The Linear board is not a passive backlog.

It is an execution runtime.

Issue state must reflect activation state.

## 20.2 Canonical Issue Classes

- Serial Constitutional
- Parallel-Safe Constitutional
- Governance Runtime
- Replay Runtime
- Data-Gated
- Observability and Tooling
- Feature Governance
- Dormant Blueprint
- Future Stage-Gated
- Deprecated / Archive

## 20.3 Canonical Activation States

- dormant
- ready-serial
- ready-parallel
- in-lane
- data-gated
- spec-needed
- blocked-hard
- blocked-soft
- pm-triage
- done
- archived

## 20.4 Dormant Issues

Dormant issues are future-stage-gated.

They are not active backlog.

## 20.5 Blocked Internal

`blocked:internal` is reserved for concrete named blockers.

It must not be applied uniformly as board noise.

## 20.6 Stage Activation

PM activates stages.

Stage activation requires proof of prerequisite certification.

---

# 21. Current Program 1 Constitutional Sequence

The Program 1 sequence is:

```text
UTV2-1083 — Reversible Migration Capability
UTV2-1088 — Machine-Readable Invariant Registry Substrate
UTV2-1084 — Raw Payload Store and Pre-Transformation Hashing
UTV2-1085 — Immutable OddsSnapshot Table and Triggers
UTV2-1086 — Snapshot Cutover and Point-in-Time Reconstruction
UTV2-1087 — Freshness Honesty and Provider Auto-Quarantine
UTV2-1091 — Isolated Full-Pipeline Replay Harness
UTV2-1089 — Invariant Engine
UTV2-1093 — Replay Validator Un-Stubbing
UTV2-1092 — Replay Divergence Engine
UTV2-1094 — Production and Replay Integration
UTV2-1095 — 30-Day Replay Driver
```

Stage 2 permits parallel execution of:

```text
WS-1.2 — Replay Runtime
+
WS-1.3 — Runtime Invariant Enforcement
```

Convergence point:

```text
UTV2-1093 requires both replay and invariant-runtime leads to stabilize.
```

---

# 22. Constitutional Anti-Patterns

The following are prohibited:

- silent fallback
- fake freshness
- mutable truth
- unbounded service role authority
- advisory-only governance presented as enforcement
- proof stale against PR head
- review stale against PR head
- PM approval without gate validation
- admin bypass as normal flow
- replay against mutable truth
- opening-line proxy treated as verified CLV
- dead-letter recovery without governance
- self-certification
- broad lane authority for convenience
- labels treated as source of truth
- post-merge proof skipped
- missing secrets treated as healthy runtime
- daemon looping empty while marked healthy
- workflow automation without validators
- stale blockers left untriaged
- dormant blueprint work shown as active backlog

---

# 23. Constitutional End State

The constitution is satisfied only when the system can prove its own truth.

The end state is a system capable of:

- immutable truth
- deterministic replay
- fail-closed runtime
- governed automation
- adversarial validation
- auditable execution
- reproducible settlement
- economic attribution
- certification lifecycle
- institutional capital readiness

Without sacrificing:

- truth
- integrity
- replayability
- authority
- auditability
- trust
