# Diff summary: UTV2-1977

This lane repairs Delivery/UI app derivation without changing the canonical lane
manifest. A file scope must identify exactly one recognized app. Every additional
supporting path must independently match the existing Delivery/UI allowlist and
must not match its denylist. Missing or invalid policy fails closed.

| File | Change |
|---|---|
| `scripts/ops/shared.ts` | Loads the canonical `delivery-ui` manifest, derives one recognized app, and validates every non-app path through the shared glob matcher with deny precedence. |
| `scripts/ops/shared.test.ts` | Adds the authorized supporting-path acceptance matrix and fail-closed regressions for supporting-only, multi-app, unknown, forbidden, malformed, missing-policy, and invalid-policy scopes. |

No app source, logo asset, lane policy, concurrency rule, Tier C path, runtime,
database, deployment, or activation surface changed.

## SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: 37f0e9df5cfcc8a9074990909a5162afde2df51c
