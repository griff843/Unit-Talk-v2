# /code-structure

Architectural boundaries for the package/app graph. Canonical reference: `docs/CODEBASE_GUIDE.md`.

---

## Dependency graph (arrows go one direction)

```
@unit-talk/contracts   ← pure types, zero runtime deps
          ↑
@unit-talk/domain      ← pure business logic (imports contracts only)
          ↑
@unit-talk/db          ← repository interfaces + impls
          ↑
@unit-talk/config, observability, events, intelligence
          ↑
apps/* (api, worker, operator-web, command-center, smart-form, discord-bot, alert-agent, ingestor)
```

**Laws:**
- Apps import from packages. Packages never import from apps.
- Apps never import from each other.
- `@unit-talk/domain` imports only `@unit-talk/contracts` + Node.js built-ins (non-I/O).
- `apps/api` is the only canonical writer to the DB.
- Services take `{ repos: RepositoryBundle }` — never `createClient` directly.

---

## File-placement decision tree

```
Type used by >1 package?            → @unit-talk/contracts
Pure business decision?             → @unit-talk/domain
DB repository / impl?               → @unit-talk/db
Runtime side effect (DB, HTTP, Discord, file I/O)?  → apps/<owner>
Handler / controller / route?       → apps/api (or owning app)
Worker poll / delivery adapter?     → apps/worker
Shared by two apps?                 → STOP — belongs in a package
```

---

## Anti-patterns to reject

- `packages/domain/**` importing `@supabase/*`, `pg`, `@unit-talk/db`, `@unit-talk/config`, or using `process.env`
- `apps/<a>/src/**` importing `apps/<b>/src/**`
- Hand-edited `packages/db/src/database.types.ts` (regenerate via `pnpm supabase:types`)
- `.js` / `.d.ts` / `.map` files committed under `src/` (build misconfiguration)
- Scoring weight defined in `apps/api/src/**` (belongs in `@unit-talk/domain`)
- Service calling `createClient(...)` directly
- Repository implementation containing business rules (repos move data; services decide)
- New "utility" file duplicating logic already in `@unit-talk/domain`

---

## Verification greps

```bash
grep -rE "from '(\.\./)+apps/" apps/         # cross-app imports
grep -rE "from 'apps/" packages/             # packages importing apps
grep -rE "from '@unit-talk/(db|config|observability)'" packages/domain/src/
```

Each must return zero results.
