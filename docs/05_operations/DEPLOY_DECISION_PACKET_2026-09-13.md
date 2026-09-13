# Production Deploy — Decision Packet, 2026-09-13

**Reserved decision 8** (`docs/mission/intent.md`): dispatching a production deployment.
**Prepared by:** Claude, measured against `origin/main` `fbd7e17d6` and the last successful
`Deploy` run `34296962788` (`755e52a6c`, 2026-09-09T00:54Z).
**Status:** prepared, not dispatched. Nothing in this packet performs, schedules or authorizes
the deploy.

This packet exists because "the image contains #1567" proves code inclusion and nothing else. It
separates four things that are usually conflated: what the release contains, what the deploy
workflow itself asserts, what only Griff's browser can prove, and what stays unprovable while SGO
is off.

---

## The ask, in one paragraph

Dispatch `deploy.yml` from `main`, with `rollback_tag` set to the currently deployed image
`755e52a6cac8fcda2d3baf490b4f6dbb849e5683`, in a window where Griff can perform the browser
acceptance in §5 within a few hours of promotion. The release carries the merged grading and
result-journey repairs that production is running without. Containment is unchanged by
construction (§3). Rollback is a documented, dry-run-tested path (§4). The deploy's own checks
prove the containers are up and parked; they do not prove the form works, so the product
acceptance is a separate, operator-performed step with read-only observations (§5).

## 1. Release identity — an exact SHA, and why it may drift by bot commits only

`deploy.yml` has no `ref`/`sha` input. It builds and tags every image with **`github.sha` of the
ref it is dispatched on** (`deploy.yml:202-207`, `:265-274`, `:433`), so the release SHA is
**`main` HEAD at the moment of dispatch.**

| Measured 2026-09-13 | Value |
|---|---|
| `main` HEAD | `fbd7e17d6427b46a5420572833927e6f2c44c326` |
| last non-bot commit | `85183e9434f25833529dfd47e080be3f97b8cbf3` (UTV2-1893 closeout) |
| deployed | `755e52a6cac8fcda2d3baf490b4f6dbb849e5683` |
| commits between | 78, of which 60 are not `ops(readiness): refresh ledger [skip ci]` |
| container-relevant files changed | **10** (table below) |
| `supabase/migrations/` changed | **0** |
| `deploy.yml`, `deploy/**`, Dockerfiles changed | **0** |

The readiness bot commits to `main` roughly every six hours and touches only
`docs/06_status/readiness/readiness-score.json`, which is not in any image. So the SHA in the
image tag may be a later bot commit than `fbd7e17d6` and the **container contents will be
identical**. The non-secret check that the release is the one described here, run before or
after dispatch against whatever SHA `Deploy` reports:

```
git diff --name-only fbd7e17d6 <release-sha> -- 'apps/**' 'packages/**' 'deploy/**' 'supabase/migrations/' \
  .github/workflows/deploy.yml | grep -v '\.test\.' | wc -l        # must print 0
```

If it prints anything but `0`, this packet is stale and must be re-measured before dispatch.

## 2. Included changes — what actually reaches a running container

```
git diff --name-only 755e52a6c fbd7e17d6 -- 'apps/**' 'packages/**' 'deploy/**' | grep -v '\.test\.'
```

| File | Lanes | What it changes in production | Runs under containment? |
|---|---|---|---|
| `apps/api/src/grading-service.ts` | UTV2-1815, 1861, 1886, 1889 | null/zero stake no longer computes as a unit; **Track Only `validated` picks are admitted to grading**; settlements read once per pass; **`game_moneyline` family** graded off an attested `game_moneyline_win` row with `line = null` accepted; results with `participant_id = NULL` refused by name | **Yes** — `UNIT_TALK_GRADING_CRON_AUTORUN=true` is written unconditionally (`deploy.yml:540`, `:1133`) |
| `apps/api/src/settlement-service.ts` | UTV2-1815, 1861 | same stake rule on the settlement side; Track Only admitted | Yes |
| `packages/db/src/repositories.ts`, `runtime-repositories.ts` | UTV2-1886 | batch settlement read the grading pass calls through | Yes |
| `packages/domain/src/attribution/attribution-engine.ts` | UTV2-1815 | unit attribution refuses an unknown stake | Yes |
| `apps/ingestor/src/results-resolver.ts` | UTV2-1868, 1889 | canonical market keys, moneyline outcome derivation, side attribution on write | **No** — ingestor autorun is `false` in parked mode; reachable only by an operator CLI that imports the library |
| `apps/ingestor/src/sgo-fetcher.ts` | UTV2-1868 | payload parse / `normalizeMarketKey` | No (same) |
| `apps/ingestor/src/write-surface.ts`, `dry-run-repositories.ts` | UTV2-1866 | the enforced ingestor write surface | No (same) |
| `apps/smart-form/e2e/phase-one.spec.ts` | UTV2-1864 | Playwright spec | **Not shipped** — not in the image |

**Smart Form itself is byte-identical to what Griff used on 2026-09-09.** No file under
`apps/smart-form/` other than the Playwright spec changed, `apps/api/src/submission-service.ts`
did not change, and no auth or allow-list code changed. The browser acceptance in §5 therefore
re-proves the pilot on a new image; it does not test new form behaviour.

**What the release does *not* contain**, so the decision is not read as more than it is: no
operator-attestation route (deleted from #1567 under the CHANGES_REQUIRED verdict; `operator` is
not a trusted grading-event provider), no SGO activation, no member-delivery change, no schema
change, no change to `deploy.yml` or the compose files, and nothing from #1570 or #1556 — both
touch `.github/workflows/` and `scripts/ops/`, neither of which is in any image.

## 3. Containment — preserved by construction, and asserted twice by the workflow

Containment is not a property of the release; it is a property of the deploy workflow plus the
`SYNDICATE_MACHINE_ENABLED` secret, and **neither changes in this release** (0 changes to
`deploy.yml`, `deploy/**`).

| Mechanism | Where | What it guarantees |
|---|---|---|
| Mode is derived from the secret and must be exactly `true`/`false` | `deploy.yml:105-113` | `false` → `parked`; anything else fails the `verify` job before any image is built |
| Parked mode forces `UNIT_TALK_INGESTOR_AUTORUN=false`, `UNIT_TALK_WORKER_AUTORUN=false`, `SYNDICATE_MACHINE_ENABLED=false` | `:440-457`, `:1033-1050` | no ingestion, no outbox delivery |
| Parked mode forces `UNIT_TALK_ENABLED_TARGETS=none` regardless of the secret | `:474-477`, `:1067-1070` (UTV2-1646) | no promotion target resolves to a real channel |
| Canary and production containers are inspected after start | "Confirm syndicate machine gate in canary container", "…in production container" (`:712`, `:1323`) | the running container's mode matches the requested one, or the job fails |
| Release record on host | `:1345-1360` | `.unit-talk-release` must equal the resolved tag, or the job fails |
| Grading is deliberately outside the case statement | `:540`, `:1133` | grading runs in production; this is why the five live-path repairs matter |

Database-side controls are untouched because the deploy runs no migration: `best-bets`,
`trader-insights` and `exclusive-insights` remain `killed = true` in `delivery_kill_switch`, and
the seven `isTrackOnlyPickMetadata` guards on `main` (submit-time pin, enqueue chokepoint, atomic
RPC audit, requeue, retry, recap exclusion, health) are unchanged since UTV2-1672 mutation-tested
them.

The last deploy emitted `{"service":"deploy","event":"syndicate_machine_mode.validated","mode":"parked"}`.
The success criterion for this one is the same line with the same value in the `verify` job log,
and green "Confirm syndicate machine gate" steps in both `canary` and `promote`.

**No containment change is requested by this packet.** A request to unpark ingestion is a request
to activate delivery (the mode is binary), and member-delivery activation is separately reserved.

## 4. Rollback

| Question | Answer |
|---|---|
| Automatic? | **No.** `rollback_tag` is an optional, empty-by-default input (`deploy.yml:10-13`). A failed health loop fails the job with production on the new tag. |
| Prepared path | `rollback-dry-run` job runs `deploy/rollback.sh --dry-run --tag <rollback_tag or github.sha>` before any build (`:172`). Every `Deploy` run exercises the script's argument path. |
| Manual command | `deploy/rollback.sh --tag 755e52a6cac8fcda2d3baf490b4f6dbb849e5683` (full 40-char tag; images resolve at the full tag for every service). |
| Configuration | Both `canary` and `promote` snapshot the outgoing `.env.production`, `.env.web`, `.env.smart-form` per tag (`:318`, `:911`; UTV2-1834); `rollback.sh:71-79` restores them and warns loudly when no snapshot exists. UTV2-1835's `.unit-talk-deploy-inflight` marker stops a failed retry from capturing the failed attempt's configuration over the running release's. |
| DDL to reverse | **None.** 0 migrations. |
| Recommendation | Pass `rollback_tag=755e52a6cac8fcda2d3baf490b4f6dbb849e5683` at dispatch so the dry run validates against the real fallback rather than against the new SHA. |

## 5. Post-deploy acceptance — three tiers, kept separate

### 5a. What the workflow proves on its own (~31 minutes, measured on `34296962788`)

`verify` (4 min, `pnpm verify:static` — the Smart Form e2e gate is **off** there, so no browser
test runs) → six image builds (2 min) → `canary` (3 min: registry preflight for all six tags,
API canary, gate confirmation) → `promote` (2 min: all containers, "Verify Next.js surfaces are
healthy", gate confirmation, release record) → `smoke` (20 s: `GET localhost:4000/health` is 200).

Non-secret success criteria, all readable from the run:

1. `verify` log contains `"mode":"parked"`.
2. Both "Confirm syndicate machine gate" steps green.
3. "Verify Next.js surfaces are healthy" green — the `smart-form` service answered its healthcheck.
4. `smoke-result.json` artifact reads `"verdict":"PASS"`.
5. On the host, `curl -s localhost:4000/health | jq .version.gitShaShort` equals the release SHA's
   short form. `routes/health.ts:223-227` reports `UNIT_TALK_GIT_SHA`, which the build stamps from
   `github.sha` (`deploy.yml:207`, `:274`). This is the "image contains the release" check, and it
   is the **weakest** of the three tiers.

What this tier does **not** prove: the `smart-form` healthcheck is `curl -fsS localhost:4400/login`
returning 200, which it does regardless of whether anyone can sign in
(`deploy/production/docker-compose.yml:223`), and the smoke job asserts only the API health code.

### 5b. Product acceptance — Griff, in a browser, then read-only observation

**Only a real session proves browser authentication.** Every Playwright suite in
`apps/smart-form/e2e/` fulfils `**/api/auth/session` with a mocked session and runs against local
dev servers started by `playwright.config` (`webServer: pnpm --dir ../api dev`, `pnpm dev`); none
performs a Google sign-in and none targets the deployed host. Enabling the CI gate
(`UNIT_TALK_SMART_FORM_E2E=1`) would add browser-level coverage of the form's contract with the
API and **would not close the browser gap for production**. The gap stays open until step 1 below
is performed on the new image.

Each step names the action, the non-secret success criterion, and the read-only observation that
records it. The observation surface is `scripts/ops/track-only-report.ts`, which uses a GET-only
transport (`ReadOnlyPostgrestClient`), selects `metadata->>distributionMode = track-only`
(the governed cohort predicate — exactly the operator picks, none of the 13 fixture rows
`capper_id = 'griff843' AND source = 'smart-form'` would return), counts the four delivery tables
per pick, and computes the cohort statistics. It needs a Supabase URL and a read key
(`TRACK_ONLY_REPORT_SUPABASE_URL` / `TRACK_ONLY_REPORT_READ_KEY`, or `--url`/`--read-key`); the
key is a secret Griff holds and this packet does not ask for it to be shared.

```
pnpm exec tsx scripts/ops/track-only-report.ts --url https://zfzdnfwdarxucxtaojxm.supabase.co --read-key <read key>
```

| # | Step | Action | Non-secret success criterion | Observation |
|---|---|---|---|---|
| 1 | Browser authentication | Griff opens the deployed form on the new image and signs in with the same account as 2026-09-09 | the form shell renders after sign-in instead of returning to `/login` | the persisted row's `submitted_by = griff843` is the only durable trace; there is no login audit table |
| 2 | Track Only submission | Submit one **real** pick with a **different market shape** from the moneyline already recorded — a spread or a player prop — with Track Only selected | the form returns a submission id; no error | report shows `cohortSize` 2 |
| 3 | Persisted pick | none | new pick `status = validated`, `capper_id = griff843`, `distributionMode = track-only`, provenance honest (`canonical` only where participant IDs resolved, `eventId` `null` or a real event) | report `picks[]` entry; `pick_lifecycle` row `null → validated` via read-only SQL |
| 4 | Internal visibility | run the report | JSON with both picks, `transportEvidence` showing only GET requests, `stats.record` `0-0-0`, `stats.pending` 2, no `unknown` bucket | the report itself |
| 5 | Zero member delivery | none | `deliveryClean: true` for both picks, i.e. 0 rows in `distribution_outbox`, `command_center_delivery_mappings`, `execution_intents`, `settlement_records`; kill switches still `killed = true` for all three targets | report `delivery` counts; one read-only SQL on `delivery_kill_switch` |

Step 2 is what Milestone 2 condition 1 needs (repeatability) and what condition 2's provenance
guarantee has never been tested on (a non-moneyline shape). It is an operator action, and it is
worth doing only on the new image, which is the reason the deploy precedes it.

### 5c. Grading on the new image — what changes, and the honest limit of what is observable

After promotion the grading loop admits the Track Only picks for the first time in production.
For the existing pick (`dfcd9486`, `eventId: null`, event dated 2026-09-09) the pass will reach
`resolvePickEvent`, find no `events` row (the table stops at 2026-06-30) and record
`outcome: 'skipped', reason: 'event_link_not_found'` (`grading-service.ts:258-264`). A pick with a
resolved event and no `game_moneyline_win` / result row is skipped one step later.

**That skip is not persisted.** `system_runs` receives only `{picksGraded, failed}`
(`grading-service.ts:491-498`); the per-pick skip histogram is UTV2-1605, PM-ratified and routed to
Codex, not yet landed. So the observable acceptance is negative and bounded:

- `system_runs` keeps producing `grading.run` rows with `status = succeeded` and `failed = 0` from
  the new image (13,785 succeeded as of 2026-09-13T08:42Z on the old one).
- both picks stay `validated` with 0 `settlement_records` — correct, because no result exists.
- the report names the precondition that stops each pick (`event missing` / `no result row`)
  rather than the code's skip reason, which is the report's deliberate design.

That is proof the repaired pass runs and does not error on real picks. It is **not** proof that a
real pick settles; see §6.

## 6. Results and statistics while SGO stays off — what is verified, at which boundary

| Boundary | Evidence | What it proves | What it cannot prove |
|---|---|---|---|
| **memory** | `scripts/ops/track-only/sgo-journey-proof.ts` drives the real `sgo-fetcher`, `results-resolver`, `submission-service`, `grading-service` and `stats.ts` end to end on an SGO-shaped payload | the shipped code settles a Track Only moneyline from an attested result and the settlement counts | nothing about the database or the running image |
| **staging DB** | `scripts/ops/track-only/sgo-journey-staging.t1-proof.test.ts`, wired into `test:t1-proof:live`, runs on every PR under `Writable DB proof (staging only)` against `xskgrzbteyqdufktjrjx` with `CI_FIXTURE_RUN_ID`-namespaced fixtures (rows are never mistaken for real data and are not deleted). Six assertions: fixture namespacing, real resolver rows survive a real insert with `market_key = game_moneyline_win`, the real grading pass persists a settlement, Track Only stays `validated` with no delivery, stats compute from the persisted settlement, an incomplete result is refused. Run `34734250949` at #1567's head: 6 pass / 0 fail; re-run at every later PR head including #1571's. | the whole journey against real Postgres types, triggers and constraints | that production has any result row to grade |
| **production, read-only** | the report and `stats.ts` over the governed cohort | the statistics layer reads the real cohort and reports `pending`, refusing to count what has no verdict; it does not fabricate a record | a settlement, because none can exist without a results supply |
| **production, a real settlement** | — | — | **requires a results supply**: an active `SGO_API_KEY` (reserved decision 4, packet `RESULTS_BACKFILL_AUTHORIZATION_PACKET.md`) or a paid commitment (reserved decision 3). There is no third exit on `main`. |

So "results and stats are verified while SGO is off" means exactly rows one to three. Row four is
the binding constraint on Milestone 2 condition 3 and this packet does not pretend otherwise.

## 7. Independence from #1570 and #1556

Neither PR shares a file with this release. #1570 changes `.github/workflows/merge-gate.yml`,
`.github/workflows/merge-gate-verdict.cjs` and tests under `scripts/ops/`; #1556 changes
instructions, skills, `scripts/ops/` and `docs/`. None of those paths is copied into an image
(`apps/**`, `packages/**`, `deploy/**` are), `deploy.yml` is untouched by both, and the deploy
runs from `main` rather than from either branch. There is no ordering constraint in either
direction: the deploy can precede or follow either merge with identical results.

## 8. Recommendation

Dispatch now, from `main`, with the rollback tag set, and schedule Griff's browser acceptance
(§5b) for the same day:

```
gh workflow run deploy.yml --ref main -f rollback_tag=755e52a6cac8fcda2d3baf490b4f6dbb849e5683
```

Expected duration ~31 minutes. Then §5a's five criteria from the run, then §5b's five steps, then
the report. After that, the smallest remaining operator action on the product path is the
provider-key confirmation in `RESULTS_BACKFILL_AUTHORIZATION_PACKET.md` §5a.

**Why now rather than after #1570 or a further merge:** every item on the live grading path is
already on `main`, the release adds nothing to the Smart Form surface that could regress the
pilot, and each day of delay is a day the deployed grading loop runs code that this repository has
already falsified. The one argument for waiting — that the moneyline family alone cannot settle
anything — is true and irrelevant: the deploy's value is the acceptance it enables, not a
settlement it cannot produce.

## 9. What this packet explicitly does not ask for

- no change to `SYNDICATE_MACHINE_ENABLED` or any containment setting
- no SGO activation, no provider key, no paid commitment
- no production write, DDL, backfill or data deletion
- no member-delivery activation
- no change to the merge gate, branch protection or CODEOWNERS
- no sharing of any secret; every command above is either run by the workflow or by Griff with
  values only he holds

## Cross-references

- `docs/mission/intent.md` — reserved decisions 3, 4, 8; Milestone 2 conditions
- `docs/mission/plan.md` — Requires Griff item 1; boundary table
- `docs/05_operations/RESULTS_BACKFILL_AUTHORIZATION_PACKET.md` — the results supply decision
- `docs/05_operations/DB_ENVIRONMENT_OPERATOR_POLICY.md` — who may run what against production
- `.github/workflows/deploy.yml`, `deploy/rollback.sh`, `deploy/production/docker-compose.yml`
- `scripts/ops/track-only-report.ts`, `scripts/ops/track-only/stats.ts`,
  `scripts/ops/track-only/sgo-journey-staging.t1-proof.test.ts`
