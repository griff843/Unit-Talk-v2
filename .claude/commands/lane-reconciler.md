# /lane-reconciler

Ghost lane detection and repair. Finds manifests where status is active but branch/PR/heartbeat state has drifted, then transitions them to their correct status.

**Usage:**
- `/lane-reconciler` — run full reconciliation against all active manifests
- `/lane-reconciler --dry-run` — show what would change without making changes

**Arguments:** `$ARGUMENTS`

---

## When to use

- After `/loop-dispatch` reports STALLED (two consecutive zero-merge cycles)
- When `ops:brief` shows active lanes with heartbeats older than 24h
- Before starting a new dispatch cycle after a long pause
- When Linear and manifest state have drifted (e.g., PR merged but manifest still `in_review`)

---

## Execution

```bash
pnpm ops:reconcile
```

The reconciler:
1. Reads all manifests in `docs/06_status/lanes/` with active statuses (`started`, `in_progress`, `in_review`, `blocked`, `reopened`)
2. Checks each against GitHub (PR state) and heartbeat age
3. Transitions stale manifests:
   - Heartbeat 4–24h old → sets `stale: true`, emits warning
   - Heartbeat > 24h old → transitions to `blocked` with reason `stranded`
   - PR already merged → transitions to `merged` or `done`
   - Branch deleted → sets `orphaned: true`, transitions to `blocked`
4. Emits JSON report of all transitions

For dry-run:
```bash
pnpm ops:reconcile --dry-run
```

---

## After reconciliation

Once `/lane-reconciler` completes:
1. Review the transition report — confirm no legitimate active lanes were incorrectly blocked
2. For lanes transitioned to `blocked/stranded`: decide whether to resume (`pnpm ops:lane-start UTV2-###` with existing branch) or close (`pnpm ops:lane-close UTV2-###`)
3. Re-invoke `/loop-dispatch` once the board state is clean

---

## Rules

- **Never manually patch manifest status.** Always go through `pnpm ops:reconcile` or the sanctioned `ops:lane-start` / `ops:lane-close` scripts.
- **Reconciler is non-destructive for legitimate work.** It only transitions lanes whose GitHub or heartbeat state clearly indicates drift.
- **This skill owns reconciliation only.** It does not dispatch new lanes. Call `/dispatch-board` or `/loop-dispatch` after reconciliation is complete.
