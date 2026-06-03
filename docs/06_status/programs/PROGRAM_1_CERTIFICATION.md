# Program 1 Certification Record

> **CANONICAL CERTIFICATION RECORD — P1 TRUTH CONVERGENCE**
> Authoritative numbering and activation state are defined by `docs/00_constitution/UNIT_TALK_CONSTITUTION_V1.md` §18.3 and `docs/00_constitution/CANONICAL_PROGRAM_STATE.md`. This document is the canonical **repo** home of the P1 certification record, created under `SPRINT-CERTIFICATION-STATE-RECONCILIATION-003` (UTV2-1195) to close **D-CONST-3** (P1 certification previously lived only in Linear `PROGRAM_1_FROZEN_SURFACE` + a repo proof JSON — asymmetrically represented).
> **This document advances no certification.** It transcribes the *existing* P1 certification evidence (frozen-surface evaluation 2026-05-27, SHA `9600938`) into a canonical, SHA-bound repo record per constitution §10. Where any older doc conflicts with the canonical program state, the canonical state governs.

**Program:** P1 — Truth Convergence (constitution §18.3)
**Canonical status:** **ACTIVE_CERTIFIED** (`CANONICAL_PROGRAM_STATE.md`, D-CONST-2 `PM_RATIFIED` 2026-06-02)
**Certification origin:** Linear `PROGRAM_1_FROZEN_SURFACE` — frozen-surface evaluation **2026-05-27**, merge SHA `9600938a557297b839dad4dca850ed89096f595e`
**Primary proof artifact:** `docs/06_status/proof/PROGRAM1/replay-reproducibility-20260527-main-9600938.json`
**Re-certification deadline:** **2026-08-25** (auto-degrade of `proof_lineage` + `freshness` domains)
**Authority:** PM (griffadavi) — sole certification issuer (§10)
**Capability layers (§4):** 4.1 (Data Acquisition), 4.2 (Market Truth), 4.13 (Observability) + Replay domain (§5.3.6)

---

## 1. Program Identification

**P1 = Truth Convergence** — the immutable market-truth and runtime-integrity substrate (constitution §18.3, Maturity Stage 1–2).

P1 establishes raw-payload capture, immutable odds snapshots, point-in-time reconstruction, freshness honesty, the canonical replay substrate, and runtime invariant enforcement. Per §18.3 this is **Program 1**. The pre-convergence numbering scheme that labeled this foundation work "Program 2" (in `PROGRAM_2_CERTIFICATION.md`) is **non-canonical** (D-CONST-1, `PM_RATIFIED`); see §6.

---

## 2. Certification Basis — Frozen Surface (primary)

P1 certification is anchored to the **frozen-surface evaluation** recorded in Linear `PROGRAM_1_FROZEN_SURFACE` and proven by the replay-reproducibility bundle on disk:

| Field | Value |
|---|---|
| Proof ID | `program-1-replay-reproducibility-merged-main` |
| Generated | 2026-05-27T12:00:00Z |
| Merge SHA | `9600938a557297b839dad4dca850ed89096f595e` |
| Evidence SHA | `ad918ac05afd721f8c9fc21bd20a6cd96c7705e5553fa1a97758f043eb27f846` |
| Domains | replay, invariant, divergence, quarantine, proof_lineage, freshness, cert_evidence |
| Constraints | deterministic clocks only · deterministic replay ids only · append-only evidence · no runtime expansion |
| Auto-degrade (`expires_at`) | 2026-08-25T12:00:00Z |

**Reproducibility verdicts (run A vs run B, both `event_count=20`, `revocation_event_count=6`):**

| Verdict | Result |
|---|---|
| `hash_equality` | **PASS** |
| `event_equality` | **PASS** |
| `certification_reconstruction_equality` | **PASS** |
| `revocation_propagation_equality` | **PASS** |

`nondeterminism_findings: []`. Revocation of the `replay` domain propagates deterministically to `divergence`, `quarantine`, `proof_lineage`, `freshness`, `cert_evidence`. The substrate is **reproducible in code** — the constitutional definition of Truth certification (§10, §5.3.6).

---

## 3. Substrate Issue Inventory (WS-1.x / INIT-1.x)

The certified truth substrate was shipped across the WS-1.x workstreams (INIT-1.x). These issues are documented in detail — including per-issue truth-check verdicts and merge SHAs — in `docs/06_status/programs/PROGRAM_2_CERTIFICATION.md` (which records this same WS-1.x work under the **superseded** "Program 2" label; see §6). All 13 issues are `done` on `main` with truth-check PASS (recovery sprint 2026-06-01, commit `7cc4ffe4`, no waivers).

| Workstream | Issues | Substrate |
|---|---|---|
| WS-1.1 — Immutable Market Truth | UTV2-1083, 1084, 1085, 1086, 1087 | reversible migration, raw-payload hashing, immutable OddsSnapshot, snapshot cutover + PIT, freshness honesty + auto-quarantine |
| WS-1.2 — Canonical Replay Infrastructure | UTV2-1091, 1092, 1093, 1095 | isolated full-pipeline replay harness, divergence engine, validator un-stubbing, 30-day replay driver |
| WS-1.3 — Runtime Invariant Enforcement | UTV2-1088, 1089, 1090, 1094 | machine-readable invariant registry, InvariantEngine, automatic quarantine/escalation, production/replay integration |

**Runtime components:** `apps/ingestor`, `raw_payloads` / `odds_snapshots` tables, `packages/verification/.../full-pipeline-replay.ts`, `packages/invariants/engine.ts` + `registry/invariant-registry.json`.

---

## 4. Operational Caveat (binding)

P1 is certified **in code** — the truth + replay substrate is real and reproducible at SHA `9600938`. Two operational facts qualify what P1 guarantees *today*:

1. **Live ingestion is stale (~11.7d at audit time) — D-CONST-6.** The frozen-surface certification (2026-05-27) predates the staleness, so the certification is valid, but P1's *operational* freshness guarantee is currently violated. Restoration must use a no-cost / mock / replay path until SGO is intentionally reactivated. Do **not** treat a green P1 certification as evidence of live freshness.
2. **Re-certification of `proof_lineage` + `freshness` is due 2026-08-25.** Past this date the frozen-surface proof auto-degrades and P1 must be re-evaluated.

**Allowed work (per `CANONICAL_PROGRAM_STATE.md`):** freshness/replay re-cert preparation; ingestion restoration via no-cost/mock/replay.
**Forbidden:** new truth-model changes without re-certification.

---

## 5. Certification Determination

**P1 — Truth Convergence — ACTIVE_CERTIFIED.**

- Frozen-surface replay-reproducibility proof: all verdicts PASS, SHA-bound to `9600938` (§2).
- Substrate (WS-1.x / INIT-1.x): 13 issues `done` + truth-check PASS (§3).
- Canonical status ratified D-CONST-2 (`PM_RATIFIED` 2026-06-02): ACTIVE_CERTIFIED.
- Operational freshness caveat (D-CONST-6) and re-cert deadline (2026-08-25) recorded (§4).

This record does **not** advance certification; it makes the pre-existing P1 certification deterministically verifiable from the repository (§10, D-CONST-3).

---

## 6. §18.3 Numbering Note (D-CONST-1)

Under constitution §18.3 the canonical numbering is: **P1 Truth · P2 Governance · P3 Decision Integrity · P4 Execution & Economic Truth · P5 Institutional Runtime.**

- The WS-1.x / INIT-1.x foundation work in §3 is canonically **Program 1 (Truth)** substrate. The file `PROGRAM_2_CERTIFICATION.md` documents this same work under the **superseded** pre-convergence label "Program 2 = WS-1.x" (D-CONST-1, `PM_RATIFIED`); its certification evidence remains valid, only its program *label* is corrected.
- The INIT-2.x certification-framework work that `CERT_BOARD.md` records under "Program 1 Certification" (UTV2-1096–1111) is canonically **Program 2 (Governance)** — not P1.

See `docs/00_constitution/PROGRAM_ALIGNMENT_MATRIX.md` and `CANONICAL_PROGRAM_STATE.md` for the full mapping.

---

## 7. Cross-References

- Canonical state: `docs/00_constitution/CANONICAL_PROGRAM_STATE.md`
- Numbering authority: `docs/00_constitution/UNIT_TALK_CONSTITUTION_V1.md` §18.3
- Drift ledger: `docs/00_constitution/CERTIFICATION_GAP_REGISTER.md` (D-CONST-1, D-CONST-3, D-CONST-6)
- Alignment analysis: `docs/00_constitution/PROGRAM_ALIGNMENT_MATRIX.md` (P1 row)
- Substrate audit: `docs/06_status/programs/PROGRAM_2_CERTIFICATION.md` (WS-1.x truth-check inventory, superseded label)
- Primary proof: `docs/06_status/proof/PROGRAM1/replay-reproducibility-20260527-main-9600938.json`
