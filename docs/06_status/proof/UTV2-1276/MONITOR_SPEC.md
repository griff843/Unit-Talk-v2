# Track A Monitor Spec — UTV2-1250 (settled CLV-path + forward-flow watch)

Authoritative run spec for the recurring Track A monitor.

**Primary runner (durable):** GitHub Actions workflow `.github/workflows/track-a-monitor.yml`
→ runs `scripts/ops/track-a-monitor.ts` every 6 hours (`schedule` cron `23 */6 * * *`)
and on `workflow_dispatch`. (UTV2-1276)

**Backup (temporary):** the session-only local cron may remain until the GHA monitor is
merged and proven, then be retired. Do not rely on the session cron long-term.

**Hard guardrails (never violate):**
- Read-only. No production mutation. No live backfill. No production evidence mutation.
- Do NOT certify P3. Do NOT mark UTV2-1042 or UTV2-1250 Done.
- No CLV / ROI / edge claims. Report counts and statuses only.
- No public Discord changes. The monitor never queries or alters delivery.
- Never print secrets.

---

## What each run does

`scripts/ops/track-a-monitor.ts` consolidates the read-only diagnostics (the queries
proven in `apps/api/src/scripts/utv2-1262-proof.ts` and
`utv2-1272-missing-event-context-diagnostic.ts`) into one snapshot, then:

1. Collects the snapshot below via read-only PostgREST counts.
2. Reads the last reported snapshot from the most recent monitor comment on UTV2-1250
   (machine state embedded after a `TRACK_A_STATE_JSON:` marker).
3. Evaluates triggers (`scripts/ops/track-a-triggers.ts`).
4. Writes the snapshot + decision to `--output-json` (uploaded as a workflow artifact).
5. Posts a comment to UTV2-1250 **only when a trigger fires** (otherwise silent).

The three underlying diagnostics remain available for deep manual analysis but are not
required for the automated path.

## Snapshot fields

- `settledClvPathNative` — **threshold metric**: settled+graded picks (`status=settled`,
  `result in win/loss/push`) joined to a **native** `closing_for_clv` snapshot, i.e.
  `pick_offer_snapshots.snapshot_kind='closing_for_clv'` with `payload->>backfill <> 'true'`.
  Backfilled rows (UTV2-1262) are excluded. Baseline = 0.
- `closingForClvTotal` / `closingForClvBackfilled` / `closingForClvNative` — total,
  backfilled (`payload->>backfill='true'`), and native (= total − backfilled).
- `wellFormedPendingPlayerProps` / `wellFormedSettledPlayerProps` — player-prop picks
  (`market like player_*`) that carry a `participant_id`, pending vs settled.
- `clvComputed` / `clvMissingEventContext` / `clvMissingClosingLine` — `clvStatus` breakdown.
- `suppressPicks` — `metadata->>band='SUPPRESS'` (orphan/suppressed class).
- `publicDiscordRecentPosts` — always `null`; the monitor does not query/change delivery.
- `errors[]` — read failures this run (treated as a blocker).

**Eligibility note:** "well-formed" means participant-linked. Strict CLV-eligibility also
requires event-context resolution, which the orphan-generator investigation lane (UTV2-1275)
addresses; these fields are leading indicators, **not** CLV-eligible certifications.

## Report conditions (post a comment to UTV2-1250)

Movement triggers fire only on an **increase** vs the last reported snapshot, so steady
state does not spam:

- first run → baseline report;
- `settledClvPathNative` ≥ 50 (DEVELOPING) → recommend re-trigger of the UTV2-1042 evaluation;
- `settledClvPathNative` increased (first/again forward-flow CLV evidence);
- `closingForClvNative` increased (new native/forward-flow `closing_for_clv` row);
- `wellFormedSettledPlayerProps` increased (new eligible player-prop settlement);
- any read error → blocker;
- otherwise, 24h since the last report → heartbeat.

## Threshold action

`settledClvPathNative` ≥ 50 → recommend re-trigger of the UTV2-1042 evidence evaluation
(recommend only; PM authorizes the actual proof run). Do not initiate STRONG (200+) proof.

## Related lanes

- UTV2-1042 — edge certification, data-gated on this threshold.
- UTV2-1275 — orphan player-prop generator investigation (suspected root blocker).
- UTV2-1268 — SGO native closing-odds capture.
- UTV2-1276 — this durable GitHub Actions monitor.
