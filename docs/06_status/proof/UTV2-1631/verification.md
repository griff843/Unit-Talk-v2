# PROOF: UTV2-1631

MERGE_SHA: 91826943f4e53a15cdcb815a43b6c3ffb7f38ced

That SHA is a real ancestor — the `main` tip this lane branched from and
measured against, not a merge SHA that does not exist yet. It is rebound to this
PR's actual squash SHA post-merge by `post-merge-lane-close.yml`, which runs
`ops:proof-generate --merge-sha`. That rebind is now non-destructive; making it
non-destructive is what this lane does.

## Summary

`pnpm ops:proof-generate --merge-sha` destroyed measured proof. It replaced
`verification.md` and `diff-summary.md` wholesale with an empty `result: not_run`
template and reported the loss as `stale_paths_replaced`.
`.github/workflows/post-merge-lane-close.yml` runs it automatically on every
merge, so the destruction happened on the automated closeout path while the lane
still read as closed.

The premise was checked before anything was changed, on a copy of a real bundle,
and it reproduced exactly.

One guard existed, and only for `verification.md`: the file was skipped if it
contained a `| Commit SHA(s) |` table row or a `## Merge SHA Binding` heading.
`diff-summary.md` had no guard at all. The repo's own canonical proof format —
the one this very file is written in, `# PROOF:` with a `MERGE_SHA:` line —
carries neither marker. Conformant proof was exactly what got destroyed. Only 43
of 401 `verification.md` files on `main` carry either marker.

`evidence.json` was **not** destroyed; that part of the reported premise did not
hold. It is key-preserving and always was. But it was rebinding only
`sha_binding.verified_source_sha`, leaving a sibling `sha_binding.merge_sha` and
any legacy top-level `merge_sha` pointing at the *old* SHA — so a rebound bundle
asserted two different merge identities in one file, and both P3 and C4 still
passed, because they only require the authoritative SHA to appear somewhere.

The contract now: **an artifact that exists is authored evidence.** It is never
regenerated. Only merge-SHA-bearing fields are rebound, in place, by
token substitution that leaves surrounding prose byte-identical. If a file
carries no bindable merge-SHA anchor and does not already name the authoritative
SHA, the run fails loudly and the file is left untouched — uncertainty never
resolves to overwriting. Templates remain correct behaviour only when no bundle
exists yet. Planning runs before any write, so a failure mutates nothing.

`implementation_sha` is deliberately **not** rebound. It names the commit the
measurements were taken on. Rewriting it to the merge SHA would be another way
of destroying a measurement, and the UTV2-1628 bundle documents in prose why
that field must keep naming the original implementation commit.

ASSERTIONS:

1. The defect reproduces on a real measured bundle. A copy of
   `docs/06_status/proof/UTV2-1628/` (7 queries, 8 row counts, a real
   `verifier.identity`) run through `pnpm ops:proof-generate --merge-sha` at
   `ad11db4f`, pre-fix: `verification.md` 19,624 B → 850 B; `diff-summary.md`
   10,515 B → 730 B. `evidence.json` unchanged at 18,742 B. Reported as
   `stale_paths_replaced`, exit code 0.
2. The same command on the same bundle, post-fix, leaves all three files at
   their original byte sizes — 19,624 / 10,515 / 18,742 — and changes only the
   `MERGE_SHA:` line, the `Merge SHA:` lines, `verified_source_sha`,
   `sha_binding.merge_sha` and `bound_at`.
3. Every destructive-mutation assertion added in this lane FAILS against the
   pre-fix implementation and PASSES against the fixed one. Both directions were
   run, not asserted: 0/6 pass pre-fix, 67/67 pass post-fix.
4. A bundle that cannot be parsed is left byte-identical and the run exits
   non-zero (`malformed_evidence_json`). Pre-fix it was silently swallowed and
   the run reported success.
5. An authored artifact with no merge-SHA anchor fails loudly
   (`unbindable_proof_artifact`) and is left byte-identical, and no sibling
   artifact is written either, because planning precedes all writes.
6. A pre-merge run (no merge SHA) never touches an authored bundle.
7. Templates are still written when no bundle exists yet.
8. `pnpm verify` is green on the branch head.

EVIDENCE:

## Verification

- `pnpm verify` — see the run log below. Static verification only; this lane
  touches no database path and makes no production writes.
- `pnpm type-check` — PASS, clean exit, no output.
- `pnpm lint` — PASS, clean exit, no output.
- `npx tsx --test scripts/ops/proof-generate.test.ts` — 67 tests, 67 pass,
  0 fail, 0 skipped.
- `npx tsx --test scripts/ops/proof-generate.test.ts scripts/ops/lane-close.test.ts scripts/ops/truth-check-lib.test.ts`
  — 259 tests, 259 pass, 0 fail. `lane-close.ts` is the other consumer of
  `rebindMergeSha`; its trusted `--repair-merged` path is unaffected.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — run as
  part of the branch gates.

No `pnpm test:db` claim is made anywhere in this bundle. This lane does not
touch a database path.

## Evidence

### E1 — the defect, reproduced before any code was changed

A copy of the real UTV2-1628 bundle was placed at
`docs/06_status/proof/UTV2-9999/` with a manifest copied from
`docs/06_status/lanes/UTV2-1628.json`, then:

```
$ pnpm ops:proof-generate UTV2-9999 --merge-sha ad11db4f4ce54b60ad2f9b4f1bec81e6e4a95a72 --json
{
  "ok": true,
  "code": "proof_generated",
  "issue_id": "UTV2-9999",
  "generated_paths": [],
  "updated_paths": [
    "docs/06_status/proof/UTV2-9999/diff-summary.md",
    "docs/06_status/proof/UTV2-9999/verification.md",
    "docs/06_status/proof/UTV2-9999/evidence.json"
  ],
  "stale_paths_replaced": [
    "docs/06_status/proof/UTV2-9999/diff-summary.md",
    "docs/06_status/proof/UTV2-9999/verification.md",
    "docs/06_status/proof/UTV2-9999/evidence.json"
  ]
}
=== EXIT 0 ===
```

Byte sizes before → after:

| File | Before | After |
|---|---|---|
| `verification.md` | 19,624 | **850** |
| `diff-summary.md` | 10,515 | **730** |
| `evidence.json` | 18,742 | 18,742 |

What replaced 19,624 bytes of assertions, queries and row counts:

```
# UTV2-9999 Runtime Verification
...
result: not_run

## Verification
- [ ] `pnpm type-check`: not run by proof-generate
- [ ] `pnpm test`: not run by proof-generate
- [ ] `pnpm verify`: not run by proof-generate
...
## Runtime Verification
- Generated foundation artifact. Replace or append command output when runtime proof is executed.
```

The `evidence.json` diff from the same run shows the second, quieter defect:
`verified_source_sha` moved to `ad11db4f…`, while `sha_binding.merge_sha`
stayed at `69b1c370…`. One file, two merge identities, both gates green.

### E2 — the same command, post-fix, on the same bundle

```
$ pnpm ops:proof-generate UTV2-9999 --merge-sha ad11db4f4ce54b60ad2f9b4f1bec81e6e4a95a72 --json
{
  "ok": true,
  "code": "proof_generated",
  "generated_paths": [],
  "stale_paths_replaced": [],
  "preserved_paths": [
    "docs/06_status/proof/UTV2-9999/diff-summary.md",
    "docs/06_status/proof/UTV2-9999/verification.md",
    "docs/06_status/proof/UTV2-9999/evidence.json"
  ],
  "rebound_paths": [ ...same three... ]
}

=== sizes ===
10515 docs/06_status/proof/UTV2-9999/diff-summary.md
18742 docs/06_status/proof/UTV2-9999/evidence.json
19624 docs/06_status/proof/UTV2-9999/verification.md
```

The complete diff produced by that run, across all three files:

```
--- verification.md ---
-MERGE_SHA: 69b1c37091e5d8984baa48e745ac1272123fa020
+MERGE_SHA: ad11db4f4ce54b60ad2f9b4f1bec81e6e4a95a72
--- diff-summary.md ---
-Merge SHA: 69b1c37091e5d8984baa48e745ac1272123fa020
+Merge SHA: ad11db4f4ce54b60ad2f9b4f1bec81e6e4a95a72
-Merge SHA: 69b1c37091e5d8984baa48e745ac1272123fa020
+Merge SHA: ad11db4f4ce54b60ad2f9b4f1bec81e6e4a95a72
--- evidence.json ---
-    "verified_source_sha": "69b1c37091e5d8984baa48e745ac1272123fa020",
+    "verified_source_sha": "ad11db4f4ce54b60ad2f9b4f1bec81e6e4a95a72",
-    "merge_sha": "69b1c37091e5d8984baa48e745ac1272123fa020",
+    "merge_sha": "ad11db4f4ce54b60ad2f9b4f1bec81e6e4a95a72",
-    "bound_at": "2026-07-31T00:53:51.470Z"
+    "bound_at": "2026-07-31T04:48:08.980Z"
```

Nothing else in 48,881 bytes moved. The scratch lane was removed afterwards; it
is not part of this PR.

### E3 — both directions, actually run

The pre-fix implementation was restored verbatim
(`git show origin/main:scripts/ops/proof-generate.ts`) alongside the fixed one,
and the new destructive-mutation assertions were run against it:

```
not ok 1 - LEGACY: measured verification.md survives byte-identically except MERGE_SHA
not ok 2 - LEGACY: verification.md keeps queries/row-counts/custom sections and is not scaffolded
not ok 3 - LEGACY: authored diff-summary.md is preserved, never regenerated
not ok 4 - LEGACY: sibling sha_binding.merge_sha is rebound too
not ok 5 - LEGACY: unparseable evidence.json is left untouched AND the run fails
  error: 'Missing expected exception.'
not ok 6 - LEGACY: authored artifact with no merge-SHA anchor fails loudly and is left untouched
  error: 'Missing expected exception.'
# tests 6
# pass 0
# fail 6
```

Against the fixed implementation, the committed suite:

```
# tests 67
# pass 67
# fail 0
# skipped 0
```

The two temporary files used for the legacy run were deleted and are not part of
this PR.

### E4 — related suites

```
$ npx tsx --test scripts/ops/proof-generate.test.ts scripts/ops/lane-close.test.ts scripts/ops/truth-check-lib.test.ts
# tests 259
# pass 259
# fail 0
```

### E5 — scaffold audit of prior closeouts

`docs/06_status/proof/UTV2-1631/proof-scaffold-audit.md`. Headline: **82
destructive overwrite events across 62 lanes, 2026-05-30 → 2026-07-25, 4,106
lines / ~222 KB destroyed**; 11 by `github-actions[bot]` on the automated
closeout path. Separated into "looks replaced" (Table A, with the commit SHA and
deletion count for each), "was always thin" (Table B, 50 lanes), and "cannot
distinguish" (Table C, 24 files whose adding commit *is* the lane's own squash
SHA — resolvable only from GitHub's retained PR commit list, not locally; that
was not resolved). Every destroyed version is recoverable via
`git show <sha>^:<path>`. No other lane's proof is repaired by this PR.

## Known imprecision, recorded rather than glossed

`evidence.json` rebinding is **value**-preserving, not **byte**-preserving. It
round-trips through `JSON.parse` / `JSON.stringify(parsed, null, 2)`, so every
key and every value survives exactly, but hand-authored formatting (compact
one-line objects, for instance) is normalized to the 2-space style. This is
long-standing behaviour of `rebindEvidenceJsonSha`, not something this lane
introduced, and no measurement is altered by it — but the byte-identical claim
above is precise only for the markdown artifacts, and it would be wrong to let
it read as covering the JSON layout too. Observed live when this bundle was
rebound to its own merge SHA: values identical, indentation reflowed.


## Merge SHA Binding

Merge SHA: `91826943f4e53a15cdcb815a43b6c3ffb7f38ced`
PR: https://github.com/griff843/Unit-Talk-v2/pull/1332
