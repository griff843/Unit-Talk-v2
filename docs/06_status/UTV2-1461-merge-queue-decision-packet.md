# UTV2-1461 — Merge-Queue Decision Packet

**Issue:** UTV2-1461 — pipeline strict-up-to-date merges (throughput fix 1 of 2)
**Tier:** T2 (docs-only decision packet; no code or workflow changes in this lane)
**Author:** Claude orchestrator session, 2026-07-04
**Decision requested from PM:** adopt Design A (native merge queue, requires org transfer), Design B (batched-merge protocol on current substrate), or the phased hybrid recommended in §5.

---

## 0. Problem statement (measured, not asserted)

Branch protection on `main`: `strict: true`, required contexts `verify`, `Executor Result Validation`, `Merge Gate`, `P0 Protocol`, `required_approving_review_count: 0`, no merge queue. Consequences, all reproduced on 2026-07-04:

1. **Every merge to main invalidates every open PR.** Strict mode demands the head branch contain main's tip. Each invalidated PR needs `pr-update-branch` → full CI re-run (~9 min) before it can merge.
2. **The executor-result validator is exact-SHA-bound.** After any update-branch, the `EXECUTOR_RESULT` comment must be re-posted/edited with the new head SHA, and the validator only passes once CI has *completed* on that exact SHA — so each update costs a CI cycle **plus** a re-validation round-trip.
3. **Each lane advances main twice** (squash merge + post-merge closeout bookkeeping commit), doubling the invalidation rate. (The closeout push-race hardening in the UTV2-1463 lane reduces closeout *failures*, not the advance count.)

Live measurement from today's session: PR #1148 (6-file T3) required 2 full CI cycles, 3 executor-result re-posts, and one manual re-run of a stale failed validation run before merging. PR #1149 (2-commit workflow-only T2) is on its 3rd CI cycle at time of writing purely due to base-advance churn. Effective ceiling observed: **~1 merge per 10–15 min**, peak 20 merges/day (2026-06-28), against a board that can produce 4–6 mergeable PRs per hour when lanes run in parallel.

---

## 1. Native merge-queue availability — API findings (not assumption)

Checked 2026-07-04 against the live repo:

```
gh api /repos/griff843/Unit-Talk-v2
→ "private": false, "owner": { "login": "griff843", "type": "User" }

gh api graphql: repository(owner:"griff843", name:"Unit-Talk-v2") { mergeQueue(branch:"main") { id } }
→ "mergeQueue": null            (no queue configured)

gh api -X POST /repos/griff843/Unit-Talk-v2/rulesets
  (branch ruleset, enforcement:"disabled", rules:[{type:"merge_queue", parameters:{…}}])
→ HTTP 422: "Invalid rule 'merge_queue': "
```

The 422 on a *disabled-enforcement* probe ruleset is the decisive evidence: GitHub rejects the `merge_queue` rule type outright on this repository. Merge queue is an **organization-scoped feature** — it is not offered on user-owned repositories on any plan, public or private. (Probe left no residue: `GET /rulesets → []`.)

**Conclusion: Design A is not adoptable on the current repo as-is.** It becomes available only if the repo is transferred to a GitHub organization (free for public repos). The transfer is therefore a prerequisite decision, not an implementation detail — see §2.4.

---

## 2. Design A — native merge queue (requires org transfer)

### 2.1 Required-context mapping

Merge queue re-validates required checks on a temporary `gh-readonly-queue/main/...` merge-group ref. Each required context maps as follows:

| Context | Today | Under merge queue |
|---|---|---|
| `verify` (ci.yml) | runs on `pull_request` | must add `on: merge_group` trigger; runs against the speculative merge commit — this is the *real* validation and replaces the strict-up-to-date guarantee |
| `Executor Result Validation` | PR-comment-scoped, exact head SHA | **incompatible as written**: a merge-group ref has no PR comments and the group's merge commit SHA never matches the comment. Needs a `merge_group` job that passes through when the *originating PR* already holds a valid validation (queue entry implies it passed at enqueue time) |
| `Merge Gate` | PR-event/comment driven (pm-verdict, tier logic) | same pass-through pattern: gate semantics are enqueue-time decisions; the merge_group job should report success if the PR carried a green Merge Gate when queued |
| `P0 Protocol` | path/label check on PR | add `merge_group` trigger; cheap re-run is fine |

The pass-through pattern is standard for comment/approval-style checks under merge queues: the queue's job is regression detection (does the *combination* still build?), not re-adjudication of review authority.

### 2.2 ci.yml implications

- Add `merge_group:` to `on:` for every workflow producing a required context (ci.yml, executor-result-validator.yml, merge-gate.yml, p0-protocol workflow). A required context with no merge_group run blocks the queue forever.
- The bookkeeping ci.yml path-filter work (the path-filter issue in this program) must land **first** or queue runs re-execute the full suite for docs-only closeout commits.
- Queue parameters proposed: `merge_method: SQUASH`, `min_entries_to_merge: 1`, `max_entries_to_build: 5`, grouping `ALLGREEN`.

### 2.3 Interaction with merge-wrapper and the local merge mutex

- `ops:merge-wrapper pr-merge` changes from "merge now" to "enqueue" (`gh pr merge --squash --auto` semantics under queue). The wrapper keeps its preconditions (issue/branch/PR consistency, lock bookkeeping) but no longer needs the serialization role — the queue serializes.
- The local merge mutex (`merge_serialized_max: 1`) becomes redundant for merges but should be retained for closeout bookkeeping pushes until batch closeout exists.
- `pr-update-branch` becomes unnecessary: the queue builds the speculative merge itself. The entire update→re-CI→re-post treadmill disappears.

### 2.4 The org-transfer prerequisite

Transferring `griff843/Unit-Talk-v2` → an org (e.g. `unit-talk/Unit-Talk-v2`):

- GitHub auto-redirects old remote URLs, PR links, and API calls indefinitely, but redirects are not a substitute for updating: local remotes (root checkout + every worktree), `SYNC_BOT_TOKEN` PAT scope, Linear GitHub integration attachments, deploy workflow secrets, Codex connector authorization, and any hard-coded `griff843/Unit-Talk-v2` strings in scripts/workflows (grep shows they exist in ops scripts).
- Risk class: moderate, one-time, fully reversible (transfer back). But it touches every integration at once — the kind of change that must be its own supervised issue with a checklist, not a rider on a throughput fix.

---

## 3. Design B — batched-merge protocol on current substrate (available today)

Keep strict protection; change *how* the orchestrator drains the green-PR set. The measured cost driver is not the merge itself but the per-PR `update-branch → full CI → re-post executor SHA` cycle repeated every time main advances.

**Protocol (implements in `ops:merge-wrapper` as `merge-train`):**

1. **Collect**: candidate PRs that are green (all four contexts) and gate-approved. Order: workflow/infra lanes first (they de-risk later merges), then by age.
2. **Freeze**: acquire the merge mutex once for the whole train, not per PR.
3. **Drain serially, immediately**: for PR₁…PRₙ — update-branch, wait CI on new head, patch the executor comment to the new head SHA (mechanical; the diff is unchanged, only the base merge commit moved), re-validate, merge, proceed to PRᵢ₊₁ *immediately*. No idle gaps between merges: today those gaps admit unrelated main advances that restart other PRs' cycles.
4. **Batch closeout**: run post-merge closeout once at end of train — one bookkeeping commit for N lanes instead of N commits, halving main-advances per lane. (Requires a small post-merge-lane-close.yml change: accept multiple issue IDs on `workflow_dispatch`; separate T3 issue.)

**Cost model**: today, N green PRs ≈ 2N–3N CI cycles (each merge invalidates the rest; each re-validation risks colliding with the next merge). Under a disciplined train: exactly **N** CI cycles + 1 bookkeeping advance. For N=4 that is ~40 min instead of ~2 h, with no protection changes.

**Follow-up that compounds it** (separate governance issue): teach the executor-result validator to accept a head SHA whose only difference from the validated SHA is merge-commits-from-main (ancestor-preserving update). That eliminates step 3's re-post entirely; the train then costs N CI waits and nothing else. This is a semantic change to a required check → adversarial review required.

---

## 4. Preflight-token HEAD binding and executor-result re-posts

| Concern | Design A (queue) | Design B (train) |
|---|---|---|
| Preflight tokens (HEAD-bound, 15/30-min TTL) | unaffected at lane start; fewer main advances between start and first push → fewer stale-token regenerations | same benefit via batch closeout (main advances ≈ halved) |
| Executor-result SHA re-posts | eliminated: PR head never needs to move; queue validates the speculative merge | reduced to one mechanical re-post per PR per train; eliminated entirely once ancestor-tolerant validation lands |
| Proof SHA binding (merge-SHA rebind post-merge) | unchanged — `ops:proof-generate --merge-sha` binds to the queue-produced merge SHA exactly as today | unchanged |

---

## 5. Recommendation

**Adopt Design B now; stage Design A behind an explicit org-transfer decision.**

1. **Now (this program):** implement `merge-train` in merge-wrapper (the merge-queue implementation issue in this program re-scopes to this), plus the batch-closeout workflow_dispatch change. No branch-protection changes, no new failure modes: the train degrades gracefully to today's behavior if interrupted mid-drain.
2. **Next (PM decision, separate issue):** org transfer. It is the only path to the native queue, and it also unlocks org-level runners, environments, and CODEOWNERS teams. If approved, Design A supersedes the train for merges; the train's batch-closeout half remains valuable regardless.
3. **Explicitly rejected:** relaxing `strict: true` (loses the only guarantee that combined changes were ever tested together) and widening admin-merge use (unaudited bypass of the four gates; today's sanctioned uses stay confined to stale-context repair per existing practice).

**Rollout (Design B):** land merge-train behind a `--dry-run` flag → one supervised train on 2–3 real PRs → make it the default drain path in /dispatch-board. **Rollback:** stop invoking merge-train; per-PR merging continues to work unchanged at any point — there is no state to unwind.

**Success metric:** merges/day ceiling ≥3× (from ~20 peak toward 50–60 capacity), and zero manual SHA-repair closeout commits per week (baseline: 11 since 2026-06-20).
