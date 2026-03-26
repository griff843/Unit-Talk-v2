# /t1-proof

Assemble a V2-native T1 proof package for a bounded change.

Answers: what changed, what was verified, what evidence exists, what remains unverified, and is this ready for T1 close?

**Prerequisites (per `SPRINT_MODEL_v2.md`):**
- Written contract must exist before this command runs
- `pnpm verify` must pass before proof is captured
- Rollback plan must be documented before activation

---

## Inputs

- **sprint_name** (required) — sprint name, e.g. `"Settlement Hardening"` or `"SPRINT-SETTLEMENT-HARDENING"`
- **change_summary** (optional) — one-line description of what changed
- **pick_ids** (optional) — one or more pick UUIDs if lifecycle/distribution/settlement/promotion is in scope
- **scope** (optional, default: `standard`)
  - `minimal` — pnpm verify + change inventory + rollback check only
  - `standard` — minimal + runtime/DB evidence + pick verification if pick_ids given
  - `full` — standard + operator surface + audit log + Linear/Notion sync status

---

## Step 0 — Confirm Prerequisites

Before assembling any proof, verify all three gates.

**Gate 1 — Contract exists?**
Check `docs/05_operations/` for a contract file for this sprint (e.g. `week_NN_*_contract.md` or `SPRINT-<NAME>_contract.md`).
- PASS → note the file path
- FAIL → STOP. T1 requires a written contract before implementation. Proof cannot be captured.

**Gate 2 — `pnpm verify` passes?**
```bash
pnpm verify
```
Run it. Report all 5 gate results:
```
env:check:   PASS / FAIL
lint:        PASS / FAIL  (N errors)
type-check:  PASS / FAIL
build:       PASS / FAIL
test:        N/N passing
```
If any gate fails: STOP. Fix root cause before capturing proof.

**Gate 3 — Rollback plan documented?**
For a T1 change that is not yet activated: rollback plan must exist before activation.
If post-activation: note that rollback plan should have existed pre-activation.
- PASS → note the file or inline location
- MISSING → flag (required for T1)

If any gate fails, output:
```
PREREQUISITES NOT MET
Missing: [contract / pnpm verify / rollback plan]
Proof capture blocked. Resolve before proceeding.
```

---

## Step 1 — Change Summary

Establish what changed and why. This section must be grounded in files, not intention.

**First, record the pre-implementation baseline** (critical for test delta and rollback reference):
```bash
git log --oneline -5          # find the commit before sprint work began
git rev-parse HEAD            # current HEAD
pnpm test 2>&1 | tail -3      # test count BEFORE this sprint's changes (use git stash or check log)
```
If working post-implementation, derive the baseline from `git log` — find the last commit before the sprint started and note its hash and the test count at that point.

Capture:
- **Sprint:** `SPRINT-<NAME>`
- **Tier:** T1
- **Date:** [today]
- **Objective:** [one sentence — what problem was solved]
- **Pre-implementation baseline:** commit=`<hash>`, tests=N passing
- **Files changed:** [exact paths — derive from `git diff --name-only <baseline>..HEAD`]
- **Tables/schema changed:** [list migration file(s) if any, or NONE]
- **Live routing changed:** YES / NO — if YES, which targets
- **Settlement path changed:** YES / NO
- **New external integration:** YES / NO

**Automatic T1 triggers — check which apply:**
- [ ] `supabase/migrations/` file created or modified
- [ ] Live routing target changed (`discord:best-bets`, `discord:trader-insights`)
- [ ] Settlement write path changed (`recordInitialSettlement`, `recordSettlementCorrection`, `recordManualReview`)
- [ ] `PROGRAM_STATUS.md` routing state table changed

If no T1 triggers apply: note it. The sprint may warrant re-classification as T2/T3 — flag for operator review but do not block proof.

---

## Step 2 — Verification Performed

Run applicable checks per scope. Report each as: **PASS / FAIL / NOT RUN / UNVERIFIED**

### All scopes — gate results

**Do not re-run `pnpm verify` here.** Record the results from Step 0 Gate 2.

| Check | Result | Notes |
|-------|--------|-------|
| `pnpm env:check` | PASS/FAIL | |
| `pnpm lint` | PASS/FAIL | N errors |
| `pnpm type-check` | PASS/FAIL | |
| `pnpm build` | PASS/FAIL | |
| `pnpm test` | N/N PASS | |
| Test delta | before=N → after=N | +N / unchanged / DECREASE |

Test count must not decrease. If it decreased, flag as FAIL regardless of all other results.

**Schema migration T1 sprints — also run:**
```bash
pnpm test:db
```
This is the DB smoke test against live Supabase. Required when any `supabase/migrations/` file was added or modified. Record result: PASS / FAIL / NOT RUN (if no schema change).

### Standard + full — runtime evidence

If the change touches submission / distribution / settlement / promotion:
- End-to-end flow run: YES / NO
- Real pick submitted via API: YES / NO → pick_id if YES
- Pick completed expected lifecycle transitions: YES / NO / UNVERIFIED

If a flow was NOT run for a lifecycle-affecting change: flag as gap and explain why (e.g. test-only verification, scope didn't require it).

### Standard + full — DB evidence

Query live DB via Supabase MCP. Relevant tables depend on change type:

| Change type | Tables to check |
|-------------|----------------|
| Schema migration | Confirm columns/constraints exist post-migration |
| Promotion change | `pick_promotion_history`, `picks.promotion_status`, `picks.promotion_target` |
| Distribution change | `distribution_outbox`, `distribution_receipts` |
| Settlement change | `settlement_records`, `picks.status` |
| Lifecycle change | `pick_lifecycle`, `picks.status` |
| Audit behavior | `audit_log` — query via `entity_ref = pick_id` |

For each table queried: record the row ID(s) found and key field values. Flag any expected row that is absent.

### Full — operator surface

- `GET /api/operator/snapshot` → confirm channel health reflects expected state
- `GET /api/operator/recap` → confirm settlement/recap visible if settlement in scope

---

## Step 3 — Evidence

Concrete, specific references only. Each item: **VERIFIED / UNVERIFIED / NOT APPLICABLE / NOT RUN**

### Repo / code truth
- Commit hash: `git rev-parse HEAD`
- Files changed: [list from Step 1]
- `pnpm verify` exit 0: YES / NO
- Test count before → after: N → N (+N)

### Runtime truth (if applicable)
- Pick ID(s): `<uuid>` / NOT RUN
- Submission response `outboxEnqueued`: true / false / NOT RUN
- Lifecycle reached `posted`: YES / NO / NOT RUN
- Discord message ID(s): `<id>` / NOT RUN / UNVERIFIED

### DB truth (Supabase MCP)
Record specific row IDs and key field values for each relevant table. Example:
```
distribution_receipts row <uuid>: channel=discord:best-bets, message_id=<discord_id>
pick_promotion_history row <uuid>: target=trader-insights, promotion_status=qualified, score=XX
settlement_records row <uuid>: status=settled, result=win
```
Flag any expected row that is missing.

### Operator surface truth (standard + full)
- Snapshot accessible: YES / NO / NOT CHECKED
- `bestBets.activationHealthy`: true / false / NOT CHECKED
- `traderInsights.activationHealthy`: true / false / NOT CHECKED
- Recap endpoint: accessible YES / NO / NOT APPLICABLE

---

## Step 4 — Pick Verification (if pick_ids given)

If the change involves lifecycle, distribution, settlement, or promotion behavior, use `/verify-pick`.

For each pick_id:
```
/verify-pick <pick_id> depth=full
```
Use `depth=full` for T1 proof — it includes the audit log, which is required to confirm transition evidence. Use `depth=standard` only if audit log access is unavailable and note the gap.

Summarize results here — do not re-implement verification logic:

| Pick ID | Lifecycle chain | Promotion | Delivery | Settlement | Verdict |
|---------|----------------|-----------|----------|------------|---------|
| `<uuid>` | validated→queued→posted→settled | qualified/discord:best-bets | sent/msg=X | settled/win | VERIFIED |

If no pick_ids were given but the change is lifecycle/promotion/distribution/settlement-affecting:
- Note that pick-level verification was NOT RUN
- Flag as gap if the change warrants it

If change does not affect pick lifecycle: state "NOT APPLICABLE — change does not affect pick lifecycle."

---

## Step 5 — Risks / Exceptions

List outstanding risks and known gaps.

For each:
- **Description:** what the risk is
- **Severity:** Low / Medium / High
- **Status:** Open / Accepted / Mitigated
- **Mitigation:** what was done, or why it is accepted

Check against:
- `PROGRAM_STATUS.md § Open Risks` — any existing risks that apply to this change
- New findings discovered during this sprint
- Items that are UNVERIFIED (not failed, but unconfirmed)

If none: state "No new risks identified."

---

## Step 6 — Rollback Readiness

| Item | Status |
|------|--------|
| Rollback plan documented | YES (file: <path>) / MISSING |
| Rollback triggers defined | YES / NO |
| Schema rollback SQL prepared | YES / NO / N/A |
| Routing rollback steps prepared | YES / NO / N/A |
| Rollback tested | YES / NO (not required — note if tested) |

**Conditions that would invalidate this proof:**
List specific, observable conditions. Examples:
- `distribution_outbox` shows `failed` or `dead_letter` rows after activation
- `picks.status` inconsistency detected in operator snapshot
- Test count drops below current baseline on re-run
- Discord delivery fails in production window
- Settlement records show mutation (should never occur — audit trigger enforces immutability)

---

## Output Format

```
# T1 Proof Report

## Sprint / Change
Sprint: SPRINT-<NAME>
Tier:   T1
Date:   <date>
Objective: <one line>
Contract: <file path> / MISSING

## Scope
Files changed: [list]
Schema change: YES/NO — [migration file if YES]
Routing change: YES/NO — [targets if YES]
Settlement path change: YES/NO
T1 triggers hit: [list / NONE]

## What Changed
<2-5 line grounded description of the change>

## Verification Performed
| Check            | Result          |
|------------------|-----------------|
| pnpm env-check   | PASS/FAIL       |
| pnpm lint        | PASS/FAIL       |
| pnpm type-check  | PASS/FAIL       |
| pnpm build       | PASS/FAIL       |
| pnpm test        | N/N PASS        |
| Test delta       | N → N (+N / 0)  |
| Runtime flow     | PASS/NOT RUN    |
| DB evidence      | VERIFIED/UNVERIFIED/NOT RUN |
| Operator surface | CHECKED/NOT CHECKED/NOT APPLICABLE |

## Evidence
Repo / code:
  Commit: <hash>
  pnpm verify: PASS (exit 0)
  Tests: N → N (+N)

Runtime:
  Pick IDs: [list] / NOT RUN
  Discord message IDs: [list] / NOT RUN / UNVERIFIED
  Outbox IDs: [list] / NOT RUN

DB (Supabase MCP):
  [table]: row <id> — [key field values]
  [any missing rows flagged]

Operator surface:
  Snapshot: [result] / NOT CHECKED
  Recap: [result] / NOT APPLICABLE

## Pick Verification (if applicable)
| Pick ID | Lifecycle | Promotion | Delivery | Settlement | Verdict |
|---------|-----------|-----------|----------|------------|---------|
| ...     | ...       | ...       | ...      | ...        | ...     |

[Or: NOT APPLICABLE | NOT RUN — <reason>]

## Risks / Exceptions
- [list] / None

## Rollback Readiness
Plan documented: YES / MISSING
Triggers defined: YES / NO
Schema rollback: YES / NO / N/A
Routing rollback: YES / NO / N/A

Invalidation conditions:
- [list specific conditions]

## Verdict
<READY FOR T1 CLOSE | READY WITH EXCEPTIONS | NOT READY>

Reason: <one sentence>

## Next Action
<one specific action>
```

---

## Verdict Definitions

| Verdict | Meaning |
|---------|---------|
| `READY FOR T1 CLOSE` | All T1 gates met: contract exists, pnpm verify passes, rollback documented, proof captured, independent verification complete. No blocking gaps. |
| `READY WITH EXCEPTIONS` | Core proof is sound. One or more items are UNVERIFIED or NOT RUN — but each is explicitly named, scoped, and accepted. Not a catch-all. |
| `NOT READY` | A T1 gate is missing or a check failed. Enumerate blockers exactly. Do not proceed to sprint-close. |

"READY WITH EXCEPTIONS" is honest acknowledgment of a bounded gap, not a workaround. Name every exception explicitly.

---

## T1 Close Checklist Mapping

This proof satisfies these `/sprint-close` requirements:

| `/sprint-close` requirement | Satisfied by |
|-----------------------------|-------------|
| Contract exists | Step 0, Gate 1 |
| `pnpm verify` exit 0 | Step 0, Gate 2 + Step 2 results |
| Test count did not decrease | Step 2 test delta |
| Proof bundle captured | This report — save to `out/sprints/<SPRINT>/<DATE>/` |
| Independent verification done | Steps 2–4 evidence |
| Rollback plan documented | Step 0, Gate 3 + Step 6 |
| `PROGRAM_STATUS.md` updated | Next action (update after proof capture) |
| `system_snapshot.md` updated | Next action (update if runtime state changed) |
| Linear synced | Part of `/sprint-close` — not proof |
| Notion synced | Part of `/sprint-close` — not proof |

If verdict is `READY FOR T1 CLOSE`: proceed to `/sprint-close`.

---

## Usage Examples

```bash
# Docs/config-only T1 change — no lifecycle in scope
/t1-proof sprint_name="Discord Routing Config Update" scope=minimal

# Runtime/lifecycle T1 change with one pick as proof anchor
/t1-proof sprint_name="Settlement Hardening" pick_ids="eb12a6c2-..." scope=standard

# Full T1 proof with multiple picks and operator surface verification
/t1-proof sprint_name="Trader Insights Activation" pick_ids="eb12a6c2-...,d4f19b3a-..." scope=full

# With inline change summary
/t1-proof sprint_name="Best Bets Activation" change_summary="Wire discord:best-bets routing + promotion gate" scope=standard
```
