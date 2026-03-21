# Tooling Setup

## External Systems

- Linear for delivery planning
- Notion for documentation
- Slack for communication and alerts
- Supabase for data platform

## MCP Note

Linear MCP has previously shown client-state drift in Codex. Re-verify MCP server registration before depending on Linear-backed automation.

## Local Bootstrap

```powershell
pnpm install
pnpm type-check
pnpm build
```

## Environment Files

- `.env.example` is the committed shared template
- `.env` is optional local-only convenience config and should remain gitignored
- `local.env` contains machine-local secrets and overrides
- Real secrets should be filled only in `local.env`
