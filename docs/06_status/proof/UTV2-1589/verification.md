# PROOF: UTV2-1589

MERGE_SHA: 26ccfa76de2394ac6bd79799b8ce59b4fbae5d41

## Summary

Post-merge proof generation now SHA-binds `model-routing.json` without
destroying the immutable model execution provenance recorded before merge.
The specialized rebind is idempotent, conflict-safe, and preflighted before
any proof artifact is written.

ASSERTIONS:

- [x] Every original model-routing field, including unknown provenance fields,
  is preserved byte-for-value after parsing and serialization.
- [x] `closeout_binding` records `sha_type: merge_sha`, the authoritative merge
  SHA, normalized PR URL, and the first successful binding time.
- [x] Repeating the same PR/SHA binding is a no-op and preserves `bound_at`.
- [x] A different PR or SHA, malformed required sidecar, missing required
  sidecar, or absent PR URL fails before any proof artifact write.
- [x] A missing optional sidecar remains unaffected.
- [x] Evidence JSON and verification Markdown rebinding remain unchanged.
- [x] Truth checks P3 and C4 fail before closeout binding and pass afterward.

## Verification

The following commands were executed on substantive commit
`26ccfa76de2394ac6bd79799b8ce59b4fbae5d41`:

- `npx tsx --test scripts/ops/proof-generate.test.ts scripts/ops/truth-check-lib.test.ts`
- `pnpm type-check`
- `pnpm test`
- `pnpm test:db`
- `pnpm test:t1-proof:live`
- `pnpm verify`
- `npx tsx scripts/ops/lane-manifest.ts validate UTV2-1589 --json`
- `git diff --check`
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`

```text
Focused proof generation and truth checks
# tests 87
# pass 87
# fail 0
# skipped 0

Live database smoke
# tests 7
# pass 7
# fail 0
# skipped 0

pnpm verify
exit 0

Manifest validation
{"ok":true,"code":"manifest_valid","errors":[]}

R-level
Verdict: PASS
Rules matched: (none)
```

The broader T1 live-proof battery completed with zero failures. One bounded
provider-history assertion skipped because the latest provider snapshot was
older than its lookback window; the test classifies that as stale provider
data, not a code regression. It also reported 196 pre-existing stranded
`awaiting_approval` rows. This lane did not update, delete, or backfill those
rows.

## Historical repair impact inventory

| Issue | Current state | Authoritative merge identity | Required recovery |
|---|---|---|---|
| UTV2-1585 | `started`; sidecar lacks binding | PR #1305 / `97527b791fc37acce41f4f46fd88699dce054b66` | Replay trusted post-merge closeout with explicit PR #1305 after UTV2-1589 merges |
| UTV2-1586 | `in_review`; sidecar lacks binding | PR #1306 / `fe09f637a7eeebf216e062dd4a003d7e38932d1a` | Replay trusted post-merge closeout using its recorded PR after UTV2-1589 merges |
| UTV2-1589 | `started`; active premerge lane | Pending implementation PR | Close normally through the repaired path after merge |

The candidate inventory is intentionally narrow: Codex T1 manifests that are
not done and declare a `model-routing.json` proof. UTV2-1585 and UTV2-1586 are
the two historical repair candidates. UTV2-1589 is the active implementation
lane and is not a historical replay candidate.

## Merge SHA Binding

The value above is the substantive premerge commit used for verification.
Trusted post-merge proof generation must replace it with the authoritative
GitHub merge SHA and append the matching `closeout_binding` to
`model-routing.json`.

This is executor-produced evidence for independent review. It is not a PM
verdict, does not add `t1-approved`, and does not authorize merge.
