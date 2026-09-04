# Mission Plan — live

**Owner:** Claude. Rewritten as reality changes. Not a log, not a backlog, not Linear in Markdown.
**Last reconciled against live truth:** 2026-09-03T17:05Z

Answers five questions: what is true now, what is executable, what is blocked, what requires Griff,
and what was learned.

---

## Reconciled current truth (2026-09-03)

Verified against `origin/main`, the GitHub API, branch protection, check-run outputs, and the
`Direct Main Push Guard` run log. Not against docs or chat history.

- `main` is `d947a12aa`, an `ops(readiness): refresh ledger [skip ci]` commit. The last commit that
  changed shipped behaviour is `b729447d2` — the UTV2-1824 lane-close. Behind it: the UTV2-1789
  lane-close (`43a1bf0f4`), the UTV2-1825 lane-close (`5b5f7a3b8`), #1485 (`5ed005a6d`), #1474
  (UTV2-1789, `01a2d2d6`, 2026-09-03T04:53Z) and #1488 (UTV2-1824, `2ac23342`, 04:52Z). All three
  lanes that merged today are truth-closed; no lane manifest is left open behind a merged PR. The
  readiness ledger writes directly to `main` on a schedule, so the tip moves without a PR and every
  head-pinned artifact on an open lane ages against commits that changed no code.
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

### Production deployed and passed its smoke on 2026-09-01 — current readiness is RED

Two different claims live in this section and they must not be collapsed. The first is a *point-in-
time deploy smoke*; the second is *current readiness*. Only the first was healthy.

**Current readiness is RED.** `docs/06_status/readiness/readiness-score.json` on `main`, generated
2026-09-03T15:40:56Z from run `33774007367`, records `"verdict": "RED"` and
`"observability": "degraded"`, with `deployed_sha` `e48106fc` against `main_sha` `48b5f679` — the
deployed commit is not `main`. Nothing below licenses a statement that production is *currently*
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

The current one is this lane (UTV2-1829, mission context). RMA is an architecture review, not a
governance lane.

Per the ratified debt policy in `intent.md`, **the slot is a ceiling, not a quota, and may stand
empty.** After this lane closes it is deliberately left unstaffed: the closeout defects below are
survivable by hand, the Command Center auth exposures are not, and production security work does
not consume this slot. The strongest current candidate when the slot is next spent is the
`pre-proof-validator` classification repair recorded under Learned.

---

## Admissibility debt

Seven open PRs cannot be evaluated by `Merge Gate` because they were opened outside the lane system
and carry no resolvable tier: #1491, #1492, #1493, #1494, #1495, #1496, #1498. All seven fail the
identical set of checks — `Check issue references`, `Sync tier label`, `Executor Result Validation`,
`Merge Gate` — every one of them downstream of the same single cause.

**PM ruling 2026-09-03: `Merge Gate` is not changed to admit incorrectly-created branches.** The fix
is readmission through `ops:lane-start` under the real issue. Renaming an open PR's head branch
closes it and it will not reopen, so readmission means a replacement PR carrying the same diff.

Two of them are security fixes that already have canonical Linear owners — the work and the issue
exist, they were simply never joined:

| PR | Fix | Canonical issue |
|---|---|---|
| #1493 (+121/-1) | a dot in the path no longer skips Command Center authentication | **UTV2-1812** (Backlog) |
| #1494 (+503/-61) | the management token can no longer be handed arbitrary SQL | **UTV2-1802** (Backlog) |

These are being re-homed onto those issues through normal governed lanes. They are production
security work, not governance work, and do not consume the governance slot.

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

The two lanes that merged before the fix landed have since been truth-closed through the governed
post-merge path. **UTV2-1789 (#1474)** closed at `43a1bf0f4` on the push that followed the fix.
**UTV2-1824 (#1488)** closed at `b729447d2`, the current `main` tip. Both manifests read `done` and
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

Consolidated from Wave 0, in dependency order:

1. **Rewrite `ALLOWED_CAPPER_EMAILS` into the `<email>=<canonicalCapperId>` shape** — urgent. #1488 merged at
   2026-09-03T04:52Z; the secret still holds the pre-#1488 shape (last updated 2026-09-01T13:26Z).
   The next deploy locks every capper out until this is set. Milestone 1 identity step. The value
   belongs only in the secret store — it is not recorded in this repository.
2. **Dispatch a `Deploy` run** once item 1 is done. The last promote was `e48106fc` on
   2026-09-01T13:28Z, so production predates #1488 and does not carry the canonical-identity fix.
   `deploy.yml` is `workflow_dispatch`-only; nothing promotes on its own. Milestone 1 steps 1–5.
3. **Approve #1501** (`t1-approved` + `pm-verdict/v1`) — UTV2-1823. Every other check is green.
   The pilot creates exactly the record this route exposes to anonymous callers, so this is a
   Milestone 1 gate. (#1485, which previously sat at this position, merged at `5ed005a6d`.)
4. **#1493** — the remaining Command Center authentication defect, still open. #1474 merged. Not a
   Milestone 1 gate.
5. **#1477, #1451** — production DDL. Neither is a Milestone 1 gate.
6. **#1491 / #1492 architecture review** — merge authority and agent authority.
7. **Direct-`main` prevention** — branch protection change, decided on its own merits and its own
   timeline. **Not sequenced behind the inadmissible-PR backlog:** the prohibition is already in
   force, and incorrectly created PRs do not earn a deferral of a safety control. Not changed in
   this lane.
8. **Any production containment change (`parked` → `active`)** — not needed for Milestone 1, and
   explicitly excluded from it. Command Center secrets are likewise not a Milestone 1 gate.
9. **`scope-override/v1` comment on PR #1499** authorizing `.lane/lanes/governance.yml`, so the
   bounded `docs/mission/**` registration in that PR is admitted. The glob is already written; only
   the human-authored override artifact can admit the file, and an agent cannot author it. The
   record is pinned to an exact head SHA, so every commit that moves the head — including a
   sanctioned `main` resync — invalidates it and requires a fresh one. That is the control working,
   and it is the reason a lane like this one should be resynced and reconciled *before* the override
   is requested rather than after.

---

## Learned

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
