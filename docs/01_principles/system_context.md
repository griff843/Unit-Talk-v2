# System Context

## Metadata

| Field | Value |
|---|---|
| Owner | Program Owner |
| Status | Ratified |
| Ratified | 2026-02-01 |
| Last Updated | 2026-03-21 |

## Program Systems

- Runtime platform: Unit Talk V2 monorepo in `C:\dev\unit-talk-v2`
- Legacy source: `C:\dev\unit-talk-production`
- Delivery planning: Linear
- Documentation authority: repo docs in `unit-talk-v2`
- Durable operating memory: Notion
- Communication and alerts: Slack
- Backend data platform: Supabase

## Control Boundaries

- API owns canonical business writes.
- Worker owns asynchronous execution and lifecycle processing.
- Smart Form owns intake UX and passes into a backend-owned submission path.
- Discord Bot owns distribution surface interaction and receipt ingestion.
- Operator Web is read-first until a future write contract is ratified.

## Truth Handling

- Repo docs are the canonical authority for architecture, contracts, roadmap, and current status.
- Notion is the durable planning and checkpoint layer.
- Linear is the active execution queue.
- `C:\dev\unit-talk-production` is reference-only unless V2 docs explicitly ratify a reused concept.
