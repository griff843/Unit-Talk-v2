# Distribution Contract

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-02-01 |
| Last Updated | 2026-03-20 |

- Distribution work is created from an outbox boundary.
- Delivery receipts are stored as first-class records.
- Discord-facing operations must be idempotent.
- Failed downstream work must be observable and retryable.
