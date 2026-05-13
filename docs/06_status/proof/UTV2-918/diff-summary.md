# UTV2-918 Diff Summary

## Scope

- Upgraded Command Center and Smart Form to `next@15.5.18`.
- Upgraded Discord bot to `discord.js@^14.26.4`.
- Added pnpm overrides for vulnerable transitive `lodash` and `postcss` ranges.
- Moved `tailwindcss-animate` out of Smart Form production dependencies.
- Added a CI step that runs `pnpm audit --prod --audit-level high`.

## Verification

- `pnpm audit --prod` reports no known vulnerabilities.
- `pnpm --filter @unit-talk/discord-bot build` passed.
- `pnpm --filter @unit-talk/smart-form build` passed with `AUTH_SECRET`/`NEXTAUTH_SECRET` set for production build validation.
- `pnpm --filter @unit-talk/command-center build` passed with `COMMAND_CENTER_AUTH_TOKEN` set for production build validation.
- `pnpm test:command-center`, `pnpm test:smart-form`, and Discord bot focused tests passed.
- `pnpm verify` passed.
- `pnpm test:db` not required for this T2 lane because no DB, migration, or API service files changed.

## R-level Notes

- `operator-ui` is triggered by Command Center and Smart Form package manifest changes.
- `discord-delivery` is triggered by the Discord bot package manifest change.
- QA artifact captured at `apps/qa-agent/artifacts/unit-talk-command_center-research_lines-operator/2026-05-13T14-30-59-lopam7/result.json`.
- The captured QA run exercised the local Command Center research-lines surface with no 5xx, network, or console errors; the runner marked the flow failed because its generic wait selector resolved a hidden div before visible content, while later page/selector expectations passed.
