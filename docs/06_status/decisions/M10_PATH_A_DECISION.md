# M10 Path A Decision Record

**Status:** PM_INPUT_REQUIRED — decision not issued  
**Produced:** 2026-06-01 (governance audit)  
**Authority:** PM (griffadavi)  
**Blocking:** UTV2-1144, UTV2-1145, UTV2-1146 (P5-C Treasury Runtime)

---

## M10 PATH A DECISION REQUIRED — PM INPUT NEEDED

No existing M10 Path A decision was found in any canonical document in this repository.

---

## 1. What Is M10 Path A?

The term "M10 Path A" appears exactly once in canonical docs, in `docs/06_status/CERT_BOARD.md`:

> | UTV2-1144 | INIT-5.1.1 — Immutable Capital Ledger | P1–P4 certified + **M10 Path A** |

No other canonical document defines M10 Path A or provides context for what it means.

**Closest related context found:**

From `docs/06_status/PROGRAM_STATUS.md` (2026-05-20 update):

> *Multi-server topology (EX44/CCX23/BX11) deferred to future scale milestone when current
> scale justifies it.*

This suggests M10 Path A may refer to a future infrastructure topology decision — the path
selection for capital-layer deployment (single-node vs. distributed, self-hosted vs. managed,
etc.). However, this is inference, not documentation.

**"M10" in PROGRAM_STATUS_ARCHIVE.md** refers to an older sprint milestone (M10 as a
milestone number in the early sprint history, circa March 2026). This is a different usage.
The CERT_BOARD's "M10 Path A" was authored in late May 2026 and refers to a future milestone
decision, not the historical M10 sprint.

---

## 2. Why This Decision Is Required

UTV2-1144 (INIT-5.1.1 — Immutable Capital Ledger) is a schema-level change that introduces
a capital ledger into the database. This is a constitutionally sensitive operation:

- Capital ledgers are append-only by design (immutability contract)
- The deployment path determines whether this is self-hosted, managed, or distributed
- Incorrect path selection creates irreversible debt

The CERT_BOARD requires "M10 Path A" as an explicit gate precisely because the Treasury
sub-program cannot safely proceed without a PM-declared deployment/topology decision.

---

## 3. Questions PM Must Answer

Before M10 Path A can be declared, the PM must address the following:

1. **What does "M10 Path A" mean?**
   Define the milestone and the alternative paths (e.g., Path A = single-node Hetzner capital
   ledger vs. Path B = distributed / managed capital layer). Document both paths and explicitly
   choose one.

2. **What are the entry conditions for M10 Path A?**
   Is there a precondition volume threshold, a burn-in period, or a specific infrastructure
   state that must be true before Treasury work begins?

3. **Is M10 Path A the same as the single-node topology decision?**
   If the 2026-05-20 single-node Hetzner decision already constitutes Path A, PM must
   explicitly affirm that here.

4. **What is the capital deployment model?**
   Self-hosted ledger on Hetzner, managed via Supabase, or hybrid? This determines the
   technical implementation scope for UTV2-1144.

---

## 4. Decision Template

When PM is ready to issue this decision, record it below:

---

**M10 PATH A DECISION**  
Date: [PM to fill]  
Authority: PM (griffadavi)

**Definition:** M10 refers to [definition]. Path A means [specific path].

**Decision:** [PM declares chosen path]

**Rationale:** [brief justification]

**Effect:**
- UTV2-1144 (Immutable Capital Ledger) is authorized to dispatch
- Capital ledger deployment follows [Path A specifications]
- Treasury Runtime (INIT-5.1.x) is unlocked: UTV2-1144 → 1145 → 1146

**Constraints:**
- [Any constraints PM wants to place on Treasury implementation]
- Certified P1–P4 artifacts must not be mutated by Treasury lanes
- All Treasury lanes require `t1-approved` label before merge

---

## 5. Current Impact

Until this decision is issued:

| Issue | Impact |
|---|---|
| UTV2-1144 | FROZEN — cannot dispatch |
| UTV2-1145 | FROZEN — depends on 1144 |
| UTV2-1146 | FROZEN — depends on 1145 |
| UTV2-1152 | FROZEN — depends on 1146 certified |
| UTV2-1153 | FROZEN — depends on 1152 |
| UTV2-1154 | FROZEN — depends on 1153 |

**P5-A (Adversarial Capital) and P5-B (Burn-In) do NOT require M10 Path A.**
They can proceed independently once P2/P3 cert resolves.

Only the Treasury (P5-C) and Capital Scaling (P5-D) sub-programs are blocked by this decision.
