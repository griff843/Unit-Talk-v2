# Week 19 Contract — Doc Truth Gate V1 Scope Hardening

## Objective

Harden the existing doc-truth gate so its V1 release is truthful: workflow scope, skill description, and policy wording all match the checker's actual enforcement model (domain-analysis consumer claims only).

## Sprint Name

`SPRINT-WEEK19-DOC-TRUTH-GATE-SCOPE-HARDENING`

## Scope

### In Scope

1. **AGENTS.md** — narrow the Documentation Truth Policy's gate enforcement description to specify domain-analysis V1 scope explicitly
2. **SKILL.md** — restructure to lead with V1 scope (domain-analysis only) instead of burying it in a notes section; update examples to match
3. **Workflow** — narrow trigger paths from broad `docs/02_architecture/**/*.md` and `docs/03_contracts/**/*.md` to the two governed domain-analysis docs only
4. **Checker** — no functional changes unless required for truthfulness
5. **Verification** — confirm governed docs pass, confirm non-governed docs are not falsely represented as enforced

### Out of Scope (Non-Goals)

- Multi-surface evidence enforcement (V1.1)
- New evidence token sets for settlement, promotion, or lifecycle surfaces
- Broad architecture doc enforcement beyond domain-analysis claims
- Changes to `docs/06_status/`, `docs/04_roadmap/`, or code files
- New test infrastructure or test runner changes

## V1 Limitations

V1 of the doc-truth gate enforces:
- Banned speculative wording in any doc it is run against
- Binary consumer status (`ACTIVE` / `NOT_CONSUMING`) classification
- Code-level evidence verification for `metadata.domainAnalysis` consumer claims only

V1 does NOT enforce:
- Evidence verification for settlement, lifecycle, promotion, or other data surface claims
- Automatic discovery of new consumer contract docs
- Cross-surface drift detection

## Acceptance Criteria

1. AGENTS.md Documentation Truth Policy specifies V1 domain-analysis scope for gate enforcement
2. SKILL.md leads with V1 scope and does not overstate generality
3. Workflow triggers only on domain-analysis governed docs
4. Both governed docs pass the checker
5. All 6 repo gates pass
6. No wording anywhere claims broader gate enforcement than the checker delivers

## Verification Gates

- `pnpm test` — all tests pass
- `pnpm type-check` — clean
- `pnpm build` — clean
- `pnpm lint` — clean
- `pnpm verify` — composite pass
- Checker passes on `docs/02_architecture/week_19_downstream_consumer_matrix.md`
- Checker passes on `docs/03_contracts/domain_analysis_consumer_contract.md`

## Codex Parallel Lane

One bounded Codex task allowed. Must not edit workflow, AGENTS.md, SKILL.md, status docs, operations docs, or roadmap docs.

## Ratification

This contract is ratified as part of the Week 19 doc-truth-gate scope hardening sprint.
