# /betting-domain

Enforce domain purity before and during any change to CanonicalPick, scoring, promotion scores, lifecycle, CLV, or grading logic.

Domain logic must remain pure. No DB, no HTTP, no side effects — ever.

---

## When this skill applies

Apply automatically when touching any of:
- `CanonicalPick` or `CanonicalPickMetadata` types
- `promotionScores` (edge, trust, readiness, uniqueness, boardFit)
- Lifecycle states: `validated | queued | posted | settled | voided`
- CLV calculation or grading logic
- Scoring weights or policy thresholds
- `@unit-talk/domain` package (any file)
- `@unit-talk/contracts` package (any file)

---

## Pre-implementation checklist

Before writing any domain code, verify:

**[ ] Contract exists first**
The type or policy must be defined in `@unit-talk/contracts` before implementation begins.
If it is not there, define it there first — then implement.

**[ ] No runtime imports in domain**
`@unit-talk/domain` must import only from:
- `@unit-talk/contracts`
- Node.js built-ins (non-I/O only)

It must NEVER import from:
- `@unit-talk/db`
- `@unit-talk/config`
- `@unit-talk/observability`
- Any app (`apps/*`)
- Any HTTP/fetch library
- Any ORM or query builder

**[ ] Scoring components match contracts**
The five promotion score components (`edge`, `trust`, `readiness`, `uniqueness`, `boardFit`) must be read from `pick.metadata.promotionScores` — not computed inline in apps.

**[ ] Policy weights come from domain, not apps**
Apps call domain functions with data. Apps do NOT contain scoring weights, threshold values, or policy logic.

**[ ] Lifecycle transitions match the allowed state machine**
```
validated → queued | voided
queued    → posted | voided
posted    → settled | voided
settled   → (terminal — no further transitions)
voided    → (terminal — no further transitions)
```
`draft` is defined but unused — all V2 picks start at `validated`.

---

## Implementation rules

**Pure functions only**
Domain functions take data in, return data or decisions out. No mutations of external state. No async I/O.

**Fail closed**
If a score is missing or a threshold cannot be evaluated, return `not_eligible` or `suppressed` — never default to `qualified`.

**Scoring gate thresholds (do not change without explicit PM approval)**
- Best Bets minimum: `promotionScore ≥ 70`
- Trader Insights minimum: `promotionScore ≥ 80`, `edge ≥ 85`, `trust ≥ 85`
- Smart Form V1 picks without `confidence` → static fallback score of `61.5` → correctly suppressed

**Priority ordering**
When a pick qualifies for multiple targets, Trader Insights takes priority over Best Bets.

**Approval and promotion are separate concepts**
Never conflate `approval_status` (`pending | approved | rejected`) with `promotion_status` (`not_eligible | eligible | qualified | promoted | suppressed | expired`). They are different fields on different axes.

---

## Verification after domain changes

```bash
pnpm type-check
pnpm test
```

Also confirm:
- No new imports from DB, config, or app packages added to `@unit-talk/domain`
- No scoring weights or thresholds moved out of domain into app layer
- Test count did not decrease

Check imports:
```bash
grep -r "from '@unit-talk/db'" packages/domain/src/
grep -r "from '@unit-talk/config'" packages/domain/src/
grep -r "from 'apps/" packages/domain/src/
```

Each of these must return zero results. If any return results, fix before proceeding.

---

## Red flags — stop if you see these

- A scoring weight defined in `apps/api/src/`
- A lifecycle transition that skips a state (e.g. `validated → posted`)
- An app importing domain internals and re-implementing scoring logic
- A `qualified` result returned when score components are absent
- Async functions inside `@unit-talk/domain`
- Any `fetch`, `axios`, `supabase`, or `pg` import inside domain

Report the violation before writing any fix.

---

## Output format (when invoked explicitly)

```
## Betting Domain Check

### Scope
Files in scope: [list]
Domain invariant most at risk: [name it]

### Import audit
- @unit-talk/domain → @unit-talk/db: CLEAN / VIOLATION (file:line)
- @unit-talk/domain → @unit-talk/config: CLEAN / VIOLATION
- @unit-talk/domain → apps/*: CLEAN / VIOLATION

### Contract alignment
- CanonicalPick contract exists: YES / NO / MISSING
- promotionScores fields match contracts: YES / DRIFT (describe)
- Scoring thresholds in domain (not apps): YES / NO

### Lifecycle transitions
- All transitions follow allowed state machine: YES / VIOLATION (describe)

### Verdict
CLEAN — proceed
— or —
VIOLATIONS FOUND — fix before implementation:
  - [list each violation]
```
