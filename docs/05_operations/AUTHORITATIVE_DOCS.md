# Authoritative documents

Index of canonical documents by topic. Moved verbatim from the root `CLAUDE.md` (WORK-2026112502) so it is read on demand instead of at every session start. If a document here and the root `CLAUDE.md` disagree, the document wins.

| Topic | Document |
|---|---|
| Master execution map (phases 1–8) | `docs/05_operations/EXECUTION_MAP.md` |
| Master modeling sequence (elite-core / human-like-core) | `docs/05_operations/MODELING_SEQUENCE.md` |
| Three-lane workflow spec | `docs/05_operations/WORKFLOW_SPEC.md` |
| Execution truth model | `docs/05_operations/EXECUTION_TRUTH_MODEL.md` |
| Done-gate (`ops:truth-check`) | `docs/05_operations/TRUTH_CHECK_SPEC.md` |
| Lane manifest schema + lifecycle | `docs/05_operations/LANE_MANIFEST_SPEC.md` |
| Delegation policy (tiers, reshaping) | `docs/05_operations/DELEGATION_POLICY.md` |
| Sonnet-5-era operating model (Outcome Contracts, PM gates, runtime validation by tier, cutover) | `docs/05_operations/OPERATING_MODEL_SONNET5.md` |
| Evidence bundle template | `docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md` |
| Docs authority map | `docs/05_operations/docs_authority_map.md` |
| Program status snapshot (dated; check its "Last verified" line; live evidence and `docs/mission/plan.md` override it. `PROGRAM_STATUS.md` is superseded audit history) | `docs/06_status/CURRENT_STATE.md` |
| Codebase guide (architecture reference) | `docs/CODEBASE_GUIDE.md` |
| Phase 7 ratification + execution plan | `docs/06_status/PHASE7R_RATIFICATION.md`, `docs/06_status/PHASE7E_EXECUTION_PLAN.md` |
| SGO / provider knowledge | `docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md` |
| Known debt | `docs/06_status/KNOWN_DEBT.md` |
| Executor result schema | `docs/05_operations/schemas/executor-result-v1.md` |
| PM verdict schema | `docs/05_operations/schemas/pm-verdict-v1.md` |
| Proof template | `docs/06_status/proof/PROOF-TEMPLATE.md` |
| **Smart Form product intent** | `docs/03_product/smart-form/intent.md` |
| **Command Center product contract** | `docs/03_product/COMMAND_CENTER_PRODUCT_CONTRACT.md` — the sole authority for what Command Center is and must do |

### Product intent — required reading when you touch a product surface

A product's intent document is required reading before any task that changes how that product
behaves for its operator — **including backend work** in `apps/api`, `packages/domain` or the
pipeline that changes what the product can do or what it records. Read it alongside the canonical
contracts it indexes, and carry the applicable acceptance criteria into any delegated packet.

| Product | Intent |
|---|---|
| Smart Form (operator pick intake) | `docs/03_product/smart-form/intent.md` |
| Command Center (operator control plane + intelligence platform) | `docs/03_product/COMMAND_CENTER_PRODUCT_CONTRACT.md` — a full product **contract**, not an intent doc. It is required reading, and unlike the intent documents below it is authority. |
| Pipeline (grading, settlement, CLV) | *written when that product is next worked* |

Product *intent* documents are not gates. They add no check, no approval artifact and no lane type,
and no work waits on one being written.

**Command Center is the exception, and deliberately so.** It is governed by a product *contract*,
not an intent document, because more than twenty Command Center documents had accumulated on `main`
and several independently claimed canonical authority over overlapping scope. All of them are now
archived under `docs/archive/command-center/` and are historical evidence only. Answer "what should
Command Center do?" from `COMMAND_CENTER_PRODUCT_CONTRACT.md` alone.
