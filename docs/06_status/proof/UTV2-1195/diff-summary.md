# UTV2-1195 — Diff Summary

**Lane:** SPRINT-CERTIFICATION-STATE-RECONCILIATION-003
**Tier:** T2 · **Lane type:** governance · **Executor:** Claude (doc authoring) + PM (ratify) + Codex (canonical types regen)
**Closes:** D-CONST-3 (missing canonical cert records); cleans up D-CONST-1 / D-CONST-2 stale references; D-CONST-7 **parity-gate half** (types-regen half deferred to a Codex Migration lane — see note below)
**Constraint honored:** No certification advanced. P3/P4/P5 not advanced. P5 stays FROZEN. No runtime behavior change.

## Files changed (8 — matches `file_scope_lock`)

> **Lane-contract gap-fix:** `.lane/lanes/governance.yml` adds `docs/06_status/programs/**` and
> `docs/06_status/CERT_BOARD.md` to the governance lane's `allowed_path_globs`. Certification
> authority records are governance artifacts but were absent from the contract (historically
> edited via non-UTV2 `chore/*` branches that skip lane-check). `.lane/**` is already governance-
> allowed, so this extension is in-scope; it is included for PM ratification.

| File | Change |
|---|---|
| `docs/06_status/programs/PROGRAM_1_CERTIFICATION.md` | **NEW.** Canonical P1 (Truth) certification record — ACTIVE_CERTIFIED. Transcribes the existing frozen-surface cert (Linear `PROGRAM_1_FROZEN_SURFACE`, SHA `9600938`, eval 2026-05-27, replay-reproducibility proof all-PASS, re-cert 2026-08-25) into a repo-canonical doc. Closes **D-CONST-3** (P1). |
| `docs/06_status/programs/PROGRAM_4_CERTIFICATION.md` | **NEW.** Canonical P4 (Execution & Economic Truth) record — **CONDITIONAL_NOT_CERTIFIED.** Documents 12/12 INIT-4.x lanes (UTV2-1132–1143) done + TC-PASS execution evidence; names the economic-truth gap (CLV/attribution code-only, no realized data). Supersedes "P4 certified: YES" claims. Closes **D-CONST-3** (P4). |
| `docs/06_status/programs/PROGRAM_2_CERTIFICATION.md` | §18.3 cleanup (D-CONST-1): §1 relabel — this doc certifies WS-1.x foundation, which is canonically **P1 (Truth)** substrate; canonical P2 = Governance. Cross-refs `PROGRAM_1_CERTIFICATION.md`. No cert change. |
| `docs/06_status/CERT_BOARD.md` | §18.3 canonical-mapping markers (D-CONST-1): "Program 1" declaration = canonically **P2 Governance** (INIT-2.x); "Program 2" declaration = canonically **P1 Truth** (WS-1.x). SUPERSEDED marker (D-CONST-2) on the stale "P4 certified / P1–P4 gate SATISFIED / P5-A eligible" effect lines. |
| `docs/06_status/programs/PROGRAM_5_ACTIVATION.md` | Corrected activation-gate table to canonical state (D-CONST-2): P3 = ACTIVE_NOT_CERTIFIED, P4 = CONDITIONAL_NOT_CERTIFIED → "P1–P4 certified" gate **NOT** satisfied; P5 stays FROZEN. SUPERSEDED marker on the stale gate block. |
| `.github/workflows/live-schema-parity.yml` | **D-CONST-7 (gate):** parity is now **non-skippable when required** — `check-config` computes a `required` flag (CI_REQUIRE_SCHEMA_PARITY ∥ protected ∥ main), and a new `enforce-parity-required` job **fails closed** when required && DB unconfigured. Silent skip downgraded to a LOUD skip on feature refs. |
| `scripts/ci/live-schema-parity-workflow.test.ts` | Added a test asserting the fail-closed gate (required output + CI_REQUIRE_SCHEMA_PARITY + `enforce-parity-required` job with `exit 1`). |

## Numbering reconciliation (§18.3 — D-CONST-1, PM_RATIFIED)

The pre-convergence numbering inverted P1/P2 for the foundation/governance layers:

| Historical label | Issues | Canonical (§18.3) |
|---|---|---|
| "Program 2 = WS-1.x" (`PROGRAM_2_CERTIFICATION.md`) | INIT-1.x (1083–1095) | **P1 Truth** substrate |
| "Program 1" (`CERT_BOARD.md` declaration) | INIT-2.x (1096–1111) | **P2 Governance** |

No certification evidence was deleted; only program *labels* were corrected via banners/markers.

## D-CONST-7 lane split (types regen deferred)

`packages/db/src/database.types.ts` is owned exclusively by the **Migration lane** per
`docs/governance/LANE_TAXONOMY.md` ("generated — only via `pnpm supabase:types` after migration
merges"; a Governance lane is forbidden from `packages/**`). The lane-authority CI gate enforces this.
Accordingly this **governance** lane delivers the D-CONST-7 **parity-gate** half (`live-schema-parity.yml`
fail-closed + test); the **types-regen** half (`execution_intents` + `settlement_corrections`, both
confirmed present in live schema `zfzdnfwdarxucxtaojxm` but absent from the generated types) is
**deferred to a separate Codex Migration lane** (T1, PM-approved) — consistent with the issue's
"Codex (types)" executor split. The now-fail-closed parity gate surfaces this exact drift until regen lands.
