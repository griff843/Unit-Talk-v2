# Issue Template — Unit Talk V2

> Copy this template when authoring a new queue issue in `docs/06_status/ISSUE_QUEUE.md`.
> All fields are required unless marked optional.
> Authority: `docs/05_operations/QUEUE_ORCHESTRATION_DESIGN.md`

---

## [UTV2-N] Issue Title

| Field | Value |
|---|---|
| **ID** | UTV2-N |
| **Tier** | T1 / T2 / T3 / DOCS |
| **Lane** | `lane:codex` / `lane:claude` / `lane:augment` |
| **Status** | READY / BLOCKED / DEFERRED |
| **Milestone** | M1–M8 or — |
| **Area** | `area:api` / `area:discord-bot` / `area:operator-web` / `area:ingestor` / `area:db` / `area:domain` / `area:contracts` / `area:governance` / `area:tooling` |
| **Blocked by** | UTV2-N (or —) |
| **Unlocks** | UTV2-N (or —) |
| **Branch** | — (set when IN_PROGRESS) |
| **PR** | — (set when IN_REVIEW) |

### Acceptance Criteria

- [ ] AC-1: ...
- [ ] AC-2: ...

### Proof Requirements

- [ ] `pnpm verify` exits 0; test count >= N
- [ ] Live proof: ...

### Contract Authority

`docs/05_operations/<CONTRACT>.md` (status: RATIFIED / DRAFT)

### Notes

---

## Field Reference

| Tier | Meaning |
|---|---|
| T1 | New migration + write-path + proof bundle. Ratified contract required. One active at a time. |
| T2 | Additive. No migration. No settlement path change. |
| T3 | Pure compute/config/tooling. No DB touch. |
| DOCS | Governance/spec only. No runtime change. No branch required. |

Status lifecycle: BLOCKED → READY → IN_PROGRESS → IN_REVIEW → DONE
