# Mission Plan — live

**Owner:** Claude. Rewritten as reality changes. Not a log, not a backlog, not Linear in Markdown.
**Last reconciled against live truth:** 2026-09-06

Answers five questions: what is true now, what is executable, what is blocked, what requires Griff,
and what was learned.

---

## Reconciled current truth (2026-09-05)

Verified against `origin/main`, the GitHub API, branch protection, check-run outputs, the secret
metadata listing and the current readiness ledger. Not against docs or chat history.

- `main` is `7231dc9c7` (re-measured 2026-09-06T04:30Z; this bullet read `175f07c10` before, and
  `85f63c696` before that). The last commit that changed code a **deployed** container executes is
  still `b7d9fc07f` — #1501, `GET /api/picks/:id/trace` below the auth gate. Everything merged since
  is ops scripts, tests, docs, or `apps/command-center/**`, and the Command Center is in no
  production compose service. **No lane manifest is `in_progress` on `main`.** The readiness ledger
  still writes directly to `main` on a schedule, so the tip moves without a PR and every head-pinned
  artifact on an open lane ages against commits that changed no code.
- Branch protection on `main` requires exactly four checks: `verify`, `Executor Result Validation`,
  `Merge Gate`, `P0 Protocol`. `strict: true`. **`enforce_admins: false`**, no push restrictions,
  no rulesets, no required reviews. Unchanged.
- **12 PRs are open** (re-measured 2026-09-06T04:30Z; #1517, this lane, is the twelfth). Every one
  is blocked on `Merge Gate`, in three distinct ways:
  - **Not admissible as a lane at all** (#1429, #1491, #1492, #1495, #1496, #1498) — six PRs opened
    with no `UTV2-###` in the branch, so `Merge Gate` reports *"No issue ID found in PR branch or
    title. Cannot resolve authoritative tier."* This is self-inflicted, not a policy defect. The
    count fell from eight because **#1493 and #1494 were re-homed and closed**, exactly as the
    readmission ruling prescribes: #1493's diff landed as **#1503 (UTV2-1812), merged
    `9ac4694d9`**, and #1494's is open as **#1513 (UTV2-1802)**.
  - **Admissible, awaiting a T1 verdict** (#1513, #1479, #1505) — all three green on `verify`,
    re-measured 2026-09-06T04:30Z. #1513's only remaining obstacle is genuinely the verdict. **#1479
    is not:** `Branch Discipline Guard`, `Proof Coverage Guard` and `Shadow Parity Check` are all
    red on its head `cdc72758`, and #1505's `File scope lock` is red. None of those four is a
    required check, so none of them blocks the merge — but binding a head-pinned verdict to a PR
    whose own contract checks disagree with it is not a reasonable hand-off — so each red was read
    rather than assumed. **None of the four turns out to be an ordinary repair**, and #1479 had
    already reached that conclusion itself: `docs/06_status/proof/UTV2-1815/verification.md`
    gives all three of its reds a measured cause.
    - #1479 `Require live-DB proof for runtime changes` — the guard requires the *same PR* that
      touches `apps/api/src/settlement-service.ts` to also touch an `apps/*/src/t1-proof-*.test.ts`
      (`proof-coverage-guard.yml:141-163`). The proof exists and is on `main`
      (`apps/api/src/t1-proof-utv2-1815-stake-units.test.ts`, landed by #1504 under UTV2-1831) — but
      it landed on a *different* PR, so #1479's own diff cannot contain it, and that path is outside
      #1479's `file_scope_lock`. Closing it needs a `scope-override/v1` or the
      `skip-proof-coverage` label. Both are Griff's.
    - #1479 `Check issue references` — `found UTV2-1783, UTV2-1815`. The one reference is commit
      `32bb89db8`'s message citing the ratification that governs its merge-SHA anchor row. Rewriting
      it changes that SHA, and `32bb89db` is the head the lane's staging receipt is bound to. The
      lane left it uncorrected deliberately, and that is the right trade: a verifiable receipt is
      worth more than a green non-required check.
    - #1479 `Shadow Parity Check` — *"No mechanically read-only production credential is
      provisioned."* It refuses service-role credentials by design, so it compared nothing and
      reached no parity conclusion. Provisioning the credential is reserved decision 4.
    - #1505 `File scope lock` — *"package.json is not declared by UTV2-1827."* `file_scope_lock` is
      pinned at lane-start and cannot be widened by an agent, so this needs a CODEOWNERS
      `scope-override/v1` pinned to the head — standing item 8 under "Requires Griff" — or the
      `package.json` wiring dropped, which would leave the runner unwired.

    So all three are genuinely verdict-blocked, and the first draft of this bullet was wrong in both
    directions: it first said they needed no repair, then said the repairs were ordinary. The true
    statement is narrower — every one of the four reds is non-required, and every one is closed only
    by an action reserved to Griff. #1513 and #1479 are also `BEHIND` and should be resynced before
    a head-pinned verdict is bound.
  - **This lane** (#1517, UTV2-1838) — `verify` green, `Merge Gate` awaiting the T2 artifact.
  - **Admissible, `verify` red** (#1451) — real repair work, production DDL, PM-gated.
  - #1484 remains open awaiting a verdict.
- Measured 2026-09-03: `strict: true` did **not** block #1474 even though it was genuinely BEHIND
  `main`, so head-pinned verdicts do not serialize to one merge per cycle and an approved-but-BEHIND
  PR needs no re-verdict round trip.
- The three-concurrent-terminal drift recorded on 2026-09-03 has not recurred. Every commit since
  has come through a lane or the readiness bot.

### Production deployed and passed its smoke on 2026-09-01 — current readiness is RED

Two different claims live in this section and they must not be collapsed. The first is a *point-in-
time deploy smoke*; the second is *current readiness*. Only the first was healthy.

**Current readiness is RED.** `docs/06_status/readiness/readiness-score.json` on `main`, generated
2026-09-05T02:37:43Z from run `33939585555`, records `"verdict": "RED"` and
`"observability": "degraded"`, with `deployed_sha` `e48106fc` against `main_sha` `9797bcbee` — the
deployed commit is not `main`, and the gap has widened by four merges since 2026-09-03. Nothing below licenses a statement that production is *currently*
healthy; the smoke below is evidence about 2026-09-01, not about today.

Measured from the `Deploy` run of 2026-09-01 (`e48106fc`), which promoted and passed its
post-deploy smoke **at that time**:

- Running containers: `api`, `worker`, `ingestor`, `discord-bot`, `grading-cron`, `web`,
  `smart-form`, `caddy`, plus Loki/Grafana. `web` and `smart-form` both reported `healthy`.
- API health: `status: healthy`, `persistenceMode: database`, `runtimeMode: fail_closed`,
  `dbReachable: true`, zombie picks 0, schema drift healthy.
- `SYNDICATE_MACHINE_MODE=parked`, which sets `UNIT_TALK_INGESTOR_AUTORUN=false`,
  `UNIT_TALK_INGESTOR_SCHEDULING_ENABLED=false`, `UNIT_TALK_WORKER_AUTORUN=false` and resolves
  enabled promotion targets to none. The deploy reads each value back out of the running container
  and fails if it disagrees.

**The readiness contract's "worker DOWN" line (dated 2026-04-30) is stale as a statement of
capability.** The worker is deployed; its autorun is deliberately off. That is containment, not
breakage, and containment is reserved until a milestone authorizes changing it.

### Open incident — direct-`main` push, `717b46971`

On 2026-09-02T21:09:57-04:00 a Claude terminal ran `git push origin HEAD:main`, landing a 2-file
edit to `docs/06_status/lanes/UTV2-1826.json` and `UTV2-1828.json` with no PR.

`Direct Main Push Guard` fired and went red (run `33683588651`), classifying it
`unauthorized_direct_push`. It could not prevent it: the guard is detection-only by design, because
`enforce_admins: false` structurally exempts an admin credential from the required checks. No
`docs/06_status/INCIDENTS/` entry has been opened and the commit carries no
`Emergency-Bypass-Record` trailer.

`DIRECT_MAIN_BYPASS_POLICY.md` names this exact path twice — under Prohibited Bypasses ("editing
protected operational truth files on `main` to make a lane appear closed") and under Non-Emergency
Alternatives ("`git push origin main` is never the next step after this tool's output"). It cites
`INC-2026-07-14-utv2-1533-direct-main-push.md` Occurrence 3. **This is a recurrence of that
occurrence class**, not a novel event.

Prevention requires one of: `enforce_admins: true`; a ruleset restricting `main` pushes to the
Actions app with a named break-glass bypass; or a `pre-push` hook refusing `refs/heads/main` without
a referenced incident file. All three are PM decisions — merge authority and branch protection are
reserved surfaces.

**Sequencing.** The active direct-`main` prohibition is not deferred behind this backlog. The
prohibition is already in force and already binding on every agent; what is outstanding is a
*mechanical* prevention control, and that control is a reserved PM decision on branch protection —
not a lane, and explicitly not changed here.

It is worth stating plainly why, because an earlier draft of this plan got it backwards:
`enforce_admins: true` would also close the only route by which several currently-inadmissible PRs
could land. That is a real consequence, but it is an argument for correcting how those PRs were
created — they were opened outside the lane system and are inadmissible for that reason — not an
argument for leaving `main` mechanically unprotected until they clear. Incorrectly created PRs do
not earn a deferral of a safety control. The correct order is: PM decides the prevention control on
its own merits and on its own timeline; the inadmissible PRs are re-homed through normal governed
lanes regardless of that decision.

---

## Frozen pending PM architecture review

PM froze these on 2026-09-03. **Do not commit to them, do not resume them, do not design against
them.** Heads preserved:

| PR | HEAD | What |
|---|---|---|
| #1491 | `73fb6b76e` | Risk-Scoped Merge Authority (RMA/v1) — replaces manifest-tier merge authority with diff classification |
| #1492 | `77dea9c8d` | Mission-native harness recalibration — 53 files; relocates dispatch/lane commands, rewrites `CLAUDE.md`/`AGENTS.md`, hooks, settings |
| ~~#1497~~ | `6d8029d03` | Mission plan update, stacked on #1491 — **closed 2026-09-04**, superseded by the reconciliations in this file |
| #1495 | `429b0cff9` | verify-semaphore claim/release race (support work; head preserved) |

The ideas in #1491/#1492 are **not ratified merely because they are implemented**: replacing
Linear/lane execution authority, treating `docs/mission/*` as higher authority than canonical
contracts, removing lane manifests, demoting `/dispatch`, changing tiers to `auto`/`human`,
auto-merging core-contract changes, or materially changing Claude/Codex authority. The execution
and governance system on `main` remains controlling. See `intent.md` § "Changes to the operating
model".

---

## Milestone 1 — what is actually left

Reach the deployed Smart Form → authenticate → resolve identity as `griff843` → submit a real
internal Track Only pick → persist it → prove Track Only cannot create member delivery → observe it
through a safe internal/operator path. Containment stays parked throughout; see `intent.md`
§ "Containment during Milestone 1".

| Step | State |
|---|---|
| Reach the deployed form | **Infrastructure done.** `smart-form` is deployed, healthy, routed by Caddy at `UNIT_TALK_SMART_FORM_DOMAIN`. The hostname is a secret and is not in the repo. |
| Authenticate | Deployed. Google OAuth via Auth.js v5, allow-list gated on `ALLOWED_CAPPER_EMAILS`. **The secret was reshaped by Griff on 2026-09-03T17:29Z**, after #1488 merged. Blocked only on the deploy that ships #1488's code (Wave 0 item 1). |
| Resolve canonical identity as `griff843` | **Code merged (#1488, `2ac23342`) and the secret has been reshaped; neither is in production yet.** The last promote predates both. See below. |
| Submit + persist a real internal Track Only pick | Deployed. `trackOnly` defaults to `true` in both `apps/smart-form/lib/form-schema.ts` and `BetForm.tsx`, so the form submits Track Only by default. `parked` stops provider ingestion and delivery; it does not stop capper submission. **Canonical reference-data coverage is not a precondition** — honest structured or manual `canonical-coverage-gap` provenance is acceptable for this contained pilot. |
| Prove Track Only cannot create member delivery | **Built, mutation-tested, and deployed.** UTV2-1672 (`6a8eface9`) is an ancestor of the running `e48106fc`: the submit-time pin, direct-enqueue guard, retry guard, requeue guard, outbox chokepoint, atomic-RPC chokepoint and recap exclusion each have a test that fails when the guard is removed. What remains is *observing* it during the pilot — a run, not a build. |
| Observe through an internal/operator path | **Not blocked.** A safe read-only internal observation — the pick's persisted `capper_id`, `metadata->>'distributionMode'`, provenance and the absence of any outbox row — satisfies this step. Deploying the Command Center (#1496) is desirable product work tracked on its own merits and is **not** a Milestone 1 gate; no `COMMAND_CENTER_*` secret is a prerequisite. |

### Containment during the pilot

Paid provider ingestion, provider activation or purchase, system picks
(`SYNDICATE_MACHINE_MODE=parked`) and member-facing delivery — including every deferred delivery
target — all remain parked for the duration of Milestone 1 and as a condition of it being
considered done. The last `Deploy` run verified `{"event":"syndicate_machine_mode.validated",
"mode":"parked"}` and re-read each value out of the running container. Nothing in the pilot may
unpark any of them.

### The identity blocker, precisely

Production today (`e48106fc`) derives the capper ID from the email local part, so a sign-in
address whose local part is not already the canonical capper id resolves to a non-canonical
identity.

That value is not cosmetic. `apps/smart-form/auth.ts` puts it in the session JWT as `capperId`, and
`apps/api/src/handlers/submit-pick.ts` prefers that claim over whatever `submittedBy` the form sent,
so it becomes the persisted identity of a real pick. Milestone 1 requires the canonical capper id.

#1488 merged at 2026-09-03T04:52Z. It requires each allow-list entry to carry its canonical ID
explicitly, refusing anything not already canonical rather than repairing it. That changes the
required *shape* of an existing secret, `ALLOWED_CAPPER_EMAILS`, to a comma-separated list of
`<email>=<canonicalCapperId>` pairs:

```
ALLOWED_CAPPER_EMAILS = <email>=<canonicalCapperId>[, <email>=<canonicalCapperId>]
```

`<canonicalCapperId>` must match `^[a-z0-9][a-z0-9_-]*$`. An entry with no `=` is dropped and does
**not** fall back to the local part.

**The actual address and mapping are not recorded here or anywhere else in the repository.** They
live only in the sanctioned secret store. Mission docs name the secret and its required shape; they
never carry its value.

**Measured 2026-09-05T02:55Z: `ALLOWED_CAPPER_EMAILS` was last updated 2026-09-03T17:29:12Z — after
#1488 merged at 04:52Z the same day.** Griff has reshaped it. The metadata listing carries the
update timestamp only; the value is never read, printed or recorded by an agent, so this plan
records *that* it was reshaped and *when*, and asserts nothing about its contents.

The hazard this section previously described — new code deploying against an old secret shape and
locking everyone out — is therefore closed at the secret end. What remains is that **no `Deploy` run
has fired since `e48106fc` on 2026-09-01T13:28Z** (run `33513608611`). Production still runs the
pre-#1488 derivation. Both halves of the identity fix now exist and neither is live; a single
`Deploy` dispatch ships them together. That dispatch is Wave 0 item 1 and it is the only remaining
reserved action on the Milestone 1 path.

One consequence worth stating: because `deploy.yml` re-reads its own environment out of the running
container and fails on disagreement, a malformed allow-list is caught by the deploy rather than
discovered by a locked-out capper — but only for values `deploy.yml` actually validates.
`ALLOWED_CAPPER_EMAILS` is only checked non-empty, so a wrongly *shaped* list still ships green.
Milestone 1 step 2 is the first real test of the value.

---

## Execution waves

Production-first. The waves are a dependency ordering, not a queue: work in a later wave that
does not depend on a reserved item proceeds immediately and in parallel.

**A reserved gate blocks only the action it reserves.** It does not block the mission, and it does
not block unrelated safe production work. Nothing in this plan should be read as "everything is
waiting on Griff" — at any moment most of the board is independent of every open reserved item.

### Wave 0 — reserved actions (Griff only)

| # | Action | Why reserved | What it actually blocks |
|---|---|---|---|
| 1 | **Dispatch a `Deploy` run — after the one-command pre-dispatch check below.** `deploy.yml` is `workflow_dispatch`-only; nothing promotes on its own. | Production deploy | Milestone 1 steps 1–5. Nothing else. |
| 2 | Approve **#1484** (`pm-verdict/v1`) — canonical reference bootstrap, the one open PR whose sole remaining obstacle is a verdict | Merge authority | #1484 only. Not a Milestone 1 gate. |
| 3 | Review **#1491 / #1492** as an architecture decision — not as engineering to resume | Merge authority | Those two PRs only. Explicitly not the mission. |
| 4 | Decide the direct-`main` prevention control (`enforce_admins`, a ruleset, or a `pre-push` hook) | Branch protection | Nothing. The prohibition is already in force; what is reserved is the mechanical enforcement. |
| 5 | Any production containment change (`parked` → `active`) | Containment | Nothing in Milestone 1 — the milestone is explicitly defined to complete with containment intact. |

Three items left this table on 2026-09-05 by being **done**, not by being deferred:

- The former item 1 — reshape `ALLOWED_CAPPER_EMAILS` — was completed by Griff on 2026-09-03T17:29Z.
- The former item 3 — decide #1477 — was resolved: the standing `CHANGES_REQUIRED` was answered by
  correcting the proof bundle rather than the implementation, and #1477 merged at `1734bf20` on
  2026-09-05T01:43Z.
- The former item 4 — approve #1501 (UTV2-1823) — was approved and merged at `b7d9fc07` on
  2026-09-03T19:26Z. The anonymous `GET /api/picks/{id}/trace` exposure that would have leaked the
  pilot's own pick is closed in code, though not yet in production, which is downstream of item 1.

Command Center secrets are **not** in this table. They are not a Milestone 1 prerequisite; see
`intent.md` § "Step 7 — observation path".

### The deployment decision packet — reconciled 2026-09-05T15:30Z

Measured against `origin/main`, the GitHub API, the deploy workflow, GHCR manifests, and live
production Supabase (read-only). **This replaces the bare "only Deploy remains" framing, which was
true but incomplete.**

**Exact release, re-measured 2026-09-06.** `origin/main` is `7231dc9c7`. Production is
`e48106fc9a5eb5904b322833d0968da5ae0b0665`. The gap is 117 commits, and exactly **two** of them
change code a running container executes:

| File | PR | SHA | Behaviour |
|---|---|---|---|
| `apps/api/src/server.ts` | #1501 | `b7d9fc07f` | `GET /api/picks/:id/trace` moved below the auth gate — the pilot's own pick's lifecycle aggregate is no longer anonymously readable |
| `apps/smart-form/lib/auth-allowlist.ts` | #1488 | `2ac233424` | Canonical capper identity from an explicit mapping; local-part derivation removed |

**Corrected 2026-09-06: the previous table listed `01a2d2d67` (#1474, Command Center auth mode) as
changing container code. It does not, and neither does any other `apps/command-center/**` commit —
see "The Command Center is not deployed" below.** That correction is what reduces the release from
three container-code changes to two.

Two further non-test files differ and ship into no container: `deploy/rollback.sh` and
`deploy/production/ENV_FILES.md` (#1507) change the deploy pipeline itself, so they govern the next
deploy rather than being carried into an image.

Measured with `git diff --name-only e48106fc origin/main -- 'apps/**' 'packages/**' 'deploy/**' |
grep -v '\.test\.'`, which returns 60 files: the two above, the two deploy files, 55 under
`apps/command-center/**`, and one `.env.example`. The remaining commits in the gap are
readiness-ledger bot commits, lane manifests, proof bundles, merges, docs and test-only changes. No
Dockerfile, no `docker-compose*`, no `packages/**` source, and no
`apps/{worker,ingestor,discord-bot,web}` source changed.

#### The Command Center is not deployed, so its defects are not live

Measured 2026-09-06, and it corrects a framing this plan repeated in three places.
`deploy/production/docker-compose.yml` declares `api`, `worker`, `ingestor`, `discord-bot`,
`grading-cron`, `web`, `smart-form`, `caddy`, `loki` and `grafana` — **there is no
`command-center` service**. `deploy/production/Caddyfile` publishes exactly three site addresses
(`{$CADDY_DOMAIN}` → `api:4000`, `{$UNIT_TALK_WEB_DOMAIN}` → `web:4200`,
`{$UNIT_TALK_SMART_FORM_DOMAIN}` → `smart-form:4400`) — no command-center route. `grep -rn
"command-center" deploy/` returns nothing at all.

So the Command Center auth defects (UTV2-1812 dotted-path bypass, UTV2-1802 arbitrary management
SQL) are **real defects in an application production does not run or expose**. They are
pre-deployment hardening for #1496, not remediation of anything an attacker can reach today. This
does not lower their priority — #1496 is precisely what would ship the exposure, so they must land
before it — but the plan must not describe an unreachable surface as live, and it did.

**No DDL prerequisite.** `deploy.yml` runs no migration step. UTV2-1811's `rate_limit_buckets` table
and `consume_rate_limit_bucket(...)` RPC were verified to **already exist** in production, and the
currently-running API already depends on the RPC (`UNIT_TALK_API_RATE_LIMIT_STORE=supabase_rpc`
shipped at `e48106fc`).

**Rollback images are available** — all six service images resolve at the full 40-char tag
`e48106fc9a5eb5904b322833d0968da5ae0b0665`. No retention or pruning workflow exists, so nothing
deletes them. Note `web` and `smart-form` carry only two tags each; `e48106fc` is effectively the
only viable Next.js rollback target.

#### The one real risk, and it is not a code risk

`ALLOWED_CAPPER_EMAILS` is validated **non-empty at three layers and shape-validated at none**:
`deploy.yml:100`, `deploy.yml:486`/`:974`, and `deploy/production/nextjs-entrypoint.sh:28-31`.
`scripts/deploy-check.ts` does not reference it at all. After #1488 the parser
(`apps/smart-form/lib/auth-allowlist.ts:43-66`) **silently drops** any entry lacking `=` or failing
`^[a-z0-9][a-z0-9_-]*$` — with no fallback and no log. An all-malformed value yields an empty
allow-list and `signIn` returns `false` for everyone.

Nothing in the deploy detects it. The `smart-form` healthcheck is `curl -fsS localhost:4400/login`
(`deploy/production/docker-compose.yml:223`), which returns 200 regardless of allow-list contents,
so the deploy reports `smart-form: healthy` with an allow-list that admits nobody. The `smoke` job
only asserts `localhost:4000/health == 200` and never touches the smart-form container, the OAuth
flow, or the allow-list. **The first real test of the value is Griff's own browser.**

**Corrected 2026-09-05: rollback now restores configuration, and the claim below it was false.**
This plan previously stated that `deploy/rollback.sh` "rewrites `.unit-talk-release` and re-pulls
images; it **touches no env file**", and concluded that rollback "makes it worse". That was true when
written and is false on current `main`. `deploy/rollback.sh:71-79` reads:

```sh
for f in .env.production .env.web .env.smart-form; do
  if [ -f "$f.$TAG" ]; then
    cp -p "$f.$TAG" "$f"; chmod 600 "$f"
    echo "restored $f from configuration snapshot $TAG"
  else
    echo "WARNING: no configuration snapshot for $TAG at $f.$TAG - code rolled back, configuration did not" >&2
  fi
done
```

UTV2-1834 (#1507, `1d76b75e1`) added both the snapshot on the way out and this restore on the way
back, and it warns explicitly when no snapshot exists rather than rolling code back silently against
a mismatched configuration. **A rollback after a bad allow-list now restores the old-shaped value
alongside the old parser**, which is the pairing the previous text said was impossible.

One real gap remained in that repair and is closed by UTV2-1835 (#1511, merged `ce3b87bf8`): the snapshot step
overwrote unconditionally, so a *retry* after a deploy that died between the env writes and the
release-record advance captured the failed attempt's configuration over the running release's — and
the mtime-ordered prune could evict the surviving snapshot outright. Both were reproduced by
executing the workflow's own remote body, and the repair distinguishes a failed retry from a
legitimate same-tag redeploy via a `.unit-talk-deploy-inflight` marker. That distinction matters
precisely because the documented recovery from a bad allow-list *is* a same-tag redeploy.

What remains true is the part that was never about rollback: `ALLOWED_CAPPER_EMAILS` is validated
non-empty at three layers and shape-validated at none, and no deploy check can see a syntactically
valid list that admits nobody.

There is also **no automatic rollback**. `ROLLBACK_TAG` comes from an optional, empty-by-default
dispatch input (`deploy.yml:10-13`); left blank, a failed health loop just fails the job with
production on the new tag (`deploy.yml:1073-1075`). The `smoke` job has no rollback branch at all.

Recovery from a lockout is therefore: edit the secret, re-dispatch `Deploy` — ~10m22s of pipeline
(measured from run `33513608611`) plus diagnosis, so **~15 minutes per attempt, each attempt itself a
reserved production deploy**.

#### Recommended action

**Close one gap locally before dispatching — it costs one command and removes the only silent-failure
path on the Milestone 1 identity fix.** Griff runs, in a local shell, with the real secret value:

```
ALLOWED_CAPPER_EMAILS='<value>' pnpm exec tsx -e "import {parseAllowedCapperEmails} from './apps/smart-form/lib/auth-allowlist.ts'; const r=parseAllowedCapperEmails(process.env.ALLOWED_CAPPER_EMAILS); console.log('entries:', r.length, 'ids:', r.map(x=>x.capperId).join(','))"
```

Success criterion, non-secret: prints `entries: N` with `N >= 1` and `ids:` containing `griff843`.
No email address is printed and no value leaves the machine.

**Then dispatch `Deploy`.** If the check fails, the fix is a secret edit *before* the deploy rather
than a lockout plus a ~15-minute recovery loop afterwards.

One further check is worth having but is not a blocker: whether the host's current
`.env.smart-form` already holds the new shape against the old parser — which would mean production
login is **already** broken today rather than merely stale. Non-secret criterion: count the `=` signs
after the first in that line; `0` means old shape, `>=1` means already-broken.

**Corrected 2026-09-05: the "stale doc" finding was itself stale.** This plan previously recorded
that `docs/05_operations/REQUIRED_SECRETS.md:541` still documented the pre-#1488 shape. It does not.
The `ALLOWED_CAPPER_EMAILS` entry on `main` now states the `<email>=<canonicalCapperId>` shape, the
`^[a-z0-9][a-z0-9_-]*$` id rule, that an entry without `=` is *silently dropped* with no local-part
fallback, and — explicitly — that neither the deploy workflow nor the container entrypoint validates
the shape, so an all-malformed value deploys green and admits nobody. No docs work is outstanding
here.

### Wave 1 — Smart Form Track Only pilot (Milestone 1)

**Every code and secret prerequisite is now met, and none of them is deployed.** #1488 (canonical
identity) merged at `2ac23342`; `ALLOWED_CAPPER_EMAILS` was reshaped on 2026-09-03T17:29Z; UTV2-1823
(authenticate `GET /api/picks/{id}/trace`, which would otherwise return the pilot's own pick's
entire lifecycle aggregate to any anonymous caller) merged at `b7d9fc07`. Production is still
`e48106fc` from 2026-09-01 and carries none of them.

**What remains before the pilot can run is exactly one action: Wave 0 item 1, the `Deploy`
dispatch.** There is no longer any engineering step, approval artifact or secret between the current
`main` and a runnable pilot.

Then **run the pilot itself as one lane**: reach the form, authenticate, resolve `griff843`, submit
a real internal Track Only pick, assert persistence, observe the Track Only guards holding during
the run, and observe the result through a safe read-only internal/operator path. Containment stays
parked throughout. This is the deliverable that has never been attempted end to end.

#1477 is **not** a Milestone 1 dependency; it is unrelated rate-limit DDL and is sequenced on its
own merits.

### Wave 2 — CLV / data truth

| PR / work | State |
|---|---|
| #1479 null-stake computation truth | **`verify` is green** (re-measured 2026-09-05T22:10Z; the earlier "red" is stale). Only `Merge Gate` fails, so what it needs is an approval artifact, not a repair. This plan states no verdict on it. |
| #1451 June offer-history partitions | `verify` red; production DDL; PM-gated |
| #1484 canonical reference bootstrap | `verify` green; needs a verdict (Wave 0 item 2) |
| Closing-line truth | Not yet a branch |

### Wave 3 — Command Center

**This is the executable front while Wave 0 item 1 is outstanding.** #1493 (dotted-path auth
bypass, canonical issue **UTV2-1812**) and #1494 (arbitrary management SQL, canonical issue
**UTV2-1802**) first — both are Command Center auth defects with green `verify`, and neither
depends on any reserved action. They are **pre-deployment hardening, not live exposure**: the
Command Center is in no production compose service and behind no Caddy route (measured 2026-09-06,
see "The Command Center is not deployed" above). They must land before #1496 because #1496 is what
would expose them. Then #1496 (deployment), which does need Command Center secrets and
a hostname. All three need readmission as lanes; see "Admissibility debt" below. Readmission runs
through `ops:lane-start --readmit-existing-branch --executor <who>` under the canonical issue.

Deployment is tracked here on its own product merits. It is **not** a Milestone 1 gate.

### Wave 4 — models / research

Nothing identified as safely independent of the waves above. Requires a scope check before starting.

### Wave 5 — website / product optimization

Not started.

### Wave 6 — exactly one governance lane at a time

The current one is **UTV2-1836** — the carry-forward evidence collector, the reserved Merge Gate
integration diff, and this reconciliation. UTV2-1830 held the slot before it and merged as #1502
(`1cb31a43e`); UTV2-1829 before that, as #1499 at `d70df077`. RMA is an architecture review, not a
governance lane.

Per the ratified debt policy in `intent.md`, **the slot is a ceiling, not a quota, and may stand
empty.** After this lane closes it is deliberately left unstaffed: the closeout defects below are
survivable by hand, the Command Center auth exposures are not, and production security work does
not consume this slot. The strongest current candidate when the slot is next spent is the
`pre-proof-validator` classification repair recorded under Learned.

---

## Tracker-independence cutover (ratified 2026-09-05)

Ratified by Griff on 2026-09-05 and recorded in `intent.md` § "Execution must not depend on the
tracker". **One supporting workstream, five exit conditions, then closed.** It is not a governance
audit and not a replacement framework.

The rule: an ordinary product task must run discovery → delegation → verification → PR → closeout
**without Linear access and without an issue ID**. Auto-setting labels and states is insufficient;
the test is what happens when Linear is unavailable, inconsistent, or at its cap.

### Evidence already in hand, measured on this lane

Recording this lane's own friction, because it is the cheapest available reproducer:

- **A transient Linear network blip hard-blocks lane start.** `ops:lane-start UTV2-1833` failed with
  `lane_start_failed: failed to capture Linear task contract for UTV2-1833: spawnSync curl
  ETIMEDOUT`. Nothing about the work required the tracker; a timeout on a metadata fetch stopped it.
  This is exit condition 2's failure mode, observed live.
- **A failed lane-start leaves residue the sanctioned cleaner refuses to clean.** The ETIMEDOUT
  attempt had already created the branch and worktree, so the retry failed with "Branch and worktree
  already exist but no manifest exists for this issue". `ops:lane-clean --issue UTV2-1833 --dry-run`
  returned `BLOCKED` with an empty `actions[]` and no reason — it is a post-merge cleaner, and an
  aborted lane start is outside its model.
- **A merged, truth-closed lane leaked its lease and blocked the next lane on the same files.**
  UTV2-1830 merged as #1502 (`1cb31a43e`) and truth-closed at 03:10Z, but `.ops/leases/UTV2-1830.json`
  stayed `active` with a 48-hour TTL and a dead owning PID (58934). `ops:lease-recover` refuses it —
  reclaim is TTL-gated — so a lease that is provably finished cannot be reclaimed for two days.
  `ops:lease release` was the working path.
- **Proportional validation exists but excludes the mission docs.**
  `scripts/ops/preflight.ts:1626-1631` admits only `docs/06_status/**` and `.claude/commands/*.md`
  to `--docs-only-fast-path`. Editing `docs/mission/intent.md` — the most authority-bearing docs edit
  in the repo — therefore requires the full application test suite (~4 min) to *begin*, while editing
  a status file does not. Same defect class as the `docs/mission/**` lane-authority gap UTV2-1829
  fixed: an allowlist that reads as if it covers a path it does not name.
- **Linear writes are not read-your-writes.** A tier label and state written at 14:54:50Z were not
  visible to a preflight Linear query started immediately after, costing one full ~4-minute run.

None of these are risk controls. Every one is administrative.

### Exit conditions

Per `intent.md`, the cutover closes when all five hold, demonstrated rather than asserted:

1. A representative ordinary task can complete without Linear.
2. Optional tracker failures cannot block it.
3. Reserved-risk changes still require appropriate approval.
4. Fresh and compacted sessions recover the mission and current plan.
5. Existing PRs can finish without administrative restarts.

Then the capacity returns to product work.

### The dependency map — measured 2026-09-05

Two dependencies are routinely conflated, and separating them is what makes this workstream small:

**Linear the API hard-blocks in exactly two files** — `scripts/ops/preflight.ts` (which gates lane
*open*) and `scripts/ops/truth-check-lib.ts` (which gates lane *close*). Everything else that touches
Linear fails soft or is off the critical path. Remove the token and the first failure is
`ops:preflight` at `preflight.ts:1128-1136` (PE2 + PL1-PL5 `infra_error` -> verdict `INFRA` -> no
token written), which then cascades to `lane-start.ts:418` *"validated preflight token is
unavailable"*.

**The `UTV2-###` identifier is embedded far more deeply** — it is the primary key for the manifest
filename, sync filename, proof directory, branch name, worktree path, preflight-token path,
file-scope lifecycle grant, and the merge gate's tier lookup.

**The decisive finding: no required CI check calls Linear.** Of the four required checks, `verify`
and `P0 Protocol` pass on an ID-less branch; `Executor Result Validation` and `Merge Gate` fail — and
both fail on the *name*, not on the tracker. `merge-gate.yml:250,419-424` resolves tier from
`docs/06_status/lanes/<ID>.json`, never from Linear. **Linear is the authoring surface for tier, not
the gate's input** — the risk decision is already repo-local by the time it matters.

One inversion worth recording: `P0 Protocol` is the *only* required check that ever touches Linear
(`p0-protocol.yml:75-78`, `exit 1` when the token is absent and an ID is present). So removing Linear
would make correctly-named branches *worse off* than ID-less ones.

Two administrative gates deserve naming:

- **`truth-check` L4** (`truth-check-lib.ts:1033-1037`) requires `manifest.pr_url` to appear in the
  issue's Linear attachments. **Nothing in this repository ever creates that attachment** — `grep -rn
  "attachmentCreate" scripts .github` returns nothing. L4 is satisfied exclusively by Linear's native
  GitHub integration, which keys off the `UTV2-###` in the branch name. A hard closeout gate depends
  on a third-party integration the repo neither owns nor exercises.
- **`truth-check` L2** (`:1012-1017`) does not merely check the tier label — it *overwrites* the
  manifest tier from Linear. That is the risk-bearing half, and relocating it is the one item here
  that needs PM sign-off on its own.

**On the classifier as a floor:** `tier-classifier.ts:76-92` `classifyMechanicalMinimum(paths)` is
pure — no Linear, no network, no git — and `classifyDerivedTier` at `:94-117` already computes
`maxTier(declaredTier, mechanicalMinimum)`, i.e. exactly floor semantics. But it is **binary, not
three-valued**: every match hard-codes `minimum_tier: 'T1'` and the reduce seeds `'T3'`, so **no path
can ever produce T2**. It cannot express the middle tier at all, and it is blind to semantic risk,
diff magnitude, and blast radius. It is a usable floor and an unusable replacement — which is exactly
what the ratification says.

**The change set, split by whether it touches reserved surface:**

| # | Change | Reserved? |
|---|---|---|
| 1 | `preflight.ts:1119-1148,1161` — emit PL1-PL5 as `skip` (not `fail`/`infra_error`) when there is no tracker ref or token; take tier from `--tier` raised by the mechanical floor | No — highest leverage; unblocks the whole open->PR path |
| 2 | Add `tracker_ref` to the manifest and widen `shared.ts:365,372,656` + the manifest schema so a repo-minted id is legal; `issue_id` becomes repo-owned identity and the Linear key becomes explicit and nullable | No for ops; **reserved** if `merge-gate.yml:243-245` must widen in lockstep — split that out |
| 3 | `truth-check-lib.ts` L1/L3/L4/C1/C7 -> `skip` when `tracker_ref` is null | No — all purely administrative |
| 5 | `lane-close.ts:2794-2803` and `lane-finalize.ts:948-953` — record `tracker_sync: skipped` instead of throwing out of closeout | No |
| 6 | `execution-packet.ts:1316-1323` — a `--description`/file source for the task contract, so a first capture needs no API | No — unblocks delegation |
| 7 | `lane-maximizer.ts` — document the existing queue-file/`--candidates` source as first-class | No — unblocks discovery |
| 4 | `truth-check-lib.ts:1012-1017` — relocate L2's tier authority to the manifest raised by the floor | **Adjacent** — risk-bearing; PM sign-off; do not bundle |
| 8-11 | `p0-protocol.yml`, `executor-result-validator.yml`, `merge-gate.yml`, classifier Phase 2 cutover | **RESERVED — not changed** |

**Items 1, 3, 5, 6 and 7 together satisfy the ratified rule for the ops-script half of the lifecycle
with zero merge-authority exposure.** Items 8-11 are where the remaining hard blocks live, and all
four are reserved. That is the real shape of the decision: the tracker can be made optional for
discovery, delegation, verification and closeout by an ordinary lane; making it optional for *merge*
is a PM decision on branch protection and the merge gate.

**Defect found in passing, worth reporting regardless of this workstream:**
`executor-result-validator.yml:181-184` — on `pull_request` with no executor-result comment it logs
*"No executor result comment found. Check stays pending."* and creates no check context. Because
`Executor Result Validation` is a required check, the PR sits BLOCKED **with no red check to look
at**. That is the mechanism behind the already-recorded "a PR can sit BLOCKED with everything green"
class.

### Sequencing — reviewed against #1491 and #1492 on 2026-09-05

**Structural finding that changes how both PRs read:** #1492 is stacked on a *stale* base of #1491
(`git merge-base 73fb6b76e 77dea9c8d` = `2641d7cae`; #1491 has 7 commits after it). A naive
`git diff 73fb6b76e 77dea9c8d` therefore *falsely* shows #1492 reverting #1491's security hardening
in `merge-authority.cjs` and `RESERVED_RISK_SURFACES.json`. Those are stale-base artifacts. #1492's
true diff is `2641d7cae..77dea9c8d` and touches none of those files.

The split is cleaner than expected: **merge authority lives almost entirely in #1491; tracker
independence lives almost entirely in #1492.** The one coupling to break is that #1492 sources its
*risk semantics* from #1491's classifier.

**PR A — the tracker-independence unblock.** Touches no reserved surface:

- `scripts/ops/executor-result-validate.ts:133-158` — absent issue ID passes, malformed still fails,
  and the load-bearing assertion (the executor attests to *this* head ref) is kept. Highest-value
  hunk: without it no branch reaches a green `Executor Result Validation` without a `UTV2-###`.
  **Do not** take the same file's `proofArtifactRequired(r, reservedSurface)` rewrite, which makes
  the classifier the *sole* evidence bar — under this ratification it must be a floor: proof required
  if `tier != T3` **or** the diff touches a reserved surface.
- `scripts/ops/branch-discipline-guard.ts:11,132-158` — a branch with no issue ID passes, while a
  branchless PR referencing two issues still fails and an ID-carrying branch must still bind to its
  own. Not a required check.
- `.github/workflows/tier-label-check.yml:41-53` — `core.setFailed` -> `core.notice`. This is what
  produces the *"No issue ID found... Cannot resolve authoritative tier"* red on eight open PRs. Not
  one of the four required checks, so it changes no merge authority, and it still mirrors the tier
  for any branch that does carry an ID — remaining sync stays optional and non-blocking.
- Hook and settings removals of mandatory tracker lookups: delete
  `.claude/hooks/commit-msg-linear-check.sh` and `linear-sync-reminder.sh` and their
  `.claude/settings.json` wiring; drop the `pnpm linear:issues` reminder in `artifact-drift-check.sh`
  and the lane-heartbeat scan in `session-summary.sh`. All advisory. Take the *removals* verbatim;
  **rewrite** `session-start.sh`'s replacement body, whose new text asserts RMA.
- `scripts/ops/classify-diff.ts` — a read-only preview CLI that exits 0 for both verdicts, stating
  outright it is not the gate. Take it, renaming its verdict labels away from `auto`/`human` so it
  does not read as an authority claim.

**PR B — the floor rework.** Where the real care is needed:

- `scripts/ops/merge-authority.cjs` `classifyDiff`/`loadPolicy` are pure, read-only functions and are
  reusable as the **mechanical risk floor**. Take `RESERVED_RISK_SURFACES.json` `surfaces[]` only.
  **Leave behind** its `approval` block and `summary` (they *are* the merge-authority definition) and
  its `scopeNote`, which declares `packages/domain`, `packages/contracts`, scoring and lifecycle
  deliberately **not** reserved — that is precisely the risk-lowering this ratification forbids.
  Never import `evaluateMergeAuthority`.
- `.claude/hooks/tier-c-path-guard.sh` hard-denies writes to `packages/domain/**`,
  `packages/contracts/**`, `apps/worker/**`, `apps/api/src/auth.ts` and `supabase/migrations/**`, and
  **its only bypass is an active lane manifest's `file_scope_lock`**. Under a no-issue-ID model that
  guard denies those edits with no way to authorize them, so execution stops at the keyboard. #1492's
  `reserved-surface-guard.sh` fixes the unblock but **demotes the hard block to advisory**, justified
  by "the merge gate blocks it instead" — a justification that does not hold here, because the merge
  gate is not changing. Salvage the mechanism (one shared classification source for keyboard and
  gate) and keep reserved paths blocking, authorized by a declared scope rather than a manifest.
- `scripts/ops/codex-packet.ts` is the **repository-owned work identity**: a packet file with
  required `Goal` / `Scope` / `Acceptance` / `Do not touch` sections that the runner refuses to
  execute without, reading no Linear, no manifest and no tier label. Its `classifyScope` fails closed
  on unclassifiable scope, and a broader scope must be at least as reserved as anything inside it —
  floor semantics done correctly. Verify `resolveProfileForScope` only ever *tightens*.

**Do not take** #1492's `CLAUDE.md`, `AGENTS.md`, command or agent rewrites. Beyond restating RMA as
doctrine, #1492's `CLAUDE.md` **deletes `## Mission — mandatory context`** — the block that
`@`-includes `intent.md`, `spec.md`, `plan.md` and `STANDING_GUARDRAILS.md`. Taking it wholesale
would silently stop loading the very sections this lane adds. Re-derive by hand against `main`.

**Dangling references to be aware of:** #1492 cites a `## Execution primitive` section of
`intent.md` in roughly six load-bearing places (`RESERVED_RISK_SURFACES.json:4`,
`reserved-surface-guard.sh:19`, `tier-label-check.yml:44-48`, `branch-discipline-guard.ts:126-131`).
**No such section exists on `main`**, and `## Changes to the operating model` says the opposite.
Every one of those citations is currently false.

### Explicitly out of scope

Merge authority, the merge gate, its policy inputs, CODEOWNERS, and branch protection are reserved
and unchanged. #1491's diff-classified merge authority is **not** approved by this ratification and
remains a separate architecture decision. Existing enforcement stays active until reviewed
replacements land.

## Admissibility debt

**Eight** open PRs cannot be evaluated by `Merge Gate` because they were opened outside the lane
system and carry no resolvable tier: #1429, #1491, #1492, #1493, #1494, #1495, #1496, #1498. All
eight fail the identical set of checks — `Check issue references`, `Sync tier label`, `Executor
Result Validation`, `Merge Gate` — every one of them downstream of the same single cause. (The count
rose from seven not because a new PR was opened outside the system, but because #1429, an older
model-de-pin branch, was checked and belongs to the same class.)

**PM ruling 2026-09-03: `Merge Gate` is not changed to admit incorrectly-created branches.** The fix
is readmission through `ops:lane-start` under the real issue. Renaming an open PR's head branch
closes it and it will not reopen, so readmission means a replacement PR carrying the same diff.

Two of them are security fixes that already have canonical Linear owners — the work and the issue
exist, they were simply never joined:

| PR | Fix | Canonical issue |
|---|---|---|
| #1493 (+121/-1) | a dot in the path no longer skips Command Center authentication | **UTV2-1812** (Backlog) |
| #1494 (+503/-61) | the management token can no longer be handed arbitrary SQL | **UTV2-1802** (Backlog) |

These are being re-homed onto those issues through normal governed lanes. They are product security
work, not governance work, and do not consume the governance slot. Note the correction above: the
Command Center is not deployed, so these harden a surface #1496 would create rather than close a
reachable one. **They are the next
executable work after this lane closes**, and neither waits on Griff.

### `Lane authority` rejects dotfiles inside its own allowed globs

Observed on this lane (UTV2-1829, PR #1499). `ops:lane-start` creates and commits
`docs/06_status/proof/<issue>/.gitkeep`. `File scope lock` accepted it; `Lane authority` and
`Return review packet` both rejected it as `out-of-scope files:
docs/06_status/proof/UTV2-1829/.gitkeep` — even though `.lane/lanes/governance.yml` lists
`docs/06_status/proof/**` as an allowed glob.

**Correction, 2026-09-05: the recorded micromatch diagnosis was wrong.** This plan previously stated
that `matchesAny()` in `scripts/lane-contract.ts` calls `micromatch.isMatch()` with no `dot` option.
It does not. `scripts/lane-contract.ts:214` reads:

```ts
return micromatch.isMatch(file, patterns, { dot: true });
```

`{ dot: true }` is present, and was present in the original commit `8477d8dbb`. Every other call site
passes it too — `ut-cli/lib/git.ts:82`, `ut-cli/lib/scope.ts:24/28/31`,
`scripts/ci/direct-main-push-guard.ts:184`, `scripts/ops/pr-review-packet.ts:656/671/960`. Whatever
rejected `docs/06_status/proof/UTV2-1829/.gitkeep` was **not** this option, and the fix this plan
proposed would have been a no-op.

**Cause identified 2026-09-05 (UTV2-1836), and it is not about dotfiles at all.** The same check
rejected `docs/06_status/proof/UTV2-1835/evidence.json` on PR #1511 — an ordinary filename. That
ruled out every dot-related explanation and pointed at the scope construction itself.

`scripts/ops/pr-review-packet.ts:487-491` builds the allowed scope as:

```ts
const allowedFileScope = normalizePaths([
  ...scopeLock,
  ...sameIssueLaneMetadataPaths(issueId),   // .ops/sync/<ID>.yml and docs/06_status/lanes/<ID>.json only
  ...expectedProofPaths,                    // an EXACT list, not a glob
]);
```

`sameIssueLaneMetadataPaths` (`:662-668`) covers the sync file and the manifest and **no proof
glob**. So the lane's own proof directory is admitted only by literal `expected_proof_paths`
entries, and any other file inside it is scope bleed. `.lane/lanes/governance.yml`'s
`docs/06_status/proof/**` glob governs `Lane authority`, not this packet.

The system contradicts itself here in two directions, and both were hit on one lane:

- **`ops:lane-start` itself creates `docs/06_status/proof/<ID>/.gitkeep`** and commits it, then the
  review packet rejects it.
- **`Executor Result Validation` selects the narrow legacy proof contract unless
  `docs/06_status/proof/<ID>/evidence.json` exists** — and that contract requires a real merge SHA
  pre-merge, which is impossible. So a lane must add `evidence.json` to pass ERV, and adding it
  fails the review packet.
- **`ops:lane-manifest update` cannot add either one.** It supports `--pr-url`, `--commit-sha` and
  `--files-changed`; `expected_proof_paths` is settable only at `create` (`lane-manifest.ts:128`).

`Return review packet` is not one of the four required checks, so this blocks no merge — it emits a
`FAIL` verdict on a correctly-constructed bundle. The repair is one of: give the packet a
`docs/06_status/proof/<ID>/**` glob the way `sameIssueLaneMetadataPaths` already does for the sync
file and manifest, or teach `ops:lane-manifest update` to extend `expected_proof_paths`. Recorded
here rather than filed, per the filing threshold.

The earlier micromatch reading above stands corrected on its own terms as well: `{ dot: true }` was
always present, and the fix this plan once proposed would have been a no-op.

### Closeout repeatability — UTV2-1838, and what it deliberately left undone

The failure this lane exists for was observed twice (UTV2-1835, UTV2-1836): `ops:lane-finalize
<ID> --pr <n>` halts at `generate_t2_proof_bundle`. `lane-finalize.ts` passes
`--verification-log docs/06_status/proof/<ID>/runtime-verification.md`, but `ops:proof-generate`
writes only `diff-summary.md` and `verification.md` (`proof-generate.ts:197`
`STANDARD_PROOF_FILES`). `readOptionalFile` called `fs.readFileSync` unguarded, *as a function
argument*, so a static-proof lane threw ENOENT before the generator ran — and that step is
`required: true`.

**That crash was the only thing preventing a data-loss bug, which is why the two repairs had to
land together.** `lane-finalize.ts` always passes `--force`, and with `--force` the writer put the
same Markdown blob into **every** entry of `expected_proof_paths`. 27 T2-eligible manifests on
`main` declare a structured sidecar there (`evidence.json`, `model-routing.json`). Repairing the
ENOENT alone would have unmasked an overwrite that destroys machine-read proof artifacts. The
overwrite guard (`isMarkdownProofPath`, refusing before the `force` check) landed first, and the
inversion test asserts the sidecar's **content** is byte-identical after a forced run, not merely
that an exit code changed.

Two other repairs landed with them:

- **`lane-close.ts` — the plain close path was unguarded on `main`.**
  `guardRepairAgainstMainCheckout` (UTV2-1542) sits inside `if (repairMerged)`, so a plain
  `pnpm ops:lane-close <ID>` from the root checkout while on `main` reached `runTruthCheck`
  (history append + heartbeat write) and `finalizeLaneCloseManifest` (`status: done`) with no
  main-checkout guard at all. `guardCloseAgainstMainCheckout` now refuses it; `--repair-merged`
  keeps the richer guard that emits a governed repair packet, and the trusted post-merge
  automation is exempt from both.
- **Replay evidence parity.** `autoHarvestCiDbProofIntoEvidence` and
  `autoPopulateStaticProofFromVerifyRun` lived only in `proof-generate`'s `main()`.
  `post-merge-lane-close.yml:332-335` short-circuits the proof step on `workflow_dispatch` and
  delegates to `rebindRepairedLaneProof`, which called neither — so a dispatch replay bound its
  SHAs correctly but left `static_proof`/`runtime_proof` unpopulated and failed P7/R1/R2 on a
  replay that would have passed on a push. Both are now called from `rebindRepairedLaneProof`
  under the same best-effort, never-fatal contract they carry in `proof-generate`.

**One scoped item was deliberately not done, and one turned out not to need doing.** A lane's
`file_scope_lock` is pinned at lane-start and cannot be widened by an agent, and UTV2-1838's lock
covers `lane-close.ts`, `lane-finalize.ts` and `t2-proof-bundle.ts` — not these two files:

| Item | File | State |
|---|---|---|
| A provably terminal lane's lease cannot be reclaimed for 48h — reclaim is purely TTL-gated (`lease-registry.ts:523-531`, `claude` TTL at `:133`). Observed live on UTV2-1830: merged `1cb31a43e`, truth-closed, lease still `active` with a dead owning PID. `ops:lease release` is the working escape, but reclaim should not require knowing that | `scripts/ops/lease-registry.ts` | **Real, not done.** Gate reclaim on lane terminality, reusing `findLeasesHeldByTerminalLanes` (`:769-800`) rather than the clock. Out of scope; recorded, not filed |
| `truth_check_history` grows on every non-`done` run, so an infra-error early return records a `fail` for what was a token blip | `scripts/ops/truth-check-lib.ts` | **The defect does not exist.** See below |

**Corrected 2026-09-06: the `truth_check_history` defect this plan and UTV2-1838's own issue text
both asserted is not real, and the line numbers cited for it were stale.** The issue named
`truth-check-lib.ts:1860-1864` as a `done`-only guard and `:986`, `:1045`, `:1062` as infra-error
early returns. On current `main` those lines are unrelated code. Measured directly by calling
`finalizeWithManifest` with its injectable `writeManifestFn` and counting writes:

| Case | Writes |
|---|---|
| second close on a `done` lane, exit 0 | **0** |
| second close on a `done` lane, exit 1 | **0** |
| `infra_error` on a live lane, exit 3 | **0** |
| `ineligible` on a live lane, exit 2 | **0** |
| genuine `fail` on a live lane, exit 1 | 1 — correct, and the control that shows the probe can observe a write |

Every `infra_error` path uses `exitCode: 3` (`:919`, `:938`, `:955`, `:1097`, `:1595`), and
`finalizeWithManifest:1898` returns before any write on exit 2 or 3. That guard was introduced in
`4c029b006` on 2026-04-11 and the `done` guard in `7bcc642d7` (UTV2-1224) on 2026-06-06 — both
predate the issue. So this was never fixed recently; **it was wrong when written**, and acceptance
criterion 3 already holds on `main`. What is genuinely missing is a regression test locking it, and
that test file is also outside this lane's lock.

The lease item is survivable by hand today and blocks no production, so per the ratified filing
threshold it is recorded here rather than filed. It is the natural content of the next governance
lane if the slot is spent, alongside the `pre-proof-validator` classification repair under Learned.

The general lesson is the expensive one: **an issue's own file:line citations are a snapshot, and a
lane that implements against them without re-measuring implements against a stale repo.** Two of
the three citations here had drifted and the defect behind them was never real.

### `docs/mission/**` lane registration — resolved on `main`

`.lane/lanes/governance.yml` enumerates every docs subtree a governance lane may touch, and
`docs/mission/**` was in none of them, so `Lane authority` and `Return review packet` failed this
PR on `docs/mission/intent.md`, `spec.md` and `plan.md`. `CLAUDE.md` and `AGENTS.md` were already
individually admitted — a governance lane could add the pointer but never the target.

That file's own comments record this exact situation eight times (UTV2-1524, 1528, 1541, 1557,
1199, 1384, 1253, 1629), each closed by the lane that hit it adding its path in the same PR.
UTV2-1829 did the same, bounded to `docs/mission/**` and nothing else, and **#1499 merged at
`d70df077` on 2026-09-04**. The glob is on `main`; this lane (UTV2-1830) touches
`docs/mission/intent.md` and `docs/mission/plan.md` inside its own `file_scope_lock` and needs no
scope override for them.

The mechanism is worth keeping recorded: `.lane/lanes/governance.yml` was outside UTV2-1829's
`file_scope_lock`, and a lock is pinned to the lane-start commit and cannot be widened by an agent,
so the bounded expansion required a `scope-override/v1` comment authored by CODEOWNERS, pinned to an
exact head SHA. Every commit that moves the head — including a sanctioned `main` resync —
invalidates it. That is why a lane needing an override should be resynced and reconciled *before*
the override is requested rather than after.

### `MERGE_SHA: pending merge` — resolved on `main`

Executor Result Validation rejected the ratified `pending merge` anchor under the legacy contract,
which demanded the row be a real commit — impossible before a merge exists — while
`PLACEHOLDER_VALUE_PATTERN` in `ops:proof-generate` did not match `pending merge` either, so a
contract-conformant bundle was also unrebindable after the merge. Post-merge closeout was
deadlocked repo-wide.

**PR #1485 (UTV2-1825) merged at `5ed005a6d`.** Its own lane then closed cleanly through the normal
post-merge path (`5b5f7a3b8`), which is the mechanical evidence the rebinder now accepts the anchor.

The two lanes that merged before the fix landed have since been truth-closed through the governed
post-merge path. **UTV2-1789 (#1474)** closed at `43a1bf0f4` on the push that followed the fix.
**UTV2-1824 (#1488)** closed at `b729447d2`. Both manifests read `done` and
both issues are `Done`. No lane is left carrying the old failure.

UTV2-1824 needed one replay, and the rebinder was not what blocked it: every proof, merge and
evidence gate passed on the first attempt, and the single failure was `L3 — Linear state Backlog is
not an active or closeout state`. That issue had never left `Backlog` in its entire history — the
lane was started, implemented, reviewed and merged while its workflow state stood still. Correcting
the state and replaying closed it. A lane can therefore run end to end with its Linear state
untouched, and nothing surfaces that until closeout refuses.

The schema-v2 `sha_binding` block in `evidence.json` (`merge_sha: null` plus `verified_source_sha`)
remains the correct authoring shape; it is what the repaired rebinder binds against.

---

## Requires Griff

Consolidated from Wave 0, in dependency order. **This list is one item long on the Milestone 1
path.** Everything below item 1 blocks only itself.

1. **Dispatch a `Deploy` run.** The last promote was `e48106fc` on 2026-09-01T13:28Z (run
   `33513608611`), so production predates #1488 (canonical identity), #1501 (authenticated
   `GET /api/picks/{id}/trace`) and #1477. `deploy.yml` is `workflow_dispatch`-only; nothing
   promotes on its own. Milestone 1 steps 1–5. **Nothing else on the board waits on this.**
   The `ALLOWED_CAPPER_EMAILS` reshape that used to sit ahead of this item was completed on
   2026-09-03T17:29Z; its value belongs only in the secret store and is not recorded here.
2. **Approve #1484** (`pm-verdict/v1`) — canonical reference bootstrap, `verify` green, the only
   open PR whose sole remaining obstacle is a verdict. Not a Milestone 1 gate.
3. **#1491 / #1492 architecture review** — merge authority and agent authority. Those two PRs only.
4. **#1451** — production DDL, `verify` currently red. Not a Milestone 1 gate.
5. **Direct-`main` prevention** — branch protection change, decided on its own merits and its own
   timeline. **Not sequenced behind the inadmissible-PR backlog:** the prohibition is already in
   force, and incorrectly created PRs do not earn a deferral of a safety control. Not changed in
   this lane.
6. **Any production containment change (`parked` → `active`)** — not needed for Milestone 1, and
   explicitly excluded from it. Command Center secrets are likewise not a Milestone 1 gate.
7. **Review the approval carry-forward Merge Gate integration** (UTV2-1836) — merge authority,
   reserved decision 7. The verifier (`scripts/ops/approval-carry-forward.ts`, #1508) and its
   trusted evidence collector (`scripts/ops/carry-forward-collect.ts`, UTV2-1836) are both on
   `main`/in review and **nothing calls them**; the workflow hunk that would is presented as a diff
   and deliberately not applied. It is narrow: it fires only when every `validateT1Verdicts` error
   is staleness, and every other T1 error still blocks. Blocks nothing — head-pinned verdicts keep
   working exactly as they do today until this is decided.
8. **A `scope-override/v1` comment** on any future lane that must touch `.lane/lanes/governance.yml`
   or another path outside its own `file_scope_lock`. None is outstanding right now — the
   `docs/mission/**` registration it was last needed for merged in #1499.

Items that left this list on 2026-09-05 by being done: the `ALLOWED_CAPPER_EMAILS` reshape; the
#1477 decision (resolved by correcting the proof bundle, merged `1734bf20`); the #1501 approval
(merged `b7d9fc07`); and the #1499 scope override (merged `d70df077`). #1493 also left it — it was
never actually a Griff-reserved item, only an unadmitted PR, and it is now Wave 3 executable work.

---

## Learned

- **A crash can be the only thing preventing a data-loss bug, and repairing it alone is a
  regression.** `ops:lane-finalize` halted on every static-proof lane because `readOptionalFile`
  threw ENOENT on a file `ops:proof-generate` never writes. That crash was thrown while evaluating
  a *function argument*, so it fired before the writer ran — and the writer, always invoked with
  `--force`, would otherwise have put a Markdown bundle over every entry in
  `expected_proof_paths`, including the 27 T2-eligible manifests that declare `evidence.json` or
  `model-routing.json` there. The generalisation: before fixing a fail-closed error, establish what
  currently *cannot happen because of it*. UTV2-1838 landed the overwrite guard first and the
  ENOENT repair second, and the inversion test asserts the sidecar's bytes rather than an exit code.

- **A vacuous `.every()` is a fail-open, and enumerating the inputs is what finds it.** The first
  draft of the carry-forward Merge Gate integration read `(t1Errors.codes || []).every(c => c ===
  'stale_head')`. On an absent list that is `[].every(...)` — true — so `onlyStaleness` would have
  been true for *every* early-return path, including **no verdict at all** and **unauthorized
  author**, and the gate would have carried an approval forward onto PRs that were never approved.
  It was found by enumerating the seven verdict shapes and reading what each returns, not by
  reading the predicate. The repair attaches a code on every return path and throws on a
  length mismatch, so a desynchronised result cannot be produced rather than merely being unlikely.
  The measured integration effects belong to the reserved packet
  (`docs/05_operations/CARRY_FORWARD_MERGE_GATE_INTEGRATION.md`), and three of them are the real
  decision: the Merge Gate job has no Node/pnpm toolchain today, so enabling the collector makes a
  **required** check depend on a `pnpm install`; `require('child_process')` collides with
  `workflow-hardening.test.ts:191`; and `workflow-hardening.test.ts:1150` forbids the gate job from
  fetching anything keyed on `pull_request.head.sha`, which is exactly what content equivalence
  needs to read.

- **A `file_scope_lock` is pinned at lane-start, so the scope decision is made before the work is
  understood.** UTV2-1838's declared scope covers three of the five files its own issue names;
  `truth-check-lib.ts` and `lease-registry.ts` are outside it and a lock cannot be widened by an
  agent. Both remaining items are recorded above under "Closeout repeatability" rather than
  smuggled in through an override. This is the routine cost of the lock, not a defect in it — but
  it argues for declaring scope from the issue's own file list at lane-start, which is what
  `ops:scope-suggest` exists for.

- **The orchestrator was returning control at every seam, and every one of those seams was inside
  the mission rather than at its edge.** Ratified by PM on 2026-09-05: waiting on CI, finishing a
  lane or a PR, having a status worth reporting, and receiving a question or correction are all
  *inside* a run, not the end of one. A reserved gate blocks only the work that depends on it. The
  measurable cost of getting this wrong is not a wasted prompt — it is that the independent work
  which never depended on the gate does not get done while the gate is open. This plan is the
  evidence: on 2026-09-05 exactly one item required Griff on the Milestone 1 path, and two live
  production security defects with green `verify` (#1493, #1494) sat unstaffed behind it. The
  authoritative statement is `intent.md` § "Stop conditions"; `CLAUDE.md` carries only a pointer.
  Recorded here, not filed, per the filing threshold.

- **A correction round is where the next defect gets introduced.** Every one of the six adversarial
  review rounds on UTV2-1811's proof bundle closed a defect and introduced at least one new one of
  the same class — a claim about the work that the work did not support. Three were BLOCKING and
  self-inflicted: "never more restrictive" (false in both directions; 26 restrictive divergences in
  a grid of 1314), "cannot let an undefined RPC ship" (the exact inverse — over-marking is the
  parity check's false-negative mode), and a cited "parity fake" that does not exist. **None of the
  defects were ever in the engineering.** The implementation was correct from the first commit and
  never changed; five commits and six rounds were spent making the bundle's *description* of it
  true. The generalization, already filed as a memory: proof values must be generated from the
  artifact, not written about it from recollection — including directional and methodology claims
  wrapped around otherwise correct facts.

- **The OS re-derives diagnoses it has already written down, and that is its dominant hidden cost.**
  On 2026-09-03 the closeout strand was diagnosed from scratch as "a lane can run end to end with
  its Linear state untouched," and the head-pinning tax was measured from scratch as "automated
  ledger commits invalidate every open lane's approval artifacts." **Both were already filed, and
  better.** `UTV2-1730` names the first with reference case UTV2-1451 and classifies it as the
  UTV2-1724 defect class on another limb. `UTV2-1818` names the second with a measured reproducer:
  PR #1476 approved at an exact head, `19a143a27` pushed by the readiness bot fifty seconds later,
  strict freshness making it BEHIND, and the sanctioned sync then moving the proof anchor and
  forcing a *second* head change. Five of six "new" improvements proposed that day already existed
  as issues — `UTV2-1818`, `UTV2-1730`, `UTV2-1529`, `UTV2-1675`, `UTV2-1767`/`UTV2-1769`. The
  backlog is not a record of what is broken; it is a record of what has already been understood and
  will not be staffed, and re-reading it costs less than re-deriving it.

- **An unbounded diagnosis rate against a capped repair rate accumulates monotonically.** 69 issues
  carry `governance-critical`; 39 are open and unstarted. That is not a failure of any individual
  fix — it is the arithmetic of a system that produces correct diagnoses far faster than one lane at
  a time can consume them, which is why the filing threshold and the empty-slot rule in `intent.md`
  are bounds rather than features. Disposition of the existing backlog is a later classified pass,
  never a mass close.

- **A fail-closed control that allocates a resource before classifying the command can deny
  everything, including its own recovery.** `.claude/hooks/pre-proof-validator.sh:21` calls `mktemp`
  on *every* Bash invocation, before it inspects whether the command is even a commit, and exits 2
  when allocation fails. A full `/tmp` therefore denied every Bash call in every session — including
  the `rm` that would clear it — while the hook's actual validation (lines 367-374) only ever runs
  on staged `docs/06_status/proof/*` paths. Cost: an entire session segment, more than any gate
  cost that day. **Repair candidate:** command classification must happen *before* any
  temp-workspace requirement, so ordinary diagnostics and recovery commands can never be globally
  denied by ENOSPC, while actual proof and commit mutations stay fail-closed. The detection step
  writes to stdout and can be captured in a shell variable, so no temp file is needed to decide
  whether the command is in scope. This is an instance of the same aggregate-conflation class as
  `UTV2-1730`/`UTV2-1724` — infrastructure failure and policy refusal reported as one verdict —
  and is recorded here rather than filed, per the filing threshold.

- **Head-pinned governance artifacts should be requested last, not first.** Every commit that moves
  the head invalidates `scope-override/v1`, `t1-approved`, `pm-verdict/v1` and `EXECUTOR_RESULT`
  alike. The reconciliation and the resync on this lane were therefore both landed *before* the
  override was requested, so a single human action binds a head that will not move again. Asking
  first and reconciling after costs the owner one round trip per reconciliation.

- **The bottleneck was never capability.** Every open PR sat green on real safety. Establishing that
  took reading branch protection and a handful of check-run outputs — a question nobody had asked
  mechanically.
- **Opening PRs outside the lane system does not route around the gate; it makes the gate
  unevaluable.** Seven PRs are stuck on "cannot resolve authoritative tier" — a self-inflicted
  block, not evidence that the gate is wrong.
- **A control that fires on everything conveys no information** — but replacing it is an
  architecture decision with a named owner, and building the replacement first does not make the
  decision.
- **Detection is not prevention.** `Direct Main Push Guard` did exactly what it was built to do and
  the push still landed, because `enforce_admins: false`. A red guard run is an incident.
- **A test that drives a function directly cannot see whether the function was called.** Every
  Command Center auth test called `middleware()` and passed; the matcher excluded every dotted path,
  so Next never invoked it and `/picks/abc.def` returned 200 with authentication required. Found by
  measuring a running server, not by reading tests.
- **Stale runtime claims are worse than absent ones.** "Worker DOWN" had been true-shaped for four
  months and was load-bearing in the readiness contract. One deploy log settled it.
- **Concurrent terminals on one checkout produce exactly the drift the lane system prevents.** Three
  sessions, one direct-`main` push, two of them iterating the same branches without knowing it.
