# Package: @unit-talk/intelligence

Placeholder for future intelligence/model output envelope type.

## Role in Unit Talk V2

- System layer: **contract (intelligence envelope)**
- Pure: yes
- Maturity: **stub** (single interface, no implementations)

## Role in Dependency Graph

**Imports:** `@unit-talk/contracts`, `@unit-talk/domain`

**Depended on by:** `apps/api`, `apps/worker`

## What Lives Here

- `src/index.ts` — `IntelligenceEnvelope` interface: `{ source: string; confidence: number; generatedAt: string }`

## Tests

None.

## Rules

- Keep as a type contract until real intelligence logic is needed
- No AI/LLM runtime logic until explicitly scoped

## What NOT to Do

- Do not add model inference, API calls, or heavy dependencies without a Linear issue


---

## System Invariants (inherited from root CLAUDE.md)

**Test runner:** `node:test` + `tsx --test` + `node:assert/strict`. NOT Jest. NOT Vitest. NOT `describe/it/expect` from Jest. Assertion style: `assert.equal()`, `assert.deepEqual()`, `assert.ok()`, `assert.throws()`.

**Module system:** ESM (`"type": "module"`) — use `import`/`export`, not `require`/`module.exports`. File extensions in imports use `.js` (TypeScript resolution).

**Schema invariants (never get these wrong):**
- `picks.status` = lifecycle column (NOT `lifecycle_state`)
- `pick_lifecycle` = events table (NOT `pick_lifecycle_events`)
- `audit_log.entity_id` = FK to primary entity (NOT pick id)
- `audit_log.entity_ref` = pick id as text
- `submission_events.event_name` (NOT `event_type`)
- `settlement_records.corrects_id` = correction FK; original row is never mutated

**Data sources:** SGO API (`SGO_API_KEY`) and The Odds API (`ODDS_API_KEY`) via `apps/ingestor`. Both OpenAI and Anthropic Claude are in use in `packages/intelligence` and `apps/alert-agent`.

**Legacy boundary:** `C:\dev\unit-talk-production` is reference-only. No implicit truth import from legacy behavior. Any reused behavior must have a v2 artifact or runtime proof.

**Verification gate:** `pnpm verify` runs env:check + lint + type-check + build + test. Use `pnpm test` for unit tests, `pnpm test:db` for live DB smoke tests.
