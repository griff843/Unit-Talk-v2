# Week 8 First Posted-to-Settled Proof Template

Use this file to capture the first canonical posted-to-settled proof bundle.

Authority:
- `docs/05_operations/week_8_settlement_runtime_contract.md`
- `docs/05_operations/settlement_planning.md`

## Proof Fields

| Field | Value | Source |
|---|---|---|
| submission ID | `0523898a-8491-47c6-b991-a7ac814f9177` | `picks.submission_id` |
| pick ID | `a955039c-616a-4821-bd2a-098a799feb28` | settlement API response / `picks.id` |
| posted lifecycle event ID | `cdbd70d9-c028-41cb-bb08-0c29800dd203` | `pick_lifecycle` query |
| settlement record ID | `fb8c8ddf-e0fe-44d4-8c5e-1e129633931f` | settlement API response / `settlement_records.id` |
| settlement status/result | `settled / win` | `settlement_records.status`, `settlement_records.result` |
| settlement source | `operator` | `settlement_records.source` |
| settlement evidence reference | `proof://week8/first-posted-settled` | `settlement_records.evidence_ref` |
| correction link if any | `null` | `settlement_records.corrects_id` |
| settled lifecycle event ID | `7e03c870-4d68-4d88-8e7c-63978a8d3fef` | settlement API response / `pick_lifecycle` query |
| audit action IDs | `3a9825dd-9ac3-48f6-8858-a1ef22d10d9d` | `audit_log` query |
| operator snapshot timestamp | `2026-03-20T19:12:16.006Z` | operator read model |
| final pick lifecycle state | `settled` | `picks.status` |

## Query Support

### Posted / Settled Lifecycle Events

```sql
select id, pick_id, from_state, to_state, writer_role, created_at
from public.pick_lifecycle
where pick_id = '<PICK_ID>'
  and to_state in ('posted', 'settled')
order by created_at asc;
```

### Settlement Records

```sql
select id, pick_id, status, result, source, evidence_ref, corrects_id, settled_by, settled_at
from public.settlement_records
where pick_id = '<PICK_ID>'
order by created_at asc;
```

### Audit Actions

```sql
select id, action, actor, created_at, payload
from public.audit_log
where entity_ref = '<PICK_ID>'
  and action like 'settlement.%'
order by created_at asc;
```

## Canonical API Request Used

`POST /api/picks/a955039c-616a-4821-bd2a-098a799feb28/settle`

```json
{
  "status": "settled",
  "result": "win",
  "source": "operator",
  "confidence": "confirmed",
  "evidenceRef": "proof://week8/first-posted-settled",
  "notes": "First canonical posted-to-settled proof run",
  "settledBy": "operator"
}
```

## Verification Outcome

- canonical API request succeeded
- one additive `settlement_records` row was created
- pick lifecycle transitioned from `posted` to `settled`
- operator snapshot showed the settlement row
- no correction row was created
- worker health remained `healthy`
- distribution health remained `healthy`
