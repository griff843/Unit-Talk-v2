# /pick-lifecycle

Red-flag card for pick lifecycle transitions. `/verify-pick` checks what happened; this checks what you are about to do.

---

## State machine (allowed transitions)

```
validated → queued    (promoted + enqueued)
validated → voided    (cancelled before delivery)
queued    → posted    (delivery confirmed, receipt written)
queued    → voided
posted    → settled   (settlement recorded)
posted    → voided    (rare — requires audit)
settled   → (terminal)
voided    → (terminal)
```

`draft` exists in the map but is unused — all V2 picks start at `validated`. **Never skip states.**

---

## When this skill applies

Touching `transitionPickLifecycle()`, `picks.status`, `pick_lifecycle`, `picks.posted_at`/`settled_at`, `settlement_records`, the distribution enqueue path, or any conditional branch on lifecycle state.

---

## Core rules

- **`transitionPickLifecycle()` (`packages/db/src/lifecycle.ts`) is the single entry point.** No direct writes to `picks.status` or `pick_lifecycle` from app code.
- **`settlement_records` rows are immutable.** Corrections insert a new row with `corrects_id`. Never `UPDATE settlement_records`.
- **Distribution gate:** only `promotion_status = qualified` + valid `promotion_target` may be enqueued. Service layer enforces; do not bypass.
- **Settlement source guard:** `source = feed` is blocked at service layer; never accept it.
- **Audit log required** for transitions involving live routing targets (`discord:best-bets`, `discord:trader-insights`).
- `picks.posted_at` / `picks.settled_at` are app-maintained caches — `picks.status` + `pick_lifecycle` are truth.

---

## Red flags — stop if you see these

- Transition that skips a state (e.g. `validated → posted`)
- `UPDATE settlement_records` statement
- Lifecycle transition without a `pick_lifecycle` row
- `posted` pick with no `distribution_receipts` row
- `picks.status` written directly without `transitionPickLifecycle()`
- Transition from a terminal state (`settled` / `voided`)
- Pick with `promotion_status != qualified` that has an outbox row
- `settlement_records.source = 'feed'`

---

## Verification greps

```bash
grep -r "picks.status\s*=" apps/api/src/ --include="*.ts"
grep -r "UPDATE picks SET status" apps/api/src/ --include="*.ts"
grep -r "UPDATE settlement_records" apps/ --include="*.ts"
```

Each direct write must route through `transitionPickLifecycle()`. Flag any that doesn't.
