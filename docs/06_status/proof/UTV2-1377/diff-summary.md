# UTV2-1377 Diff Summary

## Summary

- Added InMemory repository guards for DB-backed enum/check parity around pick approval status, promotion state/target, promotion history target/status, lifecycle writer role, and settlement status/confidence.
- Added focused node:test coverage that proves invalid InMemory inputs now fail before mutation and that existing additive settlement correction semantics still hold.
- Kept settlement parity scoped to the constraints that are currently shared by the broader test suite: status, confidence, and corrects_id reference integrity.

## Files Changed

- `packages/db/src/runtime-repositories.ts` imports schema-backed allowed value lists and applies them in InMemory write paths.
- `packages/db/src/inmemory-constraints.test.ts` adds regression coverage for the new parity guards and updates settlement fixtures to use valid correction payloads.

## Scope Notes

- No migrations were added.
- No generated DB types were edited.
- No app runtime or cross-package contract files were changed.
