# Environment Contract

## Metadata

| Field | Value |
|---|---|
| Owner | Platform |
| Status | Ratified |
| Ratified | 2026-02-01 |
| Last Updated | 2026-03-20 |

- Environments: local, staging, production.
- Environment variables are centrally documented.
- Production credentials are never required for local bootstrap.
- Integration ownership must be defined before automation depends on it.
- Shared defaults live in `.env.example`; `.env` is optional local-only convenience config; machine-local secrets and overrides live in `local.env`.
