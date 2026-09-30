# Diff summary: UTV2-1959

MERGE_SHA: 211b82551bf4ac31d2ad4634004fbdb0967026ae

The substantive change is limited to the sanctioned missing-token recovery and
its focused `node:test` regressions.

| File | Change |
|---|---|
| `scripts/ops/lane-link-pr.ts` | Resolves the unique immutable lane-start manifest blob from Git history and derives the T1 live-DB deferral only from that prior evidence. It deepens shallow history before resolution and refuses missing, ambiguous, incomplete, unreachable, or mismatched provenance before writing a token. |
| `scripts/ops/lane-link-pr.test.ts` | Proves legitimate immutable-evidence recovery succeeds; manifest-manufactured deferral, missing/ambiguous/incomplete evidence, and unavailable shallow history fail closed; ordinary recovery remains unchanged. |

Lane manifest, sync metadata, and this proof directory are lane-lifecycle
artifacts. No warehouse, runtime, database, or live-DB waiver behavior changes.

## SHA Binding

- Verified source SHA: `f03e0ce0b73f011584f122bce87fe35b1e0dc20a`
- Merge SHA: 211b82551bf4ac31d2ad4634004fbdb0967026ae
- PR: https://github.com/griff843/Unit-Talk-v2/pull/1700
