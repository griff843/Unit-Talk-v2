# Mission Plan — live

**Owner:** Claude. Rewritten as reality changes; not a log, not a backlog, not Linear in Markdown.
**Last reconciled against live truth:** 2026-09-02

Answers five questions: what is happening now, what is executable, what is blocked, what requires
Griff, and what was learned.

---

## Reconciled current truth (2026-09-02)

Verified against live `main`, the GitHub API, and branch protection — not against docs or history.

- `main` is `717b46971`; local is in sync.
- Branch protection on `main` requires exactly four checks: `verify`, `Executor Result Validation`,
  `Merge Gate`, `P0 Protocol`. Everything else in the 70-workflow suite is advisory at the branch level.
- **Eight PRs are open. Every one of them is green on `verify` and `P0 Protocol`, and every one is
  blocked solely on `Merge Gate` demanding a human approval artifact.** Not one is blocked on a
  failing test, a type error, or a real risk finding.

That is the whole diagnosis. The system was not stuck on engineering; it was stuck on relay.

### Why the relay had become meaningless

`Merge Gate` resolved a tier from the lane manifest, and in practice every lane was admitted `T1`.
So a `.env.example` edit and a production migration demanded the identical artifact pair
(`t1-approved` label + head-bound `pm-verdict/v1`). Pricing every change as reserved prices the
genuinely reserved ones at zero attention — the failure mode is not that risky changes got scrutiny,
it is that they got the same scrutiny as typo fixes, from a human who had to service the queue.

---

## In flight

### 1. Risk-Scoped Merge Authority (RMA/v1) — **awaiting Griff, one approval**

Replaces lane-manifest tier with classification over what a diff *touches*.

- `docs/05_operations/RESERVED_RISK_SURFACES.json` — the surfaces Griff reserves, as data.
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

Before merging, the gate was proven to work by executing the real inline workflow script against
live GitHub data for this PR. It returned BLOCKED, correctly naming `merge-authority` and the
`destructive-sql` rule (the latter firing on a test fixture string — an over-reservation left in
place deliberately, since excluding test files would let a real deletion hide in one).

Classification of the currently open PRs under the new rules:

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

Six of eight release immediately. The two that stay reserved are exactly the two that write
production schema. That distribution is the point.

---

## Executable now (no human gate)

Ordered by distance to Milestone 1. None of these require Griff.

1. **Reverify the Milestone-1 PR chain against live truth** — #1488 (canonical identity) and #1477
   (rate-limit contract) are the two named starting-evidence items on the pilot path. Confirm they
   still describe the current code before treating them as current.
2. **Establish whether the Smart Form is actually deployed and reachable.** Milestone 1 step 1 is
   "reach the deployed form"; there is a known open item for missing Command Center production
   deployment, and `claude/utv2-1823-authenticate-trace` exists only locally, never pushed.
3. **Prove Track Only cannot create member delivery** — by execution path, not by reading the code.
   A kill-switch that has never been observed refusing is an untested claim.
4. **Runtime truth**: worker / ingestor / outbox. Dimension 1 of the readiness contract is BLOCKED on
   "worker DOWN" as of 2026-04-30 — that assertion is four months stale and must be re-measured
   before it is either believed or dismissed.

## Blocked

- Nothing is blocked on engineering. One item is blocked on Griff (RMA, above).
- Everything else waits only on RMA landing, or is executable now.

## Requires Griff

| Item | Why reserved |
|---|---|
| RMA/v1 governance PR | Changes merge authority itself |
| #1477, #1451 | Production DDL |
| Any production containment change | Reserved until a milestone authorizes it |

## Learned

- **The bottleneck was never capability.** Eight PRs sat green. Diagnosing that took reading branch
  protection and four check-run outputs — a question nobody had asked mechanically.
- **A control that fires on everything conveys no information.** Universal `T1` was
  indistinguishable from no policy, while costing a human decision per PR.
- **Running a new control against real data before shipping it found a real defect.** The first
  version of the secrets surface reserved `.env.example` — a committed template of variable *names* —
  which would have re-created the over-reservation the change exists to remove. It was caught by
  classifying the eight live PRs, not by reasoning about the policy.
