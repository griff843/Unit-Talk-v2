# Writer Authority Contract

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-02-01 |
| Last Updated | 2026-03-20 |

- The API service is the only default writer for canonical business tables.
- Every mutation path must declare its writer role.
- Background workers execute delegated authority; they do not invent new authority.
- Operator tools do not gain write authority unless a contract explicitly grants it.
- Week 2 authority enforcement is application-layer first: repository and service paths must enforce writer authority before database mutation.
- Postgres RLS is deferred, not rejected. It may be added in a later migration once the application-layer write paths and service roles are stable.
- No current migration is blocked on RLS policy rollout. Reserve the next dedicated security migration for RLS only if and when that work is explicitly ratified.
