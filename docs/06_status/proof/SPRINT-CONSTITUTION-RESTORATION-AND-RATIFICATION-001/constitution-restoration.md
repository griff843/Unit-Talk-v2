# Constitution Restoration — Proof

> SPRINT-CONSTITUTION-RESTORATION-AND-RATIFICATION-001 · 2026-06-02.

## Restoration record

| Field | Value |
|---|---|
| Recovered source | `UNIT_TALK_CONSTITUTION_V1.md` (operator-provided, recovered) |
| Restored to | `docs/00_constitution/UNIT_TALK_CONSTITUTION_V1.md` |
| Method | Byte-faithful copy (`cp`), then `cmp` IDENTICAL verification |
| SHA-256 | `b22b6e5b47ece0d2b04688ad4b29e2fc3cb20fd09d00e50f91ac1e5fe3e2efc5` |
| Lines | 2483 |
| Sections | 0–23 (24 top-level) |
| Capability layers | 19 (§4.1–§4.19) — all present |
| Principles | 14 (§2.1–§2.14) — all present |
| Programs | 5 (§18.3) — all present |
| Maturity stages | 6 (§16) — all present |
| End state | §23 present |

## Faithfulness guarantees (hard rules honored)
- **No constitutional doctrine rewritten.** The file is byte-identical to the recovered source (`cmp` confirms).
- **No capability layers added or removed** — exactly 19, verified by `constitution:check` (19/19).
- **No sections deleted, no roadmap removed** — §18 roadmap + Programs 1–5 intact.
- **No constitutional meaning changed** — zero edits to the doctrine file.
- **Formatting improvements** were placed in the **README** (ToC, anchor links, navigation), keeping the doctrine file pristine and SHA-pinnable. This is the strongest preservation posture: the source stays tamper-evident.

## Artifacts created (this sprint, scoped)
| Path | Role |
|---|---|
| `docs/00_constitution/UNIT_TALK_CONSTITUTION_V1.md` | The constitution (verbatim) |
| `docs/00_constitution/README.md` | Entry point: authority, hierarchy, ToC, links |
| `docs/00_constitution/CONSTITUTION_IMPLEMENTATION_MATRIX.md` | Section → impl → enforcement → tests → CI → status |
| `docs/00_constitution/CONSTITUTIONAL_DRIFT_AUDIT.md` | Per-layer drift classification |
| `docs/00_constitution/PROGRAM_ALIGNMENT_MATRIX.md` | Programs 1–5 → layers/issues/WS/certs/runtime |
| `docs/02_architecture/CONSTITUTIONAL_LINEAR_EXECUTION_STRUCTURE.md` | Constitution→Programs→WS→Issues→Proof→Certs (restores the phantom §1 reference) |
| `scripts/constitution-check.ts` | Fail-closed preservation guard |
| `package.json` | one line: `"constitution:check": "tsx scripts/constitution-check.ts"` |

## Out of scope (pre-existing working-tree changes — NOT this sprint)
The working tree already contained unrelated modifications before this sprint (deploy/workflow/topology files, `scripts/deploy-check.*`, the dirty UTV2-1150 lane/evidence files, and other audit dirs). This sprint did **not** touch them and makes no claim about them.
