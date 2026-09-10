# Results Backfill — Authorization Packet

**Status:** AWAITING GRIFF. Prepared under `docs/mission/intent.md` § "How a reserved decision is
surfaced".
**Opened:** 2026-09-09 (UTV2-1870)
**Decides:** whether an operator runs a bounded SGO results backfill against production.
**Does not decide, request, or perform:** any containment change, any provider purchase, any
database write.

---

## The ask, in one paragraph

Milestone 2 condition 3 requires that grading and settlement run against **real results**.
`game_results` and `events` both stop at **2026-06-30**, so nothing after that date can resolve an
event at all, and grading has consequently never had a real pick to grade. The smallest action that
closes this is an **operator-run, results-only, window-bounded** invocation of an ingestion path
that already exists in the repository, preceded by a dry run of the identical window. This packet
states exactly what that would write, exactly what it would not, and the two reserved questions
that must be answered before it can be authorized.

**This is not an unpark request.** See § "Why this is not a containment change".

---

## 1. Blast radius — enforced, not read

The plan previously recorded that this ask could not be made because `ingestLeague` "writes offers
and events broadly rather than results alone, so its blast radius has to be measured before it is
put in front of anyone." That caveat is retired, and it is retired by a control rather than by a
more careful reading.

UTV2-1866 (#1544, merged `9bef2bd3b`) landed three things:

- **`apps/ingestor/src/write-surface.ts`** — `INGESTOR_WRITE_SURFACE` classifies each of the 16
  write methods across the eight ingestor repositories and maps it to the physical table it
  touches. `INGESTOR_READ_SURFACE` names the 31 reads **explicitly**, so "not a write" is never the
  default: a newly added repository method fails the completeness assertion in `ingestor.test.ts`
  rather than being silently classified as harmless.
- **A blast-radius test** (`ingestor.test.ts:4247`) that proxies the whole repository bundle,
  performs a `resultsOnly` run, and asserts the set of write methods actually invoked is a subset
  of `RESULTS_ONLY_ALLOWED_WRITES`.
- **A dry-run bundle** (`apps/ingestor/src/dry-run-repositories.ts`) that performs **no writes at
  all** while reporting what it would have written, per physical table.

**The enforced set.** A `resultsOnly` run may perform exactly these eight writes, touching exactly
these six tables:

| Repository method | Physical table | What it means for a backfill |
|---|---|---|
| `runs.startRun` | `system_runs` | one row opening the run |
| `runs.completeRun` | `system_runs` | the same row closed with its summary |
| `rawPayloads.insert` | `raw_payloads` | the provider response, stored verbatim for provenance |
| `events.upsertByExternalId` | `events` | one row per event in the window — **created or updated** |
| `participants.upsertByExternalId` | `participants` | teams/players referenced by those events — **created or updated** |
| `participants.updateMetadata` | `participants` | metadata on an already-resolved participant |
| `eventParticipants.upsert` | `event_participants` | the event↔participant edges |
| `gradeResults.insert` | `game_results` | the results themselves — the point of the exercise |

**What it cannot touch.** `provider_offers`, `provider_offers_staging`,
`provider_offer_cycle_status` and `odds_snapshots` are the four remaining tables in the write
surface, and a results-only run reaches none of them. Mechanically:
`ingest-league.ts:252` replaces the fetch with an empty result under `resultsOnly`, so the entire
odds branch — offers, snapshots, closing lines — never runs. That is the *reading*; the *control*
is the test above, which fails if any future edit moves a write out of that branch.

Also untouched, and worth stating because they are the tables that would matter:
**`picks`, `submissions`, `settlement_records`, `distribution_outbox`, `pick_lifecycle`,
`execution_intents` and `command_center_delivery_mappings` are not in the ingestor write surface at
all.** No backfill can create, modify, grade, settle or deliver a pick. This is the same boundary
`apps/ingestor/CLAUDE.md` states as a rule, now enforced by a completeness assertion rather than by
the rule's own text.

### The honest qualifications

Three things a reader should not have to discover afterwards:

1. **`events` and `participants` writes are upserts, not inserts.** An event or participant already
   present under the same external id is **updated**, not skipped. For events the updated columns
   are `event_name`, `event_date`, `status`, `metadata` and `updated_at`. This is the one part of
   the blast radius that modifies pre-existing rows, and it is why the dry-run report separates
   "would be created" from "would be matched" (`newEventExternalIds`,
   `newParticipantExternalIds`).
2. **The write surface bounds the tables, not the row count.** How many rows depends entirely on
   the window the operator passes. Bounding that is the dry run's job, step 1 below, and it is why
   the dry run is mandatory rather than advisory.
3. **`raw_payloads` will grow by one row per provider response.** It is provenance storage, not
   business data, but it is a real write and it is in the set.

---

## 2. Why this is not a containment change

`SYNDICATE_MACHINE_MODE` is binary (`deploy.yml:440-457`): `active`, `parked`, or `exit 1`. There
is no setting that starts the ingestor daemon alone. `active` simultaneously sets
`UNIT_TALK_WORKER_AUTORUN=true`, sets `SYNDICATE_MACHINE_ENABLED=true`, and releases
`_enabled_targets` from the forced `none` to whatever `UNIT_TALK_ENABLED_TARGETS` holds — and the
readiness assertion that delivery is off runs **only in parked mode**. A request to unpark
ingestion would therefore be, in substance, a request to activate member delivery, which
`intent.md` reserves separately and excludes from Milestone 2 explicitly.

**That request is not being made here, and the plan has affirmatively withdrawn it.**

The reason it is unnecessary is that the daemon is not the only route to the results writers. The
operator CLI `scripts/backfill-sgo-history.ts` imports `ingestLeague` and
`runHistoricalBackfill` and runs them **in-process**. It consults neither
`SYNDICATE_MACHINE_MODE` nor `UNIT_TALK_INGESTOR_AUTORUN`. Nothing about this packet changes a
deployed setting, restarts a service, or alters what production does on its own.

---

## 3. The exact commands

Both run from the repository root against production credentials. Step 1 is **required** before
step 2 and writes nothing.

### Step 1 — dry run (writes nothing)

```
pnpm backfill:sgo-history --results-only --dry-run \
  --start=YYYY-MM-DD --end=YYYY-MM-DD --leagues=MLB
```

Or, for a single Eastern day:

```
pnpm backfill:sgo-history --results-only --dry-run --eastern-date=YYYY-MM-DD --leagues=MLB
```

**Non-secret success criterion.** The command prints a JSON object whose top level reads
`"mode": "dry-run"` and `"wroteNothing": true`, with a `blastRadius.byTable` array. No API key
is printed and nothing is written.

**What the report must show before step 2 is authorized** — all four:

1. `byTable` contains **only** tables from the six-table set in § 1. Any other table name means the
   write surface has drifted and the run must not proceed.
2. `game_results` has a **non-zero** count. A zero means the window returned no finalized results
   and the write run would accomplish nothing.
3. `newEventExternalIds` and `newParticipantExternalIds` are of a size the operator is willing to
   create. These are the rows that would not exist otherwise.
4. The total row count across `byTable` is within whatever bound the operator sets when
   authorizing. The dry run is what makes that bound a number rather than a hope.

Reads in a dry run hit the real database, so counts distinguish rows that would be **created** from
rows that would be **matched**. The dry-run wrapper fails closed on an unclassified write
(`dry-run-repositories.ts`: *"dry run refused: … is not classified in INGESTOR_WRITE_SURFACE"*)
rather than under-reporting — the one direction a safety tool must never err in.

### Step 2 — the write run (only after step 1 is read and accepted)

```
pnpm backfill:sgo-history --results-only \
  --start=YYYY-MM-DD --end=YYYY-MM-DD --leagues=MLB
```

Identical arguments minus `--dry-run`. **Any change to the window invalidates step 1** and requires
a fresh dry run: the report bounds the window it was given and nothing else.

**Non-secret success criterion.** The command exits 0 and prints a run summary; afterwards
`SELECT count(*), max(sourced_at) FROM game_results` shows an increase and a date inside the
requested window, and `SELECT count(*) FROM provider_offers WHERE created_at > <run start>` is
**zero** — the latter being the assertion that the results-only bound held in production, not just
in the test.

### Recommended first window

**One day, one league, chosen so results certainly exist.** The purpose of the first run is to
confirm the bound holds against production, not to fill history. Widening comes after, on evidence
from the narrow run.

---

## 4. Rollback position

State this plainly rather than implying a safety that does not exist.

- There is **no scripted rollback** for a results backfill. `deploy/rollback.sh` rolls back a
  *release*, not data.
- Deleting written rows is **production data deletion — reserved decision 1** — so the recovery
  from an over-wide run is *not* available to an agent, and is itself a reserved ask.
- This is the entire reason the dry run is mandatory and the first window is one day. **The bound
  is enforced before the write, because it cannot be enforced after it.**
- The upsert semantics in § 1 mean an over-wide run's effect on `events`/`participants` is an
  overwrite of metadata on existing rows, not merely surplus rows. That is the least reversible
  part of the blast radius and the reason `newEventExternalIds` is worth reading rather than
  skimming.

---

## 5. What remains reserved, and to whom

Two questions gate step 1. Neither can be answered by an agent.

### 5a. Is the production `SGO_API_KEY` active? — reserved decision 4 (secrets)

The key available to tooling returns `403 Inactive API key`, verified live on 2026-09-09. Whether
the production secret differs cannot be checked without reading it.

**Non-secret success criterion:** a single authenticated `GET` against the provider's account/usage
endpoint using the production value returns `isActive: true` and a tier name. No key material is
printed or leaves the machine, and nothing is written.

**If active** → step 1 becomes executable under 5b.
**If inactive** → the results supply becomes a **paid provider commitment, reserved decision 3**.
This packet says so rather than routing around it; there is no cheaper substitute, because
`events` and `game_results` have exactly one physical writer each and both are fed by this
provider.

### 5b. Authorize the run — `DB_ENVIRONMENT_OPERATOR_POLICY.md`

The policy's Live-Write Authority Matrix covers DDL and `UPDATE`; a bulk data **insert/upsert** by
an operator CLI is not a row in it. Mapping it to the strictest adjacent cell, `UPDATE rows` →
production → **"Operator per-session auth"**, which is what this packet requests: authorization
tied to this specific action and this specific window, expiring at session end or scope change.
Per that policy, *"memory from prior sessions does not carry forward authorization"* — a second
window is a second authorization.

The policy also prohibits *"applying a data-mutating migration without row count estimate"*. The
dry run is that estimate, which is why it is step 1 rather than an option.

---

## 6. Recommendation

**Answer 5a first, and decide nothing else until it returns.** It is one authenticated GET, it
prints no secret, and it determines which of two different decisions is actually in front of you.

If the key is **active**: authorize step 1 — the dry run — on a single day and a single league.
It writes nothing, its refusal to under-report is tested, and its output converts every remaining
question about the write run into a number. Then decide step 2 on that number.

If the key is **inactive**: this stops being an operator-authorization question and becomes a
purchasing one, and it should be evaluated as such against what Milestone 2 actually needs, not
folded into this packet.

---

## 7. What this packet explicitly does not ask for

- No containment change. `SYNDICATE_MACHINE_MODE` stays `parked`.
- No member-delivery activation, which is separately reserved and excluded from Milestone 2.
- No production DDL, no migration, no `supabase db push`.
- No production data deletion.
- No provider purchase — 5a may *lead* to that decision; it is not made here.
- No agent-performed write of any kind. Every command in § 3 is an operator action.

---

## Cross-references

| Concern | Document |
|---|---|
| Reserved decisions and how one is surfaced | `docs/mission/intent.md` |
| Milestone 2 conditions and the layer-3 measurement | `docs/mission/plan.md` |
| What may be run against a live database, and by whom | `docs/05_operations/DB_ENVIRONMENT_OPERATOR_POLICY.md` |
| Score provenance for results | `docs/05_operations/SCORE_PROVENANCE_STANDARD.md` |
| Provider ingestion contract | `docs/05_operations/T1_PROVIDER_INGESTION_CONTRACT.md` |
| The enforced write surface | `apps/ingestor/src/write-surface.ts` |
| The blast-radius and dry-run controls | `apps/ingestor/src/ingestor.test.ts` (UTV2-1866 block) |
