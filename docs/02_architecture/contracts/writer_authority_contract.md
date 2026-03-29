# Writer Authority Contract

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-02-01 |
| Last Updated | 2026-03-29 — depth pass UTV2-160 |

---

## Purpose

This contract defines which services hold write authority to which database surfaces, what form that authority takes, and what must happen when a write occurs. It is the governance boundary for all DB mutation in Unit Talk V2.

---

## Canonical Writer Rule

**`apps/api` is the only default writer to canonical business tables.**

No other service, app, script, or external tool may write to canonical business tables unless:

1. This contract explicitly grants delegated authority to that surface, OR
2. A separate ratified contract describes the exception and its scope

"Writing" includes INSERT, UPDATE, DELETE, and any upsert. Reading is unrestricted.

---

## Authority Map

| Table | Primary Writer | Delegated Writer | Notes |
|---|---|---|---|
| `submissions` | `apps/api` | — | Intake only via `POST /api/submissions` |
| `submission_events` | `apps/api` | — | Append-only; intake audit trail |
| `picks` | `apps/api` | — | Created at submission; status updated by API and Worker (lifecycle transitions only) |
| `pick_lifecycle` | `apps/api` | `apps/worker` | API writes `validated`; Worker writes `queued → posted`; API writes `settled`, `voided` |
| `pick_promotion_history` | `apps/api` | — | Written at submission evaluation; never updated post-decision |
| `distribution_outbox` | `apps/api` | — | Only API enqueues rows; Worker claims/transitions status |
| `distribution_receipts` | `apps/worker` | — | Delegated: Worker is sole receipt writer (proof of delivery) |
| `system_runs` | `apps/worker` | `apps/api` | Worker writes distribution runs; API writes grading runs |
| `audit_log` | `apps/api` | `apps/worker` | Append-only; both services write; DB trigger enforces immutability |
| `settlement_records` | `apps/api` | — | Written via `POST /api/picks/:id/settle`; never mutated post-write |
| `provider_offers` | `apps/ingestor` | — | Ingestor only; API does not write offers |
| `game_results` | `apps/ingestor` | — | Ingestor only; API does not write results |
| `member_tiers` | `apps/discord-bot` | — | Delegated: bot writes on role events; append-only history |
| `alert_cooldowns` (in-process) | `apps/alert-agent` | — | In-process state; not a canonical business table |

---

## Delegated Authority

Workers and background processes that write to the DB do so under **delegated authority**: they execute instructions that the API or a ratified contract has already established. They do not invent new write authority on their own.

**Delegation rules:**

- `apps/worker` may write to `distribution_receipts`, `system_runs`, `pick_lifecycle`, and `audit_log` because those write paths are bounded to the delivery pipeline the API initiated.
- `apps/ingestor` may write to `provider_offers` and `game_results` because those are its exclusive domain (feed ingestion), not shared business tables.
- `apps/discord-bot` may write to `member_tiers` because that is the explicitly ratified source-of-truth for membership state driven by Discord role events.
- No delegated writer may create or modify `picks`, `pick_promotion_history`, `settlement_records`, `submissions`, or `submission_events`.

---

## Operator Surface Write Authority

**`apps/operator-web` has no write authority.** It is a read-only dashboard. Adding a write surface to operator-web requires a new ratified contract before any implementation.

No current or planned operator-web route may call a repository write method, execute a DB mutation, or proxy a write to the API.

---

## Application-Layer Enforcement

Write authority is enforced at the application layer through the repository pattern, not by DB-level access control.

**Enforcement surfaces:**

| Layer | Mechanism |
|---|---|
| Repository interface | All writes go through `*Repository` interfaces — no raw Supabase client calls outside `packages/db` |
| `DatabaseRepository` impl | Supabase client used only within `packages/db/src/runtime-repositories.ts` |
| Service layer | Services call repositories, never Supabase directly |
| API handler | Handlers delegate to services, never access repositories or DB directly |
| InMemoryRepository | Tests use in-memory repos — no live DB required |

**Postgres RLS is deferred, not rejected.** Application-layer enforcement is the current model. RLS may be added in a dedicated security migration once service-role patterns are stable. No current sprint is blocked on RLS.

---

## Exception Rules

The following are valid exceptions to the canonical writer rule:

1. **Migrations** (`supabase/migrations/*.sql`) — schema changes are the only non-application DB writes and are version-controlled and reviewed.
2. **`pnpm supabase:types`** — regenerates `database.types.ts` from live schema; this is a read-only introspection, not a mutation.
3. **Manual operator incident recovery** — a break-glass DB edit may be performed under documented operator authority in an incident. This must be logged in `docs/05_operations/` with date, actor, table, and reason.
4. **Test setup** — tests use `InMemory*` repos. If a test uses a live DB connection, it must use a test schema or be gated under `pnpm test:db` only.

---

## Failure Behavior

If a write is attempted outside the authority boundary:

- **Application layer (accidental call):** TypeScript type system and repository interfaces will prevent direct Supabase client access outside `packages/db`. Attempting to import `@supabase/supabase-js` in an app layer file is a lint/type-check violation.
- **Missing credentials (no Supabase URL/key):** Services fall back to `InMemory*` repositories. No DB writes occur. This is the expected behavior in local dev without credentials.
- **Unauthorized surface (e.g., operator-web write attempt):** Must be caught in code review. No current runtime guard exists at the HTTP layer for operator-web — the contract is the gate.

---

## Audit and Verification

To verify that the writer authority contract is being followed:

1. **Check that no app imports `@supabase/supabase-js` directly** — only `packages/db/src/client.ts` should.
2. **Check that `apps/operator-web` has no repository write calls** — `grep -r "\.create\|\.update\|\.delete\|\.save\|\.insert"` in `apps/operator-web/src/`.
3. **Check that `distribution_receipts` rows were created by worker delivery, not API** — all receipt rows should have a corresponding `distribution_outbox` claim.
4. **Check `audit_log` immutability** — DB trigger `reject_audit_log_mutation` prevents UPDATE and DELETE. Verify trigger exists post-migration.

---

## Implementation Boundaries

In scope for this contract:
- DB mutation authority for all services
- Repository pattern enforcement
- Delegated write surfaces

Not in scope:
- Read authority (reads are unrestricted)
- API authentication/authorization (that is a separate security contract)
- Discord API calls (not a DB write surface)
- Future RLS policy design (deferred)
