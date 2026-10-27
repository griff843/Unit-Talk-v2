# Diff summary: WORK-2026102704

Adds the read-only `GET /api/reference-data/participants/:id/media` endpoint.

| File | Change |
|---|---|
| `apps/api/src/handlers/participant-media.ts` | Validates UUIDs, reads one canonical participant by ID, projects type-specific artwork, sanitizes approved HTTPS CDN URLs, and maps failures to 404/503. |
| `apps/api/src/routes/participant-media.ts` | Provides the HTTP route adapter. |
| `apps/api/src/server.ts` | Registers the unauthenticated reference-data GET route. |
| `apps/api/package.json` | Includes handler and HTTP tests in the API test command. |
| `apps/api/src/handlers/participant-media.test.ts` | Covers projection, identity, validation, URL policy, and failure behavior. |
| `apps/api/src/participant-media.http.test.ts` | Covers the public HTTP route. |

No writes, enrichment, external fetches, auth changes, schema changes, or worker/domain changes.
