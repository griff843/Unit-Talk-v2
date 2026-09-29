# Diff summary: UTV2-1959

MERGE_SHA: pending merge

The substantive change is limited to the sanctioned missing-token recovery and
its focused `node:test` regressions.

| File | Change |
|---|---|
| `scripts/ops/lane-link-pr.ts` | Resolves the unique immutable lane-start manifest blob from Git history and derives the T1 live-DB deferral only from that prior evidence. It deepens shallow history before resolution and refuses missing, ambiguous, incomplete, unreachable, or mismatched provenance before writing a token. |
| `scripts/ops/lane-link-pr.test.ts` | Proves legitimate immutable-evidence recovery succeeds; manifest-manufactured deferral, missing/ambiguous/incomplete evidence, and unavailable shallow history fail closed; ordinary recovery remains unchanged. |

Lane manifest, sync metadata, and this proof directory are lane-lifecycle
artifacts. No warehouse, runtime, database, or live-DB waiver behavior changes.

## SHA Binding

- Verified source SHA: `69937ab36546b585a0e250b19a7c291cb3ea7c7d`
- Merge SHA: pending merge
- PR: https://github.com/griff843/Unit-Talk-v2/pull/1700
