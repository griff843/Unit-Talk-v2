# UTV2-1392 Diff Summary

## Summary

`ops:proof-generate --merge-sha` (run automatically by `post-merge-lane-close.yml`) only ever rewrote `diff-summary.md`/`runtime-verification.md` — it never touched `evidence.json`/`verification.md`, which are the files T1/T2 lanes actually use for `ops:lane-close`'s C4 (SHA binding) and P3 (merge SHA reference) checks. Every merged T1/T2 lane needed a manual post-merge SHA edit before it could close (recurred on at least 3 lanes this session: UTV2-1379, UTV2-1395, UTV2-1394).

- `scripts/ops/proof-generate.ts`: added `rebindEvidenceJsonSha()`, `rebindVerificationMdSha()`, and `rebindMergeSha()`. When `--merge-sha` is passed and `evidence.json`/`verification.md` exist for the issue, they're now surgically rebound: `evidence.json`'s `sha_binding.verified_source_sha`/`sha_type`/`bound_at` are updated (and `status` flips from a known pre-merge value to `merged`) while every other field is preserved untouched; `verification.md`'s `Commit SHA(s)` table row and `## Merge SHA Binding` section are rewritten via line-based splicing (not whole-file regex, to avoid accidentally swallowing adjacent blank lines). Both are idempotent — re-running with the same merge SHA is a no-op. Files that don't exist (e.g. T3 lanes, which have neither) are silently skipped, not treated as an error.
- `scripts/ops/proof-generate.test.ts`: 11 new tests covering rewrite behavior, idempotency, missing-file handling, non-evidence JSON, and full `generateProofArtifacts()` round-trips.
- No change to `diff-summary.md`/`runtime-verification.md` generation, `ops:lane-close`, `ops:truth-check`, or the `post-merge-lane-close.yml` workflow itself — the existing `ops:proof-generate "$ISSUE_ID" --merge-sha "$MERGE_SHA"` call now does more, with no caller-side change needed.

## No product/runtime behavior change

Touches only `scripts/ops/proof-generate.ts` (an internal ops tool) and its test file. No `apps/**` or `packages/**` code is touched.
