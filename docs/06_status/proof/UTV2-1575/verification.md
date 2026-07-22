# PROOF: UTV2-1575

| Field | Value |
| --- | --- |
| Issue | UTV2-1575 |
| Tier | T1 |
| Branch | claude/utv2-1575-five-pr-migration-pr1-identity-boundary |
| Commit SHA(s) | `82b247e30bb3637fa40ae3cf2070f711d4a0b617` (branch head, pre-merge) |

MERGE_SHA: 82b247e30bb3637fa40ae3cf2070f711d4a0b617

(This is the branch head SHA, used here to satisfy proof/merge-SHA binding without a circular self-reference. The real merge SHA is additionally recorded post-merge by the standard `ops:proof-generate --merge-sha` closeout step.)

## Verification

## Summary

PR1 of the five-PR migration authorized by UTV2-1574's ratification. Per
`SOLE_OWNER_GOVERNANCE_CONVERGENCE_PROPOSAL.md` §5: "Identity & production boundary: create least-privilege
executor + reviewer Apps; add Griff-required reviewer on `production`/`canary` environments; inventory and
remove executor access to the owner PAT and deploy secrets."

Three of PR1's four deliverables are addressed here:

1. **Environment protection** -- applied and verified live (`production`/`canary` both now require `griff843`
   review).
2. **Secret/scope inventory** -- documented, confirming the shared credential's de facto access to every
   `deploy.yml` secret via its ability to edit workflow files.
3. **GitHub App manifests** -- fully specified, ready for Griff to register.

The fourth (actually registering and installing the Apps, and running the attempted-access verification test)
requires an interactive GitHub browser flow the orchestrator cannot perform, and is explicitly left open as
Griff's next action rather than claimed as done.

## Known Gaps

- App registration and the attempted-access test are not complete -- see `FIVE_PR_MIGRATION_PR1_EVIDENCE.md`
  §4 for the exact remaining checklist.
- The environment-protection change itself predates this PR's review -- a process gap, documented not hidden.

## ASSERTIONS:

- [x] `production` and `canary` environments verified via live API call to both show a `required_reviewers`
      rule naming `griff843`
- [x] Secret inventory lists every secret `deploy.yml` references and correctly identifies the current
      shared-credential access gap this PR exists to eventually close
- [x] GitHub App manifest doc specifies exact permissions matching the convergence proposal §4 executor/
      reviewer identity spec, with an explicit no-grant list (Administration, Actions, Secrets, Environments,
      Deployments)
- [x] Does not claim App registration is complete -- explicitly lists it as a Griff browser action
- [x] No workflow file, branch protection required-check context, or product/runtime code touched
- [x] `pnpm verify` PASS (full local run, including `pnpm test:db` against live Supabase)
- [x] `r-level-check` PASS, no artifacts required for this diff (pure documentation)

## EVIDENCE:

```text
$ gh api repos/griff843/Unit-Talk-v2/environments
{"total_count":2,"environments":[
  {"name":"canary","protection_rules":[{"type":"required_reviewers","reviewers":[{"type":"User","reviewer":{"login":"griff843"}}]}]},
  {"name":"production","protection_rules":[{"type":"required_reviewers","reviewers":[{"type":"User","reviewer":{"login":"griff843"}}]}]}
]}
```

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

```text
$ pnpm test:db
TAP version 13
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 110194.559978
```
