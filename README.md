# Unit Talk V2

Unit Talk V2 is a greenfield rebuild of the Unit Talk platform in a clean monorepo.

## Workspace Split

- Active build workspace: `C:\Dev\Unit-Talk-v2-main`
- Legacy reference workspace: `C:\dev\unit-talk-production`

The legacy repository is available for audit, extraction, and migration mapping only. New implementation belongs here.

## Repo Shape

```text
apps/
  api/
  worker/
  operator-web/
  smart-form/
  discord-bot/
packages/
  config/
  contracts/
  db/
  domain/
  events/
  intelligence/
  observability/
docs/
  01_principles/
  02_architecture/
  03_product/
  04_roadmap/
  05_operations/
  06_status/
```

## Getting Started

```powershell
pnpm install
pnpm env:check
pnpm lint
pnpm type-check
pnpm build
```

## Current Guardrails

- `pnpm env:check` validates `.env.example` and `local.env` ownership rules
- `pnpm lint` runs repo-wide ESLint checks
- `pnpm type-check` validates all workspace TypeScript packages
- `pnpm build` builds all workspace packages

## Environment Files

- `.env.example` is the committed shared template
- `.env` is optional local-only convenience config and is gitignored
- `local.env` is for local secrets and machine-specific overrides and is gitignored

## Schema Bootstrap

- Supabase config: `supabase/config.toml`
- Foundation migration: `supabase/migrations/202603200001_v2_foundation.sql`
- Canonical schema metadata: `packages/db/src/schema.ts`
