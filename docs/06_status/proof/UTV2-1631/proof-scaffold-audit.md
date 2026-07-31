# Proof scaffold audit — which closed lanes had their proof replaced

Produced under UTV2-1631. Read-only forensic scan of `main` at
`ad11db4feb84f574e2cbf63e0dce05ef1c1ab47d`. **No other lane's proof is repaired
by this PR.** This document is the record of what to repair, and by whom, later.

## What was being looked for

`generateProofArtifacts` in `scripts/ops/proof-generate.ts` overwrote
`docs/06_status/proof/<ID>/verification.md` and `.../diff-summary.md` wholesale
with a generated `result: not_run` template. `post-merge-lane-close.yml` runs
`ops:proof-generate --merge-sha` automatically after every merge, so the
overwrite happened on the automated closeout path as well as on manual runs.

One guard existed, and only for `verification.md`: the file was skipped if it
contained a `| Commit SHA(s) |` table row or a `## Merge SHA Binding` heading.
`diff-summary.md` had no guard at all. `evidence.json` was never overwritten.

## Method

A naive "does the file look like the template" test under-counts, because
several files were overwritten and then partially hand-repaired, so they no
longer score as templates today. The test used instead is a *shape* test that
survives hand-editing — first line `# <ID> Runtime Verification` /
`# <ID> Diff Summary`, second line blank, third line beginning `Generated at:`
— a shape emitted only by `buildRuntimeVerification` / `buildDiffSummary`. The
`diff-summary.md` shape has been byte-identical since 2026-05-25
(`git show dda94cd0:scripts/ops/proof-generate.ts`); `verification.md`
generation was added 2026-07-04 in `994ed267`.

The decisive per-file test: walk the file's commits newest to oldest, fetch
`git show <sha>^:<path>` and `git show <sha>:<path>`, and find the commit where
the content went **not-generated-shape → generated-shape**. That is
unambiguous replacement and does not depend on line-count heuristics.

Scope scanned: 528 proof directories — 401 `verification.md`, 332
`diff-summary.md`, 198 `evidence.json`.

## Headline

**82 destructive overwrite events, across 62 distinct lanes, 2026-05-30 →
2026-07-25, destroying 4,106 lines / ~222 KB of pre-existing proof content.**

- 11 events by `github-actions[bot]` (760 lines) — the automated closeout path.
- 71 events by local `griff843` runs of `ops:proof-generate` during closeout.
- Visible on `main` today: 22 replaced `verification.md`, 58 replaced
  `diff-summary.md`. Two more were replaced and later hand-rewritten.
- No file was overwritten twice.
- **Every destroyed version is recoverable** — each parent blob is one
  `git show <sha>^:<path>` away, and the SHAs are recorded below.

All 644 lane manifests are present (only `.ops/sync/<ID>.yml` is removed on
close), and every lane cross-referenced below has `status: done` and a non-empty
`commit_sha`. So "closed, and reads as closed, on scaffolded proof" is the
accurate description of these lanes.

## Table A — looks REPLACED

### A1 — `verification.md` replaced (22 lanes)

| Lane | Commit | Date | Author | numstat | Prior content lost |
|---|---|---|---|---|---|
| UTV2-1546 | `de89a37253` | 2026-07-20 | griff843 | +30/−217 | 239 L / 11,715 B |
| UTV2-1493 | `c32db6aa8c` | 2026-07-08 | griff843 | +18/−170 | 174 L / 8,182 B |
| UTV2-1533 | `761752f014` | 2026-07-14 | **github-actions[bot]** | +20/−136 | 140 L / 11,331 B |
| UTV2-1467 | `35378722d2` | 2026-07-10 | griff843 | +16/−125 | 135 L / 10,142 B |
| UTV2-1454 | `dabb4a47f6` | 2026-07-10 | griff843 | +20/−115 | 119 L / 6,082 B |
| UTV2-1522 | `6b7de5a51a` | 2026-07-13 | griff843 | +21/−99 | 104 L / 4,196 B |
| UTV2-1494 | `496ec72f1b` | 2026-07-09 | **github-actions[bot]** | +18/−92 | 96 L / 4,365 B |
| UTV2-1424 | `80099d5f83` | 2026-07-20 | griff843 | +32/−72 | 92 L / 2,802 B |
| UTV2-1446 | `7c25ed6588` | 2026-07-20 | griff843 | +32/−70 | 90 L / 2,790 B |
| UTV2-1565 | `9e55d3f268` | 2026-07-20 | griff843 | +39/−72 | 85 L / 3,059 B |
| UTV2-1521 | `62be9cd143` | 2026-07-11 | **github-actions[bot]** | +10/−57 | 69 L / 4,641 B |
| UTV2-1516 | `801929c61e` | 2026-07-11 | griff843 | +19/−61 | 66 L / 3,589 B |
| UTV2-1564 | `87f55923e4` | 2026-07-20 | griff843 | +35/−45 | 62 L / 1,918 B |
| UTV2-1563 | `7a7f2eb3da` | 2026-07-20 | griff843 | +35/−43 | 60 L / 1,886 B |
| UTV2-1514 | `16032ded49` | 2026-07-10 | griff843 | +20/−55 | 59 L / 3,122 B |
| UTV2-1495 | `3ab032f4ed` | 2026-07-10 | griff843 | +20/−54 | 58 L / 5,626 B |
| UTV2-1502 | `3bd277e0cd` | 2026-07-14 | griff843 | +20/−46 | 50 L / 1,817 B |
| UTV2-1491 | `0aa63df2d0` | 2026-07-08 | griff843 | +22/−21 | 38 L / 1,283 B |
| UTV2-1479 | `3063d1b74c` | 2026-07-08 | griff843 | +16/−22 | 35 L / 1,207 B |
| UTV2-1384 | `90e28dc145` | 2026-07-07 | **github-actions[bot]** | +17/−28 | 33 L / 1,679 B |
| UTV2-1505 | `16d3ecc443` | 2026-07-14 | griff843 | +20/−24 | 28 L / 1,196 B |
| UTV2-1531 | `3c7c7d69ea` | 2026-07-14 | griff843 | +20/−12 | 16 L / 1,046 B |

Replaced, then later hand-rewritten (so not template-shaped today, but the
original was still destroyed at the time):

| Lane | Commit | Date | Author | numstat | Prior content lost |
|---|---|---|---|---|---|
| UTV2-1464 | `b7d22746e2` | 2026-07-04 | griff843 | +13/−41 | 50 L / 2,363 B |
| UTV2-1526 | `3348234e8e` | 2026-07-14 | **github-actions[bot]** | +20/−121 | 125 L / 7,062 B |

Content, not just line counts, was read for the largest cases:

- **UTV2-1533** (T1) lost a hand-written proof containing 15 `[x]` assertions,
  a literal `# tests 137 / # pass 137 / # fail 0` node:test TAP block, and an
  `r-level-check` verdict. It was replaced by
  `- [ ] pnpm type-check: not run by proof-generate`.
- **UTV2-1493** (T1) lost a full acceptance-criteria mapping table and a
  PM-constraint mapping table.
- **UTV2-1546** lost a 239-line SHA-binding rationale.

### A2 — `diff-summary.md` replaced (58 lanes)

`diff-summary.md` had no guard whatsoever, so this is the larger blast radius.
Worst 20 by lines destroyed:

| Lane | Commit | Date | Author | numstat | Lost |
|---|---|---|---|---|---|
| UTV2-1533 | `761752f014` | 2026-07-14 | **bot** | +45/−98 | 98 L / 7,676 B |
| UTV2-1546 | `de89a37253` | 2026-07-20 | griff843 | +62/−94 | 94 L / 5,960 B |
| UTV2-1571 | `a39609b14c` | 2026-07-23 | **bot** | +28/−73 | 83 L / 4,693 B |
| UTV2-1564 | `87f55923e4` | 2026-07-20 | griff843 | +38/−68 | 72 L / 3,581 B |
| UTV2-1327 | `595ca1f19e` | 2026-06-27 | griff843 | +43/−65 | 70 L / 2,746 B |
| UTV2-1522 | `6b7de5a51a` | 2026-07-13 | griff843 | +429/−65 | 70 L / 3,928 B |
| UTV2-1355 | `7c5bbbf0b4` | 2026-06-29 | griff843 | +29/−56 | 63 L / 2,564 B |
| UTV2-1364 | `95bc879b78` | 2026-06-29 | griff843 | +44/−61 | 61 L / 3,043 B |
| UTV2-1479 | `3063d1b74c` | 2026-07-08 | griff843 | +38/−48 | 54 L / 2,696 B |
| UTV2-1514 | `16032ded49` | 2026-07-10 | griff843 | +42/−48 | 54 L / 4,638 B |
| UTV2-1565 | `9e55d3f268` | 2026-07-20 | griff843 | +50/−50 | 54 L / 2,687 B |
| UTV2-1563 | `7a7f2eb3da` | 2026-07-20 | griff843 | +38/−49 | 53 L / 2,440 B |
| UTV2-1358 | `7c5bbbf0b4` | 2026-06-29 | griff843 | +28/−45 | 51 L / 2,041 B |
| UTV2-1295 | `a5c61d6559` | 2026-06-24 | griff843 | +36/−46 | 48 L / 2,308 B |
| UTV2-1357 | `7c5bbbf0b4` | 2026-06-29 | griff843 | +29/−42 | 47 L / 1,602 B |
| UTV2-1134 | `1e9365616b` | 2026-05-30 | griff843 | +40/−45 | 45 L / 1,813 B |
| UTV2-1491 | `0aa63df2d0` | 2026-07-08 | griff843 | +33/−39 | 44 L / 1,895 B |
| UTV2-1270 | `7bd40ea397` | 2026-06-22 | griff843 | +38/−38 | 38 L / 1,869 B |
| UTV2-1343 | `78732b2c10` | 2026-06-28 | griff843 | +36/−34 | 36 L / 1,975 B |
| UTV2-1516 | `801929c61e` | 2026-07-11 | griff843 | +40/−34 | 36 L / 2,216 B |

Remaining 38 lanes with a replaced `diff-summary.md`: UTV2-1141, 1135, 1256,
1266, 1267, 1288, 1292, 1301 (bot), 1331, 1335, 1336, 1337, 1339, 1341, 1348,
1349, 1354, 1356, 1380, 1382, 1384 (bot), 1386, 1392, 1397, 1400, 1424, 1446,
1454, 1463, 1473, 1493, 1495, 1502, 1505, 1521 (bot), 1531, 1574, 1576 (bot).

Four predecessors were spot-read (UTV2-1491, 1357, 1571, 1341). All four were
substantive hand-written summaries — prose scope descriptions, "Files changed"
tables, per-file provenance. None were older generator output.

### A3 — the automated path specifically

32 bot commits touch `docs/06_status/proof/`. The destructive ones, all titled
`chore(lanes): close UTV2-#### — lane closed, sync file removed`:

| Commit | Date | Files + numstat |
|---|---|---|
| `bed00c0c7c` | 06-25 | `UTV2-1301/diff-summary.md` +22/−26 |
| `90e28dc145` | 07-07 | `UTV2-1384/verification.md` +17/−28; `diff-summary.md` +40/−17 |
| `7ab0b6c55f` | 07-08 | `UTV2-1491/verification.md` +7/−24; `diff-summary.md` +12/−16 |
| `6f47431ae7` | 07-08 | `UTV2-1423/verification.md` +7/−27; `diff-summary.md` +8/−28 |
| `496ec72f1b` | 07-09 | `UTV2-1494/verification.md` +18/−92 |
| `62be9cd143` | 07-11 | `UTV2-1521/verification.md` +10/−57; `diff-summary.md` +40/−18 |
| `0f4c308ba9`, `d18e304ad6`, `5df3f53283`, `d718b89ed0` | 07-13 | `UTV2-1518` / `1428` / `1498` / `1528` `verification.md`, −21/−11/−11/−11 |
| `761752f014` | 07-14 | `UTV2-1533/verification.md` +20/−136; `diff-summary.md` +45/−98 |
| `3348234e8e` | 07-14 | `UTV2-1526/verification.md` +20/−121; `diff-summary.md` +14/−60 |
| `a39609b14c` | 07-23 | `UTV2-1571/diff-summary.md` +28/−73 (verification.md only +2/−8 — guard held) |
| `0a334844ff` | 07-23 | `UTV2-1576/diff-summary.md` +47/−33 |
| `b2b3169e44` | 07-25 | `UTV2-1574/diff-summary.md` +14/−22 |

`evidence.json` in these commits only ever *gains* lines (SHA rebind). The
key-preserving claim for `evidence.json` holds throughout the history.

## Table B — thin, but always was

55 `verification.md` files are under 1,200 B and not generated-shape. **50 of
them never shrank in any commit** — added small, stayed small. These are
genuinely thin proof, not victims:

UTV2-598, 603, 640, 642, 643, 930, 1008, 1024, 1026, 1047, 1077, 1078, 1079,
1080, 1081, 1082, 1097, 1098, 1102, 1105, 1106, 1114, 1133, 1135, 1138, 1139,
1140, 1147, 1148, 1163, 1168, 1172, 1177, 1181, 1183, 1185, 1186, 1187, 1192,
1199, 1210, 1212, 1328, 1340, 1389, 1396, 1489, plus the three
`*-manifest-done-sync` directories (UTV2-1433 / 1460 / 1549). Smallest is
`UTV2-1114/verification.md` at 358 B — one commit, never touched again.

The other five thin non-template files (UTV2-1454, 1522, 1514, 1495, 1184) are
in Table A: replaced, then hand-repaired back to under 1,200 B.

Also always-thin: five bot commits between 2026-05-26 and 2026-06-08
(`211112320d`, `b111dc7465`, `9282264f55`, `d9473b8c16`, `ed5fe3a330`) each
created 2-line stub proof files for UTV2-1168 / 1123 / 1138 / 1198 / 1229. Born
as stubs; destroyed nothing.

## Table C — cannot distinguish

67 files (16 `verification.md`, 51 `diff-summary.md`) first appear on `main`
already in generated shape, so no pre-state exists in `main`'s history.

> **[RESOLVED — see [`../UNPROVEN_BUT_SHIPPED.md`](../UNPROVEN_BUT_SHIPPED.md), UTV2-1635]**
> C1 was resolved from GitHub's retained pre-squash PR commits, as anticipated below.
> All 28 files across 21 lanes were decided; none remained undecidable. 26 were born as
> scaffold on the branch and destroyed nothing; 2 (UTV2-1423, T1 governance) had
> hand-written proof destroyed pre-squash and have been recovered byte-identically.
> Only 3 lanes are classified `UNPROVEN_BUT_SHIPPED`. Note the count below is not
> reproducible — the correct figures are 28 files / 21 lanes; see the ledger's
> "Count reconciliation" section.

**C1 — genuinely undecidable (24 files, 22 lanes).** The adding commit *is* the
lane's own squash-merge SHA, confirmed against `commit_sha` in
`docs/06_status/lanes/<ID>.json`. A squash merge collapses the branch, so if
`ops:proof-generate` ran on the branch pre-merge and clobbered hand-written
proof there, `main` cannot show it. **This is only resolvable from GitHub's
retained PR commit list, not locally.** I did not resolve it.

- `verification.md`: UTV2-1423, 1428, 1498, 1513, 1518, 1524, 1528
- `diff-summary.md`: UTV2-1143, 1170, 1171, 1174, 1286, 1287, 1344, 1352, 1401,
  1423, 1428, 1433, 1459, 1460, 1464, 1467, 1498, 1513, 1518, 1524, 1528

Caveat inside C1: `UTV2-1125/verification.md` was added 2026-05-29, *before*
`verification.md` generation existed (2026-07-04). It is hand-written prose that
happens to mimic the header shape — a false positive of the shape test, not a
generator artifact.

**C2 — decidable, and NOT destructive (43 files).** The adding commit is a later
post-merge closeout commit distinct from the lane's merge SHA, and no file
existed at that path before it. `proof-generate` created the artifact from
nothing. No data was lost — but these lanes have never had proof beyond
`result: not_run`, which is its own finding. Includes UTV2-1246, 1278, 1290,
1297, 1300, 1304, 1328, 1340, 1342, 1366, 1367, 1373, 1379, 1390, 1419, 1420,
1432, 1488, 1489, 1490, 1494, 1517, 1519, 1523, 1526, 1530, 1537, 1589, 1628,
1629.

## The guard asymmetry, isolated

12 lanes where the `| Commit SHA(s) |` / `## Merge SHA Binding` guard *did* save
`verification.md`, and `diff-summary.md` was destroyed anyway in the same commit
because it had no guard:

| Lane | diff-summary.md replaced by | Lost |
|---|---|---|
| UTV2-1571 | `a39609b14c` 2026-07-23 **bot** +28/−73 | 83 L / 4,693 B |
| UTV2-1357 | `7c5bbbf0b4` 2026-06-29 griff843 +29/−42 | 47 L / 1,602 B |
| UTV2-1576 | `0a334844ff` 2026-07-23 **bot** +47/−33 | 33 L / 1,375 B |
| UTV2-1349 | `913c06fe8f` 2026-06-28 griff843 +29/−22 | 29 L / 1,363 B |
| UTV2-1354 | `7c5bbbf0b4` 2026-06-29 griff843 +30/−26 | 28 L / 929 B |
| UTV2-1337 | `913c06fe8f` 2026-06-28 griff843 +34/−23 | 25 L / 1,069 B |
| UTV2-1356 | `7c5bbbf0b4` 2026-06-29 griff843 +26/−18 | 24 L / 801 B |
| UTV2-1348 | `913c06fe8f` 2026-06-28 griff843 +36/−22 | 22 L / 1,877 B |
| UTV2-1380 | `0052ee4968` 2026-07-01 griff843 +36/−16 | 22 L / 1,405 B |
| UTV2-1335 | `787cd5bcef` 2026-06-28 griff843 +31/−16 | 21 L / 1,186 B |
| UTV2-1574 | `e7ecc92dc6` 2026-07-25 griff843 +37/−16 | 21 L / 1,116 B |
| UTV2-1392 | `bb79dd7d2f` 2026-07-01 griff843 +34/−7 | 13 L / 1,976 B |

UTV2-1571 is the cleanest single illustration: in commit `a39609b14c`, one bot
run touched `verification.md` (+2/−8 — guard held, SHA rebind only) and
`diff-summary.md` (+28/−73 — wholesale replacement of an 83-line hand-written
problem statement).

## Two things worth flagging beyond the immediate fix

1. **The guard was weaker than it looked even where it fired.** It keyed on a
   `| Commit SHA(s) |` row or a `## Merge SHA Binding` heading — a naming
   convention no template, skill, or gate enforces. Only 43 of 401
   `verification.md` files carry either marker. The other 358 were unprotected
   on every future run. The repo's own canonical `# PROOF:` / `MERGE_SHA:`
   format carries neither, so conformant proof was precisely what was exposed.

2. **`evidence.json` was rarely a fallback copy.** Of the 22 lanes whose
   `verification.md` was destroyed, **16 have no `evidence.json` at all** —
   including UTV2-1546 (239 lines lost), 1454, 1522, 1424, 1446, 1565, 1516,
   1495. For those the git parent blob is the only surviving copy. The
   key-preserving `evidence.json` logic was protecting a file that mostly did
   not exist.

## Recommended follow-up (not done here)

Restoration is mechanical and safe now that the generator preserves: for each
row in Table A, `git show <sha>^:<path>` recovers the destroyed version, and
`ops:proof-generate` will rebind its merge SHA in place rather than replace it.
That should be a separate lane, or one lane per tier band — deliberately out of
scope for this PR, which changes the generator and nothing else.

## Follow-up completed

**Table C1 was resolved under UTV2-1635.** Ledger:
[`../UNPROVEN_BUT_SHIPPED.md`](../UNPROVEN_BUT_SHIPPED.md) (human) and
[`../UNPROVEN_BUT_SHIPPED.json`](../UNPROVEN_BUT_SHIPPED.json) (machine-readable).
These two documents should be read together with this audit — this one records what was
destroyed and what it could not decide; the ledger decides the remainder.

Table A restoration (the 82 destructive events on `main`, all locally recoverable via
`git show <sha>^:<path>`) remains open and is still the larger body of work.
