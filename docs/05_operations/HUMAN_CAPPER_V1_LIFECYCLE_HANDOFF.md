# Human Capper V1 — lifecycle position and owner decisions

**Status:** Measured, not asserted. Every figure below was read from production
`zfzdnfwdarxucxtaojxm` and from `origin/main` on **2026-09-18**, and each row names the
query or command that produced it. Re-measure before repeating any of it.

**Scope.** This document records where the Human Capper V1 path actually stands after the
accepted live delivery canary, and states the two owner decisions that now block it. It
changes no gate, adds no threshold and authorizes nothing. Overall production readiness
remains governed solely by `T1_PRODUCTION_READINESS_CONTRACT.md`.

---

## 1. What is proven end to end

The full pick lifecycle — submit → persist → deliver → settle → statistics — has now been
exercised against the deployed system with real data, once for delivery and six times for
settlement.

| Stage | Evidence | Verdict |
|---|---|---|
| Submit and persist | 7 rows match `picks.metadata ? 'distributionMode'`, all `capper_id = 'griff843'`, all `source = 'smart-form'` | **proven** |
| Canonical identity and honest provenance | 6 `track-only` + 1 `delivery-eligible`; provenance truthful on each | **proven** |
| Delivery to the pinned official channel | `distribution_outbox` `684ba33f-45c4-4a80-adf0-db8286c90815`, `target = discord:official-picks`, `status = sent`, `attempt_count = 0` | **proven** |
| Delivery routing read the right field | receipt `653db135…` payload: `route: capper-pinned`, `destinationSource: cappers.metadata.discord.picksChannelId` | **proven** |
| Settlement | 6 `settlement_records` rows, every one `source = operator`, `confidence = confirmed`, `status = settled`, each with a real ESPN `evidence_ref` | **proven** |
| Statistics from the persisted history | Command Center analytics read `settlement_records` joined to `picks`. Reconciled directly against the rows: `track-only` 5 settled, 3W-2L, 17.50 units staked; `delivery-eligible` 1 settled, 1 loss, 3.50 units staked | **reconciles** |

**Containment held throughout.** Exactly one `distribution_outbox` row exists since
2026-09-01 — the accepted canary. Every `track-only` pick has zero outbox rows.
`SYNDICATE_MACHINE_MODE` is unchanged.

**One deliberate omission.** Milestone 1's pick `dfcd9486-cba2-4bb5-b684-beec36e52c0b`
carries no settlement record. It references a matchup that did not occur, and it is left
unsettled rather than given an invented outcome. That is the correct state, not a gap.

---

## 2. What is not proven, and exactly why

### 2.1 Recap — blocked on a deploy

The delivered pick settled, and no recap was posted. This is **not** a defect in the
current code; it is a defect in the *running* code.

- Deployed release: `961f17c64`, `Deploy` run `35289985486`, 2026-09-18T00:09Z.
- The receipt's `channel` column reads `discord:official-picks`. The deployed
  `resolveRecapChannel` normalizes a channel only when it is a bare numeric id, so it
  cannot resolve that value and the recap fails closed.
- The same receipt's `payload.channelId` already holds `1384052464189440120` — the id the
  message was actually posted to.
- `apps/api/src/grading-service.ts` on `main` reads `payload.channelId` first
  (UTV2-1929, merged in #1601). That repair is **merged and not running**.

**The recap was attempted, once.** `delivery_kill_switch` records `official-picks` as
`killed = true` with `updated_at = 2026-09-18 06:31:22+00` and the reason "the per-pick
settlement recap for canary pick 816a84c7 was attempted once and the switch is re-engaged
immediately". The attempt happened one second after the settlement at 06:31:21 and produced
no outbox row — because the deployed resolver could not read the destination, not because
the switch refused it.

Re-attempting that recap after the deploy therefore needs two things, in order: the deploy
(decision 1), and a deliberate, bounded re-opening of the `official-picks` kill switch. The
second is a **member-delivery posture action and is Griff's**, not an agent's, even though
the original canary was accepted.

`961f17c64..origin/main` is 6 commits and 32 files. Three of them change what runs:

- `apps/api/src/grading-service.ts` — reads `payload.channelId` first, the repair above.
- `apps/worker/src/delivery-adapters.ts` — the adapter change that writes that field.
- `.github/workflows/deploy.yml` — adds `UNIT_TALK_CC_API_KEY` to the `.env.production`
  the workflow writes. This one is durability, not a fix: Command Center writes *do*
  currently succeed (the six settlements and the kill-switch toggle on 2026-09-18 are
  attributed to `operator:command-center:HGkYXQqj`), but `deploy.yml` rewrites
  `.env.production` from scratch on every deploy, so without this change the next deploy
  would remove whatever is authorizing them today.

The remaining files are one migration already applied in production
(`insert_certification_propagation_batch` exists with `p_records jsonb, p_events jsonb`),
the UTV2-1930 seeding CLI, and lane/proof artifacts.

### 2.2 Automated grading — blocked on the results supply

Grading runs (it is deliberately outside containment), but there is no result to grade
against: the newest `events`/`game_results` rows still predate 2026-07-01. Every settlement
above was therefore produced through the **attested operator path**, with a real ESPN
reference recorded on each record. That path is honest and is working; it is not routine.

**There is a second, independent reason automated grading cannot reach these picks.**
Measured 2026-09-18: only the one `delivery-eligible` canary carries an `eventId`
(`16924899…`). All six `track-only` picks have `eventId: null` — the honest
coverage-gap shape — so grading skips them at `event_link_not_found` before the
results question is even reached. Seeding events (§2.4) closes that half; it does
**not** close the other half, because an `operator-manual-entry` event is deliberately
outside `TRUSTED_GRADING_EVENT_PROVIDERS`. Both halves need a trusted provider.

### 2.3 CLV — unmet

`clvPercent` is null on every settled pick. CLV requires a closing line, which requires
provider data. Milestone 2 condition 4 is therefore partially unmet, and will stay so until
§3 decision 2 resolves.

### 2.4 Current-game reference data — one operator command, not yet routine

Smart Form needs a current event with participants before a capper can pick a side.
Production holds exactly one such event, `16924899-2a8c-4f90-9c0c-1f45e3230d79`
("Lions @ Bills"), hand-seeded by raw SQL, with `external_id = NULL` and **zero**
`event_participants` rows. Measured 2026-09-18: no `events` row exists with an
`event_date` in the last 14 days other than that one, and it has no participants — so
**as of today there is no current game a capper can pick a side from**. That, not the
form, is what makes repeat submission an engineering event each time.

`scripts/ops/seed-operator-event.ts` (UTV2-1930, merged in #1602) replaces that hand path:
it resolves both participants from the canonical catalog *before* writing anything, derives
a deterministic `external_id` under the `operator-manual` namespace, and writes the event
and both participant rows together. It mints no participants, refuses to overwrite a
provider-owned row, and deliberately does **not** make the seeded event gradeable —
`TRUSTED_GRADING_EVENT_PROVIDERS` is `new Set(['sgo'])`, and `operator-manual-entry` fails
closed there.

**Preconditions verified in production on 2026-09-18:** 32 NFL team participants exist, and
`BUFFALO_BILLS_NFL`, `MIAMI_DOLPHINS_NFL` and `DETROIT_LIONS_NFL` each resolve uniquely by
canonical `external_id`.

**Two things an operator must know before running it:**

1. It cannot be dry-run from the repository's root checkout as configured. `local.env`
   pins `SUPABASE_URL=http://127.0.0.1:1` — a deliberate fail-closed placeholder — so the
   tool exits `unexpected_error: fetch failed` before touching anything. That placeholder is
   a *default*, not a floor: `readEnvValue` reads `process.env` first, so exporting real
   credentials for the one command is enough. Doing so is a secrets action (reserved
   decision 4) and a live-database action under `DB_ENVIRONMENT_OPERATOR_POLICY.md`, which
   is why it is the operator's to run and not an agent's. Without `--apply` it only reads.
2. It will not adopt the existing orphan row. The tool looks the event up by
   `external_id`, and the orphan's is `NULL`, so seeding the same matchup would create a
   *second* Lions @ Bills row. Setting that row's `external_id` to
   `operator-manual:NFL:2026-09-17:DETROIT_LIONS_NFL@BUFFALO_BILLS_NFL` first would make the
   tool adopt it and backfill its two missing participant rows — a production write, and
   therefore an operator decision, not an agent one.

**Invocation shape** (dry run; add `--apply` only when the plan reads correctly):

```
pnpm exec tsx scripts/ops/seed-operator-event.ts \
  --sport NFL --date <YYYY-MM-DD> --starts-at <ISO-8601 with offset> \
  --home <CANONICAL_EXTERNAL_ID> --away <CANONICAL_EXTERNAL_ID> \
  --operator <who>
```

---

## 3. Owner decisions

Both are prepared. Neither blocks the other, and neither blocks the rest of the board.

### Decision 1 — dispatch `Deploy` at `origin/main`

**Reserved under** `intent.md` reserved action 8 (dispatching a production deployment).

**Recommendation: do it.** It is the single action that completes the post-delivery
lifecycle. The drift is small, contains no unapplied migration, and its two container files
are the recap channel-resolution repair and the delivery-adapter change that produced the
very receipt field the repair reads.

**Non-secret success criterion:** after the run, a settlement on a delivered pick produces a
`distribution_outbox` row whose target is the recap target, and the deployed release SHA
equals `origin/main`.

**Consequence of not deciding:** delivered picks continue to settle correctly and silently,
with no recap, and `deploy_sha_alignment` stays red.

### Decision 2 — the results and reference-data supply

**Reserved under** `intent.md` reserved decision 3 (paid provider / subscription
commitments) and 4 (secrets).

There are exactly two exits, and there is no third inside existing authority:

- **(a) Confirm the production `SGO_API_KEY` is active.** Fully prepared in
  `RESULTS_BACKFILL_AUTHORIZATION_PACKET.md`. Non-secret success criterion: one
  authenticated `GET` against the provider's account/usage endpoint returns `isActive: true`
  and a tier name. If it returns inactive, this becomes a paid-provider commitment.
- **(b) Admit a second, schedule-only data source.** This is **not** available to an agent:
  `PROVIDER_AUTHORITY_LOCK.md` is an active T1 governance rule naming SGO Pro as the sole
  live provider and requiring provider-bound work to fail closed to it. Admitting another
  source — including a free public schedule feed — is an amendment to that lock and is
  PM-owned.

**Recommendation:** take (a) first, because it is a check rather than a commitment, and it
also resolves automated grading and CLV. Until one of them resolves, the operator seeding
command in §2.4 is the whole of the reference-data path, and settlement stays on the
attested operator route.

---

## 4. What was deliberately not done

- No containment change was made or requested. `SYNDICATE_MACHINE_MODE` is untouched.
- No deploy was dispatched.
- No production write was made. Every production figure here came from a governed read.
- No provider was activated, and no alternative provider was integrated.
- The orphan event row was left exactly as found.
