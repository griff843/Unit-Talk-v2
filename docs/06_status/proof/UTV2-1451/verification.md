# PROOF: UTV2-1451

MERGE_SHA: f254a3c467e69efb435990511a73d702946d5648

(This is the content commit for this design doc, an ancestor of this
branch's actual head -- a file cannot bind its own future hash once
further proof-doc commits land on top of it, per this repo's established
convention.)

## Summary

Design-only lane (spec-first, per the UTV2-1494 precedent for exactly this
kind of self-authorization-loophole closure). No code, workflow, or hook
behavior changes in this revision -- `docs/06_status/proof/UTV2-1451/diff-summary.md`
is the actual deliverable: a concrete, implementable design for the two
genuinely unaddressed loopholes (Tier C path guard self-authorization,
`--singleton-approved` bare flag), plus verification that the third
(mechanical T2 risk-class derivation) is already substantially shipped via
UTV2-1494's Phase 1 advisory tier classifier -- confirmed live via GitHub
API, not assumed from documentation.

## ASSERTIONS:

- [x] Investigated all three named loopholes against the actual current code (not the issue's prose alone)
- [x] Confirmed `scripts/ops/tier-classifier.ts` (UTV2-1494 Phase 1) is real, already running in CI ("Tier Classifier (advisory)"), and does not duplicate the Tier C path matrix
- [x] Did not bundle a Phase 2 (blocking) cutover of the tier classifier -- that requires its own separate PM approval per the locked spec, and bundling it here would violate that PM-locked sequencing
- [x] Produced concrete file-level designs for the two remaining loopholes, citing exact current line numbers and exact proposed schema/validator shapes reusing existing repo patterns (scope-override/v1, pm-verdict/v1, preflight tokens) rather than inventing new trust primitives
- [x] Removed placeholder empty stub files created during investigation rather than committing unfinished code
- [x] `pnpm verify` PASS (full suite; no code touched, docs-only diff)

## EVIDENCE:

```text
$ pnpm verify
env:check ... PASS
lint ... PASS
type-check ... PASS
build ... PASS
test (including live-DB suites) ... PASS
(exit code 0)
```

## Tier

T1 — governance-critical, self-authorization-loophole closure design. No runtime/domain/DB code
touched; this is a docs-only design lane.

## Owner boundary

Requires the `t1-approved` label and a Griff-authored `pm-verdict/v1` APPROVED comment bound to the
reviewed head before merge, and before any follow-up implementation lane opens against this design
(per the UTV2-1494 precedent's own PM-gate requirement: PM must approve the design before Codex/
Claude implements against it). This proof supplies neither.
