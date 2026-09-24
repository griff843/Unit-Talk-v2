# WORK-2026092404 — Command Center runtime: API /health latency and complete zombie-pick detection

Repo-owned work order (tracker independence, ratified 2026-09-05). No Linear issue exists for this identity by design.
PM directive 2026-09-24, section 7 (Command Center), items 1 and 2. Items 3-5 (governed proxy/access path, container
health checks, repeatable runtime configuration) touch `deploy/production/docker-compose.yml`, which #1645 holds;
they follow once #1645 releases that lock.

## Objective

- `/health` answers well inside the Command Center's health timeout against production.
- Zombie-pick detection reads the whole candidate population, not the first 1,000 rows PostgREST returns.

## Why (measured 2026-09-24, production, read-only)

- API `/health` takes ~13.9s. `checkSchemaDrift` issues 39 serial HEAD requests and builds a new client per call;
  the zombie check then runs one serial outbox lookup per candidate.
- `listByLifecycleStates(['draft','validated'])` selects `*` with no limit: 38,939 rows qualify, PostgREST returns
  1,000, so detection is silently partial. Filtering server-side on promotion status and target leaves 37 candidates.
- A complete read finds 8 picks with no active outbox row. All 8 are CI proof fixtures (selection matches
  `/proof/i`, or `metadata.proof_issue`), the same classifier Command Center and the alert query service already use.

## Acceptance Criteria

- Candidate read is server-filtered, ordered (`created_at`, `id`) and paged past the 1,000-row cap.
- Recognised test fixtures are reported (`fixtureCount`) and warned about, but do not make `/health` 503. Every other
  zombie still makes `/health` `down` exactly as today. Track Only exclusion unchanged.
- Schema-drift probes run concurrently and the result is reused for 60s.
- Tests: paging past 1,000 rows; fixture vs real zombie classification; mutation control on the fixture exclusion;
  drift probes concurrent and cached.
- T1 runtime proof: the new repository read and `/health` timing measured against real Supabase.

## Guardrails

- No containment, delivery-target, kill-switch or production-data change. No requeue of the 8 fixtures.
- Command Center stays internal-only; no DNS, no port exposure, no deploy from this lane.
