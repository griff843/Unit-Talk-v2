# DEPRECATED — operator-web

**Status:** Decommissioned 2026-04-27

## Why decommissioned

`operator-web` was a read-only Node.js HTTP server (port 4200) that served operator dashboard data to `apps/command-center`. It has been replaced by a direct Supabase data layer inside `apps/command-center/src/lib/data/`, eliminating the inter-service HTTP hop.

## What replaced it

- Data access: `apps/command-center/src/lib/data/` — direct Supabase queries using `@unit-talk/db` repositories
- All 16 command-center page components were rewired to call these functions directly (UTV2-764, UTV2-766)

## Removal path

This directory is retained temporarily for reference. Once the command-center data layer is confirmed stable in production, this directory will be deleted entirely. Do not add new code here.

## Related issues

- UTV2-764: Extract operator-web data logic into command-center src/lib/data/
- UTV2-766: Rewire command-center pages to direct data layer calls
- UTV2-769: Delete operator-web app and remove workspace references
