# UTV2-608 Diff Summary

Implemented live routing and promotion preview surfaces:

- Added read-only API preview endpoints for pick routing and promotion dry-runs.
- Added operator-web proxy routes for command-center access to the preview endpoints.
- Replaced command-center routing and promotion placeholder pages with pick ID search, empty state, error state, loading skeletons, and live result panels.
- Promotion preview uses the server-side promotion engine in dry-run mode through non-writing repository proxies.
- Routing preview reports pick status, promotion target, distribution target, routing reason, and latest outbox status.
