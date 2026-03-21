# Submission Contract

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-02-01 |
| Last Updated | 2026-03-20 |

- Client-facing intake surfaces submit into a backend-owned intake path.
- Smart Form does not write directly to canonical pick tables.
- Submission validation produces either a rejection artifact or a canonicalized candidate payload.
- Every accepted submission emits an auditable event.
