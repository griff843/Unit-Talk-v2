# UTV2-1752 — Diff Summary

**Issue:** UTV2-1752 — packet finalization (readmission timing + nested-section consumption)
**Tier:** T1 · **Lane type:** governance
**Branch:** `claude/utv2-1752-packet-finalization`
**Verified source SHA:** `3e7abdbbaedaa360529871b61f1ace68b45182fe`
MERGE_SHA: 3e7abdbbaedaa360529871b61f1ace68b45182fe
**Predecessor:** UTV2-1747 / PR #1446, closed unmerged at `d54abcbd`. That tree was preserved and ported here; UTV2-1752 addresses its four review findings and nothing else.

---

## Provenance of the diff

The branch contains two distinguishable populations:

| Population | Files | Origin |
|---|---|---|
| **Ported** | `execution-packet.ts`, `claude-exec.ts`, `codex-exec.ts` and their tests (except the additions listed below) | byte-preserved from `d54abcbd`, re-applied onto current `main` |
| **New in 1752** | the `lane-start.ts` readmission edits; the reserved-descendant logic in `execution-packet.ts`; test cases G1–G5 | authored in this lane to close findings 1 and 3 |

Per-file `sha256` prefixes for both populations are recorded in
`evidence.json → provenance`.

---

## Changes by file

### `scripts/ops/lane-start.ts` — Finding 1 (P1)

Readmission of an existing branch no longer resolves the lane task contract
*before* the worktree exists.

- The early bounded capture is now conditional: `readmitExistingBranch ? null : resolveLaneTaskContract(...)`.
- The unconditional `persistLaneTaskContract(..., [ROOT])` that followed the readmit `writeManifest` is removed.
- The post-checkout resolution is now the **first and only** resolution on the readmit path, and is offline for a branch that already carries its own contract.
- The fresh-lane path is unchanged except for a null guard before its persist call.

**Why it mattered:** on a preserved branch whose own contract differed from
Linear's current one, the early capture wrote a *newer* contract to `ROOT`,
after which the post-checkout resolution saw contracts at both roots and failed
closed as `lane_contract_conflict` — against the branch's own valid record. It
also made readmission require the network for a branch that needed nothing.

### `scripts/ops/execution-packet.ts` — Finding 3 (P2)

Nested sections whose heading is a reserved contract field are no longer
double-counted as residue of their ancestor.

- `SectionOccurrence` gains `lineOwners: number[]`, populated during `parseSections`.
- `CONTRACT_FIELD_HEADINGS` names the reserved keys (`objective`, `required outcome`, `acceptance criteria`, `acceptance criterion`, `exit criteria`).
- `sectionLines` subtracts reserved descendants (and their nested lines) from the ancestor's collected lines, unless the descendant claims its own key.
- `unmappedSections` snapshots `taken` as `consumedByField` **before** the ancestor-suppression loop, then subtracts claimed descendant lines per line rather than per section.

### `scripts/ops/{claude,codex}-exec.ts` — ported, unchanged from `d54abcbd`

No 1752 edits. Present so the packet path is whole.

### Tests

- `execution-packet.test.ts`: adds G1 and G5. **48/48 pass.**
- `lane-start.test.ts`: adds `resolveTaskContractAcrossRoots` import, a `seedContractRoots()` helper, and G2/G3/G4. **44/44 pass.**

### Proof bundle — Finding 4 (P2)

`verification.md` and `evidence.json` are regenerated from measurement at the
verified source SHA. Every count, mutation summary, and status is measured
here; no figure or unresolved-defect claim is carried over from the
predecessor's bundle.

---

## Findings status

| # | Sev | Finding | Status |
|---|---|---|---|
| 1 | P1 | Readmission resolves contract before worktree exists | **FIXED** — proved by G2/G3/G4 + mutation M3 |
| 2 | P1 | Mandatory T1 database verification | **SATISFIED BY CI.** `pnpm test:db` cannot run locally (`ci:assert-staging` refuses `host=127.0.0.1`), but CI job **Writable DB proof (staging only)** produces a run-scoped receipt against staging `xskgrzbteyqdufktjrjx`, validated **inside the required `verify` context**. Not waived, not `N/A`, not author-asserted. |
| 3 | P2 | Nested reserved-field sections counted twice | **FIXED** — proved by G5 + mutation M2 |
| 4 | P2 | Proof truth / stale figures | **FIXED** — bundle regenerated at this SHA |

All four findings are closed. The lane is still **not merge-authorized**: Merge Gate is BLOCKED pending a `pm-verdict/v1` APPROVED comment from CODEOWNERS and the `t1-approved` label. Green CI does not substitute for either.

---

## Out of scope (deliberately not touched)

- `ops-merge-wrapper.ts` `git-merge-main` `--ff-only` defect — filed as **UTV2-1753**, left in Backlog per PM.
- Any change beyond the four findings above.
- No SGO, ingestion, delivery, production DDL, or production unpark action.

---

## Verification

- `pnpm verify:static` — exit 0, **5062 pass / 0 fail / 0 skipped**
  (`pnpm verify` cannot exit 0 locally: `ci:assert-staging` refuses on `host=127.0.0.1`)
- R-level compliance — PASS
- Mutation battery M1→G1, M2→G5, M3→G4, each killing only its own test;
  both sources restored byte-identical to baseline (`sha256` verified).
  One vacuity was found and is disclosed in `verification.md`, not silently corrected.

Full detail: `docs/06_status/proof/UTV2-1752/verification.md`,
machine-readable: `docs/06_status/proof/UTV2-1752/evidence.json`.
