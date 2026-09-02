# Mission Plan — live

**Owner:** Claude. Rewritten as reality changes; not a log, not a backlog, not Linear in Markdown.
**Last reconciled against live truth:** 2026-09-02

Answers five questions: what is happening now, what is executable, what is blocked, what requires
Griff, and what was learned.

---

## Reconciled current truth (2026-09-02)

Verified against live `main`, the GitHub API, branch protection, and the deploy workflow's own run
logs — not against docs or history.

- `main` is `717b46971`.
- Branch protection on `main` requires exactly four checks: `verify`, `Executor Result Validation`,
  `Merge Gate`, `P0 Protocol`. Everything else in the 70-workflow suite is advisory at the branch level.
- **Every open PR is green on real safety and blocked solely on `Merge Gate` demanding a human
  approval artifact.** Not one is blocked on a failing test, a type error, or a real risk finding.

That is the whole diagnosis. The system was not stuck on engineering; it was stuck on relay.

### Production is deployed, healthy, and contained

Measured from the `Deploy` run of 2026-09-01 (`e48106fc`), which promoted and passed its
post-deploy smoke:

- Running containers: `api`, `worker`, `ingestor`, `discord-bot`, `grading-cron`, `web`,
  `smart-form`, `caddy`, plus Loki/Grafana. `web` and `smart-form` both reported `healthy`.
- API health: `status: healthy`, `persistenceMode: database`, `runtimeMode: fail_closed`,
  `dbReachable: true`, zombie picks 0, schema drift healthy.
- `SYNDICATE_MACHINE_MODE=parked`, which sets `UNIT_TALK_INGESTOR_AUTORUN=false`,
  `UNIT_TALK_INGESTOR_SCHEDULING_ENABLED=false`, `UNIT_TALK_WORKER_AUTORUN=false` and resolves
  enabled promotion targets to none. The deploy then reads each value back out of the running
  container and fails the deploy if it disagrees.

**The readiness contract's "worker DOWN" assertion (2026-04-30) is stale and wrong as a statement of
capability.** The worker is deployed and its autorun is deliberately off. That is containment, not
breakage — and containment is reserved until a milestone authorizes changing it.

### Why the merge relay had become meaningless

`Merge Gate` resolved a tier from the lane manifest, and in practice every lane was admitted `T1`.
So a `.env.example` edit and a production migration demanded the identical artifact pair
(`t1-approved` label + head-bound `pm-verdict/v1`). Pricing every change as reserved prices the
genuinely reserved ones at zero attention — the failure mode is not that risky changes got scrutiny,
it is that they got the same scrutiny as typo fixes, from a human who had to service the queue.

---

## In flight

### 1. Risk-Scoped Merge Authority (RMA/v1) — #1491 — **awaiting Griff, one action**

Replaces lane-manifest tier with classification over what a diff *touches*.

- `docs/05_operations/RESERVED_RISK_SURFACES.json` — the six surfaces Griff reserves, as data.
- `scripts/ops/merge-authority.cjs` — classifier. Fail-closed on every error path.
- `scripts/ops/merge-authority.test.ts` — 31 tests, including one per reserved surface and the
  fail-closed cases (missing diff, empty diff, unreadable policy, unavailable patch).
- `.github/workflows/merge-gate.yml` — 334 lines of tier/manifest/bootstrap logic replaced by 61.
  Verdict parsing is untouched and still delegates to `merge-gate-verdict.cjs`, so
  latest-verdict-wins, CODEOWNERS authorization and exact-head binding are not re-derived.

It also carries the other half of the same coupling. `Executor Result Validation` is the *other*
required check, and it rejected any branch not named `(claude|codex)/utv2-NNN-*` and demanded a proof
bundle unless a `tier:T3` label said otherwise. Left alone, every PR opened under the new primitive
would have been permanently blocked by it. ERV now asserts what is real — the executor attests to
this exact branch and head SHA — and takes its evidence bar from the same risk classifier: a diff
touching a reserved surface must carry proof, and no label can excuse it. That is strictly stricter
than the label lookup it replaces, under which a missing `tier:` label silently moved the bar.

**This PR reserves itself.** `merge-authority` is a reserved surface, so the gate blocks its own
amendment. That is deliberate and it is the property that makes RMA safe to grant: it cannot widen
its own authority. It is also why this one change needs Griff and cannot be self-authorized.

**Landing it needs a one-time repo-owner merge, not a label.** Both required gates load their logic
from the *base* checkout (deliberately — so a PR cannot supply its own rules), and on this PR base is
`main`, which does not yet have `merge-authority.cjs`. So both gates fail closed with a module-not-
found error and no label or verdict can clear them. This is the same one-time self-referential
bootstrap gap UTV2-1550 hit and documented in its own proof bundle — *"a one-time self-referential
bootstrap gap specific to the PR that introduces the file — future PRs will not hit it, since main
will already contain the file at their base SHA"* — resolved there by a repo-owner merge. Every PR
after this one evaluates normally.

`verify` is green on head `132ad95f`. Its one earlier red was a genuine flake, now fixed under #1495.

Before opening it, the gate was proven to work by executing the real inline workflow script against
live GitHub data for every open PR. Classification:

| PR | Classification | Reason |
|---|---|---|
| #1488 canonical capper identity | `auto` | product code only |
| #1474 Command Center fail-closed auth | `auto` | product code only |
| #1479 null-stake computation truth | `auto` | domain code only |
| #1485 pre-merge placeholder rebind | `auto` | ops scripts only |
| #1484 canonical reference bootstrap | `auto` | ops scripts only |
| #1429 harness model de-pin | `auto` | config only |
| #1477 rate-limit DB contract | `human` | production DDL + `DELETE FROM` |
| #1451 offer-history partitions | `human` | production DDL + `DROP TABLE` |
| #1491 RMA itself | `human` | reserves its own amendment |
| #1496 operator console deployment | `human` | `deploy.yml` — secrets surface |

The changes that stay reserved are exactly the ones that write production schema, change how secrets
reach production, or change merge authority itself. That distribution is the point.

### 2. Opened while RMA is in flight — all `auto`, all waiting on it

| PR | What |
|---|---|
| #1493 | Command Center: a dot in the path no longer skips authentication |
| #1494 | Command Center: the management token can no longer be handed arbitrary SQL |
| #1495 | verify-semaphore: claim the slot and register its release in one step |
| #1496 | Deploy the operator console (reserved: `deploy.yml`) |

---

## Milestone 1 — what is actually left

Milestone 1: reach the deployed Smart Form, authenticate, resolve identity as `griff843`, submit a
real canonical pick, persist it, prove Track Only cannot create member delivery, observe it through
the operator path.

| Step | State |
|---|---|
| Reach the deployed form | **Done in infrastructure.** `smart-form` is deployed, healthy, and routed by Caddy at `UNIT_TALK_SMART_FORM_DOMAIN`. Griff knows the hostname; it is a secret and is not in the repo. |
| Authenticate | Deployed. Google OAuth via Auth.js v5, allow-list gated on `ALLOWED_CAPPER_EMAILS`. |
| Resolve canonical identity as `griff843` | **Blocked on a secret change.** See below. |
| Submit + persist a canonical pick | Deployed. `parked` mode stops provider ingestion and delivery; it does not stop capper submission. |
| Prove Track Only cannot create member delivery | **Already built and mutation-tested** (UTV2-1672): the pin at submit, the direct-enqueue guard, the retry guard, the requeue guard, the outbox chokepoint, the atomic-RPC chokepoint and the recap exclusion each have a test that fails when the guard is removed. What remains is *observing* it during the pilot, which is a run, not a build. |
| Observe through the operator path | **Blocked.** The Command Center has never been deployed — #1496 adds it. It also had a live authentication bypass, fixed in #1493. |

### The identity blocker, precisely

Production today (`e48106fc`) derives the capper ID from the email local part:

```
deriveCapperIdFromEmail('griffadavi@gmail.com') -> 'griffadavi'
```

That value is not cosmetic. `apps/smart-form/auth.ts` puts it in the session JWT as `capperId`, and
`apps/api/src/handlers/submit-pick.ts` prefers that claim over whatever `submittedBy` the form sent —
so it becomes the persisted identity of a real pick. Milestone 1 requires `griff843`.

#1488 fixes this by requiring each allow-list entry to carry its canonical ID explicitly and
refusing anything that is not already canonical, rather than repairing it. That changes the required
shape of an existing secret:

```
ALLOWED_CAPPER_EMAILS = griffadavi@gmail.com=griff843
```

An entry with no `=` is dropped and does **not** fall back to the local part, so **merging #1488
without updating the secret means nobody can sign in.** The secret must change with the merge, not
after it.

---

## Executable now (no human gate)

Nothing on the Milestone-1 path is left that does not require either RMA to land or a Griff decision.
Work continues on hardening and on the readiness contract's other dimensions.

## Requires Griff

| # | Item | Why reserved | Effect |
|---|---|---|---|
| 1 | Merge #1491 (RMA/v1) | Changes merge authority itself; gates fail closed from base | Unblocks every other PR |
| 2 | Set `ALLOWED_CAPPER_EMAILS=griffadavi@gmail.com=griff843` **with** #1488 | Secrets | Milestone 1 identity step |
| 3 | Create `COMMAND_CENTER_DOMAIN`, `COMMAND_CENTER_AUTH_TOKEN`, `UNIT_TALK_CC_API_KEY`; approve #1496 | Secrets + `deploy.yml` | Milestone 1 observation step |
| 4 | Approve #1477, #1451 | Production DDL | Rate-limit contract, offer-history partitions |
| 5 | Any production containment change (`parked` → `active`) | Reserved until a milestone authorizes it | Not needed for Milestone 1 |

Items 2 and 3 are the only ones that gate Milestone 1. Item 1 gates everything.

## Learned

- **The bottleneck was never capability.** Every open PR sat green. Diagnosing that took reading
  branch protection and four check-run outputs — a question nobody had asked mechanically.
- **A control that fires on everything conveys no information.** Universal `T1` was
  indistinguishable from no policy, while costing a human decision per PR.
- **Running a new control against real data before shipping it found a real defect.** The first
  version of the secrets surface reserved `.env.example` — a committed template of variable *names* —
  which would have re-created the over-reservation the change exists to remove. It was caught by
  classifying the live PRs, not by reasoning about the policy.
- **A test that drives a function directly cannot see whether the function was called.** Every
  Command Center auth test called `middleware()` and passed; the matcher excluded every dotted path,
  so Next never invoked it and `/picks/abc.def` returned 200 with authentication required. The bug
  was found by measuring a running server, not by reading tests.
- **Stale runtime claims are worse than absent ones.** "Worker DOWN" had been true-shaped for four
  months and was load-bearing in the readiness contract. The worker is deployed; its autorun is off
  on purpose. One deploy log settled it.
