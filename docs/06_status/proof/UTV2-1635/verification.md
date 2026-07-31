# UTV2-1635 Verification

Lane type: governance. Tier: T2. Docs-only — no source, migration, or workflow change.

## Scope of the claim

This lane makes **no runtime claim**. It adds a forensic ledger and recovered historical
proof content. The only assertions requiring evidence are:

1. that the C1 file/lane counts are what this lane says they are;
2. that the recovered files are byte-identical to what GitHub returned;
3. that the recovery/no-loss verdict per file follows from retained GitHub data.

Each is mechanically checkable below. Nothing here was reconstructed from memory.

## Verification

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm type-check` | PASS | via `ops:preflight` check PB1 on this branch. |
| `pnpm ci:sync-check` | PASS after fix | initially failed (`.ops/sync.yml` listed a different issue); resolved by adding `.ops/sync/UTV2-1635.yml`. |
| Required `verify` context | see PR checks | authoritative CI result for this head; this lane makes no local live-database claim. |

### Live-database gate

Not applicable and not claimed. This lane changes only Markdown and JSON under
`docs/06_status/proof/`. Per the `ci:assert-staging` guard (`a55de402`, 2026-07-30),
`pnpm test:db` fails closed in a developer checkout, and this worktree holds no staging
credential. **No local `pnpm test:db` was run and no live-database claim is made.** The
authoritative live-database evidence for this head is the required `verify` context.

This lane's own subject matter is proof that asserts runs which did not happen as
described, so it deliberately makes the narrowest claim its evidence supports.

## Issue-specific verification

### 1. C1 counts

Derived by re-implementing the audit's shape test with one correction: test the file's
content **at its adding commit**, not as it reads today. Testing today's content
misclassifies Table A files (added with real content, clobbered later) as C1.

```
TRUE C1 (generated-shape AT adding commit AND adding commit == lane commit_sha):
  29 files / 22 lanes
after excluding the confirmed false positive:
  28 files / 21 lanes
```

Cross-check against the audit's own enumerated lists: 7 `verification.md` + 21
`diff-summary.md` = 28 entries across 21 unique lanes — matching exactly, once the
separately-caveated false-positive lane is excluded. The audit's prose figure of
"24 files" is not reproducible under any reading.

False positive confirmed by three independent facts: the file predates the generator
emitting that filename (`994ed267`, 2026-07-04); it contains substantive hand-written
Summary and Evidence sections; and it contains zero `result: not_run` /
`not run by proof-generate` markers.

### 2. Byte-identity of recovered files

Recovered content was fetched from GitHub's contents API at the cited commit and written
without modification. Identity is proven by git blob SHA equality — the blob SHA is a
hash of the content, so a match is proof of byte-identity, not a proxy for it.

```
$ git hash-object docs/06_status/proof/<lane>/recovered/verification.md
83ca97f7ddfcd9e8d93193e43df13cab3646c9f5
$ gh api ".../contents/<path>?ref=c003a5529962a1aeb77f38d926f6b22170fa1710" --jq .sha
83ca97f7ddfcd9e8d93193e43df13cab3646c9f5      -> OK

$ git hash-object docs/06_status/proof/<lane>/recovered/diff-summary.md
a3adc064bb6e248ff8c214c30470d96728fb6b71
$ gh api ".../contents/<path>?ref=c003a5529962a1aeb77f38d926f6b22170fa1710" --jq .sha
a3adc064bb6e248ff8c214c30470d96728fb6b71      -> OK
```

### 3. Per-file verdict provenance

For each of the 28 C1 files: the lane PR was resolved from its manifest, its retained
pre-squash commits enumerated via `/pulls/{n}/commits`, and the blob fetched via
`/contents/{path}?ref={sha}` at every commit touching that path.

- **0 contents-API failures.** Every blob for every touching commit was returned.
- **0 files with zero branch touches.** No file was unexplained.
- 26 files: every branch version was already generator-shaped → born scaffold, nothing destroyed.
- 2 files: a non-generated branch version existed → destroyed pre-squash, recovered.

Because the API returned complete data for every file, "unrecoverable" here means *the
hand-written version never existed*, not *the lookup failed*. That distinction is what
makes the `UNPROVEN_BUT_SHIPPED` classification honest rather than an artifact of a
failed query.

### 4. Retained CI as independent evidence

The four required contexts were queried on each C1 lane's branch head. 19 of 21 returned
all four green. 2 returned zero retained check-runs (merged 2026-05-26, predating the
current checks regime) — recorded as such rather than assumed.

### 5. Claim coherence

Every C1 bundle asserting a live-database run was re-checked against what that lane could
actually have executed at its own merge date. All 11 such lanes merged before the
`ci:assert-staging` guard landed, so their `test:db` evidence is a production-database run
from a developer checkout: valid-for-era, not valid-now, and not reproducible. This
caveat is applied to the recovered content too — recovering a claim establishes what the
branch said, not that the run occurred.

## Non-destructiveness

The hard constraint on this lane was to add, never replace. This is verified mechanically
by the diff's deletion count, which is **zero across every file**:

```
$ git diff --numstat origin/main..HEAD -- docs/06_status/proof/
1420    0    docs/06_status/proof/UNPROVEN_BUT_SHIPPED.json
 276    0    docs/06_status/proof/UNPROVEN_BUT_SHIPPED.md
  76    0    docs/06_status/proof/<lane>/RECOVERED.md
  71    0    docs/06_status/proof/<lane>/recovered/diff-summary.md
  48    0    docs/06_status/proof/<lane>/recovered/verification.md
  27    0    docs/06_status/proof/UTV2-1631/proof-scaffold-audit.md
   3    0    docs/06_status/proof/UTV2-1635/diff-summary.md
   3    0    docs/06_status/proof/UTV2-1635/verification.md

1924 insertions(+), 0 deletions(-)
```

A zero deletion count is the strongest available mechanical statement of the constraint:
no line of any existing proof bundle was changed or removed. The only edit to a
pre-existing file is the source audit, and it is additions only (a resolution banner and
a follow-up section). Recovered content sits in a new `recovered/` subdirectory beside the
untouched original bundle.

## R-level

No R-level rules triggered: no source code, migrations, or workflow YAML changed.
