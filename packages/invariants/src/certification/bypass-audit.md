# Bypass Audit — UTV2-1106 (INIT-2.3.3)

**Audit date:** 2026-05-26  
**Last updated:** 2026-05-27 (UTV2-1178 — E-2 and G-6 enforcement closed)  
**Scope:** `packages/invariants/src/` — all bypass/exception/forceBypass/override paths
**Status:** E-2 and G-6 enforcement closed by UTV2-1178. Remaining items deferred per Section 5.

---

## 1. Inventory

### 1.1 `engine.ts` — InvariantEngine (INIT-1.3.2)

| # | Line(s) | Identifier / Pattern | Description |
|---|---------|----------------------|-------------|
| E-1 | 57–63 | Advisory-only evaluator (INV-0001) | `agent_claim_overrides_main` must be explicitly set to `true` in context; no flag → no violation. All remaining advisory invariants (INV-0002 through INV-0008, INV-0011, INV-0012, INV-0013) follow the same pattern. |
| E-2 | 282–308 | `evaluate()` — silent skip on unknown evaluator | `if (!evaluator) { continue; }` — an invariant that has a registry entry but no evaluator function is silently skipped without any signal. |
| E-3 | 313–319 | `evaluateForReplay()` — mutates violation after creation | Stamps `replay_run_id` on violation objects post-construction; object is not frozen before this mutation is applied. |

---

### 1.2 `quarantine.ts` — QuarantineManager (INIT-1.3.3)

| # | Line(s) | Identifier / Pattern | Description |
|---|---------|----------------------|-------------|
| Q-1 | 62–65 | `AUTO_QUARANTINE_BEHAVIORS` — allow-list gate | Only `'fail-closed'` and `'quarantine'` trigger automatic quarantine. Violations with `quarantine_behavior` values outside this set (e.g. `'warn'`, `'advisory'`) pass through with an audit event but no quarantine record and no escalation. |
| Q-2 | 153–161 | `resolveEscalationTarget()` — fallback to `GovernanceReviewer` | Unregistered invariant IDs fall back to `'GovernanceReviewer'` string literal. No error, no visibility — silent routing. |

---

### 1.3 `governance-exception.ts` — GovernanceException (INIT-2.3.1)

| # | Line(s) | Identifier / Pattern | Description |
|---|---------|----------------------|-------------|| 
| G-1 | 24–28 | `GovernanceExceptionType = 'temporary-bypass'` | Named bypass type. Creates a sanctioned, structured bypass record with dual-approver authorization, justification, expiration, rollback condition, and audit ref. |
| G-2 | 26 | `'operational-override'` | Named explicit override type — same structure and gates as G-1. |
| G-3 | 27 | `'emergency-exception'` | Named emergency bypass type — same structure and gates. |
| G-4 | 28 | `'scheduled-maintenance'` | Named maintenance window type — same structure and gates. |
| G-5 | 173–192 | `createGovernanceException()` audit event — `event_type: 'invariant_violation'` | The audit event emitted when creating a governance exception uses the `'invariant_violation'` event type with a code comment noting "closest semantic match." This is a semantic mislabeling — a sanctioned exception creation is not itself a violation. Replay tools consuming this audit stream must differentiate these two cases by inspecting `payload.entity_type === 'governance_exception'`. |
| G-6 | 136–143 | `validate()` — expiration must be future at creation time | Expiration is validated only at the moment `createGovernanceException` is called. No runtime enforcement checks whether an exception is expired when later referenced. The `status: 'active' | 'expired' | 'rolled-back'` field exists on `GovernanceException` but no engine path reads or enforces it. |

---

### 1.4 `certification/` — CertificationStateMachine (UTV2-1096)

| # | File | Line(s) | Identifier / Pattern | Description |
|---|------|---------|----------------------|-------------|
| C-1 | `state-machine.ts` | 33–39 | `VALID_TRANSITIONS['revoked'] = []` | Terminal state is enforced by an empty allow-list. Any attempt to transition out of `'revoked'` throws `CertificationTransitionError`. Correctly fail-closed. |
| C-2 | `state-machine.ts` | 95–112 | `assertTransitionAllowed()` — initial insert constrained to `'pending'` | First status for any domain must be `'pending'`. Attempting to insert directly into `'active'` throws. Correctly fail-closed. |
| C-3 | `state-machine.ts` | 271–275 | `computePropagation()` — `continue` on `null` or already-revoked | If a dependent domain has no current record (`null`), propagation silently skips it. If the dependent is already `'revoked'`, it is skipped. Both are intentional but the `null` case is implicitly a bypass: a missing domain record is treated as not requiring propagation rather than as a blocker. |
| C-4 | `state-machine.ts` | 321–331 | `isCertified()` — clock-based expiry | Expired-by-clock active records return `false`. However, no path automatically transitions such records to `'expired'` status — the `active` record persists, but certification queries fail-closed. The status in the DB does not self-update. |
| C-5 | `types.ts` | 42 | `RevocationTrigger: 'quarantine_bypass'` | Revocation trigger type enumerating a bypass as a revocation cause. Correctly models bypass detection as a revocation signal. |

---

## 2. Classification

| ID | File | Pattern | Classification | Replay-Visible |
|----|------|---------|----------------|----------------|
| E-1 | `engine.ts:57–254` | Advisory evaluators — all 11 advisory invariants only fire if caller explicitly sets a context flag | **Silent-fail-open** — caller omission ≡ no violation; not a forced bypass but a structural gap | No — advisory violations suppressed by omission do not produce replay records |
| E-2 | `engine.ts` | `evaluate()` — unknown evaluator | **Enforced (UTV2-1178)** — emits `'unknown-evaluator-skipped'` diagnostic event with `replaySafe: true`; no longer silent | Yes — `UnknownEvaluatorDiagnostic` event emitted |
| E-3 | `engine.ts:313–319` | Post-construction mutation of violation objects for replay stamping | **Implicit** (not a bypass, but a mutability concern for replay determinism) | Yes — `replay_run_id` is present in replay-stamped violations |
| Q-1 | `quarantine.ts:62–65` | Non-`fail-closed`/non-`quarantine` behaviors produce only an audit event | **Explicit** — documented allow-list; `warn` and `advisory` behaviors intentionally pass through | Yes — audit event is emitted for all violations regardless of quarantine outcome |
| Q-2 | `quarantine.ts:153–161` | Fallback escalation target `'GovernanceReviewer'` | **Explicit fallback** — but silent in that no signal distinguishes known vs unknown invariant IDs | Yes — escalation notice contains target; detectable by target = `'GovernanceReviewer'` with unrecognized `invariant_id` |
| G-1 | `governance-exception.ts:25` | `'temporary-bypass'` type | **Explicit** — dual-approver + expiration + rollback condition required | Yes — audit event emitted at creation |
| G-2 | `governance-exception.ts:26` | `'operational-override'` type | **Explicit** — same gates as G-1 | Yes — audit event emitted at creation |
| G-3 | `governance-exception.ts:27` | `'emergency-exception'` type | **Explicit** — same gates as G-1 | Yes — audit event emitted at creation |
| G-4 | `governance-exception.ts:28` | `'scheduled-maintenance'` type | **Explicit** — same gates as G-1 | Yes — audit event emitted at creation |
| G-5 | `governance-exception.ts:173–192` | Audit event `event_type: 'invariant_violation'` for exception creation | **Semantic mislabeling** — not a bypass itself, but creates ambiguity for replay consumers | Partially — replay consumers must inspect `payload.entity_type` to distinguish |
| G-6 | `engine.ts` → `governance-exception.ts` | `validateGovernanceException()` — use-time expiration enforcement | **Enforced (UTV2-1178)** — `InvariantEngine.validateGovernanceException()` calls `enforceGovernanceExceptionExpiration()` at use time; expired/rolled-back exceptions throw `GovernanceExceptionValidationError` and emit `'governance-exception-expired'` event | Yes — `GovernanceExceptionUseDiagnostic` event emitted with `replaySafe: true` |
| C-1 | `certification/state-machine.ts:33–39` | Terminal revoked state | **Explicit, fail-closed** | Yes — `replaySafe: true` on all transition events |
| C-2 | `certification/state-machine.ts:95–112` | Initial-insert gate | **Explicit, fail-closed** | Yes |
| C-3 | `certification/state-machine.ts:271–275` | `null` domain record → skip propagation | **Silent-fail-open** — missing domain = not propagated | No — no event for skipped propagation |
| C-4 | `certification/state-machine.ts:321–331` | Clock-expired active records: `isCertified()` returns false but DB status stays `'active'` | **Status drift** — not a bypass, but creates a gap between DB state and certification truth | Partially — query-time check is correct; stored status is stale |
| C-5 | `certification/types.ts:42` | `'quarantine_bypass'` revocation trigger | **Explicit detection signal** — not a bypass path itself | Yes |

---

## 3. Summary by Category

### 3.1 Silent-fail-open (remaining — deferred)

| ID | Location | Mechanism |
|----|----------|-----------|
| E-1 | `engine.ts` | Advisory invariants fire only on explicit context flags; caller omission = no violation |
| C-3 | `certification/state-machine.ts:271–275` | `null` domain record skips propagation silently |

### 3.1.1 Closed by UTV2-1178

| ID | Location | Closure |
|----|----------|---------|
| E-2 | `engine.ts` | Emits `'unknown-evaluator-skipped'` `UnknownEvaluatorDiagnostic` event — no longer silent |
| G-6 | `engine.ts` | `validateGovernanceException()` enforces expiration/rollback status at use time — throws `GovernanceExceptionValidationError` and emits `'governance-exception-expired'` event |

### 3.2 Explicit / sanctioned bypasses (structurally sound, verify expiration semantics pending UTV2-1105)

| ID | Location | Mechanism |
|----|----------|-----------|
| G-1 | `governance-exception.ts:25` | `'temporary-bypass'` — dual-approver + expiration enforced |
| G-2 | `governance-exception.ts:26` | `'operational-override'` — same gates |
| G-3 | `governance-exception.ts:27` | `'emergency-exception'` — same gates |
| G-4 | `governance-exception.ts:28` | `'scheduled-maintenance'` — same gates |
| Q-1 | `quarantine.ts:62–65` | Non-quarantine behaviors pass through with audit event — documented allow-list |
| C-1 | `certification/state-machine.ts:33–39` | Terminal revoked state — correctly fail-closed |
| C-2 | `certification/state-machine.ts:95–112` | Initial-insert gate — correctly fail-closed |

### 3.3 Semantic ambiguity (monitoring debt)

| ID | Location | Issue |
|----|----------|-------|
| G-5 | `governance-exception.ts:173–192` | `event_type: 'invariant_violation'` used for exception creation — misleading for replay consumers |
| Q-2 | `quarantine.ts:153–161` | Fallback `'GovernanceReviewer'` not distinguished from explicitly configured target |
| C-4 | `certification/state-machine.ts:321–331` | DB status stays `'active'` for clock-expired records; drift between DB and `isCertified()` |

---

## 4. Replay Visibility Summary

**Replay-visible (event emitted):** G-1, G-2, G-3, G-4, Q-1, C-1, C-2, E-2 (UTV2-1178), E-3 (partially), G-6 (UTV2-1178), Q-2 (detectable post-hoc)

**Not replay-visible (silent — no event):** E-1 (when context flags absent), C-3 (null domain propagation skip)

**Partial visibility (requires payload inspection):** G-5 (`entity_type` field distinguishes violation vs exception creation)

---

## 5. Deferred Work

The following enforcement actions are NOT implemented in UTV2-1178:

1. Converting `GovernanceExceptionType = 'temporary-bypass'` to require an `ExceptionRecord` enforced by the engine
2. Making advisory evaluators (E-1) emit a "context-insufficient" advisory event instead of silent pass
3. Emitting an audit event when `null` domain record skips propagation (C-3)
4. Correcting the `event_type` for governance exception creation (G-5) from `'invariant_violation'` to a dedicated type

Closed by UTV2-1178 (no longer deferred):
- G-6: Runtime expiration re-validation when a `GovernanceException` is referenced — CLOSED
- E-2: Emitting a diagnostic event when an unknown evaluator is skipped — CLOSED
