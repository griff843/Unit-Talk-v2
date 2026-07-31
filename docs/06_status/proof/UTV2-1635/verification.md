# PROOF: UTV2-1635
MERGE_SHA: 7625d7aa3075e2fd4db78fc31ff0aea47c21e47a

Lane type: governance. Tier: T2. Docs-only — no source, migration, or workflow change.

## Scope of the claim

This lane makes **no runtime claim**. It adds a forensic ledger and recovered historical
proof content. The only assertions requiring evidence are that the C1 counts are what this
lane says, that the recovered files are byte-identical to what GitHub returned, and that
each per-file verdict follows from retained GitHub data.

This lane's own subject matter is proof that asserts runs which did not happen as
described, so it deliberately makes the narrowest claim its evidence supports.

ASSERTIONS:
- [x] The true C1 scope is 28 files across 21 lanes, not the audit's stated "24 files, 22 lanes".
- [x] One audit-listed lane is a confirmed false positive of the shape test and is excluded.
- [x] Every one of the 28 C1 files was decided from GitHub's retained pre-squash commits; none remained undecidable.
- [x] 26 of 28 files were already generator-shaped at their first branch commit, so nothing was destroyed for them.
- [x] 2 files had a non-generated branch version that was destroyed pre-squash, and both were recovered byte-identically.
- [x] Recovered content is byte-identical to GitHub's blob, proven by git blob SHA equality.
- [x] Nothing pre-existing was modified or removed: the diff has zero deletions across every file.
- [x] Only 3 lanes genuinely resist recovery and are classified UNPROVEN_BUT_SHIPPED.
- [x] 11 lanes assert a `pnpm test:db` run predating the `ci:assert-staging` guard, making that evidence valid-for-era but not valid-now.
- [x] This lane ran no local `pnpm test:db` and makes no live-database claim.

EVIDENCE:

### 1. C1 count derivation

The audit's shape test was re-implemented with one correction: test the file's content
**at its adding commit**, not as it reads today. Testing today's content misclassifies
Table A files (added with real content, clobbered later) as C1.

```text
TRUE C1 (generated-shape AT adding commit AND adding commit == lane commit_sha):
  29 files / 22 lanes
after excluding the confirmed false positive (UTV2-1125/verification.md):
  28 files / 21 lanes

cross-check against the audit's own enumerated lists:
  7 verification.md + 21 diff-summary.md = 28 entries / 21 unique lanes   -> MATCH
audit prose figure: "24 files, 22 lanes"                                  -> not reproducible
```

False positive confirmed by three independent facts:

```text
$ git log --diff-filter=A --format='%H %ad' --date=short -- docs/06_status/proof/UTV2-1125/verification.md
992a7c8ca1335029660b439872be1ef4dd65cc1f 2026-05-29

$ git log --format='%h %ad' --date=short -S 'buildRuntimeVerification' -- scripts/ops/proof-generate.ts | tail -1
dda94cd0 2026-05-25          # generator existed, but emitted runtime-verification.md
994ed267 2026-07-04          # first commit pointing it at verification.md

$ grep -c "not run by proof-generate\|result: not_run" docs/06_status/proof/UTV2-1125/verification.md
0
$ wc -c docs/06_status/proof/UTV2-1125/verification.md
2287
```

### 2. Byte-identity of recovered files

The blob SHA is a hash of the content, so equality with GitHub's own `.sha` is proof of
byte-identity, not a proxy for it.

```text
$ git hash-object docs/06_status/proof/UTV2-1423/recovered/verification.md
83ca97f7ddfcd9e8d93193e43df13cab3646c9f5
$ gh api ".../contents/docs/06_status/proof/UTV2-1423/verification.md?ref=c003a5529962a1aeb77f38d926f6b22170fa1710" --jq .sha
83ca97f7ddfcd9e8d93193e43df13cab3646c9f5                                  OK

$ git hash-object docs/06_status/proof/UTV2-1423/recovered/diff-summary.md
a3adc064bb6e248ff8c214c30470d96728fb6b71
$ gh api ".../contents/docs/06_status/proof/UTV2-1423/diff-summary.md?ref=c003a5529962a1aeb77f38d926f6b22170fa1710" --jq .sha
a3adc064bb6e248ff8c214c30470d96728fb6b71                                  OK
```

What was destroyed, and what landed on `main` instead:

```text
docs/06_status/proof/UTV2-1423/verification.md
  branch c003a55299  added     49L / 2255B  shaped=false   <- hand-written, destroyed
  branch ac82663dad  modified  39L / 1147B  shaped=true    <- generator output
  main   today                 23L /  705B  "result: not_run"

docs/06_status/proof/UTV2-1423/diff-summary.md
  branch c003a55299  added     72L / 4218B  shaped=false   <- hand-written, destroyed
  branch ac82663dad  modified  90L / 4104B  shaped=true
  main   today                 31L /  806B
```

### 3. Per-file verdict provenance

For each of the 28 files the lane PR was resolved from its manifest, its retained
pre-squash commits enumerated via `/pulls/{n}/commits`, and the blob fetched via
`/contents/{path}?ref={sha}` at every commit touching that path.

```text
PR commit lists retrieved:      21 / 21 lanes
contents-API failures:           0
files with zero branch touches:  0

BORN_SCAFFOLD  26   every branch version already generator-shaped -> nothing destroyed
RECOVERABLE     2   a non-generated branch version existed        -> recovered
                --
                28
```

Because the API returned complete data for every file, "unrecoverable" here means *the
hand-written version never existed*, not *the lookup failed*. That distinction is what
makes the classification honest rather than an artifact of a failed query.

### 4. Retained CI as independent evidence

The four required contexts were queried on each C1 lane's branch head.

```text
19 / 21 lanes: verify + Executor Result Validation + Merge Gate + P0 Protocol all success
 2 / 21 lanes: zero retained check-runs (merged 2026-05-26, predating the checks regime)
```

### 5. Claim coherence

```text
ci:assert-staging landed: a55de402  2026-07-30
C1 lane merge dates:                2026-05-26 .. 2026-07-17   (all before the guard)
lanes asserting a test:db run:      11 / 21
  -> evidence is a production-database run from a developer checkout
  -> valid-for-era, not valid-now; not reproducible under the current standard
```

### 6. Non-destructiveness

A zero deletion count is the strongest available mechanical statement of the
add-never-replace constraint.

```text
$ git diff --numstat origin/main..HEAD -- docs/06_status/proof/
1420    0    docs/06_status/proof/UNPROVEN_BUT_SHIPPED.json
 276    0    docs/06_status/proof/UNPROVEN_BUT_SHIPPED.md
  76    0    docs/06_status/proof/UTV2-1423/RECOVERED.md
  71    0    docs/06_status/proof/UTV2-1423/recovered/diff-summary.md
  48    0    docs/06_status/proof/UTV2-1423/recovered/verification.md
  27    0    docs/06_status/proof/UTV2-1631/proof-scaffold-audit.md
   3    0    docs/06_status/proof/UTV2-1635/diff-summary.md
   3    0    docs/06_status/proof/UTV2-1635/verification.md

1924 insertions(+), 0 deletions(-)
```

The only edit to a pre-existing file is the source audit, additions only (a resolution
banner and a follow-up section). Recovered content sits in a new `recovered/`
subdirectory beside the untouched original bundle.

### 7. Local command results

```text
pnpm type-check    PASS   (ops:preflight check PB1 on this branch)
pnpm ci:sync-check PASS    after adding .ops/sync/UTV2-1635.yml
pnpm test:db       NOT RUN  no live-database claim is made by this lane
```

## Live-database gate

Not applicable and not claimed. This lane changes only Markdown and JSON under
`docs/06_status/proof/`. Per the `ci:assert-staging` guard (`a55de402`, 2026-07-30),
`pnpm test:db` fails closed in a developer checkout and this worktree holds no staging
credential. The authoritative live-database evidence for this head is the required
`verify` context.

## R-level

No R-level rules triggered: no source code, migrations, or workflow YAML changed.
