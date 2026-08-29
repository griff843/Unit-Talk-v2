# /pr-unblock

A PR is red, `BLOCKED`, or stalled with no visible reason. This skill diagnoses which gate is actually refusing and why, and encodes the traps where GitHub's reported state is misleading.

Use `/verification` before claiming a merge is *allowed*. Use this skill when the merge is *refused*.

---

## The four required contexts

Branch protection on `main` requires exactly these, and nothing else is blocking:

```
verify · Executor Result Validation · Merge Gate · P0 Protocol
```

Confirm rather than assume — the list is authoritative from the API, not from this file:

```bash
gh api repos/:owner/:repo/branches/main/protection --jq '.required_status_checks.contexts'
```

Any other red check (Proof Auditor Gate, T1 Proof Gate, File scope lock, Lane authority, Close eligibility preflight) is **advisory for merge purposes** — it does not block the merge button, though it may still block closeout or violate policy. Never report "CI is red" without naming which context and whether it is required.

---

## Step 1 — get the real state, bound to the real head

```bash
pnpm ops:pr-block-diagnostic --pr <number> --json
pnpm ops:merge-ready --pr <number> --explain
gh pr view <number> --json headRefOid,mergeStateStatus,isDraft,reviewDecision
gh pr checks <number>
```

**Trap A — `mergeStateStatus` lies about scope.** It is computed from the *whole* check rollup, not the required subset. A parked or unrelated red workflow makes every PR read `BLOCKED` even when all four required contexts are green. Always cross-check the four contexts individually before treating `BLOCKED` as real.

**Trap B — stale head binding.** Every governance artifact is head-pinned. Compare each artifact's SHA against `headRefOid`; a green check bound to an older SHA is not a green check for this head.

---

## Step 2 — match the symptom

### `Executor Result Validation` is `pending` and never runs

This context is created **only** by an `EXECUTOR_RESULT` comment. No amount of pushing will create it, and a PR can sit `BLOCKED` with everything else green forever. Post the comment (schema: `docs/05_operations/schemas/executor-result-v1.md`) referencing the exact current head SHA.

After **any** branch refresh, force-push, or new commit, the previous executor result is bound to a dead SHA and must be reposted.

### `Merge Gate` red with no verdict, or a check titled `EVALUATING` that has a conclusion

Merge Gate has 403'd on GitHub's Actions check-run rule during its supersede loop and died before writing a verdict. A check-run titled `EVALUATING` that carries a conclusion is **stale residue, not a decision**. Re-trigger rather than interpret it:

```bash
gh workflow run merge-gate.yml -f pull_number=<number>
```

Merge Gate triggers on `pull_request` (`opened`, `synchronize`, `reopened`, `labeled`, `unlabeled`, `ready_for_review`), `pull_request_review`, `issue_comment`, and `workflow_dispatch`. If none of those has fired since the state you care about, the gate has simply not looked yet.

### Merge Gate warns about bounce count

Merge Gate trips a warning at **three** authorized `CHANGES_REQUIRED` pm-verdicts on one PR. Check the count proactively after the second bounce — discovering it on the third costs a cycle.

```bash
gh pr view <number> --json comments --jq '[.comments[] | select(.body | test("CHANGES_REQUIRED"))] | length'
```

### PR is a draft

Codex opens PRs as drafts. Confirm `isDraft` and mark ready before expecting review-driven gates to settle:

```bash
gh pr ready <number>
```

### `verify` failed and a rerun makes it worse

**`gh run rerun --failed` is structurally broken in this repo.** The `verify` job consumes an attempt-scoped artifact (`utv2-1630-db-proof-receipt-<run>-<attempt>`) produced by the sibling job `staging-db-proof`. A failed-jobs-only rerun starts a new attempt with no sibling to produce the artifact, so `verify` fails on a missing dependency that has nothing to do with the original failure.

Always run a **full** rerun:

```bash
gh run rerun <run-id>
```

### `verify` failed on `pnpm audit --prod`

A newly published advisory blocks every open PR at once. The fix is a `pnpm-workspace.yaml` override (pnpm 10 ignores `package.json` overrides here), landed as a standalone chore PR — never smuggled into a feature lane.

### `verify` failed but tests pass locally

Two known false-red sources before you debug the code:

- **Live Supabase degradation.** Small live-DB suites flake during an outage. Re-run `pnpm test` standalone to confirm before treating `main` as red.
- **Bare `tsx`.** A global `tsx --test` fails module resolution repo-wide, even on `main`. Use `pnpm exec tsx`.

### `File scope lock` red

See `/lane-recovery` S2. The guard reads the manifest from its first-adding commit and cannot be satisfied by editing the branch. The only exit for a legitimately wider scope is a PM `scope-override/v1` comment on the PR.

### `Check issue references` red

A commit message references a UTV2 ID other than the lane's. Grep every commit on the branch before pushing — this violation recurs and is cheap to prevent:

```bash
git log origin/main..HEAD --format='%s%n%b' | grep -oE 'UTV2-[0-9]+' | sort -u
```

Fix by rewriting the offending messages, not by adding the foreign ID to the sync file.

### Label operations appear to succeed but nothing changes

`gh pr edit --add-label` can silently no-op behind a Projects-classic GraphQL warning. Verify after every label write and fall back to REST:

```bash
gh pr view <number> --json labels --jq '.labels[].name'
gh api -X POST repos/:owner/:repo/issues/<number>/labels -f 'labels[]=<label>'
```

---

## Step 3 — re-authorization after a head change

Any push, refresh, or amend invalidates every head-pinned artifact. Re-authorize in this order — the ordering matters because the executor result must describe a *verified* head:

1. Confirm the new `headRefOid`.
2. Let `verify` settle green on that head.
3. Repost `EXECUTOR_RESULT` bound to the new head.
4. Repost or re-apply any `scope-override/v1`.
5. Regenerate and rebind proof if the proof content changed (`/proof-authoring`).
6. Request the independent review at the new head.
7. Only then request PM verdict / `t1-approved`.

Requesting a verdict before step 2 produces a verdict that a later push silently invalidates.

---

## Rationalization resistance

- "CI is green" — name the four required contexts and their SHAs, or you have not checked.
- "It says BLOCKED so we're blocked" — see Trap A.
- "The check exists, so it ran" — a `pending` required context that nothing creates is the default state, not a transient one.
- "I'll rerun just the failed job" — that specific action breaks `verify` here.
- "The reviewer approved it earlier" — approval is head-pinned. Earlier is not now.

## Red flags — stop and report

- A required context whose creating event you cannot name.
- A green check whose SHA you did not compare to `headRefOid`.
- Any impulse to merge via the REST API to route around a gate, absent an explicit PM instruction naming that gate.
