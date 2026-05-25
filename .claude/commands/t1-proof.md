# /t1-proof

Assemble a T1 evidence bundle for a bounded change. Wraps `pnpm proof:t1` and verifies the output against T1 gates.

**Canonical templates:** `docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md`, `docs/06_status/proof/PROOF-TEMPLATE.md`
**Done-gate:** `/verification`

---

## Inputs

- **issue_id** (required) — `UTV2-###`
- **pick_ids** (optional) — comma-separated UUIDs if lifecycle/distribution/settlement/promotion is in scope
- **change_summary** (optional) — one-line description

---

## Step 0 — Prerequisites (fail closed)

Before running the bundler, confirm all three. Any FAIL → STOP.

| Gate | Check |
|------|-------|
| Contract exists | File at `docs/05_operations/` for this sprint (`week_NN_*_contract.md` or `SPRINT-<NAME>_contract.md`) |
| `pnpm verify` PASS | All 5 sub-gates green (env / lint / type-check / build / test) |
| Rollback plan documented | File path or inline location identified |

Quick context: `pnpm ops:brief -- --issue <UTV2-ID> --pick <pick-id>`

---

## Step 1 — Run the bundler

```bash
pnpm proof:t1 -- --issue <UTV2-ID> --change "<summary>" --pick <pick_id>
```

Repeat `--pick` for multiple picks. The bundler runs:
- Gate verification (`pnpm verify` + `pnpm test:db`)
- Pipeline summary
- Pick-level verification (via `/verify-pick` logic)
- Evidence bundle assembly (static + runtime sections)

Bundle is written to `out/sprints/<SPRINT>/<DATE>/` and validated against the v1 schema.

---

## Step 2 — T1 trigger check

Confirm at least one T1 trigger applies — if none, flag for re-classification (T2/T3) but do not block:

- [ ] `supabase/migrations/` file created or modified
- [ ] Live routing target changed (`discord:best-bets`, `discord:trader-insights`)
- [ ] Settlement write path changed (`recordInitialSettlement`, `recordSettlementCorrection`, `recordManualReview`)
- [ ] `PROGRAM_STATUS.md` routing-state table changed

---

## Step 3 — Verify bundle output

The bundle must contain:
- `static_proof` section (CI logs, diffs, schema validation — verifiable without running merged code)
- `runtime_proof` section (row counts, receipts, audit entries — requires merged code against live infra)
- Both sections SHA-tied to the merge commit
- `verifier.identity` distinct from the implementing agent

If `static_proof` and `runtime_proof` are not both populated → bundle is incomplete → fix before close.

For lifecycle/distribution/settlement/promotion changes without `pick_ids`: note "pick-level verification NOT RUN" as a gap. Do not paper over.

---

## Step 4 — Schema validation

```bash
pnpm evidence:validate <bundle-path>
```

Exit 0 = bundle conforms to v1 schema. Any other exit = stop and regenerate.

---

## Verdicts

| Verdict | Meaning |
|---------|---------|
| `READY FOR T1 CLOSE` | All gates met, bundle complete, runtime + static proof populated, schema-validated |
| `READY WITH EXCEPTIONS` | Core proof sound; one or more items UNVERIFIED, each explicitly named and bounded |
| `NOT READY` | A T1 gate missing or check failed; enumerate blockers |

"READY WITH EXCEPTIONS" is honest acknowledgment of a bounded gap, not a workaround.

---

## Hand-off

If verdict is `READY FOR T1 CLOSE`:
1. Attach bundle path to PR body
2. Surface T1 merge gate (PM_VERDICT required) — see `/dispatch-board` Phase 5 or `/verification`
3. After PM approval + merge: `ops:lane-close <UTV2-###>` (wraps `ops:truth-check`)

---

## Known quirks (do not flag as bugs)

- `audit_log.entity_ref = null` on `distribution.sent` entries (worker doesn't write entity_ref on sent)
- Smart Form V1 picks score `61.5` static fallback and are correctly suppressed
- Two `pick_promotion_history` rows per pick (one per policy)
- `audit_log.entity_id` is never the pick_id — always query via `entity_ref`
- `picks.posted_at` / `settled_at` are denormalized caches and may lag
