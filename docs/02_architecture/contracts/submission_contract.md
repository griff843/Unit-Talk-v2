# Submission Contract

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-02-01 |
| Last Updated | 2026-03-29 — depth pass UTV2-160 |

---

## Purpose

This contract defines how picks enter the system, what the submission pipeline does, what constitutes a valid vs rejected submission, and what must be true before a pick becomes canonical.

---

## Intake Path

All pick submissions flow through a single API-owned intake path:

```
POST /api/submissions
  → body validation and coercion
  → submission service: validate, create CanonicalPick
  → submission event written
  → domain analysis attached (edge, devig, kelly, promotion scores)
  → promotion evaluation (best-bets + trader-insights policies)
  → distribution enqueue (if qualified)
  → response: accepted pick ID or rejection payload
```

**No client surface writes directly to canonical pick tables.** Smart Form posts to `POST /api/submissions` via HTTP fetch — it does not have a DB connection. Discord bot `/pick` command posts to the same endpoint via the internal API client.

---

## Authority

`apps/api` is the sole intake authority. The submission path is the only way picks enter the `picks` table. No bulk import, script, or external tool may insert into `picks` or `submissions` directly without an explicit ratified contract for that surface.

---

## Body and Safety Limits

- **Max body size:** 64 KB (`API_MAX_BODY_BYTES = 65536`). Requests exceeding this limit receive HTTP 413 without reading the body.
- **Rate limit:** 10 submissions per minute per IP (`API_RATE_LIMIT_RPM = 10`). Excess requests receive HTTP 429.
- These limits apply to `POST /api/submissions` and `POST /api/picks/:id/settle`.

---

## Validation and Canonicalization

Submission validation produces one of two outcomes:

**Rejection** — submission does not produce a pick. The following are rejectable:
- Missing required canonical fields (`capper`, `league`, `pick`, `odds`)
- Odds outside representable range
- Unknown or unsupported market type
- Invalid participant reference
- Duplicate submission with identical idempotency key already in `pending` or `validated`

**Accepted** — submission produces a `CanonicalPick` record. Canonical fields are normalized at acceptance:
- Market key normalized via `normalizeMarketKey()`
- Source hardcoded to `'smart-form'` for Smart Form submissions (user-provided source is ignored)
- `confidence` converted to trust score in `metadata.promotionScores`
- Domain analysis computed and attached: implied probability, edge, devig (`metadata.deviggingResult`), Kelly sizing (`metadata.kellySizing`)

---

## Smart Form Source Enforcement

The Smart Form intake surface always sets `source = 'smart-form'` regardless of what the user-submitted body contains. Any user-supplied `source` field is discarded.

This is a governance rule: pick source must be attributable to the actual intake surface, not self-reported. Enforcement is in `apps/smart-form/src/server.ts` at the `mapFormToSubmission()` step.

---

## Submission Events

Every accepted submission writes a `submission_events` row:

| Column | Value |
|---|---|
| `submission_id` | FK to `submissions.id` |
| `event_name` | `'submission.accepted'` |
| `payload` | Canonicalized input snapshot |
| `created_at` | Event timestamp |

The field is `event_name` — not `event_type`. Do not confuse these.

Submission events are append-only. They are never updated or deleted. They form the intake audit trail.

---

## Domain Analysis at Submission

The submission pipeline computes and attaches domain analysis before the pick is persisted:

- **Implied probability** — from odds
- **Edge** — pick edge vs closing line (if market data available)
- **Devigging** — `metadata.deviggingResult` via `DeviggingService`
- **Kelly sizing** — `metadata.kellySizing` via `KellySizingService`
- **Promotion scores** — `metadata.promotionScores`: `{ edge, trust, readiness, uniqueness, boardFit }`

Domain analysis is fail-closed: if a computation fails, the submission still proceeds but the field is absent from metadata. Promotion evaluation uses whatever scores are present.

---

## Failure Behavior

| Failure | HTTP response | DB writes |
|---|---|---|
| Body too large (>64 KB) | 413 | None — body not read |
| Rate limit exceeded | 429 | None |
| Validation failure | 422 with rejection payload | `submissions` row written (rejected record); no `picks` row |
| DB unavailable (in-memory mode) | 200 accepted — in-memory only | No persistent writes |
| DB unavailable (fail-closed mode) | 503 | None |
| Domain analysis failure | 200 accepted — pick proceeds with partial metadata | `picks` row written; affected metadata field absent |

A validation rejection is not an error — it is a normal outcome. The `submissions` row records the rejection reason.

---

## Audit and Verification

For a successfully accepted submission:

1. `submissions` row exists with `status = 'accepted'`
2. `picks` row exists with `status = 'validated'`
3. `submission_events` row exists with `event_name = 'submission.accepted'`
4. `pick_promotion_history` row(s) exist — one per evaluated policy
5. `pick_lifecycle` row exists with `to_state = 'validated'`
6. `audit_log` entry exists with `action = 'submission.validated'`

For a rejected submission:
1. `submissions` row exists with `status = 'rejected'` and rejection reason
2. No `picks` row

---

## Implementation Boundaries

In scope:
- HTTP intake path (`POST /api/submissions`)
- Smart Form HTTP post to API
- Discord `/pick` command to API
- Validation, canonicalization, domain analysis, promotion evaluation, distribution enqueue

Not in scope:
- Feed-ingested picks (ingestor writes `provider_offers`/`game_results`, not picks directly)
- Bulk pick import (not ratified; requires separate contract)
- Settlement (see `settlement_contract.md`)
- Promotion policy thresholds (see `board_promotion_contract.md`)
