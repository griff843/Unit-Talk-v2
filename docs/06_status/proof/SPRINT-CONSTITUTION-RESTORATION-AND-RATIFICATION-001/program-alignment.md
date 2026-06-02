# Program Alignment — Proof Summary

> SPRINT-CONSTITUTION-RESTORATION-AND-RATIFICATION-001 · 2026-06-02.
> Canonical: [`docs/00_constitution/PROGRAM_ALIGNMENT_MATRIX.md`](../../../00_constitution/PROGRAM_ALIGNMENT_MATRIX.md).

## What each Program actually means today (repo evidence, not Linear assumption)

| Program | Constitutional theme (§18.3) | Real state | Cert basis |
|---|---|---|---|
| **P1** Truth Convergence | raw payloads, snapshots, PIT, freshness, replay, invariants | Substrate certified **in code**; live ingestion dark (~11.7d) | Linear `PROGRAM_1_FROZEN_SURFACE` (SHA `9600938`) + repo proof JSON. **No repo cert doc.** |
| **P2** Governance Convergence | certification + proof runtime, exceptions, authority | **Strongest program** — 229 live tests | Linear `PROGRAM_2_*` docs; repo `PROGRAM_2_CERTIFICATION.md` **mislabeled "WS-1.x"** |
| **P3** Decision Integrity | feature/model/calibration/decision/portfolio gov | **Half real**: decision+portfolio+risk implemented; feature/model/calibration aspirational | Repo `PROGRAM_3_CERTIFICATION.md`; **not authorized by Linear freeze surface** |
| **P4** Execution & Economic Truth | execution, settlement, CLV, attribution | Execution+settlement real (settlement live-verified); economics code-only, no data; runtime delivery degraded | **No cert doc anywhere** — only manifest annotations + HEAD `55bd0bd7` |
| **P5** Institutional Runtime | treasury, adversarial, burn-in, capital scaling | P5-A adversarial merged; **P5-B burn-in never passed**; P5-C/P5-D **frozen** | No P5 cert; `PROGRAM_5_ACTIVATION.md` is activation, not certification |

## Layer → Program coverage (constitution §18.3)
- **P1** → 4.1, 4.2, 4.13
- **P2** → 4.15, 4.16
- **P3** → 4.3, 4.4, 4.5, 4.8, 4.9
- **P4** → 4.10, 4.11, 4.12, 4.19
- **P5** → 4.17, 4.18 (+ burn-in)

## Conclusions
1. The constitution's §18.3 numbering is authoritative and resolves the long-standing dispute.
2. Certification records are **asymmetric and partly non-canonical** (P1 Linear-only, P2 mislabeled, P4 manifest-only, P5 none) — a §10 gap.
3. **"P1–P4 certified" is not deterministically verifiable** today → capital activation (P5-C/P5-D) **must remain frozen** per §4.17/§20.6 (this is already the case; this audit confirms it should stay).
