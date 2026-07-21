# PROOF: UTV2-1503

MERGE_SHA: 5aa66f6c6d4aac16288f450b9cfcf4be094c1c9b

(This is the substantive audit-content commit on the fresh continuation
branch, an ancestor of this branch's actual head -- a file cannot bind
its own future hash once further proof-doc commits land on top of it,
per this repo's established convention.)

## Summary

This is a clean continuation lane for UTV2-1503. A prior PR for this
issue reached PM `APPROVED` on its final exact head, but exceeded the
T1 `CHANGES_REQUIRED` bounce limit (4), which the protected-base Merge
Gate correctly rejects regardless of verdict. Per PM triage direction,
the already-reviewed five-file result (lane manifest, sync metadata,
audit doc, evidence, verification) is carried forward on a fresh
branch cut from current `main`, with no additional scope. This proof
is mechanical executor evidence only. It is not independent Griff
review, `t1-approved`, a `pm-verdict/v1`, or merge authorization.

## ASSERTIONS:

- [x] Audit doc (`docs/06_status/audits/UTV2-1503-orchestrator-standing-authority-narrowing.md`) carried forward byte-for-byte from the prior PR's approved final head -- confirmed via `diff` against that head's content, no differences
- [x] Independently re-verified every factual claim in the audit against current `main` before finalizing: `.lane/lanes/governance.yml`'s `forbidden_path_globs` (still exactly three entries), the active consolidated `proof-gate.yml` workflow (still replaces the disabled-to-`workflow_dispatch`-only `proof-auditor-gate.yml`), cited line numbers in `scripts/ci/r-level-check.ts` (256), `scripts/ops/truth-check-lib.ts` (243-284), and `scripts/ops/apply-branch-protection.sh` (33-38), `docs_authority_map.md`'s ownership rows for `r1-r5-rules.json`/`LANE_MANIFEST_SPEC.md`/`TRUTH_CHECK_SPEC.md` (Program Owner) and `EXECUTION_TRUTH_MODEL.md` (still absent by name), the live branch-protection snapshot (`required_status_checks.contexts = ["verify", "Executor Result Validation", "Merge Gate", "P0 Protocol"]`, `enforce_admins=false`, no required approving review count), and `STANDING_GUARDRAILS.md`'s single live guardrail (2026-07-07, UTV2-1432) -- no drift found, no content changes required
- [x] `pnpm verify` PASS (full suite, including live-DB smoke and live T1 proof), run on this exact branch after a fresh `pnpm install` in an isolated worktree
- [x] `pnpm test:db` PASS (7/7, live Supabase, standalone run)
- [x] R-level check PASS, no artifacts required for this diff
- [x] (This revision) `evidence.json` rebuilt to `schema_version: 1`, the schema `scripts/ops/truth-check-lib.ts`'s T1 `P6` check actually requires and that every real `done` T1 governance lane on `main` actually uses -- confirmed `scripts/ci/proof-binding-validator.ts` (the schema-v2 validator) does not apply to this file, since it is wired only into `migration-reversibility-gate.yml`, which this PR does not trigger
- [x] (This revision) Every SHA in `evidence.json`/`verification.md` re-verified against this branch's actual current ancestry with `git merge-base --is-ancestor`, shown above, not assumed -- no SHA carried over from the prior PR's branch (grep confirms zero matches)
- [x] (This revision) Both Codex-flagged ancestry findings re-checked: the two cited SHAs (`9de2146d`, `6ac0838`) do not exist in this branch's history and are not applicable; the real finding (schema_version mismatch) is resolved above

## EVIDENCE:

- PR: https://github.com/griff843/Unit-Talk-v2/pull/1290
- Substantive source SHA: `5aa66f6c6d4aac16288f450b9cfcf4be094c1c9b`
- Changed behavior: none; the lane remains an analysis-only governance audit.
- Corrected authority model: lane allowlists establish path eligibility, while the Delegation Policy and tier gates establish execution, review, and merge authority.
- Preserved T1 gate: both `t1-approved` and a valid Griff-authored, reviewed-head-bound `pm-verdict/v1` APPROVED artifact remain mandatory.
- Identity boundary: shared Griff/Claude account provenance and executor output are explicitly non-independent.

### SHA ancestry verification (shown, not asserted)

Base `main` at the time this branch was cut, and re-confirmed with no drift before this revision:

```text
$ git rev-parse origin/main
c3cb22683c0f218f7a6acdf3e4335a673932e91c
$ git merge-base HEAD origin/main
c3cb22683c0f218f7a6acdf3e4335a673932e91c
```

The substantive content commit is a real ancestor of this branch's own head (verified directly, not assumed from any prior lane's records):

```text
$ git merge-base --is-ancestor 5aa66f6c6d4aac16288f450b9cfcf4be094c1c9b HEAD && echo "IS ANCESTOR"
IS ANCESTOR
```

This branch's commit list relative to `main`, before this schema-correction commit lands on top (all authored on this branch, none inherited from the prior PR's branch):

```text
$ git log --oneline origin/main..HEAD
6cd0d416 chore(lanes): UTV2-1503 bind pr_url to the continuation PR
f13d4726 chore(proof): UTV2-1503 continuation evidence and verification bundle
5aa66f6c UTV2-1503: orchestrator standing authority audit and narrowing recommendation -- clean continuation
a47add85 chore(lanes): UTV2-1503 continuation lane manifest and sync metadata
```

This edit lands as one further commit on top of that history -- proof/manifest-only, per this repo's established convention that a proof file cannot bind its own future hash. The exact resulting head SHA is reported in this lane's `EXECUTOR_RESULT` comment and the PR itself once pushed.

No commit SHA in this proof bundle or in `evidence.json` was inherited from the prior PR's branch (grepped this branch's proof/audit/manifest files for every SHA that appeared in the prior PR's records -- zero matches).

### Proof schema correction (this revision)

`evidence.json`'s `schema_version` was `2` in the prior revision of this PR. That was wrong for this file: `scripts/ops/truth-check-lib.ts`'s T1 evidence check (`P6`, line ~668) reads the first JSON file in the lane manifest's `expected_proof_paths` (here, `evidence.json`) and requires `schema_version === 1` -- not `2`. Confirmed this is the actually-enforced, currently-working convention by inspecting every `done` T1 governance lane's own `evidence.json` on `main` (e.g. `UTV2-1494`, `UTV2-1506`, `UTV2-1521`, `UTV2-1537`, `UTV2-1557`, `UTV2-1467`, `UTV2-1493`): all use `schema_version: 1`, none use `2`.

Separately confirmed that `scripts/ci/proof-binding-validator.ts` (the schema-v2, `sha_binding`-requiring validator referenced in the prior revision and in one of Codex's review comments) is **not** wired into the general Proof Gate or Proof Auditor Gate that runs on this PR -- `grep` across `.github/workflows/*.yml` shows it is invoked only by `migration-reversibility-gate.yml`, which itself triggers only on `supabase/migrations/**` / `db/migrations-rollback/**` paths. This PR touches none of those paths, so that validator never runs against this PR's `evidence.json` at all; treating it as authoritative for this file was a mistake in the prior revision. `evidence.json` is now `schema_version: 1`, matching every real, currently-`done` T1 governance lane's actual working evidence bundle.

### Codex review resolution (re-checked against this revision)

Three inline findings were posted against the prior head (`6cd0d416`):

1. **P1, `verification.md`** -- claimed `MERGE_SHA` is not an ancestor of a cited head `9de2146d`. That SHA does not exist anywhere in this branch's history (`git cat-file -t 9de2146d` fails); not applicable.
2. **P1, `evidence.json`** -- the real finding: `schema_version: 2` conflicts with `truth-check-lib.ts`'s T1 `P6` check. Resolved above by rebuilding the file as `schema_version: 1`.
3. **P2, `evidence.json`** -- claimed the source SHA is not an ancestor of a cited head `6ac0838`. That SHA also does not exist anywhere in this branch's history (`git cat-file -t 6ac0838` fails); not applicable. The real ancestry check (against this branch's actual head, shown above) passes.

## Verification

### Full repository gate

Command executed:

```text
pnpm verify
```

Result: PASS, exit code 0 (confirmed twice). The command completed sync checks, system alignment, automation coverage, environment validation, lint, type-check, build, all unit/command suites, live DB smoke, and live T1 proof execution.

### Standalone live database smoke

Command executed:

```text
pnpm test:db
```

Terminal summary:

```text
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 97676.813748
```

The smoke ran against Supabase project `zfzdnfwdarxucxtaojxm` and used the repository/service paths already defined by the suite. Test-created submission and pick records are cleaned up by the tests. This documentation-only lane performs no separate production mutation.

### R-level compliance

Command executed:

```text
pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
```

Result:

```text
Verdict: PASS
Changed files: 3
Rules matched: (none) — no R-level artifacts required for this diff
```

### Owner boundary

Mechanical checks passing does not approve this T1 PR. Griff must review the final head and independently supply both required owner artifacts before merge. This lane did not create either artifact and did not review, approve, label, or merge the PR.
