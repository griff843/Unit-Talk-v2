# /audit

Deterministic 10-area constitutional enforcement audit. Reads only from merged main and persisted repo files. Fail-closed: if evidence is absent, uncertain, or cannot be located, the area verdict is FAIL.

**Usage:**
- `/audit` — full 10-area audit against merged main
- `/audit <scope>` — scope to issue range (e.g. `UTV2-1107..1111`) or comma-separated area names (e.g. `db-fsm,dual-auth`)

**Arguments:** `$ARGUMENTS`

---

## Core rule

All evidence from merged main and persisted repo files only. Do not implement new runtime. Do not modify code unless the audit finds a hard blocker (defined as: a missing guard that allows an illegal state transition, authority bypass, or data mutation to proceed silently). Hard blockers must be called out explicitly in the verdict block before any fix is considered.

---

## 10 audit areas

Work through each area in order. For each, grep/read the relevant source files. Emit `PASS / FAIL / PARTIAL` with evidence file path and line number.

---

### 1. DB FSM enforcement

What to check:
- TypeScript transition guard `isAllowedLifecycleTransition` exists and covers all lifecycle states
- Postgres BEFORE UPDATE trigger present in migration files, enforcing the same state machine
- Terminal states (e.g. `CANCELLED`, `SETTLED`, `VOIDED`) are enforced — no outbound transitions allowed from them
- `lifecycle-matrix.test.ts` (or equivalent) covers all states, including terminal → illegal attempts

Grep targets: `isAllowedLifecycleTransition`, `BEFORE UPDATE`, `lifecycle-matrix`, terminal state names.

---

### 2. Scoped authority matrix enforcement

What to check:
- `AUTHORITY_MATRIX` is hardcoded (not runtime-loaded) in the contracts layer
- `assertAuthority()` is present and throws on unauthorized access
- `assertFieldAuthority()` is present and throws on unauthorized field mutation
- `cross_domain_allowed` flag is enforced via `assertCrossDomainAllowed()` — no cross-domain writes without explicit permit

Grep targets: `AUTHORITY_MATRIX`, `assertAuthority`, `assertFieldAuthority`, `assertCrossDomainAllowed`, `cross_domain_allowed`.

---

### 3. Dual-authorization runtime

What to check:
- `completeApproval()` checks same-operator block before state mutation (approver !== initiator)
- `completeApproval()` checks window expiration before state mutation
- Both checks fail-closed (throw, not warn)
- `PendingApproval` and `ApprovalRecord` are `Object.freeze()`'d at construction
- Boundary semantics use `>=` (not `>`) for expiration comparison

Grep targets: `completeApproval`, `Object.freeze`, `PendingApproval`, `ApprovalRecord`, same-operator check pattern.

---

### 4. Approval expiration

What to check:
- `assertApprovalNotExpired()` is present and fail-closed (throws, does not return false)
- Three TTL windows defined: dual-auth 3600s, operator-action 1800s, member-promotion 86400s
- `ExpirationRecord` is `Object.freeze()`'d
- No code path allows a stale approval to proceed

Grep targets: `assertApprovalNotExpired`, `3600`, `1800`, `86400`, `ExpirationRecord`, `Object.freeze`.

---

### 5. Emergency governance rollback

What to check:
- `assertDomainNotFrozen()` executes first in the auth chain (before dual-auth and expiry checks)
- Dual-auth and expiry checks follow in order after frozen-domain check
- `RollbackEvent` is `Object.freeze()`'d
- `replayRollbackChain()` breaks on the first terminal state (no replay past terminal)

Grep targets: `assertDomainNotFrozen`, `RollbackEvent`, `Object.freeze`, `replayRollbackChain`, terminal-break pattern.

---

### 6. Frozen-domain enforcement

What to check:
- `FROZEN_DOMAINS` set is defined in `governance-rollback.ts` (or equivalent governance module)
- `assertDomainNotFrozen()` is unconditional — no feature flag, no env bypass
- Check membership of four specific domains: `capital`, `scaling`, `ws-3.5`, `treasury`
- Note absent domains explicitly in the verdict

Grep targets: `FROZEN_DOMAINS`, `assertDomainNotFrozen`, `capital`, `scaling`, `ws-3.5`, `treasury`.

---

### 7. Replay visibility

What to check:
- `IsolatedReplayStore` constructor throws if `mode !== 'isolated'` (no accidental production writes during replay)
- `production_write_count` is tracked and asserted zero after replay
- `audit_log` table exists in DB schema (migration files)
- Proof tests for replay are present in the verify gate (CI)

Grep targets: `IsolatedReplayStore`, `production_write_count`, `audit_log`, verify-gate test references.

---

### 8. Append-only evidence

What to check:
- `Object.freeze()` applied to all governance records (approval, rollback, certification, expiration)
- No update paths exist for governance records (no UPDATE SQL on governance tables, no setter methods)
- `CertificationRecord` is marked never-mutate (comment or type annotation)
- `immutableAfterSet` flag present in writer-authority module

Grep targets: `Object.freeze`, `CertificationRecord`, `immutableAfterSet`, UPDATE on governance tables.

---

### 9. Deterministic reconstruction

What to check:
- Replay functions are pure (no side effects, no external calls)
- Events sorted by `occurredAt` timestamp before replay (not insertion order)
- `reconstructRollbackChain()` is idempotent (same input → same output, no internal state mutation)
- `replayApprovalChain()` delegates to `completeApproval()` (does not reimplement approval logic)

Grep targets: `reconstructRollbackChain`, `replayApprovalChain`, `occurredAt`, sort pattern, `completeApproval`.

---

### 10. Program 1 certification non-interference

What to check:
- `assertAcyclic()` called at module load (not deferred to runtime)
- `DependentGateChecker.checkDomainGates()` is fail-closed (throws on gate failure, not warns)
- Downstream revocation uses BFS in `computeCanonicalDownstreamRevocations()`
- Each (P1–P5, domain) pair is independently evaluated — no shared mutable state between pairs

Grep targets: `assertAcyclic`, `DependentGateChecker`, `checkDomainGates`, `computeCanonicalDownstreamRevocations`, BFS pattern.

---

## Required output format

### Per-area verdict

```
[N]. <Area name>
  Verdict: PASS | FAIL | PARTIAL
  Evidence: <file path>:<line number> — <what was found or not found>
  Gap (if FAIL/PARTIAL): <exact missing guard or check>
```

### Overall verdict block

```
Overall: PASS | FAIL
Remaining blockers: <list or "none">
Replay/audit risks: <list or "none">

Frozen-domain status:
  capital   — FROZEN | NOT IN SET
  scaling   — FROZEN | NOT IN SET
  ws-3.5    — FROZEN | NOT IN SET
  treasury  — FROZEN | NOT IN SET | CONFIRMED NOT FROZEN

Next safe Linear issue batch: <recommendation>
```

---

## Verdict definitions

- `PASS` — all named guards present, evidence cited with file path and line number
- `FAIL` — one or more named guards absent or bypassed; cite what is missing
- `PARTIAL` — guards present but incomplete coverage (e.g. TypeScript guard present, Postgres trigger absent)

Overall is `PASS` only if all 10 areas are `PASS`. Any `FAIL` or `PARTIAL` makes overall `FAIL`.

---

## Rationalization resistance

| You might think… | But actually… |
|---|---|
| "The function exists somewhere" | Existence is not enforcement. It must be called unconditionally in the auth chain. |
| "Tests cover it implicitly" | Implicit coverage is not cited evidence. Name the test file and line. |
| "The flag is configurable" | Configurable guards are not fail-closed. Unconditional throw required. |
| "It's probably fine" | "Probably" is a FAIL verdict. Cite the line or mark it FAIL. |
| "This area is out of scope" | All 10 areas are always in scope unless `$ARGUMENTS` explicitly names a subset. |
