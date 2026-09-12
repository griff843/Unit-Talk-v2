# Mission Plan — lessons reference

Moved verbatim from plan.md to keep session-start context bounded. Read relevant
entries when needed; this file introduces no authority or new work. Current work
and decisions remain in [plan.md](plan.md); canonical contracts remain controlling.

## Learned

- **A lease leaked `active` on a terminal lane *after* the gate that was supposed to close that
  class had already landed.** UTV2-1863 (#1542) types reclaim admission as
  `'terminal_lane' | 'lapsed_ttl' | 'surrendered_status'` and gates it on
  `findLeasesHeldByTerminalLanes` rather than on the clock — the repair this page recommended, built
  and merged. On 2026-09-10 `.ops/leases/UTV2-1877.json` was nonetheless still `active`, with a dead
  `owner_pid` (3576109) and a `file_scope_lock` of `["docs/mission/plan.md"]`, on a lane whose
  manifest read `done` on `main`. `pnpm ops:lease release --issue UTV2-1877 --actor claude --reason
  "<why>"` cleared it, which is the same escape the pre-gate occurrences needed. **The gate changed
  what `reclaim` will admit; it did not make closeout release the lease.** Those are different
  operations, and the five recorded occurrences were all diagnosed as the first one. The next lane
  should sweep terminal leases before `lane-start` rather than after a refusal — and this is the
  sixth occurrence of the class, which is what the filing threshold's "repeatedly strands lanes"
  clause exists for. Recorded here rather than filed only because the escape is one command and it
  stranded nothing this time.

- **A root-checkout copy of a lane manifest is always the stale lane-start snapshot, and `main` or
  the lane branch always wins.** `git pull --ff-only origin main` aborted on 2026-09-10 with
  *"Please move or remove them before you merge"*, because #1554's merge put
  `.ops/sync/UTV2-1877.yml` and `docs/06_status/lanes/UTV2-1877.json` on `main` while untracked
  copies of both sat in the root checkout. The untracked copies read `status: "started"`,
  `commit_sha: null`, `pr_url: null` — the snapshot written at lane-start, before the lane did
  anything. The authoritative copy on `main` read `status: done` with the merge SHA. The same
  situation existed for UTV2-1878, whose authoritative copy lives on its **own branch** rather than
  on `main`, because that lane is still open. **The rule is mechanical and the order matters: diff
  the root copy against its authoritative version *first*, establish which is which, and only then
  remove.** Deleting first and reasoning afterwards would have destroyed a live lane's manifest in
  the UTV2-1878 case, where the authoritative copy happened to be safe on a branch — the outcome was
  correct by luck of where the file lived, not by the procedure used.

- **The plan can be stale against work this same session merged, and the injected copy is what
  makes that invisible.** `CLAUDE.md` `@`-includes `docs/mission/plan.md` at session start, so the
  copy in context is a snapshot. Acting on it, this session filed UTV2-1872 to *write* the
  results-backfill authorization packet, because the injected text said "that packet is not written
  yet and is not requested here" — and drafted 200 lines of it before a `grep` of the file on disk
  showed UTV2-1870 had already written it, in a lane **this same session merged and closed**. The
  draft was discarded and the issue rescoped to this reconciliation. **The rule is mechanical:
  before starting work the plan describes as outstanding, grep the file on disk, not the copy in
  context** — the two diverge the moment your own lane merges. The same trap caught the `main` SHA
  and the production-drift block corrected at the top of this page.

- **A forbidden-combination refusal names the lane that fired, and it is worth reading rather than
  assuming.** A `migration` lane was expected to be refused by the other open migration PR (#1451).
  It was refused by #1484 instead, a `data-canonical` lane, because #1451 is `parked` and `parked`
  is not in the active set. Two consequences: the concurrency rules make `parked` a genuinely
  different state from `blocked`, which nothing else in this plan had recorded; and a reserved
  approval's blast radius can only be measured by running the command that would be refused. This
  is the same lesson the `PL6` / `lane-start` correction records, reached from the concurrency side.

- **The route around a concurrency refusal exists and was not taken.** Re-typing the UTV2-1871
  lane `governance` would have been admitted mechanically — `governance` admits
  `supabase/migrations/**` at `.lane/lanes/governance.yml:136` and holds no singleton type. It was
  declined because §3 forbidden combinations are described as blocked *unconditionally*, and
  choosing a lane type to evade a concurrency rule is a change to the operating model made by an
  agent, which `intent.md` reserves. Recorded here so the next agent finds the route already
  considered and refused rather than discovering it fresh and taking it.

- **A caveat that blocks an ask can be retired by building a control, and that is cheaper than
  reading more carefully.** This plan declined for days to write the results-backfill packet on the
  grounds that `ingestLeague` "writes offers and events broadly rather than results alone, so its
  blast radius has to be measured before it is put in front of anyone." The obvious response was to
  go read `ingest-league.ts` more carefully and write down what it does — and that would have been
  worthless, because a reading is invalidated by the next edit and nobody would know. UTV2-1866
  instead made the claim testable: the write surface is enumerated with reads named **explicitly**
  so a new method fails a completeness assertion rather than defaulting to harmless, and the
  behavioural claim is asserted by proxying the bundle rather than by inspecting the branch. The
  packet then cites the control, not the code path. **The general form: when a decision is blocked
  on "we cannot state what this does", the deliverable is the mechanism that keeps the statement
  true, not the statement.** This is the same rule as the UTV2-1688 duplicated-regex lesson and the
  UTV2-1856 client-guard lesson, arrived at from the opposite direction — those two are what
  happens when the coupling is documented in a comment instead.

- **The safety direction of a reporting tool is a design decision, and it has a right answer.** The
  dry-run bundle overlays its own simulated writes onto subsequent reads, because without the
  overlay a would-be-created event is invisible to the following `findByExternalId` and every
  result under it counts as `skippedEventNotFound` — an *undercount*, which reads as a smaller
  blast radius than the real run would have. It also refuses outright on an unclassified write
  rather than dropping it. Both choices err toward over-reporting. A safety tool that can be wrong
  in the reassuring direction is worse than no tool, because it is believed.

- **A milestone closed, and the thing that closed it was a dispatch — not a repair.** For five
  reconciliations this plan named an engineering blocker as the last obstacle to Milestone 1, and
  each time the blocker underneath turned out to be reserved rather than technical. The final
  sequence was: repair merged → deploy dispatched → milestone performed. **The engineering had been
  finished for a day before the milestone was reachable**, which is the strongest available
  statement of the merged-is-not-shipped rule this plan recorded on 2026-09-08. Worth keeping now
  that it has been paid off rather than only warned about.

- **The one prediction this plan repeated most often was correct, and it was correct because it
  named the mechanism rather than the outcome.** For six days it said `ALLOWED_CAPPER_EMAILS` was
  checked non-empty at three layers, shape-validated at none, that the healthcheck returned 200
  regardless of its contents, and that Griff's browser would therefore be its first real test. All
  four were true and the value happened to be right. **The gap is not closed by the value being
  right** — nothing validates the shape today either, so the next reshape carries the identical
  risk with no accumulated protection. A risk that does not fire is not a risk that was wrong.

- **Verifying a milestone means reading the row, not the receipts underneath it.** The Milestone 1
  verification queried the persisted pick, its lifecycle, its promotion history, its participants
  against the real `participants` table, four separate delivery-bearing tables, and the deploy's own
  containment log. Every one of those could have been argued from code and tests that were already
  green — and the 2026-09-08 client-guard defect is proof that green tests coexisted with a form
  that refused. **Enumerate the delivery-bearing tables from the schema** (`information_schema`
  for `pick_id`) rather than from the two you happen to remember; two of the four checked this way
  were not in the plan's own prior list.

- **A monitor that has failed 12,634 consecutive times is not a monitor.** `governance.awaiting-approval-drift`
  reports `failed` every 15 minutes on a static 14,984-row backlog while computing
  `countIncreased: false` in the same payload — it holds the field that would distinguish real
  drift from historical residue and does not use it. This is the "a control that fires on
  everything conveys no information" class, and it is the first instance where the control's own
  output contains its own repair. Also a reminder that the fix is in the classifier: deleting the
  rows to make the monitor green would be destroying audit history to improve a dashboard, and
  production data deletion is reserved besides.

- **Config that is *not* gated is as load-bearing as config that is, and nobody writes it down.**
  `UNIT_TALK_GRADING_CRON_AUTORUN=true` sits at `deploy.yml:540` outside the
  `SYNDICATE_MACHINE_MODE` case statement that parks the ingestor and worker. That single
  placement is why grading has 13,720 successful runs under containment, and it materially changed
  Milestone 2's starting position — but no document said so, and the plan spent five days
  describing containment as though it stopped everything. **When recording what containment parks,
  enumerate what it does not.**

- **Promotion ran, scored, force-promoted past its own minimum, and delivered nothing — and only
  the last of those is guaranteed by containment.** The Milestone 1 pick is `qualified` for
  `best-bets` at score 64.02 against a policy minimum of 70, via a source-based override. Track
  Only made it harmless. The general form is worth holding onto going into Milestone 2: **a guard
  that blocks the consequence does not correct the decision**, and when the guard is removed the
  decision is what remains.

- **A client guard that mirrors a server rule is one rule stored twice, and deleting the server copy
  silently re-arms the client copy.** UTV2-1856 removed the server refusal *"canonical player
  selection requires a canonical event"*; `evaluateSubmissionGuards` kept its mirror of that exact
  rule, citing it by `file:line` in a comment. Every test stayed green — the server tests assert the
  server's new behaviour, the client tests assert the client's old behaviour, and no test compares
  them — so a green `verify`, a complete T1 proof bundle and a merged repair all coexisted with a
  form that refused before issuing a request. **Server-side evidence cannot detect this class at
  all**, because the defect is that the request is never sent. It was found in ~40 seconds of
  Playwright and would not have been found by any amount of reading. The mechanical form of the
  lesson matches UTV2-1688's: where a rule is duplicated for a real reason, something must fail when
  the copies disagree; a `file:line` citation in a comment is documentation of the coupling, not
  enforcement of it.

- **"Demonstrate the path" and "prove the components" are different obligations, and only one of
  them ends a milestone.** The submission repair had unit tests, live-DB tests, mutation tests and
  green CI at every step, and the operator still could not submit. Milestone 1's steps are written
  as operator actions for exactly this reason. Any future claim that a step is repaired needs a run
  of that step, not a receipt from underneath it.

- **A merged repair is not a shipped repair, and this plan wrote the confusion into its own
  headings.** The 2026-09-07 draft said "the submission blocker is closed" in a section whose
  subject was explicitly the *deployed* system. Both halves were individually true — UTV2-1842 was
  merged, and the pilot runs against production — and the sentence connecting them was false. It
  took a `git rev-list --count d3f69b804..origin/main` returning **45** to notice. The generalisable
  rule is narrow and mechanical: **when a claim is about a deployed system, the evidence has to be
  an ancestry or drift measurement against the deployed SHA, never a merge SHA.** The plan already
  applied that rule correctly to #1488 and #1501 (`git merge-base --is-ancestor`); it stopped
  applying it the moment the merges started arriving faster than the reconciliations.

- **The two-lane sequencing argument was right about the risk and wrong about the file.** "The route
  B bootstrap" section below reasoned carefully that the admission change could not land in one
  lane, because copying the deferral onto the manifest lives in `lane-start.ts`, which is T1-floored
  by `tier-c-pattern` — the exact refusal the change exists to lift. UTV2-1851 landed it in **one**
  lane by putting the carry-forward in `createManifest` in `shared.ts`, a T3 file that
  `lane-start.ts` calls. The hazard the section identified was real and had to be closed; the
  ordering constraint it derived was an artifact of assuming where the code had to go. **A tier
  floor is computed from the file list, so the file list is a design variable, not a given** — when
  a floor makes a change unopenable, ask which file the change actually needs before accepting the
  sequencing cost.

- **A leaked lease has now blocked five lane starts, which is what the filing threshold's
  "repeatedly strands lanes" clause is for.** UTV2-1849 merged, truth-closed, manifest `done` on
  `main`, `owner_pid: null` — and its lease refused UTV2-1858 with `lease_conflict`. Reclaim is
  purely TTL-gated, so the only escape is knowing that `ops:lease release --issue <ID> --actor
  <who> --reason <why>` exists. `findLeasesHeldByTerminalLanes` already computes the right
  predicate; the reclaim path consulted the clock instead. Fifth occurrence: UTV2-1830, 1835, 1838,
  1840, 1849. **Closed by UTV2-1863 (#1542) — reclaim now admits a terminal lane's lease and reuses
  that helper.** The *leak* is unchanged: closeout still leaves every merged lane's lease `active`
  with `owner_pid: null`, observed again on UTV2-1874, 1875 and 1876. What changed is that it
  self-heals on reclaim instead of requiring an operator to know `ops:lease release` exists.

- **A failed `lane-start` leaves a branch and worktree the retry then refuses**, and the sanctioned
  cleaner does not model that state. `ops:lane-start` created both before failing the lease check;
  the retry reported *"Branch and worktree already exist but no manifest exists for this issue"*.
  `git worktree remove --force` plus `git branch -D` is the working path. Recorded again because
  it compounds with the lease defect above: one leaked lease costs two failures, not one.

- **A red check can be red for a reason that has nothing to do with the code.** #1521's
  `QA Experience Regression (Advisory)` failed at its *"Post PR comment"* step with a GitHub API
  403 — *"Resource not accessible by integration"* — after the check itself had already concluded
  `NEEDS_REVIEW` (advisory; the apps are not running in CI). The workflow's finding was
  informational and the job failed on a permissions grant, not on a QA result. This belongs to the
  same aggregate-conflation class already recorded three times over — infrastructure failure and
  policy or product state reported as one verdict — and it is a fourth instance rather than a new
  defect. Recorded rather than filed, per the filing threshold.

- **When a lane's only scope violation is a shared registry file, land the registration as its own
  lane instead of asking for an override.** #1521 sat one `scope-override/v1` away from mergeable
  for two days on a single violation: `.lane/lanes/governance.yml is not declared by UTV2-1843`.
  UTV2-1857 registered the same paths byte-identically in its own T3 lane; the resync then dropped
  the file from #1521's diff entirely and `File scope lock` went green with no human artifact and
  no head pinning. The override route costs one Griff round trip *per head move*, and the readiness
  bot moves heads on a schedule. This route costs one lane and is immune to that.

- **A reserved gate's blast radius is itself a measurement, and stating it from the one case that
  surfaced it understates it.** This plan said the PT1 containment admission blocked UTV2-1842 and
  that *"nothing else on the board waits on this"*. The predicate is not the issue — it is the
  mechanical tier floor: PT1 runs at T1, is waivable at no tier, and `classifyMechanicalMinimum`
  raises **any** path under a Tier C prefix to T1. `.github/workflows/` is such a prefix, so the
  CI wiring that Wave 1 step 3 needs is blocked by the same decision. The error was not a wrong
  fact; it was reporting the instance instead of the rule, and it cost nothing to correct only
  because the next lane happened to be `docs/mission/plan.md`, which floors at T3 and could still
  be opened. The general form: when recording what a gate blocks, enumerate it from the gate's own
  predicate, never from the work that happened to hit it.

- **Landing the enforcement before the admission changes what the owner is being asked.** UTV2-1848
  built and merged the closeout gate that a deferred T1 live-DB precondition would need
  (`t1_live_db_precondition` + `G6`), while admitting nothing — 0 of 752 manifests carry the field,
  asserted by a test that reads them all rather than by a claim. The reserved decision is now a
  yes/no on a three-edit diff whose protection already exists on `main`, instead of a decision to
  authorise building one. This is the shape "How a reserved decision is surfaced" in `intent.md`
  asks for, and it is reusable: the half of a reserved change that *tightens* is usually
  unreserved, and landing it first shrinks the reserved half to something reviewable.

- **A test that reads the real corpus finds defects a fixture never will.** The UTV2-1848
  acceptance test walks every `docs/06_status/lanes/*.json` on the branch, and 16 of 752 threw
  `ERR_INVALID_ARG_TYPE` out of `validateManifest` — `isPortableAbsolutePath` (`shared.ts:1884`)
  assumes a string and every closed lane's manifest carries `worktree_path: null`. Pre-existing,
  unrelated to the new field, and invisible to every hand-written manifest fixture in the suite.
  Counted and skipped explicitly with a non-vacuity assertion rather than swallowed, and recorded
  here rather than filed, per the filing threshold.

- **"lane closed, sync file removed" is still false.** `.ops/sync/UTV2-1848.yml` is tracked on
  `main` after a closeout commit whose message says it was removed. This is now confirmed on every
  lane that has checked it; the string is a template, not an observation.

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
  cost that day. **Repaired — verified on `main` 2026-09-09 at `.claude/hooks/pre-proof-validator.sh:19-38`.**
  A `case` statement now classifies before any `mktemp`, and its comment records the reasoning the
  repair candidate called for, including that `case` rather than `grep` is used on purpose because
  the filter that exists to avoid allocating a resource must not itself spawn a process. The second
  allocation is deliberately left where it is, after the commit verdict, where failing closed is
  correct. **This entry stood as "the leading candidate for the governance slot" after the fix had
  already landed** — the recorded cost of a snapshot read as current state. This is an instance of the same aggregate-conflation class as
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
