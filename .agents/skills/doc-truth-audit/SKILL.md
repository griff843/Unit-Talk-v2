# Doc Truth Audit

## V1 Scope

V1 enforces consumer truth claims for `metadata.domainAnalysis` only. Evidence verification uses domain-analysis tokens (`computeSubmissionDomainAnalysis`, `enrichMetadataWithDomainAnalysis`, `readDomainAnalysisEdgeScore`, `domainAnalysis`). ACTIVE claims for other data surfaces (settlement, lifecycle, promotion) are not verified by V1.

## V1 Governed Docs

- `docs/02_architecture/week_19_downstream_consumer_matrix.md`
- `docs/03_contracts/domain_analysis_consumer_contract.md`

## Purpose

Audit docs that claim `metadata.domainAnalysis` runtime consumers or producers.

## When to Use

- PRs that change a V1 governed doc listed above
- Manual audit of any doc making domain-analysis consumer claims

## Rules

1. Every claimed consumer must be classified as exactly one of:
   - `ACTIVE`
   - `NOT_CONSUMING`
2. `ACTIVE` requires code-level proof:
   - exact file path
   - exact symbol or reference
3. Reject speculative wording:
   - adjacent
   - possible
   - easy to wire
   - future consumer
   - ready to consume
4. If a doc mixes real and aspirational consumers without explicit status labels, fail.
5. Output categories:
   - `VALIDATED_ACTIVE` - consumer exists in code with provable domain-analysis reference
   - `INVALID_OR_UNPROVEN` - consumer claimed but no code evidence found, or a claimed `NOT_CONSUMING` surface is actually consuming
   - `MISSING_BUT_REAL` - code file has domain-analysis references but is not listed in the document
   - `FINAL_VERDICT` - PASS or FAIL

## Checker Contract

Primary entrypoint:
- `.agents/skills/doc-truth-audit/check-doc-truth.ps1 -DocPath <path>`

The checker is fail-closed for governed doc claims. It:
- rejects banned speculative wording
- parses markdown tables and section blocks that contain consumer statuses
- allows only `ACTIVE` and `NOT_CONSUMING` status values
- verifies `ACTIVE` claims against domain-analysis code evidence from `apps/**` and `packages/**`
- fails `NOT_CONSUMING` claims if the referenced code file actually contains domain-analysis consumption

## V1 Limitations

- Evidence tokens are hardcoded to domain-analysis patterns
- Running the checker against non-domain-analysis docs will still enforce banned wording and binary status rules, but ACTIVE claim verification is only meaningful for domain-analysis consumers
- MISSING_BUT_REAL reports domain-analysis files not documented in the audited doc, which is informational noise for non-domain-analysis docs
