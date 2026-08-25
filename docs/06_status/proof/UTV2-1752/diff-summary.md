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
| **New in 1752** | the `lane-start.ts` readmission edits and `laneContractRoots`/`resolveReadmissionContract` extractions; the reserved-descendant logic, shared field table, fence/indent handling and fail-closed extraction guard in `execution-packet.ts`; test cases G1–G18 | authored in this lane to close findings 1 and 3, the three review threads, and two rounds of independent-review findings |

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

### `scripts/ops/execution-packet.ts` — Finding 3 (P2) and both review threads

Three changes, two of them from PR review threads:

1. **Reserved-descendant subtraction** (Finding 3, as before).
2. **One field table** (`PRRT_kwDORr3vD86cHGhZ`). `CONTRACT_FIELD_SPECS` is now
   the single source for which headings each field extracts AND which are
   reserved. The previous fix restated the reserved set as a literal list that
   omitted `guardrails`, all four `non goals` spellings and `required evidence`,
   so a nested non-goal was both retained by its acceptance ancestor and
   extracted as a non-goal — the same sentence became a thing to do and a thing
   not to do. A list could not have expressed `non goals`' prefix matching
   anyway. An earlier revision of this file claimed `G8` fails if any
   `sectionLines` call names a heading literal again. That was FALSE: G8 only
   fires on a literal that DIVERGES from the table. The property is enforced in
   production code instead -- `sectionLines` throws on any extraction heading
   that is not reserved -- because no test that enumerates the table can detect
   a heading absent from it.
3. **Fence and indentation awareness** (`PRRT_kwDORr3vD86cHGhc`). `parseSections`
   tracks fenced blocks and requires at most three leading spaces, and
   `sectionItems` keeps a fenced block as one item with its newlines. The second
   half was not in the report and was found by an assertion: flattening put
   `# do not run this against production` on the same line as `pnpm test:db`,
   where the comment swallows the command.

### Original Finding 3 detail

Nested sections whose heading is a reserved contract field are no longer
double-counted as residue of their ancestor.

- `SectionOccurrence` gains `lineOwners: number[]`, populated during `parseSections`.
- `CONTRACT_FIELD_SPECS` is the single table naming every contract field's headings and whether it matches by prefix. It replaced a `CONTRACT_FIELD_HEADINGS` constant whose five hardcoded keys (`objective`, `required outcome`, `acceptance criteria`, `acceptance criterion`, `exit criteria`) WERE the defect: they omitted `non goals`, `guardrails` and `required evidence`, and a flat list cannot express `non goals`' prefix matching at all. Extraction, reservation, the empty-acceptance guard and the heading-match rule all read it; `sectionLines` throws on any extraction heading it does not contain.
- `sectionLines` subtracts reserved descendants (and their nested lines) from the ancestor's collected lines, unless the descendant claims its own key.
- `unmappedSections` snapshots `taken` as `consumedByField` **before** the ancestor-suppression loop, then subtracts claimed descendant lines per line rather than per section.

### `scripts/ops/{claude,codex}-exec.ts` — ported, unchanged from `d54abcbd`

No 1752 edits. Present so the packet path is whole.

### Tests

- `execution-packet.test.ts`: adds G1, G5, the thread regressions G6-G11, and
  G12-G14, G16-G18 and G22 from three rounds of independent review.
- `lane-start.test.ts`: adds `resolveTaskContractAcrossRoots` /
  `laneContractRoots` / `resolveReadmissionContract` imports, the
  `seedContractRoots()`, `seedBothRoots()` and `seedReadmissionFixture()`
  helpers, G2/G2b/G2c/G3/G4/G15, and the end-to-end readmission tests
  G19/G20/G21 -- the first coverage this repository has ever had of
  `lane-start --readmit-existing-branch` running as a program.
- `claude-exec.test.ts`, `codex-exec.test.ts` -- ported, unchanged.

**No test count appears in this file.** Restating measured figures in three
places is what produced the same stale-bundle finding in two consecutive
reviews; every count now lives in exactly one place, the EVIDENCE block of
`verification.md`, with its machine mirror in `evidence.json`.

### Proof bundle — Finding 4 (P2)

All three bundle files are regenerated from measurement **at the PR head**, not
at the SHA anchor. The anchor `3e7abdbb` is the lane's first implementation
commit and exists only because a file cannot contain its own SHA; it is NOT
where the figures were measured, and an earlier revision of this bundle wrongly
said it was. No figure or unresolved-defect claim is carried over from the
predecessor's bundle.

An earlier revision of THIS file was also left stale while the other two were
updated — it reported 54/54, described the removed five-key `CONTRACT_FIELD_HEADINGS`
list as current, and contradicted its own Verification section. That was found
by an independent review, not by me.

---

## Findings status

| # | Sev | Finding | Status |
|---|---|---|---|
| 1 | P1 | Readmission resolves contract before worktree exists | **FIXED, and NARROWER than earlier revisions claimed.** The CONTRACT half is closed by the conflict gate and proved end-to-end by G19/G20/G21 through `lane-start` main(). The RECORD half was still reintroducible at the previous head — a fourth review's R2b copied control's whole sync file over the branch's after the persist, destroying entities accumulated on the branch, with every test green; `metadataPaths` then commits that loss onto the branch. G20 now pins it in the working copy and the committed tree. |
| 2 | P1 | Mandatory T1 database verification | **SATISFIED BY CI.** `pnpm test:db` cannot run locally (`ci:assert-staging` refuses `host=127.0.0.1`), but CI job **Writable DB proof (staging only)** produces a run-scoped receipt against staging `xskgrzbteyqdufktjrjx`, validated **inside the required `verify` context**. Not waived, not `N/A`, not author-asserted. |
| 3 | P2 | Nested reserved-field sections counted twice | **FIXED** — proved by G5 + mutation M2 |
| T2 | P2 | Review thread: reserve ALL recognized contract headings | **FIXED** — G6/G7/G8 + mutation M4 |
| T3 | P2 | Review thread: honor fenced code while parsing headings | **FIXED** — G9/G10/G11 + mutations M5/M6/M7 |
| 4 | P2 | Proof truth / stale figures | **RE-OPENED THREE TIMES, then addressed structurally.** The fourth round found `evidence.json` still carrying round-3 counts AND still attributing finding 1 to G2/G3/G4 + M3 — the attribution the third round disproved — while this file asserted the correct one. Suite counts, the test delta and the finding attributions are now generated from the runner's output, not maintained by hand. Rounds 2 and 3 each found this file stale again while the other two were updated. The remedy is no longer "regenerate carefully": measured figures are now single-sourced in `verification.md` and generated into `evidence.json` from the battery's own output, and this file quotes none. |

All four findings and all three review threads are closed. The lane is **not merge-authorized and not ready for a mechanical merge**: two packet-parser defects were fixed after the previous review, so this head requires a fresh independent exact-head review and a new `pm-verdict/v1` APPROVED comment plus the `t1-approved` label. Green CI substitutes for none of that.

---

## Out of scope (deliberately not touched)

- `ops-merge-wrapper.ts` `git-merge-main` `--ff-only` defect — filed as **UTV2-1753**, left in Backlog per PM.
- Any change beyond the four findings and the review-thread defects above.
- No SGO, ingestion, delivery, production DDL, or production unpark action.

---

## Verification

Every measured figure for this lane -- suite totals, `verify:static` result,
r-level outcome, the mutation battery and its kill targets -- is recorded once,
in the EVIDENCE block and Mutation battery section of
`docs/06_status/proof/UTV2-1752/verification.md`, with the machine-readable
mirror in `docs/06_status/proof/UTV2-1752/evidence.json`.

This file deliberately restates none of them. Two consecutive independent
reviews found this file carrying figures from an earlier head while the other
two files had been updated; the third review found the same defect a third
time, including a paragraph that admitted the staleness while leaving the stale
numbers in place. Duplication was the cause, so the duplication is gone rather
than re-synchronised.

- `pnpm verify` cannot exit 0 locally: `ci:assert-staging` refuses on
  `host=127.0.0.1`. The live half is supplied and enforced by CI inside the
  required `verify` context (finding 2).
- **Nine controls of mine proved nothing when written** -- three vacuous
  assertions, four source-text greps, one single-root fixture, and one
  emitted-nowhere field whose two tests guarded state no consumer could
  observe. Six of the nine were found by independent reviewers, not by me. Each
  is disclosed in `verification.md` with the mutation that now kills it, rather
  than silently corrected.

Full detail: `docs/06_status/proof/UTV2-1752/verification.md`,
machine-readable: `docs/06_status/proof/UTV2-1752/evidence.json`.
