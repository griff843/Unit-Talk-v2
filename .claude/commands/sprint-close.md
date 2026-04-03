# /sprint-close

Close the current sprint following V2 governance.

Requires: sprint tier (T1 / T2 / T3) and sprint name.

---

## Step 0 — Confirm gates are green

Recommended first command:
```bash
pnpm ops:brief -- --issue <UTV2-ID> --pick <pick-id>
```
Use it to confirm current branch, runtime health, proof inputs, and the likely next action before closing.

Run `pnpm verify` and confirm exit 0. Do not proceed if any gate fails.

```
pnpm verify
```

Confirm:
- `pnpm env:check` — PASS
- `pnpm lint` — 0 errors
- `pnpm type-check` — 0 errors
- `pnpm build` — exit 0
- `pnpm test` — all passing, count must not have decreased

If gates fail, stop. Fix root cause before closing.

---

## Step 1 — Update PROGRAM_STATUS.md

**File:** `docs/06_status/PROGRAM_STATUS.md`

Required for all tiers (T1 = full update, T2 = full update, T3 = sprint log row only).

For **T1 and T2:**
- Update `## Last Updated` date
- Update `## Current State` table (test count, gate status)
- Update `## Gate Notes` section if gate behavior changed
- Append a row to `## Sprint Log` with: name, week, tier, status=CLOSED, summary
- Update `## Open Risks` (close resolved risks, add new findings)
- Update `## Live Routing` table if routing changed (T1 only)

For **T3:**
- Append a row to `## Sprint Log` only. No other sections required.

---

## Step 2 — Update system_snapshot.md (T1 and T2 only)

**File:** `docs/06_status/system_snapshot.md`

Required when runtime state changed (new Discord delivery, new DB records, schema changes).

Add a new section for this sprint with:
- Implementation files changed
- Test count delta
- Verification results (live snapshot data if available)
- Verdict line

Skip for T3 sprints. Skip if no runtime state changed.

---

## Step 3 — Verify T1 proof bundle is captured (T1 only)

For T1 sprints, confirm that a proof bundle was generated and matches the format in `docs/06_status/PROOF_TEMPLATE.md`.

The proof bundle must include:
- Pre/post test count
- Gate verification outputs
- Live DB evidence (submission ID, pick ID, outbox ID, receipt ID, Discord message ID where applicable)
- Lifecycle chain confirmation
- Audit log entries
- Verdict: PASS or FAIL with explicit rollback trigger check

If a rollback plan was required, confirm it was documented using `docs/06_status/ROLLBACK_TEMPLATE.md` before implementation began.

---

## Step 4 — Sync Linear

**Required for:** T1 (at close), T2 (at close), T3 (batch into next T2+ close)

For T1/T2 closes:
- Find the relevant Linear issue in the `unit-talk-v2` (UTV2) team
- Mark it Done
- Add a comment with: test count, verdict, key finding or link to proof

CLI-first preference:
- `pnpm linear:close -- <issue-id> --comment "test count, verdict, key finding"`
- or `pnpm linear:update -- <issue-id> --state Done` plus `pnpm linear:comment -- <issue-id> --body "..."`

For T3 sprints:
- Batch the update into the next T2 or T1 close — no immediate sync required

---

## Step 5 — Sync Notion (T1 only)

**Required for:** T1 (at close). T2 and T3 batch into next T1 close or monthly.

Update the Notion checkpoint with:
- Sprint name and tier
- Verdict (PASS / FAIL)
- Test count
- Key deliverables
- Link to PROGRAM_STATUS.md sprint log row

---

## Step 6 — Update Rebuild Home (T1 only)

If the team uses a Rebuild Home dashboard or summary surface: update it to reflect the new sprint status.

Skip if not applicable or not maintained.

---

## Checklist (copy into your response or a doc)

```
Sprint: <name>
Tier: T1 / T2 / T3
Date: <date>

[ ] pnpm verify — exit 0
[ ] Test count: before=___ after=___ (must not decrease)
[ ] PROGRAM_STATUS.md updated (sprint log row added, risks updated)
[ ] system_snapshot.md updated (T1/T2 only, if runtime state changed)
[ ] T1 proof bundle captured (T1 only)
[ ] Rollback plan documented pre-implementation (T1 only)
[ ] Linear synced
[ ] Notion synced (T1 only)
[ ] Rebuild Home updated (T1 only, if applicable)

Verdict: CLOSED
```

---

## Authority References

- Sprint model and tier requirements: `docs/05_operations/SPRINT_MODEL_v2.md`
- Proof template: `docs/06_status/PROOF_TEMPLATE.md`
- Rollback template: `docs/06_status/ROLLBACK_TEMPLATE.md`
- Canonical status: `docs/06_status/PROGRAM_STATUS.md`
- Runtime evidence: `docs/06_status/system_snapshot.md`
- T1 automatic triggers: migrations, live routing changes, settlement write path changes — see `SPRINT_MODEL_v2.md § Tier Classification`
