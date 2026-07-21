# Fable Pilot Closeout Packet Template (UTV2-1569)

**Authority:** Claude/governance-owned. Final decision requires PM review.
**When to use:** at pilot expiry — 8 qualifying tasks, 30 calendar days, or the usage
ceiling, whichever comes first (`docs/05_operations/FABLE_PILOT_STATE.json`'s `status`
mechanically flips to `"expired"` at that point via
`scripts/ops/fable-pilot-state.ts#recordQualifyingTask`; this template is filled in
immediately after that transition, before any decision about permanence).

**No permanent routing or authority change happens automatically from this packet.**
It is an input to a later, exact-head Griff decision — never a self-certifying
conclusion, and never a substitute for the fresh governance-change PR any permanent
Fable reinstatement would require.

---

## 1. Pilot summary

- Activated at: `<FABLE_PILOT_STATE.json activated_at>`
- Expired at / reason: `<expires_at, or the cap that fired: tasks | days | usage>`
- Qualifying tasks recorded: `<task_count> / 8`
- Usage consumed: `$<usage_used_usd> / $<usage_ceiling_usd>`
- Calendar days elapsed: `<n> / 30`

## 2. Per-task quality findings

For each entry in `FABLE_PILOT_STATE.json`'s `qualifying_tasks`:

| Task ID | Trigger class | Fable finding independently confirmed correct? | Found something the standard reviewer path missed? | Unnecessary owner-facing question raised? | Cost (USD) | Turns/elapsed time |
|---|---|---|---|---|---|---|
| UTV2-#### | repeated_architecture_bounce \| live_state_root_cause \| product_synthesis_no_precedent \| build_mode_certification_review | yes/no | yes/no | yes/no | $X.XX | N turns / Nm |

## 3. Aggregate metrics

- Unique defects found (materially correct, independently confirmed, not found by the
  standard path): `<n>`
- Bounces avoided (a repeated-CHANGES_REQUIRED cycle that Fable's input resolved
  without a further bounce): `<n>`
- Owner questions raised that would not otherwise have been necessary: `<n>` — list them
- Total elapsed time / turns across all qualifying tasks: `<n>`
- Total usage: `$<n>`

## 4. Reviewer independence audit

Confirm, for every qualifying task: the reviewing Fable pass never reviewed its own
prior proposal, and never received an author-curated framing (only `git diff main` or
equivalent unedited artifacts). List any exception found, however minor.

## 5. Fresh decision packet

```
FABLE 5 PERMANENT INTEGRATION: YES | NO | EXTEND
```

- **YES** — requires its own fresh governance-change diff (routing tables, allowlists,
  caps) and adversarial review before taking effect. This packet alone never authorizes
  it.
- **NO** — run `docs/05_operations/FABLE_PILOT_ROLLBACK.md`'s Part 1 (mechanical) and
  Part 2 (documentary) rollback.
- **EXTEND** — requires a fresh, explicitly re-justified cap (new max_tasks/max_days/
  usage_ceiling_usd) via a new governance-change diff; the expired state is never
  silently re-activated by editing `FABLE_PILOT_STATE.json` back to `"active"` with the
  old caps.

## 6. Sign-off

- Prepared by: `<identity>`
- Date: `<ISO-8601>`
- Griff decision: `<pending | YES | NO | EXTEND>`, date: `<ISO-8601>`
