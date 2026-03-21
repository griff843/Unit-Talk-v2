# Domain Model

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-02-01 |
| Last Updated | 2026-03-20 |

## Core Entities

- Submission
- Pick
- Pick Lifecycle
- Distribution Outbox
- Distribution Receipt
- Settlement Record
- Participant
- Participant Membership

## Primary Flows

1. Intake captures a submission.
2. API validates and materializes a canonical pick.
3. Lifecycle transitions move the pick through promotion and posting.
4. Distribution creates downstream work and stores receipts.
5. Settlement records finalize the pick outcome.
