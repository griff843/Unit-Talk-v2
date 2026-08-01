# PROOF: UTV2-1659 — canonical Git-tracked executable-wiring scan

MERGE_SHA: 6019d32254264be6c2fa33cc59bc724c51d96d20

ASSERTIONS:
- [x] Nested `.claude/worktrees/**` files produce zero findings.
- [x] Tracked `.claude` policy and command files remain scanned.
- [x] Ignored and untracked files cannot affect canonical totals.
- [x] Newly tracked unwired files still fail closed.
- [x] Clean-clone and worktree-heavy checkout results are identical.
- [x] The canonical repository scan adds no baseline entries and reports zero new unwired tests or orphan capabilities.
- [x] The full GitHub `verify` check and writable staging DB proof passed on the PR head.

EVIDENCE:

## Verification

Focused regression run:

```text
tsx --test scripts/ops/executable-wiring.test.ts
tests 30
pass 30
fail 0
```

Canonical automation coverage:

```text
[automation-coverage] verdict=PASS fail=0 warn=1 classified=15
[executable-wiring] verdict=PASS required_roots=verify
[executable-wiring] tests total=465 required-reachable=310 optional-reachable=36 fixture-helper=0 quarantined=0 unwired=119 (baselined=119 new=0)
[executable-wiring] capabilities total=150 wired=132 orphan=18 (baselined=18 new=0)
[executable-wiring] baseline tests=119/119 capabilities=18/18
```

R-level compliance:

```text
Verdict: PASS
Changed files: 9
Rules matched: (none) — no R-level artifacts required for this diff
```

GitHub PR verification on the reviewed head:

```text
verify                              PASS
Writable DB proof (staging only)    PASS
T1 Proof Gate                       PASS
Proof Auditor Gate                  PASS
Runtime Verifier Gate               PASS
File scope lock                     PASS
R-Level Compliance Check            PASS
Merge Gate                          PASS
```

The advisory Readiness Regression Gate remains red because of pre-existing production
readiness conditions outside this issue. No production action, deployment, baseline change,
or finding downgrade was performed.
