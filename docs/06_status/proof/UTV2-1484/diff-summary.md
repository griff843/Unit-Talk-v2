# UTV2-1484 Diff Summary

- Added the read-only `GET /api/governance/lanes` Command Center route. It reads lane-manifest JSON files only and has no database, Linear, GitHub, or mutation client.
- Updated the governance board to render the server-side manifest snapshot and to explicitly label unavailable Linear-only fields and missing sources.
- Added route tests covering manifest projection, absent-data handling, and the absence of write handlers.
