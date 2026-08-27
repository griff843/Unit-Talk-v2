# PROOF: UTV2-1758
MERGE_SHA: 5913819c7a585e87a253209b08892a5867e318a7

Reconciliation classification correctness and authoritative in-flight manifest
resolution. T2, governance/reconciliation tooling only. No DB, contract,
lifecycle, or production surface is touched.

## Verification

ASSERTIONS:
- [x] An open PR whose manifest exists at the exact PR head no longer produces
      `ORCH-OPEN-PR-MANIFEST-URL` merely because that manifest is not yet on main.
      The manifest is read from the PR head commit and preferred over any
      main/working-tree copy.
- [x] Suppression is driven strictly by "a manifest was resolved at the PR head",
      never by "the PR is open". Proven by mutation: removing the head manifest
      restores the failure, and a head manifest recording a different PR URL
      still fails.
- [x] Linear lookup failures are classified into four distinct kinds — deleted,
      transient, auth, unknown — from the error signature alone. The previous
      coupling to "is this issue in the current working set" is removed; that
      coupling is what let one entity be classified two different ways on two
      consecutive runs.
- [x] Deleted Linear entity + active lane state emits `ORCH-LINEAR-DELETED-ORPHAN`,
      a PM-required, dispatch-blocking finding.
- [x] Deleted Linear entity + terminal historical manifest emits historical debt.
      Asserted explicitly: no check anywhere reports that entity as passing.
- [x] Transient, auth, and unclassifiable failures remain blocking infra errors.
      `ENOTFOUND` — a DNS failure whose text contains "not found" — is classified
      transient, not deleted.
- [x] Merged-PR / Linear-closeout debt is reported but does not halt dispatch when
      the lane holds no active lease, no manifest lock, and no active Linear
      record. When it does hold any of those, it still blocks.
- [x] Output is separated into `dispatch_blocking_failures`, `closeout_debt`,
      `warnings`, and `infra_errors`; every emitted check lands in exactly one
      bucket or is informational (asserted mechanically).
- [x] Exit is nonzero only when `dispatch_blocking_failures` or `infra_errors` are
      non-empty.
- [x] No hard-coded issue allowlist exists. Classification follows from lane state
      (lease, manifest status, manifest location, Linear state) and from the
      Linear error signature. No issue identifier appears in any branch condition
      in `orchestration-reconciler.ts`.

## Runtime Verification

EVIDENCE:

### 1. Unit suite — 7 regression fixtures, each with a mutation control

Every fixture asserts both the intended classification and the classification
under the condition the control names. A green-only control proves nothing.

```text
# tests 38
# suites 0
# pass 38
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### 2. Live reconciliation, before and after

`pnpm ops:orchestration-reconcile --current --json` against live Linear and
GitHub state, same working set.

| | Before (main @ b667c702) | After (5913819c) |
|---|---|---|
| checks | 1538 | 1450 |
| dispatch-blocking | 31 (undifferentiated `fail`) | 8 |
| closeout debt | not distinguished | 18 |
| warnings | not distinguished | 724 |
| infra errors | 1 (`UTV2-1432`, misclassified) | 0 |
| `ORCH-OPEN-PR-MANIFEST-URL` failures | 7 | 2 |

The five `ORCH-OPEN-PR-MANIFEST-URL` failures that cleared — UTV2-1729, 1736,
1744, 1745 and their `ORCH-LINEAR-ACTIVE-RECORD` counterparts — were reading
stale untracked working-tree copies (`status: started`, `pr_url: null`) in
preference to the authoritative branch manifests. The two that remain are
genuine and are analysed in section 3.

Remaining dispatch-blocking findings, all verified genuine:

```text
ORCH-LINEAR-DELETED-ORPHAN UTV2-1512 :: Linear entity UTV2-1512 is deleted but lane state is still active; PM disposition required before dispatch
ORCH-LINEAR-ACTIVE-RECORD UTV2-1651 :: Linear In Codex has no active lease or lane manifest
ORCH-LINEAR-ACTIVE-RECORD UTV2-1659 :: Linear In Claude has no active lease or lane manifest
ORCH-MERGED-PR-ACTIVE-MANIFEST UTV2-1512 :: PR is merged but lane manifest remains blocked; record merge SHA/status before lane closeout
ORCH-OPEN-PR-MANIFEST-URL UTV2-1652 :: Open PR exists but the matching lane manifest is missing at the PR head and on main
ORCH-OPEN-PR-MANIFEST-URL UTV2-1659 :: Open PR exists but the lane manifest resolved from PR head ef66847c38f1ee80e84da729b344213dd7d8b740 is missing the matching PR URL
ORCH-MERGED-PR-LINEAR-DONE UTV2-1659 :: Merged PR is 37352m old but Linear state is In Claude (lane still holds active Linear record)
ORCH-MERGED-PR-LINEAR-DONE UTV2-1659 :: Merged PR is 37467m old but Linear state is In Claude (lane still holds active Linear record)
```

### 3. Correction to the issue's evidence table — UTV2-1652

The issue description lists UTV2-1652 as having a manifest "present on branch",
and predicts it would stop failing. That is **not true**, and this lane did not
force it to pass.

```text
$ gh pr list --state open --json number,headRefName,headRefOid     --jq '.[] | select(.headRefName|test("1652"))'
1401 codex/utv2-1652-normal-close-worktree-cleanup 5c39f9ea6655f3eff25ef8c35b3f5e58486cc4f7

$ git ls-tree -r --name-only 5c39f9ea6655f3eff25ef8c35b3f5e58486cc4f7     -- docs/06_status/lanes/ | grep -i 1652
(no output)

$ git ls-tree -r --name-only 5c39f9ea6655f3eff25ef8c35b3f5e58486cc4f7     -- docs/06_status/lanes/ | wc -l
676
```

676 sibling manifests are present at that head, so the tree resolved fully and
this is a real absence, not a resolution failure. UTV2-1652 therefore remains
dispatch-blocking, which is the correct outcome and is exactly the anti-regression
control (fixture 4) firing on live data rather than on a synthetic input.

Fixture 3 is retained under the UTV2-1652 identifiers as a **synthetic** valid
on-branch manifest, because requirement 1 still needs a second independent
positive case. The proof for the real UTV2-1652 is that it correctly still fails.

### 4. Verification commands

```text
$ pnpm lint          -> pass
$ pnpm type-check    -> pass
$ pnpm build         -> pass
$ pnpm test          -> 98 suites, 0 failures
$ pnpm verify        -> fails only at test:live-db (environment gate)

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 5
Rules matched: (none) - no R-level artifacts required for this diff
```

`test:live-db` refuses locally by design:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL
(host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx.
Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
```

This is an environment gate, not a code failure, and it is unobtainable outside
the staging-ci environment. Required CI `verify` runs it with those credentials.
This lane is T2 and touches no DB surface.

## Known gaps

- The reconciler resolves head manifests only for **open** PRs. A merged PR's
  manifest is expected on main and is deliberately not read from its head.
- If a PR head commit cannot be fetched locally, resolution is abandoned and the
  check falls back to the working-tree copy, with an infra error recorded. This
  is fail-closed: an unresolvable head never suppresses a finding.
- The 624 `ORCH-HISTORICAL-DECAY` warnings are real deleted-entity debt spanning
  UTV2-570..1566. This lane classifies them correctly as non-blocking; it does
  not remediate them. Remediation of UTV2-1512 specifically is UTV2-1757.
- `docs/06_status/lanes/UTV2-1758.json` is not in this lane's `file_scope_lock`.
  `ops:lane-start` requires every scope path to exist before it runs, but it is
  what creates the manifest, so the manifest's own path cannot be declared at
  lane-start and `file_scope_lock` is immutable afterwards. Recorded as a known
  S1 scope-diff risk, not worked around.
