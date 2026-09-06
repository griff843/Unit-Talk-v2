# PROOF: UTV2-1845 — classify the containment placeholder distinctly in preflight PT1

MERGE_SHA: pending merge
Execution SHA: b7274edd3b1665a5074c4edd176d87d0790063b4

Preflight PT1 reported a deliberate, documented containment state as an infrastructure fault, which
made every T1 lane unopenable on a contained workstation. This lane corrects the classification and
does not change what any lane is admitted without.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1522
Verified source SHA: b7274edd3b1665a5074c4edd176d87d0790063b4

`sha_binding.merge_sha` is `null` pre-merge. `verified_source_sha` is
`b7274edd3b1665a5074c4edd176d87d0790063b4`, the last commit on this branch changing any file outside
`docs/06_status/proof/UTV2-1845/`. The binding is written after merge by
`ops:proof-generate --merge-sha`; no manual append is made here.

## ASSERTIONS:

- [x] **A1 — The containment placeholder is recognised exactly, not heuristically.**
      `isContainmentPlaceholderSupabaseUrl` matches only loopback and unspecified hosts —
      `127.0.0.0/8`, `localhost`, `::1`, `::`, `0.0.0.0` — parsed out of the URL rather than
      substring-matched.
- [x] **A2 — A real host is never mistaken for the placeholder.** Both real Supabase project URLs,
      an ordinary host, a lookalike (`https://127.0.0.1.example.com`), a malformed string and the
      empty string all return `false`.
- [x] **A3 — The predicate is checked against this repository's own configured value**, not against
      a value invented in the test: the assertion reads `SUPABASE_URL` out of `local.env`, computes
      the loopback answer independently of the function under test, and requires the two to agree.
      It therefore holds in both environments — the loopback placeholder locally, a real staging host
      in CI — where an earlier version that demanded the placeholder answer was red in CI for exactly
      that reason. `local.env` is gitignored, so the assertion is conditional on the file existing.
      See "Correction after CI" below.
- [x] **A4 — PT1 reports `blocked_by_containment` for the placeholder host**, exercised through
      `runT1Checks` rather than through the predicate alone, so the branch selection itself is
      covered.
- [x] **A5 — A real but unreachable host still reports `infra_error`.** This is the control. The
      ping fails for both inputs; only the classification differs.
- [x] **A6 — An absent credential still reports `fail`**, and is not reclassified as containment.
- [x] **A7 — The change admits nothing.** `blocked_by_containment` resolves to verdict `INFRA`
      exactly as `infra_error` does, so no lane opens that could not open before. Asserted with two
      controls: the same check list with `pass` still resolves `PASS` (the mapping is not
      unconditional), and `infra_error` still resolves `INFRA` (unchanged).
- [x] **A8 — The reserved half is written and not implemented.**
      `docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md` states the admission change,
      its closeout obligation, its options and one recommendation. No token field, no manifest field
      and no closeout check is added by this diff.
- [x] **A9 — No reserved surface is touched.** No `.github/workflows/**` file, no CODEOWNERS, no
      branch-protection change, no tier semantics, no approval artifact, no change to what `verify`
      requires. The diff is three ops scripts and one document.

## Verification

How the assertions above were established, so the evidence table is read as measurement rather than
description.

- **Executed, not inspected.** Every behavioural claim comes from tests run on this branch; counts
  are in "Commands run" (`pnpm test` — `tests 5969, pass 5969, fail 0`).
- **Both directions are asserted.** A1 says what the predicate matches and A2 says what it must not,
  including a lookalike host (`https://127.0.0.1.example.com`) that a substring match would wrongly
  accept.
- **The classification is exercised through `runT1Checks`, not through the predicate alone**, so the
  branch selection is covered rather than assumed (A4-A6), with an unreachable real host as the
  control that only the classification differs.
- **The admission claim carries its own controls.** A7 is the load-bearing safety claim — this diff
  must admit nothing — and it is asserted with two controls so the mapping cannot be vacuous: `pass`
  still resolves `PASS`, and `infra_error` still resolves `INFRA`.
- **Both mutations were executed and reverted**, and each turns a named, distinct set of tests red;
  the table records which.
- **The reserved half is verified by absence.** A8/A9 are checked against the diff: no workflow, no
  CODEOWNERS, no branch-protection, no tier or approval change. The admission change itself is
  written as a decision document and deliberately not implemented.
- **One assertion was corrected after CI disagreed with it**, rather than after review — recorded in
  full below rather than silently rewritten.

## EVIDENCE:

| Assertion | Evidence |
|---|---|
| A1, A2 | `scripts/ops/preflight.ts` — `isContainmentPlaceholderSupabaseUrl`; tests *"the containment placeholder is recognised exactly"* and *"a real host is never mistaken for the containment placeholder"* |
| A3 | test *"the repository's own containment placeholder is classified as containment"* |
| A4, A5, A6 | `runT1Checks` in `scripts/ops/preflight.ts`; the three `runT1Checks` tests |
| A7 | `resolveVerdict` in `scripts/ops/preflight.ts`; test *"blocked_by_containment admits nothing"* |
| A8 | `docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md` §4 Part 2 and §6 |
| A9 | the diff scope below |

### Commands run

```
pnpm lint                              # exit 0
pnpm type-check                        # exit 0
pnpm test                              # exit 0 — tests 5969, pass 5969, fail 0
pnpm exec tsx --test scripts/ops/preflight.test.ts
                                       # exit 0 — tests 39, pass 39, fail 0
pnpm verify                            # refused locally at test:live-db under containment; the
                                       #   binding receipt is the required `verify` check on this head
```

### Mutation evidence

A control is only proven by making it fail on the condition it names. Both mutations were executed
against this branch and reverted.

| Mutation | Command | Result |
|---|---|---|
| `isContainmentPlaceholderSupabaseUrl` returns `false` unconditionally | `pnpm exec tsx --test scripts/ops/preflight.test.ts` | `# pass 36 / # fail 3` — the exact-recognition test, the agreement test bound to the repo's own `SUPABASE_URL`, and the `runT1Checks` classification test |
| `resolveVerdict` stops considering `blocked_by_containment` | same | `# pass 38 / # fail 1` — the assertion that the new outcome still resolves to `INFRA` |

The second mutation is the one that matters: without it, a future change could silently make
`blocked_by_containment` admit a lane and nothing in the repository would notice.

### Correction after CI — a test that encoded one environment's value as the contract

`verify` was red on `98a08827e` with one failure: *"UTV2-1845: the repository's own containment
placeholder is classified as containment"*, reported as `got ` — an empty value.

The cause was in the test, not the predicate. It read `SUPABASE_URL` out of `local.env` and asserted
the answer is `true` unconditionally. That holds where this repository runs under containment; it
does not hold in CI, where `local.env` is written from the `staging-ci` environment. The test had
encoded one environment's value as if it were the contract — the same defect class this bundle's
own §"What this lane does not claim" warns about, committed one file away from it.

It now computes the expected answer independently of the function under test — parsing the host and
applying the loopback rule inline — and asserts the two agree. That is a real assertion in both
environments rather than a true one in exactly one. The verdict-bearing controls are untouched:
tests 33 and 34 still assert exact recognition and the real-host inversion, including the lookalike
`https://127.0.0.1.example.com`, and both mutations below were re-executed after the change with
identical results.

### Diff scope

```
 .../PT1_CONTAINMENT_ADMISSION_DECISION.md          | 263 +++++++++++++++++++++
 scripts/ops/preflight.test.ts                      | 137 +++++++++
 scripts/ops/preflight.ts                           |  57 ++++-
 scripts/ops/shared.ts                              |   6 +-
 4 files changed, 459 insertions(+), 4 deletions(-)
```

Measured with `git diff --stat origin/main...HEAD` excluding this lane's own manifest, sync file and
proof directory.

## What this lane does not claim

- It does **not** claim that a T1 lane can now open under containment. It cannot. The verdict is
  unchanged and that is asserted, not assumed.
- It does **not** claim the admission change is approved, safe to enable, or bookkeeping. It is a
  change to lane admission and is reserved to PM. An earlier framing of it in chat as a
  no-merge-authority-exposure ops-script change was wrong and is withdrawn in the document.
- It does **not** claim to unblock the Smart Form submission repair. That lane is unblocked by an
  operator action recorded in the decision packet §1a — `process.env` overrides `local.env`
  (`packages/config/src/env.ts:707-713`, verified by execution), so exporting staging credentials
  for one `ops:preflight` invocation opens it today. This diff is the durable repair, not that
  unblock.
- It does **not** claim `pnpm build` was re-run. It was not; this diff compiles no new application
  source and `pnpm type-check` covers the TypeScript project references.
