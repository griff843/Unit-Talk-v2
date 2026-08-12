# PROOF: UTV2-1697

MERGE_SHA: b092c93c0b52d7b3543ab848a8b901c45caf61fe

# UTV2-1697 Diff Summary

- Issue: `UTV2-1697`
- Tier: `T2`
- Branch: `codex/utv2-1697-capability-map-ci-validation`

## Summary

- Adds a fail-closed validator for `docs/05_operations/CAPABILITY_MAP.json`.
- Resolves every declared command against root `package.json` scripts and every agent or skill against its canonical Markdown surface.
- Adds a path-scoped GitHub Actions workflow that runs regression tests and validates the committed map when it is present.

## Files changed

- `.github/workflows/capability-map-check.yml` — runs the focused test and map validation on relevant pull requests and main pushes.
- `scripts/ci/capability-map-check.ts` — parses the map, validates its required structure, and resolves primary/fallback capabilities fail-closed.
- `scripts/ci/capability-map-check.test.ts` — covers valid resolution, missing/invalid map input, malformed entries, unknown references, and missing schema surfaces.
- `docs/06_status/proof/UTV2-1697/*` — records implementation, routing, and verification evidence.

## Scope notes

UTV2-1693 owns the map itself and explicitly deferred this independent CI checker because its frozen file scope could not be widened. This lane does not edit the map. Its validator passes against the exact UTV2-1693 map payload: 22 entries checked, 0 findings.
