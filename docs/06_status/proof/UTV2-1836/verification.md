# PROOF: UTV2-1836

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-05T21:58:37.891Z
Issue: UTV2-1836
Tier: T2
Lane type: governance
Branch: claude/utv2-1836-carry-forward-collector
PR URL: N/A
Head SHA: 3c3abd3117d4af8f53bcc4a69c868e72965b4c37
result: pass

## ASSERTIONS:

- [x] Every fact the verifier consumes is produced from a source a PR author cannot write: the
      commit graph, ancestry and changed paths from `git` after a fresh `git fetch origin <base>`;
      required-check conclusions from the check-runs API at the exact head; approvals and
      withdrawals from the issue-comments and reviews APIs, restricted to a CODEOWNERS login with
      `user.type === 'User'`.
- [x] The one comment-derived value, the approval's `Head SHA:`, is re-verified rather than
      trusted — `git cat-file -e` proves it names a real commit and `git merge-base --is-ancestor`
      proves the relationship the comment merely claims.
- [x] A previously posted receipt is never read back as evidence. The receipt is an output; were it
      an input, anyone with comment access could forge an approval.
- [x] Verdict recognition reuses `parseVerdict` from `scripts/ops/merge-gate-verdict.cjs`, so the
      collector and the merge gate cannot drift on what counts as an approval.
- [x] The refuse direction was demonstrated against real GitHub evidence on PR #1503, including the
      reference case PM corrected — `b06593e94 → 6bfc5875a` carries #1507's deployment changes and
      package test wiring, is not bookkeeping-only, and is refused.
- [x] The accept direction was measured on real `origin/main` history, so this is demonstrably not
      an always-refuse control.
- [x] The Merge Gate integration is RESERVED under `docs/mission/intent.md` decision 7 and is
      **not** in this diff. Nothing calls the collector; no gate changes behaviour.
- [x] Plan reconciliation is bounded to statements measured false against `origin/main`, not a
      general cleanup pass.

## EVIDENCE:

```
$ pnpm type-check
EXIT=0

$ pnpm test
# suites 129
# tests 5540
# pass 5540
# fail 0
EXIT=0

$ pnpm exec tsx --test scripts/ops/carry-forward-collect.test.ts
# tests 20
# pass 20
# fail 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 7
Rules matched: (none) — no R-level artifacts required for this diff
EXIT=0

$ pnpm verify
Executed by the required CI `verify` context, not locally.
Run 33996599211, head 2578c9926, job `verify`, conclusion success.
2578c9926 is the sanctioned `main` resync. Between the execution SHA 3c3abd311
and it lie this lane's own manifest and the incoming `origin/main` commits; no
implementation file of this lane differs, so the run covers the execution SHA
against the base the PR will actually merge into. The earlier run 33994945082 at
f81cf471d is superseded and is not cited, because it predates the resync.
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0, full suite
- [x] `pnpm verify`: CI run 33996599211 at head `2578c9926` (the resynced head), job `verify`, conclusion `success` — no implementation file of this lane differs from the execution SHA `3c3abd311`
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, no artifacts required

## Demonstration against real GitHub evidence

Injected-input unit tests do not establish operational completion, so the collector was run against
a real pull request and against real `main` history. Every line below is command output, not a
description of it.

### Refuse direction — PR #1503, three replays

| Replay | Verdict | Refusals |
|---|---|---|
| live head | REFUSED | C2 `package.json`, `scripts/ops/approval-carry-forward.test.ts`; C3; C4 `Executor Result Validation` pending |
| `b06593e94 → 6bfc5875a` | REFUSED | C2 `deploy/production/ENV_FILES.md, deploy/rollback.sh, package.json, scripts/ci/deploy-config-rollback.test.ts`; C3 `.github/workflows/deploy.yml` |
| `535148faa → b06593e94` | REFUSED | C3 **alone**: `docs/mission/intent.md`, `docs/mission/plan.md` |

The second row is the case PM corrected: that delta is not bookkeeping-only and must not pass. It
does not.

The third row is the discrimination that matters — 11 of its 13 commits are pure bookkeeping, and
it still refuses, on the two authority-bearing files and nothing else.

### Accept direction — real `origin/main` windows

```
C3 over 199 real first-parent windows on origin/main: ADMIT 150, REFUSE 49
sample admitted:
  19cdba3af..175f07c10  docs/06_status/readiness/readiness-score.json
  8b3a841cc..19cdba3af  .ops/sync/UTV2-1818.yml, docs/06_status/lanes/UTV2-1818.json, ...
  1d76b75e1..1faf29c35  .ops/sync/UTV2-1834.yml, docs/06_status/lanes/UTV2-1834.json, ...
```

Admitted windows are readiness-ledger and other lanes' bookkeeping — precisely the head-pinning tax
UTV2-1818 was filed against. A control that refused everything would be useless and would also pass
a refusal-only proof; that is why this measurement is here.

## What is NOT proven

- **The collector has never gated a merge, by design.** The `merge-gate.yml` call site is reserved
  and is deliberately excluded. What is proven is that it produces correct, unforgeable inputs and
  that the verifier reaches the right verdict on real cases.
- No runtime proof is claimed. This diff ships no code path, query or configuration into any
  running container and touches no pick-pipeline write path.
- No claim is made that this mechanism *should* be wired into merge authority. That is a PM
  architecture decision this lane does not pre-empt.

## A measurement error found and corrected during this lane

The first accept-direction scan reported `ADMIT 0, REFUSE 199` — which would have been a strong
claim that the control is useless. It was wrong: `evaluateC3` returns `{ result, admitted }`, and
the scan read `r.status` instead of `r.result.status`, so `status` was `undefined` and never
`'pass'`. Recorded because the failure mode is the one this repo keeps paying for — a plausible
reading asserted instead of generated — and because an unexplained all-refuse result is exactly the
kind of number that gets written into a bundle unchallenged.

## Runtime Verification

None claimed. See "What is NOT proven".

## Reserved surfaces deliberately untouched

`strict: true` branch protection, the four required contexts, `.github/workflows/merge-gate.yml`,
CODEOWNERS and every existing guard remain exactly as they are. Nothing was written to `main`
outside the normal PR path.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Approved PR head: pending merge
Execution SHA: 67a2795cb89bccf2147a412e2ea46d37e933458d
