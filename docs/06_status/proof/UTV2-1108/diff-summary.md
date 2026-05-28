## Summary

UTV2-1108 implements INIT-2.4.1 — Scoped Roles and Authority Matrices, closing Gap #22 where the service_role was unrestricted and separation of duties was convention only.

**Branch HEAD SHA:** 741d6afd3a43ab54d1ff98c4da4444cedf976104
**Merge SHA:** _to be updated post-merge_
**PR:** _to be updated post-merge_

## Files Changed

- `packages/contracts/src/operator-role.ts`: Defines `OperatorRole`, `AuthorityMatrix`, `AUTHORITY_MATRIX` (canonical), `assertAuthority()`, `hasAuthority()`, `getRole()`, and `AuthorityViolationError`. Six roles declared with explicit domain scopes: submitter, settler, poster, worker, operator, capper.
- `packages/contracts/src/index.ts`: Exports `./operator-role.js`.
- `docs/governance/authority-matrix.json`: Governance document encoding the canonical authority matrix, separation-of-duties principle, and enforcement reference.
- `apps/api/src/authority-enforcement.ts`: API adapter bridging `AuthContext` from `auth.ts` with `assertAuthority()` from contracts.
- `apps/api/src/t1-proof-utv2-1108-authority-matrix.test.ts`: 20 adversarial proof assertions — valid transitions accepted, cross-domain actions rejected, unknown roles rejected.

## Gap Closed

Gap #22 (INIT-2.4.1): Previously, RBAC roles existed but the service role was unrestricted; separation of duties was convention enforced only by code review. `assertAuthority()` now mechanically rejects any role-domain pair not declared in `AUTHORITY_MATRIX`, throwing `AuthorityViolationError` with `ERRCODE=AUTHORITY_VIOLATION`. Authority decisions are auditable and replayable.

## Proof Result

pnpm verify — PASS. T1 proof test — PASS (20/20). R-level — PASS.
