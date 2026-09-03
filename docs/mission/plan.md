# Mission Plan — live

**Owner:** Claude. Rewritten as reality changes. Not a log, not a backlog, not Linear in Markdown.
**Last reconciled against live truth:** 2026-09-03T05:30Z

Answers five questions: what is true now, what is executable, what is blocked, what requires Griff,
and what was learned.

---

## Reconciled current truth (2026-09-03)

Verified against `origin/main`, the GitHub API, branch protection, check-run outputs, and the
`Direct Main Push Guard` run log. Not against docs or chat history.

- `main` is `5b5f7a3b8` (the UTV2-1825 lane-close commit). #1485 merged at `5ed005a6d`, behind
  #1488 (UTV2-1824, `2ac23342`, 2026-09-03T04:52Z) and #1474 (UTV2-1789, `01a2d2d6`, 04:53Z).
- Branch protection on `main` requires exactly four checks: `verify`, `Executor Result Validation`,
  `Merge Gate`, `P0 Protocol`. `strict: true`. **`enforce_admins: false`**, no push restrictions,
  no rulesets, no required reviews.
- 15 PRs are open. None is blocked on a failing test, a type error, or a real risk finding.
  They are blocked on `Merge Gate` in two distinct ways, and the distinction matters:
  - **Missing a human approval artifact** (#1477, #1484, #1501) — a `pm-verdict/v1`
    comment and/or the `t1-approved` label. #1474, #1488 and #1485 were in this group and merged
    2026-09-03 (`01a2d2d6`, `2ac23342`, `5ed005a6`). Measured the same day: `strict: true` did **not** block
    #1474 even though it was genuinely BEHIND `main`, so head-pinned verdicts do not serialize to
    one merge per cycle and an approved-but-BEHIND PR needs no re-verdict round trip.
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
internal Track Only pick → persist it → prove Track Only cannot create member delivery → observe it
through a safe internal/operator path. Containment stays parked throughout; see `intent.md`
§ "Containment during Milestone 1".

| Step | State |
|---|---|
| Reach the deployed form | **Infrastructure done.** `smart-form` is deployed, healthy, routed by Caddy at `UNIT_TALK_SMART_FORM_DOMAIN`. The hostname is a secret and is not in the repo. |
| Authenticate | Deployed. Google OAuth via Auth.js v5, allow-list gated on `ALLOWED_CAPPER_EMAILS`. Blocked only on the secret reshape (Wave 0 item 1). |
| Resolve canonical identity as `griff843` | **Code merged (#1488, `2ac23342`), secret not yet reshaped — this is a live production hazard.** See below. |
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

**Measured 2026-09-03T05:00Z: `ALLOWED_CAPPER_EMAILS` was last updated 2026-09-01T13:26Z — before
#1488 merged — and no `Deploy` run has fired since (latest is `e48106fc`, 2026-09-01T13:28Z).**
Production therefore still runs the old derivation and still works. The next deploy ships the new
code against the old secret shape, every entry is dropped, and nobody can sign in. This is the one
open item where doing nothing is not safe: the secret must be updated before the next deploy, not
before the next pilot.

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
| 1 | **Rewrite `ALLOWED_CAPPER_EMAILS` into the `<email>=<canonicalCapperId>` shape before the next deploy.** #1488 shipped the code; the secret still holds the pre-#1488 shape. | Secrets | The next deploy, and Milestone 1 step 2. Nothing else. |
| 2 | Dispatch a `Deploy` run once item 1 is done | Production deploy | Milestone 1 steps 1–5. Nothing else. |
| 3 | Decide **#1477** — standing verdict is `CHANGES_REQUIRED` | Production DDL | #1477 only. |
| 4 | Approve **#1501** (`t1-approved` + `pm-verdict/v1`) — UTV2-1823, authenticate `GET /api/picks/{id}/trace` | T1 merge authority | Milestone 1: the pilot creates exactly the record this route exposes to anonymous callers. |
| 5 | Review **#1491 / #1492** as an architecture decision — not as engineering to resume | Merge authority | Those two PRs only. Explicitly not the mission. |

Item 4 previously read "Approve #1485". That merged at `5ed005a6d` and its own lane closed cleanly
afterwards, which is the mechanical evidence the fix works.

Command Center secrets are **not** in this table. They are not a Milestone 1 prerequisite; see
`intent.md` § "Step 7 — observation path".

### Wave 1 — Smart Form Track Only pilot (Milestone 1)

#1488 (identity) is merged. UTV2-1823 — authenticate `GET /api/picks/{id}/trace`, which today
returns a pick's entire lifecycle aggregate to any anonymous caller and would expose the pilot's own
pick — is implemented and green on **PR #1501**, awaiting only its T1 approval artifacts. What
remains before the pilot can run is Wave 0 items 1, 2 and 4.

Then **run the pilot itself as one lane**: reach the form, authenticate, resolve `griff843`, submit
a real internal Track Only pick, assert persistence, observe the Track Only guards holding during
the run, and observe the result through a safe read-only internal/operator path. Containment stays
parked throughout. This is the deliverable that has never been attempted end to end.

#1477 is **not** a Milestone 1 dependency; it is unrelated rate-limit DDL and is sequenced on its
own merits.

### Wave 2 — CLV / data truth

| PR / work | State |
|---|---|
| #1479 null-stake computation truth | `verify` red — repair first |
| #1451 June offer-history partitions | `verify` red; production DDL; PM-gated |
| #1484 canonical reference bootstrap | `verify` green; needs a verdict |
| Closing-line truth | Not yet a branch |

### Wave 3 — Command Center

#1493 (dotted-path auth bypass) and #1494 (arbitrary management SQL) first — both are live security
defects with green `verify`, and neither depends on any reserved action. Then #1496 (deployment),
which does need Command Center secrets and a hostname. All three need readmission as lanes; see
"Admissibility debt" below.

Deployment is tracked here on its own product merits. It is **not** a Milestone 1 gate.

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

### `Lane authority` rejects dotfiles inside its own allowed globs

Observed on this lane (UTV2-1829, PR #1499). `ops:lane-start` creates and commits
`docs/06_status/proof/<issue>/.gitkeep`. `File scope lock` accepted it; `Lane authority` and
`Return review packet` both rejected it as `out-of-scope files:
docs/06_status/proof/UTV2-1829/.gitkeep` — even though `.lane/lanes/governance.yml` lists
`docs/06_status/proof/**` as an allowed glob.

The cause is not a missing allowlist entry. `matchesAny()` in `scripts/lane-contract.ts` calls
`micromatch.isMatch()` with no `dot` option, and micromatch does not match a leading dot against `*`
or `**` by default:

```
micromatch.isMatch('docs/06_status/proof/UTV2-1829/.gitkeep', 'docs/06_status/proof/**')            // false
micromatch.isMatch('docs/06_status/proof/UTV2-1829/.gitkeep', 'docs/06_status/proof/**', {dot:true}) // true
```

This is the same defect class as the `nocase` bug that `.lane/lanes/governance.yml` documents inline
under UTV2-1541 (`docs/06_status/incidents/**` never matching `docs/06_status/INCIDENTS/**`): a
micromatch default silently narrowing an allowlist that reads as if it covers the path. Every
`.gitkeep`, `.keep` or dot-prefixed control file a sanctioned lane command writes into an allowed
directory is affected. This lane removed the placeholder rather than widen its scope; the underlying
defect is unfixed.

### `docs/mission/**` lane registration — resolved in this PR

`.lane/lanes/governance.yml` enumerates every docs subtree a governance lane may touch, and
`docs/mission/**` was in none of them, so `Lane authority` and `Return review packet` failed this
PR on `docs/mission/intent.md`, `spec.md` and `plan.md`. `CLAUDE.md` and `AGENTS.md` were already
individually admitted — a governance lane could add the pointer but never the target.

That file's own comments record this exact situation eight times (UTV2-1524, 1528, 1541, 1557,
1199, 1384, 1253, 1629), each closed by the lane that hit it adding its path in the same PR. This
PR does the same, bounded to `docs/mission/**` and nothing else.

`.lane/lanes/governance.yml` is outside this lane's `file_scope_lock` (`AGENTS.md`, `CLAUDE.md`,
`docs/mission/**`), and the lock is pinned to the lane-start commit and cannot be widened by an
agent. The bounded expansion is therefore authorized by a `scope-override/v1` comment authored by
CODEOWNERS on this PR. Without that comment `File scope lock` fails on this file, and correctly so.

### `MERGE_SHA: pending merge` — resolved on `main`

Executor Result Validation rejected the ratified `pending merge` anchor under the legacy contract,
which demanded the row be a real commit — impossible before a merge exists — while
`PLACEHOLDER_VALUE_PATTERN` in `ops:proof-generate` did not match `pending merge` either, so a
contract-conformant bundle was also unrebindable after the merge. Post-merge closeout was
deadlocked repo-wide.

**PR #1485 (UTV2-1825) merged at `5ed005a6d`.** Its own lane then closed cleanly through the normal
post-merge path (`5b5f7a3b8`), which is the mechanical evidence the rebinder now accepts the anchor.

Two lanes merged before the fix landed still carry the old failure and remain `in_review` on `main`:
**UTV2-1824 (#1488)** and **UTV2-1789 (#1474)**. Their closeouts need a governed replay through
`post-merge-lane-close.yml` now that the repaired rebinder is on `main`. This is lane bookkeeping,
not a product gate — the code from both PRs is already shipped.

The schema-v2 `sha_binding` block in `evidence.json` (`merge_sha: null` plus `verified_source_sha`)
remains the correct authoring shape; it is what the repaired rebinder binds against.

---

## Requires Griff

Consolidated from Wave 0, in dependency order:

1. **Rewrite `ALLOWED_CAPPER_EMAILS` into the `<email>=<canonicalCapperId>` shape** — urgent. #1488 merged at
   2026-09-03T04:52Z; the secret still holds the pre-#1488 shape (last updated 2026-09-01T13:26Z).
   The next deploy locks every capper out until this is set. Milestone 1 identity step. The value
   belongs only in the secret store — it is not recorded in this repository.
2. **Dispatch a `Deploy` run** once item 1 is done. Production is 23 commits behind `main` and does
   not yet carry #1488. Milestone 1 steps 1–5.
3. **Approve #1501** (`t1-approved` + `pm-verdict/v1`) — UTV2-1823. Every other check is green.
   The pilot creates exactly the record this route exposes to anonymous callers, so this is a
   Milestone 1 gate. (#1485, which previously sat at this position, merged at `5ed005a6d`.)
4. **#1493** — the remaining Command Center authentication defect, still open. #1474 merged. Not a
   Milestone 1 gate.
5. **#1477, #1451** — production DDL. Neither is a Milestone 1 gate.
6. **#1491 / #1492 architecture review** — merge authority and agent authority.
7. **Direct-`main` prevention** — branch protection change; sequence after the backlog clears.
8. **Any production containment change (`parked` → `active`)** — not needed for Milestone 1, and
   explicitly excluded from it. Command Center secrets are likewise not a Milestone 1 gate.
9. **`scope-override/v1` comment on PR #1499** authorizing `.lane/lanes/governance.yml`, so the
   bounded `docs/mission/**` registration in that PR is admitted. The glob is already written; only
   the human-authored override artifact is missing, and an agent cannot author it.

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
