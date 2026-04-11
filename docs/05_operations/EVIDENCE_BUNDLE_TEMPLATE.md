# Evidence Bundle Template

**Status:** Ratified 2026-04-11 (UTV2-532)
**Authority:** Canonical shape for all phase/gate evidence bundles written from 2026-04-11 onward.
**Scope:** Applies to `docs/06_status/UTV2-*-EVIDENCE-BUNDLE.md` artifacts produced by Claude Code / Codex CLI execution lanes or by human verifiers.

This template defines the minimum structure and evidence-tie rules an evidence bundle must satisfy to be considered valid by the mechanical validator (`scripts/evidence-bundle/validate-bundle.mjs`). Existing bundles authored before this date are **not** retrofitted; see the follow-up issue list in UTV2-532 for retrofit tracking.

> To generate a new bundle from this template, run: `pnpm evidence:new UTV2-XXX`.
> To validate a bundle against this shape, run: `pnpm evidence:validate docs/06_status/UTV2-XXX-EVIDENCE-BUNDLE.md`.

---

## Why this shape exists

Prior evidence bundles varied wildly in structure. Some embedded DB rows and SQL queries; others claimed "PASS" with only free-text narration. An auditor could not mechanically check whether a claimed PASS was tied to any evidence artifact. This template closes that gap by enforcing:

1. One canonical section order so auditors can scan linearly.
2. Every assertion points to at least one concrete evidence shape.
3. Waivers must name an approver — no anonymous free passes.
4. Verifier identity is mandatory and non-generic (a raw `claude` identity is rejected).
5. Acceptance criteria from the Linear issue are mapped 1:1 to assertions in the table.

Free-text "I checked this" is not evidence. The validator will fail a bundle that claims PASS without tying it to one of the allowed evidence shapes below.

---

## Required sections (order matters)

Every bundle must contain these seven top-level sections, in this order, with matching headings:

1. `## Metadata`
2. `## Scope`
3. `## Assertions`
4. `## Evidence Blocks`
5. `## Acceptance Criteria Mapping`
6. `## Stop Conditions Encountered`
7. `## Sign-off`

The validator performs a literal heading match on these exact strings. If a section is missing or renamed, validation fails.

---

## 1. Metadata

A metadata table that identifies the bundle. All fields are mandatory and must be non-empty.

```markdown
## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-XXX |
| Tier | T1 / T2 / T3 |
| Phase / Gate | Phase N — short name |
| Owner | <lane or human> |
| Date | YYYY-MM-DD |
| Verifier Identity | claude/<session-id> OR codex-cli/<lane-id> OR <human name> |
| Commit SHA(s) | <short sha> + optional follow-ons |
| Related PRs | #NNN, #MMM |
```

**Verifier identity rules:**
- Must not be blank.
- Must not be the literal string `claude` on its own — use `claude/<session-id>` or a similar qualified form.
- Human names are allowed verbatim.
- Automated lanes must qualify with the lane id (e.g. `codex-cli/lane-2`).

The verifier identity field is the same concept as the identity captured by the `ut:phase:verify` CLI (see `scripts/ut-cli/`). It exists so that an auditor can trace a bundle back to a specific execution session or person.

---

## 2. Scope

A short section that states what this bundle claims and what it explicitly does NOT claim.

```markdown
## Scope

**Claims:**
- <concrete claim 1>
- <concrete claim 2>

**Does NOT claim:**
- <out-of-scope item>
- <deferred follow-up>
```

The "Does NOT claim" list is a hard anti-overreach rule. If the work touched something but did not fully verify it, it belongs here.

---

## 3. Assertions

A table with one row per assertion. Column order matters — the validator parses this shape.

```markdown
## Assertions

| # | Assertion | Evidence Type | Source | Result | Evidence Ref |
|---|---|---|---|---|---|
| 1 | <assertion text> | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E1](#e1-first-assertion) |
| 2 | <assertion text> | test | `apps/api/src/foo.test.ts::bar` | PASS | [E2](#e2-second-assertion) |
| 3 | <assertion text> | fixture | `__fixtures__/golden.json` | WAIVED | approved by: PM (date) — see [E3](#e3-third-assertion) |
```

Rules:
- At least one row is required.
- The `Result` cell must be exactly one of `PASS`, `FAIL`, `WAIVED`.
- The `Evidence Ref` cell must not contain any placeholder text (`TODO`, `TBD`, `<fill-in>`, `FIXME`). The validator rejects these outright.
- Every `PASS` row must have a matching evidence block below (`### E<n> ...`).
- Every `WAIVED` row must contain the phrase `approved by: <name>` somewhere in that row.
- `Evidence Type` should be one of the shapes enumerated in the next section.

---

## 4. Evidence Blocks

One block per assertion in the table. Each block is a level-3 heading `### E<n> <short title>` and contains the raw evidence artifact. This is what an auditor reads to independently verify the assertion.

```markdown
## Evidence Blocks

### E1 First assertion

<raw evidence — SQL + result rows, test output, fixture hash, curl + response, etc.>

### E2 Second assertion

<...>

### E3 Third assertion

<waiver text: reason, stop condition, approver name, date>
```

The validator checks that for every `PASS` row `n`, a heading containing the token `E<n>` exists beneath `## Evidence Blocks`.

### Allowed evidence shapes

A bundle is valid only if every PASS row uses one of these shapes in its evidence block. Free-text "I checked this" is not an allowed shape.

#### db-query

A SQL query, the Supabase project ref, a run timestamp, and the raw result rows.

```markdown
**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-11T14:22:00Z
Query:
```sql
select id, status, approval_status
from picks
where id = 'dad42bc3-ddbd-47fc-ba0a-17eb5e5e62d1';
```
Result (1 row):
| id | status | approval_status |
|---|---|---|
| dad42bc3-... | awaiting_approval | approved |
```

#### test

A named test (file path + test name), the run command, and the raw PASS line from `node:test` output with duration.

```markdown
**Test evidence**
Test: `apps/api/src/promotion-service.test.ts::evaluateAndPersistBestBetsPromotion qualifies on all-strong`
Command: `tsx --test apps/api/src/promotion-service.test.ts`
Output excerpt:
```
ok 12 - evaluateAndPersistBestBetsPromotion qualifies on all-strong
  ---
  duration_ms: 41.2
  ...
```
```

#### fixture

A file path, a content hash (sha256), and a one-line explanation of what the fixture proves.

```markdown
**Fixture evidence**
Path: `scripts/evidence-bundle/__fixtures__/valid-bundle.md`
sha256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
Role: golden shape for regression — any diff triggers validator failures.
```

#### http

A curl/fetch invocation and the raw response (status + body excerpt).

```markdown
**HTTP evidence**
Command:
```
curl -sS -X POST http://localhost:4000/api/picks/abc123/review \
  -H 'content-type: application/json' \
  -d '{"decision":"approve"}'
```
Response: `HTTP 200`
```json
{ "ok": true, "pickId": "abc123", "newStatus": "queued" }
```
```

#### repo-truth

A `git log --oneline <range>` output or a ripgrep match that proves "this code exists on main".

```markdown
**Repo-truth evidence**
Command: `git log --oneline c8ebfde^..c8ebfde -- apps/api/src/scripts/utv2-494-phase7a-proof-a-brake.ts`
Output:
```
c8ebfde fix(utv2-522): Lane A proof script — re-runnable + idempotency hygiene
```
```

#### waived

An explicit waiver. Only allowed when a stop condition was accepted by the PM.

```markdown
**Waiver**
Reason: <why the assertion could not be proven mechanically>
Stop condition: <link to the stop-conditions row below>
Approved by: PM on 2026-04-11
```

The validator requires `approved by: <name>` somewhere in the assertion row for any `WAIVED` result. Waivers without a named approver fail validation.

---

## 5. Acceptance Criteria Mapping

Every acceptance criterion from the Linear issue must map to one or more assertion rows. A bundle without this section, or with zero mapping rows, is invalid.

```markdown
## Acceptance Criteria Mapping

| Acceptance Criterion (verbatim from Linear) | Assertion # |
|---|---|
| Non-human-produced picks can land in `awaiting_approval` | 1 |
| Those picks do not auto-queue | 2 |
| Approval advances the pick into `queued` | 5 |
```

The validator checks that this section exists and contains at least one non-header row.

---

## 6. Stop Conditions Encountered

Any time the verifier hit a stop condition (per CLAUDE.md `### Stop Conditions`) and escalated. If none were hit, write the literal string `None`.

```markdown
## Stop Conditions Encountered

- 2026-04-11: schema CHECK constraint drift discovered mid-run. Escalated. Resolution: UTV2-519 corrective DDL shipped before bundle closed.
```

---

## 7. Sign-off

A verifier signature line and a PM acceptance line. This section gates bundle acceptance.

```markdown
## Sign-off

**Verifier:** <name or lane> — <YYYY-MM-DD HH:MM TZ>
**PM acceptance:** <pending | accepted by <name> on YYYY-MM-DD>
```

---

## How assertions must tie to evidence

Every `PASS` row in the assertions table must tie to evidence. Here is what "tie to evidence" means per shape, with minimum worked examples:

**DB-query assertion.** Show the exact SQL query, the project ref, the run timestamp, and the raw result row count plus the decision.

Example: "A1 — autonomous source pick lands in `awaiting_approval`" ties to:
```sql
select id, status from picks where source = 'system-pick-scanner' and id = 'dad42bc3-...';
```
Result: 1 row, `status = 'awaiting_approval'`. Decision: PASS.

**Test assertion.** Show the test file path + test name, the command used to run it, and the stdout excerpt containing the `ok <n> - <test name>` line.

Example: "A2 — promotion gate rejects unscored picks" ties to `apps/api/src/promotion-service.test.ts::rejects pick without scores`, `tsx --test apps/api/src/promotion-service.test.ts`, output `ok 4 - rejects pick without scores`.

**Fixture assertion.** Show the fixture file path and a content hash. If regression drift matters, include the expected hash.

Example: "A3 — golden submission shape preserved" ties to `apps/api/src/__fixtures__/submission.golden.json` with sha256 `deadbeef...`.

**Acceptance-outcome assertion.** Quote the acceptance criterion verbatim from the Linear issue, then reference the row in the assertions table that proves it. This is what the `## Acceptance Criteria Mapping` section is for — it is not optional.

Example: acceptance criterion "Non-human-produced picks can land in `awaiting_approval`" maps to assertion row #1, which in turn ties to a db-query evidence block.

---

## Validator rules (mechanical)

The validator (`scripts/evidence-bundle/validate-bundle.mjs`) enforces:

1. All seven required sections present by heading match.
2. Metadata table has all required fields, non-empty.
3. Assertions table has at least one data row.
4. Every assertion row has a `Result` of `PASS`, `FAIL`, or `WAIVED`.
5. Every `PASS` row has a corresponding evidence block (`### E<n> ...`) under `## Evidence Blocks`.
6. Every `WAIVED` row contains `approved by: <name>`.
7. No row has `evidence ref` equal to placeholder text (`TODO`, `TBD`, `<fill-in>`, `FIXME`).
8. `Verifier Identity` field is not blank and not the literal string `claude`.
9. Acceptance criteria mapping section has at least one mapping row.

The validator is a doc-shape checker, not a semantic proof engine. It cannot tell you whether your SQL query actually produced the rows you claim — that is the auditor's job. What it can do is prevent bundles from claiming PASS without any evidence artifact at all.

---

## Related artifacts

- Generator: `scripts/evidence-bundle/new-bundle.mjs` (`pnpm evidence:new UTV2-XXX`)
- Validator: `scripts/evidence-bundle/validate-bundle.mjs` (`pnpm evidence:validate <path>` or `pnpm evidence:validate --all`)
- Historical schema (pre-2026-04-11): `docs/06_status/PROOF_BUNDLE_SCHEMA.md` — superseded by this template for new bundles
- Verifier identity convention: `scripts/ut-cli/` spec
