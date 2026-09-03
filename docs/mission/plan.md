# Mission Plan — live

**Owner:** Claude. Rewritten as reality changes. Not a log, not a backlog, not Linear in Markdown.
**Last reconciled against live truth:** 2026-09-03

Answers five questions: what is true now, what is executable, what is blocked, what requires Griff,
and what was learned.

---

## Reconciled current truth (2026-09-03)

Verified against `origin/main`, the GitHub API, branch protection, check-run outputs, and the
`Direct Main Push Guard` run log. Not against docs or chat history.

- `main` is `72a4da762` (`ops(readiness): refresh ledger [skip ci]`, github-actions[bot]).
- Branch protection on `main` requires exactly four checks: `verify`, `Executor Result Validation`,
  `Merge Gate`, `P0 Protocol`. `strict: true`. **`enforce_admins: false`**, no push restrictions,
  no rulesets, no required reviews.
- 16 PRs are open. None is blocked on a failing test, a type error, or a real risk finding.
  They are blocked on `Merge Gate` in two distinct ways, and the distinction matters:
  - **Missing a human approval artifact** (#1474, #1477, #1484, #1485, #1488) — a `pm-verdict/v1`
    comment and/or the `t1-approved` label.
  - **Not admissible as a lane at all** (#1491, #1492, #1493, #1494, #1495, #1496, #1498) — opened
    with no `UTV2-###` in the branch, so `Merge Gate` reports *"No issue ID found in PR branch or
    title. Cannot resolve authoritative tier."* This is self-inflicted, not a policy defect.
- Three separate Claude terminals produced commits against this repo within 12 hours, uncoordinated,
  two of them concurrently against the same branches. Lane mechanics exist to prevent that and were
  not in force, because none of the new branches were lanes.

### Production is deployed, healthy, and contained

Measured from the `Deploy` run of 2026-09-01 (`e48106fc`), which promoted and passed its
post-deploy smoke:

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
reserved surfaces. **Sequencing note:** `enforce_admins: true` also removes the only route by which
several currently-blocked PRs can land, so it should follow the backlog, not precede it.

---

## Frozen pending PM architecture review

PM froze these on 2026-09-03. **Do not commit to them, do not resume them, do not design against
them.** Heads preserved:

| PR | HEAD | What |
|---|---|---|
| #1491 | `73fb6b76e` | Risk-Scoped Merge Authority (RMA/v1) — replaces manifest-tier merge authority with diff classification |
| #1492 | `77dea9c8d` | Mission-native harness recalibration — 53 files; relocates dispatch/lane commands, rewrites `CLAUDE.md`/`AGENTS.md`, hooks, settings |
| #1497 | `6d8029d03` | Mission plan update, stacked on #1491 |
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
canonical pick → persist it → prove Track Only cannot create member delivery → observe it through
the operator path.

| Step | State |
|---|---|
| Reach the deployed form | **Infrastructure done.** `smart-form` is deployed, healthy, routed by Caddy at `UNIT_TALK_SMART_FORM_DOMAIN`. The hostname is a secret and is not in the repo. |
| Authenticate | Deployed. Google OAuth via Auth.js v5, allow-list gated on `ALLOWED_CAPPER_EMAILS`. |
| Resolve canonical identity as `griff843` | **Blocked on a secret change.** See below. |
| Submit + persist a canonical pick | Deployed. `parked` stops provider ingestion and delivery; it does not stop capper submission. |
| Prove Track Only cannot create member delivery | **Built and mutation-tested** (UTV2-1672): the submit-time pin, direct-enqueue guard, retry guard, requeue guard, outbox chokepoint, atomic-RPC chokepoint and recap exclusion each have a test that fails when the guard is removed. What remains is *observing* it during the pilot — a run, not a build. |
| Observe through the operator path | **Blocked.** The Command Center has never been deployed (#1496), and carried a live authentication bypass (#1493). |

### The identity blocker, precisely

Production today (`e48106fc`) derives the capper ID from the email local part:

```
deriveCapperIdFromEmail('griffadavi@gmail.com') -> 'griffadavi'
```

That value is not cosmetic. `apps/smart-form/auth.ts` puts it in the session JWT as `capperId`, and
`apps/api/src/handlers/submit-pick.ts` prefers that claim over whatever `submittedBy` the form sent,
so it becomes the persisted identity of a real pick. Milestone 1 requires `griff843`.

#1488 fixes this by requiring each allow-list entry to carry its canonical ID explicitly, refusing
anything not already canonical rather than repairing it. That changes the required shape of an
existing secret:

```
ALLOWED_CAPPER_EMAILS = griffadavi@gmail.com=griff843
```

An entry with no `=` is dropped and does **not** fall back to the local part, so **merging #1488
without updating the secret means nobody can sign in.** The secret must change with the merge.

---

## Execution waves

Production-first. Wave 0 is entirely Griff; everything else is blocked behind it.

### Wave 0 — PM unblock

| # | Action | Why reserved |
|---|---|---|
| 1 | Approve **#1488** (`pm-verdict/v1` + `t1-approved`) **and** set `ALLOWED_CAPPER_EMAILS=griffadavi@gmail.com=griff843` in the same action | Secrets |
| 2 | Re-authorize **#1474** against head `285fa8998` — the verdict is stale (approved `9f9e7fc6`), not negative | — |
| 3 | Decide **#1477** — standing verdict is `CHANGES_REQUIRED` | Production DDL |
| 4 | Create `COMMAND_CENTER_DOMAIN`, `COMMAND_CENTER_AUTH_TOKEN`, `UNIT_TALK_CC_API_KEY` | Secrets |
| 5 | Review **#1491 / #1492** as an architecture decision — not as engineering to resume | Merge authority |

Items 1 and 4 gate Milestone 1.

### Wave 1 — Smart Form Track Only pilot (Milestone 1)

Land #1488 and #1477, then **run the pilot itself as one lane**: reach the form, authenticate,
resolve `griff843`, submit a real canonical pick, assert persistence, observe the Track Only guards
holding during the run, and observe the result through the operator path. This is the deliverable
that has never been attempted end to end.

### Wave 2 — CLV / data truth

| PR / work | State |
|---|---|
| #1479 null-stake computation truth | `verify` red — repair first |
| #1451 June offer-history partitions | `verify` red; production DDL; PM-gated |
| #1484 canonical reference bootstrap | `verify` green; needs a verdict |
| Closing-line truth | Not yet a branch |

### Wave 3 — Command Center

#1493 (dotted-path auth bypass) and #1494 (arbitrary management SQL) first — both are live security
defects with green `verify`. Then #1496 (deployment) once the Wave 0 secrets exist. All three need
readmission as lanes; see "Admissibility debt" below.

### Wave 4 — models / research

Nothing identified as safely independent of the waves above. Requires a scope check before starting.

### Wave 5 — website / product optimization

Not started.

### Wave 6 — exactly one governance lane at a time

The current one is this lane (UTV2-1829, mission context). The next candidate is the direct-`main`
prevention repair. RMA is an architecture review, not a governance lane.

---

## Admissibility debt

Seven open PRs cannot be evaluated by `Merge Gate` because they were opened outside the lane system
and carry no resolvable tier: #1491, #1492, #1493, #1494, #1495, #1496, #1498.

For the ones being kept, the fix is readmission through `ops:lane-start` under a real issue, not a
change to the gate. Renaming an open PR's head branch closes it and it will not reopen, so
readmission means a replacement PR carrying the same diff.

---

## Requires Griff

Consolidated from Wave 0, in dependency order:

1. **#1488 + the `ALLOWED_CAPPER_EMAILS` secret, together** — Milestone 1 identity step.
2. **Command Center secrets** — Milestone 1 observation step.
3. **#1474 re-authorization** — stale verdict only.
4. **#1477, #1451** — production DDL.
5. **#1491 / #1492 architecture review** — merge authority and agent authority.
6. **Direct-`main` prevention** — branch protection change; sequence after the backlog clears.
7. **Any production containment change (`parked` → `active`)** — not needed for Milestone 1.

---

## Learned

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
