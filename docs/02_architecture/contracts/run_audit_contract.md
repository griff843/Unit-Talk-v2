# Run And Audit Contract

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-02-01 |
| Last Updated | 2026-03-20 |

- Long-running work emits run metadata.
- Health, retries, and failures are queryable.
- Completion claims require proof artifacts or durable records.
- Operational dashboards are consumers of audit state, not substitutes for it.
- `system_runs` is the current canonical store for worker and job visibility in V2.
- V2 does not introduce a separate `worker_heartbeats` table during the Week 2 foundation pass.
- If future worker liveness needs cannot be expressed through `system_runs`, a dedicated heartbeat table may be proposed later via ADR or contract update rather than added ad hoc.
