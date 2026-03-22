# Consumer Classification Governance Rule

**Version:** 1.0
**Ratified:** 2026-03-21
**Scope:** All architecture and contract documents that list consumers of any data surface

---

## Rule

Every architecture or contract document that lists consumers of a data surface MUST classify each consumer into exactly one of two states:

| Status | Definition | Required Evidence |
|---|---|---|
| **ACTIVE** | Code exists that reads or writes this data surface | File path, function name, grep match |
| **INACTIVE** | No code exists that reads or writes this data surface | Explicit statement: "This consumer does NOT currently read [surface]" |

No other classification is permitted. The following terms are FORBIDDEN in consumer listings:

- "adjacent"
- "easy to wire"
- "possible"
- "could consume"
- "near-term"
- "planned"
- "suggested"

Any document using these terms to describe a consumer's current status is non-compliant.

---

## Evidence Requirements

### ACTIVE consumers require all three:

1. **File path** — exact path to the consuming file (e.g., `apps/api/src/promotion-service.ts`)
2. **Function or usage** — the function name or code pattern that reads the surface (e.g., `readDomainAnalysisEdgeScore()`)
3. **Grep proof** — a grep command and its expected output confirming the reference exists

Example of compliant ACTIVE entry:

```
### Promotion Scoring

- File: apps/api/src/promotion-service.ts
- Function: readDomainAnalysisEdgeScore()
- Status: ACTIVE
- Grep: grep -n "domainAnalysis" apps/api/src/promotion-service.ts
  → line 422: const domainAnalysis = metadata['domainAnalysis'];
```

### INACTIVE consumers require:

1. **File path** — exact path to the file that does NOT consume the surface
2. **Status statement** — "This consumer does NOT currently read [surface]"
3. **Grep proof** — grep command showing zero matches

Example of compliant INACTIVE entry:

```
### Settlement Enrichment

- File: apps/api/src/settlement-service.ts
- Status: INACTIVE
- Statement: This consumer does NOT currently read metadata.domainAnalysis
- Grep: grep -n "domainAnalysis" apps/api/src/settlement-service.ts
  → (no matches)
```

---

## CI Check Concept

### Gate: consumer-claim-verification

**Trigger:** Any document under `docs/02_architecture/` or `docs/03_contracts/` that contains the word "ACTIVE" adjacent to a file path.

**Logic:**

```
For each ACTIVE consumer claim in the document:
  1. Extract the file path
  2. Extract the data surface name (e.g., "domainAnalysis")
  3. Run: grep -l "<surface>" <file_path>
  4. If grep returns no matches → FAIL
  5. If the file does not exist → FAIL
```

**Pass condition:** Every ACTIVE claim has a corresponding grep match in the referenced file.

**Fail condition:** Any ACTIVE claim references a file that does not contain the claimed surface. Fail closed. Do not proceed.

**Output on failure:**

```
CONSUMER CLAIM VIOLATION
Document: docs/02_architecture/week_19_downstream_consumer_matrix.md
Claim: ACTIVE consumer "Settlement Enrichment" at apps/api/src/settlement-service.ts
Grep result: 0 matches for "domainAnalysis"
Verdict: FAIL — claimed consumer is not present in code
```

---

## Example Violation

**Document content (non-compliant):**

```markdown
## Consumers

| Consumer | File | Status |
|---|---|---|
| Operator Analytics | apps/operator-web/src/server.ts | ACTIVE |
```

**Verification:**

```bash
grep -n "domainAnalysis" apps/operator-web/src/server.ts
# (no output — zero matches)
```

**Result:** FAIL

**Reason:** Document claims ACTIVE status for a consumer that has zero code-level references to the data surface. This is a false claim. The document must either:
- Change the status to INACTIVE with the required statement, or
- Point to a different file that does contain the reference

---

## Enforcement Scope

This rule applies to:
- All documents under `docs/02_architecture/`
- All documents under `docs/03_contracts/`
- Any document in any location that lists consumers of a named data surface

This rule does NOT apply to:
- Sprint planning documents that list candidate work (these must not use "ACTIVE" for unimplemented consumers)
- Code comments
- Test files

---

## Authority

This governance rule is a peer to the domain analysis consumer contract (`docs/03_contracts/domain_analysis_consumer_contract.md`). It generalizes the consumer truth discipline established in that contract to all data surfaces in the repository.

When a consumer contract exists for a specific surface, that contract's Approved Consumers list is the authoritative source. This governance rule defines the classification standard that all such contracts and architecture documents must follow.
