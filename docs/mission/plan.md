# Mission Plan — live

**Owner:** Claude. Rewritten as reality changes. Not a log, not a backlog, not Linear in Markdown.
**Last reconciled against live truth:** 2026-09-06

Answers five questions: what is true now, what is executable, what is blocked, what requires Griff,
and what was learned.

---

## Reconciled current truth (2026-09-06)

Verified against `origin/main`, the GitHub API, branch protection, check-run outputs, the secret
metadata listing and the current readiness ledger. Not against docs or chat history.

- `main` is `3ad11a69b` (re-measured 2026-09-06T20:50Z; this bullet read `7231dc9c7` earlier the
  same day, `175f07c10` before that, and `85f63c696` before that). **Production is
  `d3f69b804`, and there is now zero container-code drift between production and `main`** — see the
  rewritten deploy section below, which replaces the "only Deploy remains" framing this plan carried
  for five days. **No lane manifest is `in_progress` on `main`.** The readiness ledger still writes
  directly to `main` on a schedule, so the tip moves without a PR and every head-pinned artifact on
  an open lane ages against commits that changed no code — measured again on this reconciliation,
  which found #1521 `BEHIND` at a head whose Merge Gate and executor result were both green.
- Branch protection on `main` requires exactly four checks: `verify`, `Executor Result Validation`,
  `Merge Gate`, `P0 Protocol`. `strict: true`. **`enforce_admins: false`**, no push restrictions,
  no rulesets, no required reviews. Unchanged.
- **12 PRs are open** (re-measured 2026-09-06T20:55Z, after #1523 merged; this lane is not yet
  among them). The composition has shifted and the previous "every one is blocked on `Merge Gate`"
  framing no longer holds — #1523 merged cleanly through the ordinary path, which is the first
  end-to-end demonstration since the ratification that an open PR can finish without an
  administrative restart. Current state by class:
  - **Not admissible as a lane at all** (#1429, #1491, #1492, #1495, #1496, #1498) — six, unchanged.
  - **Admissible, awaiting a verdict** (#1451, #1479, #1484, #1505, #1513) — five.
  - **Admissible, blocked on a scope decision** (#1521) — one; see "Requires Griff".
  - **`BEHIND` count: eight of twelve.** #1451, #1479, #1484, #1495, #1505, #1513, #1521 and
    #1523-before-it-merged. This is the head-pinning tax measured directly rather than described:
    the ledger bot and ordinary merges move `main` faster than head-pinned artifacts can be
    obtained.

  The three-way breakdown below was written on 2026-09-06T04:30Z and is retained because its
  diagnoses of the individual reds are still accurate:
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

### Production is `d3f69b804`, deployed 2026-09-06 — and readiness is still RED for reasons that are mostly containment

**This section previously said production was `e48106fc` from 2026-09-01 and that a `Deploy`
dispatch was the one reserved action left on the Milestone 1 path. Both are now false.** The
dispatch happened. What follows is measured against the GitHub API, git ancestry and the readiness
ledger on `main`, not against the previous draft of this file.

#### The deploy ran, failed once on a repo defect, was repaired inside existing authority, and succeeded

| run | SHA | result | when |
|---|---|---|---|
| `34041575531` | `d3f69b804` | **success** | 2026-09-06T15:12:30Z |
| `34031708984` | `391d4345c` | failure | 2026-09-06T11:57:41Z |
| `33513608611` | `e48106fc9` | success | 2026-09-01T13:28:39Z |

The first attempt of the day failed **inside the deploy workflow's own `verify` job**, at *"Run test
suite (dev env — static correctness gate before gate env is written)"*. That was a defect in
`.github/workflows/deploy.yml`, not in the release: UTV2-1841 repaired it, merged as **#1520**, and
the merge commit of that repair **is** `d3f69b804` — the deploy was dispatched nineteen seconds
later and passed.

This is worth recording as a shape, not just an event. A reserved action was attempted, was blocked
by an ordinary repository defect, was diagnosed and repaired through a normal governed lane inside
existing authority, and then completed. The reservation was never the thing that was broken.

#### What is actually live

Both Milestone 1 identity prerequisites are in production, established by ancestry rather than by
recollection:

```
git merge-base --is-ancestor 2ac233424 d3f69b804   # #1488 canonical capper identity     -> yes
git merge-base --is-ancestor b7d9fc07f d3f69b804   # #1501 authenticated picks trace     -> yes
git merge-base --is-ancestor 1734bf201 d3f69b804   # #1477 rate-limit work               -> yes
```

And the gap between production and `main` contains **no container code at all**:

```
git diff --name-only d3f69b804 origin/main -- 'apps/**' 'packages/**' 'deploy/**' \
  | grep -v '\.test\.' | wc -l
0
```

Four commits separate them and every one is ops scripts, lane artifacts, proof bundles or docs.
`d3f69b804` itself changed only `.github/workflows/deploy.yml` and its own lane artifacts, which is
why the deploy that shipped it altered no running image beyond the two behaviours above.

#### Readiness is RED, and the distinction that matters is containment versus breakage

`docs/06_status/readiness/readiness-score.json`, generated 2026-09-06T19:54:20Z from run
`34056303418`, records `"verdict": "RED"` and `"observability": "degraded"`. Five blocking
dimensions are not passing, and **they do not mean the same kind of thing**:

| Dimension | Status | What it actually means |
|---|---|---|
| `deploy_sha_alignment` | fail | **Bookkeeping, not drift.** `commits_ahead: 1` at generation time. It compares SHAs, and zero container-code files differ. |
| `ingestor_health` | fail | **Containment.** `SYNDICATE_MACHINE_MODE=parked` sets `UNIT_TALK_INGESTOR_AUTORUN=false`; the last cycle is from 2026-06-30 because ingestion is deliberately off. |
| `worker_outbox_health` | fail | **Containment.** Same mechanism — `UNIT_TALK_WORKER_AUTORUN=false`. The heartbeat is 29944m old because the worker is not autorunning. 32 rows sit `bucket:stale_unknown`, 0 attempted-and-stuck. |
| `dead_letter_count` | fail | **1953 of 1954 rows are `bucket:governance_hold` with `attempt_count=0`**, which `QUEUE_READINESS_SEMANTICS.md` v1.0 says do not fail readiness. Exactly **one** row is `bucket:true_failure`. |
| `db_tripwires` | unknown | The observer itself is red (`db-health-tripwire.yml` run `34055734941` failed at *Report DB health verdict*), so tripwire state is **unproven**, correctly not scored as passing. |

**The structural consequence, stated plainly: readiness cannot reach GREEN while containment
holds.** Two blocking dimensions measure precisely the flags containment sets to `false`. That is
not an argument for unparking anything — containment is reserved, and Milestone 1 is defined to
complete with it intact. It is an argument against reading this ledger's verdict as a statement
about whether the product works. The ledger measures a system running at full autonomy; the system
is deliberately not running at full autonomy.

**The one row that is not containment is the `true_failure` dead-letter row — and it was read, and
it is not a delivery failure either.** Measured read-only against production Supabase on
2026-09-06:

```
id           c60ec49b-c1b0-4b60-aea8-640a5daa07b7
target       discord:canary
attempt_count 1
created_at   2026-07-14T12:59:44Z    updated_at 2026-07-15T19:00:30Z
last_error   proof-pick-blocked: source 't1-proof' is not a live source
```

That string is emitted by `apps/worker/src/distribution-worker.ts:212-213`, which blocks any pick
whose `source` is not in `LIVE_SOURCES` from delivery. **The guard fired and won.** It marked the
row dead-letter, recorded its own run as `status: 'succeeded'`, and wrote a `distribution.blocked`
audit entry (`:214-236`). All 1 of 1 `true_failure` rows carry that error.

Two things follow, and they matter in opposite directions:

- **This strengthens the Milestone 1 step 6 position rather than weakening it.** The only
  real-looking delivery failure in production is the delivery guard refusing a T1 proof fixture. It
  is direct evidence of a non-delivery control working against live data, from before this mission
  began. It does not by itself prove Track Only non-delivery — that guard is a different one — but
  the table holds no unexplained delivery failure that a non-delivery claim would have to account
  for.
- **`dead_letter_count` misclassifies it.** `readiness-refresh.ts:517-532` buckets purely on
  `attempt_count`: `= 0` is `governance_hold`, `> 0` is `true_failure`. A guard that refuses on the
  first attempt increments the counter, so **a successful policy refusal is counted as a true
  delivery failure** and fails a blocking readiness dimension. This is the third recorded instance
  of the aggregate-conflation class — after `UTV2-1730`/`UTV2-1724` and PT1's `infra_error`
  reporting of a documented containment state. Recorded here rather than filed, per the filing
  threshold; the bucketing needs a reason predicate, not an attempt count.

Three non-blocking dimensions also fail: `pnpm_verify` (main HEAD has no completed CI result of its
own — an artefact of the ledger bot committing to `main`), `scheduled_observer_health` (four
observer workflows red, which are observer failures rather than product failures), and
`proof_coverage` (71/72; UTV2-1822 unbound).

**The readiness contract's "worker DOWN" line (dated 2026-04-30) remains stale as a statement of
capability.** The worker is deployed; its autorun is deliberately off.

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
| Authenticate | **Live.** Google OAuth via Auth.js v5, allow-list gated on `ALLOWED_CAPPER_EMAILS`; the secret was reshaped 2026-09-03T17:29Z and #1488's parser shipped 2026-09-06. Both halves are now in production together. **Untested against a real sign-in** — nothing in the deploy validates the allow-list's shape, so this step is live-but-unproven, not done. |
| Resolve canonical identity as `griff843` | **Live.** #1488 (`2ac233424`) is an ancestor of the deployed `d3f69b804`, verified by `git merge-base --is-ancestor`. Local-part derivation is gone. Same caveat as above: proven present, not yet exercised. |
| Submit + persist a real internal Track Only pick | **Implemented, but blocked in the deployed flow.** `trackOnly` defaults to `true` in both `apps/smart-form/lib/form-schema.ts` and `BetForm.tsx`, and `parked` does not stop capper submission. But a structured-fallback submission still 422s on the event-existence gate, so a real pick cannot currently be submitted end to end. **This is the Milestone 1 blocker**, tracked as UTV2-1842 — see below. The UI half landed as UTV2-1844 (#1523). **Canonical reference-data coverage is not a precondition** — honest structured or manual `canonical-coverage-gap` provenance is acceptable for this contained pilot. |
| Prove Track Only cannot create member delivery | **Built, mutation-tested, and deployed.** UTV2-1672 (`6a8eface9`) is an ancestor of the running `d3f69b804`, re-verified 2026-09-06: the submit-time pin, direct-enqueue guard, retry guard, requeue guard, outbox chokepoint, atomic-RPC chokepoint and recap exclusion each have a test that fails when the guard is removed. What remains is *observing* it during the pilot — a run, not a build. |
| Observe through an internal/operator path | **Not blocked.** A safe read-only internal observation — the pick's persisted `capper_id`, `metadata->>'distributionMode'`, provenance and the absence of any outbox row — satisfies this step. Deploying the Command Center (#1496) is desirable product work tracked on its own merits and is **not** a Milestone 1 gate; no `COMMAND_CENTER_*` secret is a prerequisite. |

### Containment during the pilot

Paid provider ingestion, provider activation or purchase, system picks
(`SYNDICATE_MACHINE_MODE=parked`) and member-facing delivery — including every deferred delivery
target — all remain parked for the duration of Milestone 1 and as a condition of it being
considered done. The last `Deploy` run verified `{"event":"syndicate_machine_mode.validated",
"mode":"parked"}` and re-read each value out of the running container. Nothing in the pilot may
unpark any of them.

### The identity blocker is closed. The submission blocker is not.

**The identity work is done and live.** #1488 requires each allow-list entry to carry its canonical
ID explicitly, refusing anything not already canonical rather than repairing it:

```
ALLOWED_CAPPER_EMAILS = <email>=<canonicalCapperId>[, <email>=<canonicalCapperId>]
```

`<canonicalCapperId>` must match `^[a-z0-9][a-z0-9_-]*$`; an entry with no `=` is dropped and does
**not** fall back to the local part. The secret was reshaped 2026-09-03T17:29Z and the parser shipped
2026-09-06 in `d3f69b804`. Both halves are in production together, which is the pairing this section
spent five days warning about.

**The actual address and mapping are not recorded here or anywhere else in the repository.** They
live only in the sanctioned secret store. Mission docs name the secret and its required shape; they
never carry its value.

What is *not* established is that the value is correct — see the allow-list gap above. The deploy
validated it non-empty and nothing validated its shape, so the first real test is a sign-in.

**The blocker underneath it is UTV2-1842**, and it was always there; the deploy is what made it
visible. A structured-fallback submission 422s on the event-existence gate
(`checkEventExistenceGate`, `apps/api/src/submission-service.ts:867`, called at `:203`), so Griff
cannot complete step 4 even with a perfect sign-in. That path is a Tier C exact path, so
`classifyMechanicalMinimum` returns a `T1` floor and the work cannot be reclassified down.

And UTV2-1842 cannot currently open a lane at all. `ops:preflight` PT1 pings live Supabase and, under
containment, `local.env` points every client at `http://127.0.0.1:1` by design. PT1 reports that
deliberate policy state as `infra_error`, which maps to verdict `INFRA`, so no preflight token is
written and `lane-start` refuses. PT1 runs only at T1 and is waivable at no tier. The full analysis,
two routes and a recommendation are in **`docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md`**
(merged `9a233bd90` under UTV2-1845). Part 1 — classifying the containment placeholder as
`blocked_by_containment` rather than `infra_error` — has landed and makes the refusal *honest*; it
deliberately does not make it stop refusing, because admitting the lane is an admission-policy change
and that is reserved.

**This is Wave 0 item 1 and the one thing on the Milestone 1 critical path.**

## Execution waves

Production-first. The waves are a dependency ordering, not a queue: work in a later wave that
does not depend on a reserved item proceeds immediately and in parallel.

**A reserved gate blocks only the action it reserves.** It does not block the mission, and it does
not block unrelated safe production work. Nothing in this plan should be read as "everything is
waiting on Griff" — at any moment most of the board is independent of every open reserved item.

### Wave 0 — reserved actions (Griff only)

**Nothing in this table is on the Milestone 1 critical path.** That is new as of 2026-09-06 and it
is the single most important change in this reconciliation.

| # | Action | Why reserved | What it actually blocks |
|---|---|---|---|
| 1 | Decide **UTV2-1842's backend admission** — route A0 or B in `docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md` | Route A0 is a bounded secrets action (reserved decision 4); route B is an admission-policy change | Milestone 1 steps 4–5. This is now the Milestone 1 blocker. |
| 2 | Approve **#1484** (`pm-verdict/v1`) — canonical reference bootstrap | Merge authority | #1484 only. Not a Milestone 1 gate. |
| 3 | Review **#1491 / #1492** as an architecture decision — not as engineering to resume | Merge authority | Those two PRs only. Explicitly not the mission. |
| 4 | Decide the direct-`main` prevention control (`enforce_admins`, a ruleset, or a `pre-push` hook) | Branch protection | Nothing. The prohibition is already in force; what is reserved is the mechanical enforcement. |
| 5 | Any production containment change (`parked` → `active`) | Containment | Nothing in Milestone 1 — the milestone is explicitly defined to complete with containment intact. |

**Four items left this table by being done, not by being deferred.** The newest is the one that
mattered most:

- **The `Deploy` dispatch — completed 2026-09-06T15:12:30Z, run `34041575531`, shipping
  `d3f69b804`.** It stood at the head of this table for five days and was described here as the only
  remaining reserved action on the Milestone 1 path. It is done, and the Milestone 1 path did not
  open, which is what surfaced UTV2-1842 as the real blocker underneath it.
- The former item 1 before that — reshape `ALLOWED_CAPPER_EMAILS` — was completed by Griff on
  2026-09-03T17:29Z.
- The former item 3 — decide #1477 — was resolved: the standing `CHANGES_REQUIRED` was answered by
  correcting the proof bundle rather than the implementation, and #1477 merged at `1734bf20` on
  2026-09-05T01:43Z.
- The former item 4 — approve #1501 (UTV2-1823) — was approved and merged at `b7d9fc07` on
  2026-09-03T19:26Z. The anonymous `GET /api/picks/{id}/trace` exposure that would have leaked the
  pilot's own pick is closed in code, though not yet in production, which is downstream of item 1.

Command Center secrets are **not** in this table. They are not a Milestone 1 prerequisite; see
`intent.md` § "Step 7 — observation path".

### The deployment decision packet — closed 2026-09-06, kept for what it got right and wrong

This packet existed to prepare a reserved decision. **The decision was taken and the action
completed**, so it is retained here only as a record, and trimmed to the parts that are still load-
bearing. It is no longer something Griff has to read before acting.

**What the packet got right.** It insisted on measuring the release rather than describing it, and
the measurement held: the release really did contain exactly two container-code changes (#1488
canonical identity, #1501 authenticated trace), the Command Center really was in no compose service
and behind no Caddy route, and there really was no DDL prerequisite — `deploy.yml` runs no migration
step, and `rate_limit_buckets` plus `consume_rate_limit_bucket(...)` already existed in production.
All three still check out.

**What it did not anticipate.** It framed the risk entirely as *a bad `ALLOWED_CAPPER_EMAILS` value
shipping green*. The deploy that actually failed failed for a different reason — a defect in the
deploy workflow's own `verify` job — and no part of this packet was watching for that. The
generalisable point is that a decision packet which enumerates the risks of *the change* can still
miss the risks of *the mechanism that applies the change*.

#### The allow-list gap is still open, and is now the live Milestone 1 risk

Nothing in the deploy validates the **shape** of `ALLOWED_CAPPER_EMAILS`; it is checked non-empty at
three layers and shape-validated at none (`deploy.yml:100`, `:486`/`:974`, and
`deploy/production/nextjs-entrypoint.sh:28-31`). `scripts/deploy-check.ts` does not reference it.
The parser (`apps/smart-form/lib/auth-allowlist.ts:43-66`) **silently drops** any entry lacking `=`
or failing `^[a-z0-9][a-z0-9_-]*$`, with no fallback and no log, so an all-malformed value yields an
empty allow-list and `signIn` returns `false` for everyone.

The `smart-form` healthcheck is `curl -fsS localhost:4400/login`
(`deploy/production/docker-compose.yml:223`), which returns 200 regardless of allow-list contents,
and the `smoke` job only asserts `localhost:4000/health == 200`. **So the deploy reported healthy
without ever exercising the allow-list.** Whether the value is right is still unknown, and
Milestone 1 step 2 — Griff's own browser — remains its first real test. That is now an *immediate*
question rather than a prospective one, because the code that reads it is live.

The one-command local check remains the cheapest way to answer it before spending a browser attempt:

```
ALLOWED_CAPPER_EMAILS='<value>' pnpm exec tsx -e "import {parseAllowedCapperEmails} from './apps/smart-form/lib/auth-allowlist.ts'; const r=parseAllowedCapperEmails(process.env.ALLOWED_CAPPER_EMAILS); console.log('entries:', r.length, 'ids:', r.map(x=>x.capperId).join(','))"
```

Non-secret success criterion: prints `entries: N` with `N >= 1` and `ids:` containing `griff843`. No
email address is printed and no value leaves the machine.

#### Rollback, if it is ever needed

`deploy/rollback.sh:71-79` restores `.env.production`, `.env.web` and `.env.smart-form` from the
per-tag configuration snapshot and warns explicitly when no snapshot exists, so a rollback after a
bad allow-list restores the old-shaped value alongside the old parser (UTV2-1834, #1507). UTV2-1835
(#1511, `ce3b87bf8`) closed the remaining gap where a failed retry could capture the failed
attempt's configuration over the running release's, via a `.unit-talk-deploy-inflight` marker —
which matters precisely because the documented recovery from a bad allow-list *is* a same-tag
redeploy.

There is still **no automatic rollback**: `ROLLBACK_TAG` is an optional, empty-by-default dispatch
input (`deploy.yml:10-13`), and a failed health loop just fails the job with production on the new
tag. Rollback images resolve at the full 40-char tag for every service.

### Wave 1 — Smart Form Track Only pilot (Milestone 1)

**Every code and secret prerequisite is now deployed.** #1488 (canonical identity, `2ac233424`),
#1501 (authenticated `GET /api/picks/{id}/trace`, `b7d9fc07f`) and #1477 (`1734bf201`) are all
ancestors of the running `d3f69b804`, and `ALLOWED_CAPPER_EMAILS` was reshaped on 2026-09-03T17:29Z.

**The previous draft of this section said one `Deploy` dispatch was all that stood between `main`
and a runnable pilot. That was wrong, and the deploy is what proved it wrong.** The dispatch
happened; the pilot still cannot complete, because step 4 — submit a real Track Only pick — 422s on
the event-existence gate before it ever reaches persistence.

So the sequence is now:

1. **Decide UTV2-1842's admission** (Wave 0 item 1). Route A0 or B in
   `docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md`. This is the only reserved item on the
   path.
2. **Land UTV2-1842's server half.** The client half is already on `main` — UTV2-1844 (#1523,
   `b5ee99e17`) delivered signed odds and line entry and the three-valued identity mode.
3. **Verify the combined flow before release**: browser → API → persisted pick, covering stale
   events, signed odds and spread lines, canonical team fallback, honest missing coverage, and
   Track Only non-delivery. This is not covered today — the four `apps/smart-form/e2e/` specs are
   run by no CI workflow, and `playwright.config.ts` starts only `pnpm dev` on `127.0.0.1:4100`
   with no API process while the client posts to `127.0.0.1:4000`. Wiring it needs a lane that
   declares `package.json` in its `file_scope_lock`.
4. **Then run the pilot itself as one lane**: reach the form, authenticate, resolve `griff843`,
   submit a real internal Track Only pick, assert persistence, observe the Track Only guards holding
   during the run, and observe the result through a safe read-only internal/operator path.
   Containment stays parked throughout.

Step 4 is still the deliverable that has never been attempted end to end. Steps 1–3 are what the
deploy revealed sit in front of it.

#1477 is **not** a Milestone 1 dependency; it is unrelated rate-limit DDL and is sequenced on its
own merits.

### Wave 2 — CLV / data truth

| PR / work | State |
|---|---|
| #1479 null-stake computation truth | **`verify` is green** (re-measured 2026-09-05T22:10Z; the earlier "red" is stale). Only `Merge Gate` fails, so what it needs is an approval artifact, not a repair. This plan states no verdict on it. |
| #1451 June offer-history partitions | `verify` red; production DDL; PM-gated |
| #1484 canonical reference bootstrap | `verify` green; needs a verdict (Wave 0 item 2) |
| **The one `true_failure` dead-letter row** | **Read 2026-09-06 — done, and it was not a delivery failure.** It is the `proof-pick-blocked` guard refusing a `t1-proof` fixture to `discord:canary`, with its own run recorded `succeeded`. See the readiness section above. What remains is the *bucketing* defect it exposed in `readiness-refresh.ts:517-532`, recorded rather than filed. |
| Closing-line truth | Not yet a branch |

### Wave 3 — Command Center

**This is one of two executable fronts while Wave 0 item 1 is outstanding**; the other is the
Smart Form work in Wave 1 steps 2–3, which is product work on the Milestone 1 path itself and
outranks this. #1493 (dotted-path auth
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

**The slot is empty.** UTV2-1688 — the executor-result namespace repair described under the
`WORK-###` correction above — held it and **merged as #1519 (`949459fea`) on 2026-09-06T07:26Z**.
It was chosen for a reason worth recording: it was not new debt. Filed 2026-08-09, PM-authored and
already tier-labelled, and until it landed it made every `bootstrap/` lane permanently unmergeable
without an admin bypass. Staffing an existing canonical issue that blocks merges outranks opening a
fresh one.

Leaving the slot empty now is deliberate and correct per the ratified policy: the Milestone 1 path
has a live blocker (UTV2-1842) and the Smart Form work is product work, not governance work.

**UTV2-1840** held the slot before it and merged as #1518 (`e4dcb59ee`), moving a repo-minted
`WORK-###` task from *cannot start* to *cannot finish*; UTV2-1838 as #1517 (`3eea8f258`, closeout
made safe to repeat); UTV2-1836 before that (the carry-forward evidence collector and the reserved
Merge Gate integration diff); UTV2-1830 as #1502 (`1cb31a43e`); UTV2-1829 as #1499 (`d70df077`).
RMA is an architecture review, not a governance lane.

Per the ratified debt policy in `intent.md`, **the slot is a ceiling, not a quota, and may stand
empty.** After this lane closes it is deliberately left unstaffed: the closeout defects below are
survivable by hand, the Command Center auth exposures are not, and production security work does
not consume this slot. The strongest current candidates when the slot is next spent are the
`pre-proof-validator` classification repair recorded under Learned, and the lease-reclaim
terminality gate — now at **four** recorded occurrences, UTV2-1830, UTV2-1835, UTV2-1838 and
UTV2-1840, the last of which refused UTV2-1688's lane start from a lease whose lane was already
`done` on `main`.

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
- **A lane can run start → merge with its Linear state never moving, and only closeout notices.**
  `truth-check` L3 refuses a lane whose issue is in an `unstarted` state. Nothing earlier checks
  it — preflight, `verify`, ERV, Merge Gate and the merge itself all pass — so the first signal is
  `post-merge-lane-close.yml` going red *after* the code is on `main`. Observed on UTV2-1838
  (`Ready for Claude`) and previously on UTV2-1824 (`Backlog`). Recovery is a state change plus a
  replay, ~4 minutes, no code change. This is also a precise measurement of the cutover's shape:
  L1/L3/L4/C1/C7 skip when `tracker_ref` is **null**, not when the tracker is merely *stale*, so a
  present-but-unmoved tracker remains a hard closeout dependency.
- **A merged, truth-closed lane leaked its lease for the third recorded time.** UTV2-1838 closed at
  `3eea8f258` with its `.ops/leases/UTV2-1838.json` still `active`, `owner_pid: null`, TTL to
  2026-09-08, which refused the next lane on the same files with `lease_conflict`.
  `pnpm ops:lease release --issue <ID> --actor claude --reason "<why>"` is the working path; both
  flags are required and their absence reports `lease_missing_required_fields` rather than usage.
  Reclaim stays TTL-gated, so a provably finished lease is still unreclaimable for 48 hours.
- **`preflight` PL3 and `truth-check` L3 are inverses, and only `lane-start` may cross between
  them.** PL3 refuses to issue a token when the issue is in a *started* state (`issue state In
  Claude is not startable`); L3 refuses closeout when it is in an *unstarted* one. So the obvious
  defence against the L3 failure recorded above — set the state before opening the lane — makes the
  lane unopenable, and `lane-start` will not run without a validated token. Measured on UTV2-1688,
  2026-09-06: two full ~4-minute preflight runs, one to discover it and one to undo it. The tracker
  is a hard dependency at *both* ends of an ordinary lane, and the two ends disagree about what it
  must say.

- **`--files` and `PG2` deadlock on any file the lane will create.** `ops:lane-start --files`
  refuses a path that does not exist yet; pre-creating it then fails preflight `PG2` (*working tree
  is not clean*). Only a **trailing** `/**` glob is legal in a scope declaration, so the only way
  out is to widen the lock to the whole directory — `scripts/ops/**` on this lane, where the actual
  change was three files. `file_scope_lock` is pinned at lane-start and an agent cannot narrow it
  afterwards either, so the cost is paid as permanently looser scope than the work needed.

None of these are risk controls. Every one is administrative.

### Exit conditions

Per `intent.md`, the cutover closes when all five hold, demonstrated rather than asserted:

1. A representative ordinary task can complete without Linear.
2. Optional tracker failures cannot block it.
3. Reserved-risk changes still require appropriate approval.
4. Fresh and compacted sessions recover the mission and current plan.
5. Existing PRs can finish without administrative restarts.

Then the capacity returns to product work.

**Measured 2026-09-06 — where the five actually stand.** The workstream is *not* complete, and it
is not complete for reasons that are now specific rather than general:

| # | State | Evidence |
|---|---|---|
| 1 | **Advanced, not closed** | A repo-minted `WORK-###` task could not *open* a lane: a credential-free `ops:preflight WORK-902` reported `PE2 skip` and `PL1 skip` — every tracker check correctly optional — and then **`PX2 fail`**, because `branch-discipline-guard.ts` kept a private copy of the identifier alternation never widened when `WORK-###` was minted, and `lane-start` refuses without a validated preflight token. UTV2-1840 repairs that; the same probe now reports `PX2 pass`. **It does not make the rest of the lifecycle `WORK-###`-clean** — see the enumeration below. |
| 2 | **Holds** | The credential-free probe reaches a verdict at all: `PE2`/`PL1`-`PL5` degrade to `skip`, not `fail`. |
| 3 | **Holds, unchanged** | Nothing in this workstream has touched merge authority, the merge gate, CODEOWNERS or branch protection. Items 8–11 of the change set remain RESERVED and unimplemented. |
| 4 | **Demonstrated but not yet proven mechanically** | This session recovered mission and plan across a compaction, but no test asserts it. |
| 5 | **Demonstrated twice on 2026-09-06** | #1522 (UTV2-1845) merged `9a233bd90` and #1523 (UTV2-1844) merged `b5ee99e17`; both post-merge closeouts concluded `success` on the first attempt, with no replay, no state repair and no manifest repair. Both lanes had their tracker state moved *before* closeout rather than after it, which is what avoided the `truth-check` L3 failure recorded below — so this demonstrates the lifecycle works when the tracker is correct, not that it works without one. |

**Where `WORK-###` still fails, enumerated rather than assumed.** `grep -rn "UTV2|UNI" scripts/
.github/` returns **22 sites** carrying the narrow alternation. They are not equivalent, and the
distinction is what says how much of exit condition 1 is left:

- **Deliberately narrow, correct as written (1).** `shared.ts:415` `TRACKER_REF_PATTERN`, with the
  comment *"A tracker key is a Linear issue identifier. `WORK-###` is deliberately NOT one."* This
  one must stay.
- **Hard refusals that would block a `WORK-###` lane after it opens (2).**
  `executor-result-validate.ts:109` pushes `Invalid Issue ID … Must match UTV2-NNN or UNI-NNN`.
  `proof-rebind.ts:1652` refuses with `proof_rebind_refused`; that one is a path-traversal guard on
  a value used as a directory segment, so it must be widened carefully rather than relaxed.
  **Corrected 2026-09-06 (UTV2-1688): the first of those two is not the required check, and the
  parenthetical "and ERV is a *required* check" made it read as though it were.** See the
  correction below — `executor-result-validate.ts` is reached by nothing but its own test file.
- **Soft degradations (2).** `proof-schema.ts:326` returns `unverified` and
  `proof-binding-validator.ts:150` returns a null binding context. Neither hard-fails; both quietly
  stop verifying, which is its own problem.
- **Discovery and reconciliation, non-blocking (5).** `queue-lib.mjs`, `lane-maximizer.ts`,
  `orchestration-reconciler.ts`, `truth-check-lib.ts:2613` (cross-issue commit scanning, which
  simply would not see a `WORK-###` reference).
- **Reserved surfaces, deliberately untouched (7).** `merge-gate.yml:244`,
  `executor-result-validator.yml:206`, `p0-protocol.yml:53`, `tier-label-check.yml:38,119`,
  `tier-label-apply.yml:90`, `merge-gate-verdict.cjs:30`. These are cutover items 8–11 and remain a
  PM decision on merge authority.

So exit condition 1 moves from *"a `WORK-###` task cannot start"* to *"a `WORK-###` task cannot
finish"*. **The cutover does not close because a helper merged** — 4 and 5 still require
demonstration, and the tracker remains a hard dependency at closeout (`truth-check` L3, above) for
any lane that *has* a tracker ref at all.

**Corrected 2026-09-06 (UTV2-1688): "the two hard refusals above are the next non-reserved step"
was wrong about the first of them, and the error matters because it mislocates the whole exit
condition.** PR A below names `scripts/ops/executor-result-validate.ts:133-158` as its
*"highest-value hunk: without it no branch reaches a green `Executor Result Validation` without a
`UTV2-###`."* Measured on `main` `66fb0d6a2`, `grep -rn "validateExecutorResultFields"` across the
repository returns exactly two consumers — its own definition and
`scripts/ops/executor-result-validate.test.ts`. The script's only CLI command is
`resolve-check-name`, which is all `executor-result-validator.yml:103` invokes it for.

**The required check validates fields from an inline duplicate**, at
`.github/workflows/executor-result-validator.yml:206-223`, inside an `actions/github-script` block
that cannot import a TypeScript module. Taking PR A's script hunk would change what the unit tests
assert and nothing whatsoever about what can merge.

This was diagnosed and filed on 2026-08-09 as **UTV2-1688**, which states it in as many words:
*"The copy that actually gates merges is the one inline in the workflow. Fixing only the script
would make the tests pass while the gate stayed broken."* Re-deriving it here cost a repository
sweep that reading the issue would have answered — the cost `Learned` already names, paid again.

Two consequences, and they point in opposite directions:

- **Exit condition 1 cannot be closed by ops-script work.** The identifier the required check
  admits is defined inside a required-check workflow, so widening it for a repo-minted `WORK-###`
  identity is a change to what a required check requires, and stays reserved with items 8–11.
- **The `bootstrap/` half of the same defect was never reserved and was never staffed.** UTV2-1688
  is PM-authored, already `tier:T2`, and its acceptance criteria explicitly exclude any change to
  required-check configuration, branch protection or bypasses. It widens which namespaces are
  legal while leaving every binding rule — `Branch:` equals the PR head ref, the declared PR equals
  the actual PR, the declared head SHA equals the current head — untouched. Until it landed, every
  `bootstrap/` lane was permanently unmergeable without an admin bypass, because the required
  context is created only by an EXECUTOR_RESULT comment and no valid one could be written.

  The lane also closes the drift itself rather than only its current symptom:
  `EXECUTOR_RESULT_ISSUE_ID_RE` and `EXECUTOR_RESULT_BRANCH_RE` are exported from the script, and
  the test suite now reads `executor-result-validator.yml` and asserts both inline literals are
  byte-identical to them. Mutation-checked three ways — reverting the script copy alone, reverting
  the workflow copy alone, and deleting the `Branch: == head ref` binding each turn a distinct
  assertion red. The second of those is the one that matters: before this lane, reverting only the
  copy that gates merges was invisible to every test in the repository.

**A new test file cannot be added without editing `package.json`, and that is a scope trap.**
`pnpm verify` fails closed with `WIRING_TEST_UNWIRED_NEW` on any `*.test.ts` not reachable from a
package script or workflow command, and the only wiring point is the `test:ops` script in
`package.json`. A lane that did not declare `package.json` at lane-start therefore cannot add a test
file at all: `file_scope_lock` is pinned and an agent cannot widen it. UTV2-1840 hit this and
resolved it by putting the eight tests in the already-wired `scripts/ops/shared.test.ts` — defensible
here, since the contract under test *is* that module's exported namespace list, but it is not a
general answer. **Declare `package.json` in the scope of any lane that may add a test file.**

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

### The reserved `WORK-###` executor-result diff — prepared, not applied (UTV2-1688)

Per `intent.md` § "How a reserved decision is surfaced": the dependent work is staged and verified
as far as existing authority allows, and one recommendation is stated with its exact inputs.

**What is already done and needs no decision.** UTV2-1688 widened both copies of the
executor-result field validation to recognize `bootstrap/`, and made the duplication self-policing:
`EXECUTOR_RESULT_ISSUE_ID_RE` and `EXECUTOR_RESULT_BRANCH_RE` are exported from
`scripts/ops/executor-result-validate.ts`, and two tests read
`.github/workflows/executor-result-validator.yml` and assert its inline literals are byte-identical
to them. Reverting **only** the workflow copy now fails the suite; before, nothing caught it.

**What is reserved.** Admitting a repo-minted `WORK-###` identity into a *required* check changes
what that check requires. That is reserved decision 7, and it is cutover items 8–11. The change is
two words:

```diff
-export const EXECUTOR_RESULT_ISSUE_ID_RE = /^(UTV2|UNI)-\d+$/i;
-export const EXECUTOR_RESULT_BRANCH_RE = /^(claude|codex|bootstrap)\/(utv2|uni)-\d+/i;
+export const EXECUTOR_RESULT_ISSUE_ID_RE = /^(UTV2|UNI|WORK)-\d+$/i;
+export const EXECUTOR_RESULT_BRANCH_RE = /^(claude|codex|bootstrap)\/(utv2|uni|work)-\d+/i;
```

plus the byte-identical edit to the inline copy at `executor-result-validator.yml:216,223`, which
the drift tests already force to happen together. The error strings widen to name `WORK-NNN`.

**What it does and does not do.**

- It does **not** make an absent issue ID pass. Every executor result still declares an identifier,
  and the `Branch:` value must still equal the PR head ref, the declared PR must still equal the
  actual PR, and the declared head SHA must still equal the current head. This is the specific line
  #1492 crosses and this diff does not: #1492 makes an ID-less branch legal, which is a different
  and larger decision.
- It does **not** touch required-check configuration, branch protection, CODEOWNERS, the merge gate,
  tier semantics or approval policy.
- It admits an identifier the repository *already mints* — `shared.ts` `BRANCH_PATTERN` has accepted
  `work-\d+` since UTV2-1837, and `ISSUE_ID_NAMESPACES` since UTV2-1840.

**What it still would not close.** Exit condition 1 also needs `proof-rebind.ts:1652`
(non-reserved; a path-traversal guard, widen carefully) and the closeout gates. This diff removes
the *required-check* blocker, not the last blocker.

**Recommendation:** approve it as a bounded namespace widening. Non-secret success criterion — after
it lands, a `WORK-###` lane's EXECUTOR_RESULT comment produces a green `Executor Result Validation`,
and the three controls in `executor-result-validate.test.ts` (head-ref mismatch, PR mismatch, stale
head SHA) still fail on the conditions they name. Both are mechanical and already written.

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

1. **Decide UTV2-1842's backend admission.** Route **A0** (export staging credentials for one
   preflight invocation — no code change, unblocks the lane today, a bounded reserved-decision-4
   secrets action) or route **B** (Part 1 + Part 2 — admit with a recorded, closeout-enforced
   deferral, which unblocks every future T1 lane opened from a contained workstation). The packet
   recommends **A0 now, B as the durable fix**, and is written in full at
   `docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md` (merged `9a233bd90`). Route A — Part 1
   alone — has already landed and makes the refusal honest without lifting it.

   **This is not bookkeeping and must not be presented as such.** Changing PT1's classification
   from `infra_error` to `skip` would change lane *admission* behaviour, which is execution
   authority under `intent.md` § "Changes to the operating model". Part 1 was deliberately scoped
   to avoid that: `blocked_by_containment` still resolves to verdict `INFRA` exactly as
   `infra_error` does, asserted with two controls, so no lane opens that could not open before.

   Blocks Milestone 1 steps 4–5. **Nothing else on the board waits on this.**
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

9. **The `WORK-###` executor-result namespace diff** (UTV2-1688) — reserved decision 7. Two words
   in two byte-identical regex literals, one of them inside a required-check workflow. Blocks
   nothing that is running today; it blocks cutover exit condition 1. Prepared in full above under
   "The reserved `WORK-###` executor-result diff", with its controls already written and its
   non-secret success criterion stated. The `bootstrap/` half of the same defect needed no
   decision and has landed.

**The `Deploy` dispatch left this list on 2026-09-06 by being done** — run `34041575531`,
`d3f69b804`, 15:12:30Z. It had been item 1 for five days.

Items that left on 2026-09-05 by being done: the `ALLOWED_CAPPER_EMAILS` reshape; the #1477 decision
(resolved by correcting the proof bundle, merged `1734bf20`); the #1501 approval (merged
`b7d9fc07`); and the #1499 scope override (merged `d70df077`). #1493 also left it — it was never
actually a Griff-reserved item, only an unadmitted PR, and it is now Wave 3 executable work.

**One item is outstanding and is not on the Milestone 1 path: a `scope-override/v1` on #1521**
(UTV2-1843, Smart Form product-intent consolidation). Its four required checks were green, but its
`File scope lock` is red because the diff adds `apps/api/CLAUDE.md`, `apps/smart-form/CLAUDE.md` and
`docs/03_product/**` to `.lane/lanes/governance.yml` — genuinely outside its own pinned lock. That
is a real scope question, not the review-packet defect, and "non-required check" is not
authorization to merge past it. The PR has since gone `BEHIND`, so per the head-pinning rule it
should be resynced and reconciled *before* the override is requested, not after.

---

## Learned

- **Clearing the last reserved item on a path does not mean the path is clear — it means the next
  blocker becomes visible.** This plan said for five days that a single `Deploy` dispatch was all
  that stood between `main` and a runnable Milestone 1 pilot. The dispatch happened on 2026-09-06
  and the pilot still cannot complete, because step 4 fails on the event-existence gate. The
  statement was not a lie; it was a claim about *what was known to be in the way*, phrased as a
  claim about what was in the way. Those are different, and the difference only shows up when the
  named item is removed. The honest form is "this is the next blocker", never "this is the only
  one" — a plan can enumerate what it has measured and cannot enumerate what it has not.

- **A reserved action can be blocked by an ordinary repository defect, and that is not a reason to
  escalate.** The first `Deploy` dispatch of 2026-09-06 failed inside the deploy workflow's own
  `verify` job. Nothing about the reservation was the problem. UTV2-1841 diagnosed and repaired
  `.github/workflows/deploy.yml` through a normal governed lane, merged as #1520, and the deploy at
  that very commit succeeded nineteen seconds later. The generalisation for the decision-packet
  format: a packet that enumerates the risks of *the change* can still be blind to the risks of
  *the mechanism that applies the change*, and this one was — it was watching the allow-list value
  exclusively.

- **A RED readiness verdict is not a statement that the product is broken when two of its blocking
  dimensions measure flags that policy sets to false.** `ingestor_health` and `worker_outbox_health`
  fail because `SYNDICATE_MACHINE_MODE=parked` disables their autorun, which is containment working
  as designed. `deploy_sha_alignment` fails on a 1-commit SHA distance with zero container-code
  files differing. `dead_letter_count` fails on 1954 rows of which 1953 are governance holds the
  ledger's own semantics exclude. **Readiness cannot reach GREEN while containment holds** — which
  means the verdict is currently measuring the gap between the contained system and a fully
  autonomous one, not the gap between the system and working. That is worth knowing before anyone
  reads RED as a reason to unpark something. It is not one.

- **Non-required checks are not interchangeable, and treating them as a class is how a real scope
  violation gets waved through.** #1523 merged with two red non-required checks, and #1521 is being
  held with one. The difference is not the checks' status but what they found: #1523's `Return
  review packet` named `.gitkeep` and `evidence.json` — the lane's own required artifacts, inside
  its own proof directory, one created by `ops:lane-start` itself and the other mandatory for ERV —
  which is the recorded `pr-review-packet.ts:487-491` defect. #1521's `File scope lock` named three
  paths genuinely outside its pinned lock. The first is a defective check reporting on correct
  work; the second is a correct check reporting on a real scope question. "Non-required" is a
  statement about merge mechanics, never about whether the finding is real, and each red has to be
  read before it can be classified.

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
