# UTV2-1762 — Diff Summary

Audited, narrowing-only release of paths from an active lane's
`file_scope_lock`. T2, governance tooling only.

**Anchor SHA:** `e4101d1b36ad5bd1446a5abf245a7391c0214273` (last non-proof commit)
**Substantive diff:** 9 files, 1821 insertions(+), 5 deletions(-)

| File | Δ | What changed |
|---|---|---|
| `scripts/ops/scope-release.ts` | +514 | New. Pure `evaluateScopeRelease` (18 refusals, all collected before returning) plus an IO shell that gathers live git/GitHub state and persists only on success. |
| `scripts/ops/scope-release.test.ts` | +598 | New. 24 tests: the release itself, every refusal in isolation, atomicity, byte-identity of lifecycle state, audit-chain validation, and a mutation harness proving all 18 refusals load-bearing. |
| `scripts/ci/file-scope-guard.test.ts` | +186 | 8 new tests for sanctioned-narrowing recognition, plus a cross-check that the guard's duplicated lock hash agrees with `shared.ts`. |
| `scripts/ci/file-scope-guard.ts` | +181 | `evaluateSanctionedNarrowing` and its wiring into `resolveTrustedManifests`: an audited narrowing from the PR head is trusted; every other manifest-sourced scope change stays inert. |
| `scripts/ops/shared.ts` | +149 | `ScopeReleaseHistoryEntry`, the `scope_release_history` field, `hashFileScopeLock`, and `validateScopeReleaseHistory` (chain enforcement), wired into `validateManifest`. |
| `scripts/ops/lane-manifest.ts` | +54 | `scope-release` subcommand and its argument validation; usage text. |
| `docs/05_operations/LANE_MANIFEST_SPEC.md` | +56/−5 | §6 corrected (a lane can never widen; widening needs a `scope-override/v1` comment), new §6.1 documenting the real command and stating plainly that `ops:lane:relock` was never implemented, and §17's "no way to release" sentence bounded. |
| `docs/05_operations/schemas/lane_manifest_v1.schema.json` | +47 | `scope_release_history` declared beside `reopen_history`. |
| `scripts/ops/lane-manifest.test.ts` | +41/−0 | Routing test for the subcommand; chains the sibling scope-release suite so it executes under `pnpm test`. |

## Not touched

- `scripts/ops/truth-check-lib.ts` and `scripts/ops/truth-check-lib.test.ts` —
  the contended paths; they belong to a different lane.
- `package.json` — outside this lane's frozen `file_scope_lock`; see the known
  gap on test wiring in `verification.md`.
- No lane manifest other than this lane's own. No release was run against any
  lane. No PR's checks were repaired.
- No DB, migration, runtime, deployment, ingestion, delivery, or production
  surface.
