# Warehouse Object Storage — Provisioning

**Status:** Active — WORK-2026092101
**Owner action required.** No bucket is provisioned by this lane. Provisioning object storage
and issuing credentials are owner actions; this document is the exact, non-secret specification
of what to create and how to confirm it, so the owner action is one bounded step.

**Nothing in this document is a secret, and no secret value may ever be added to it.**

---

## 1. What to provision

| Property | Value | Why it is not negotiable |
|---|---|---|
| Provider | Hetzner Object Storage (S3-compatible) | preferred per the work packet; any S3-compatible endpoint works |
| Region | the same region as the production runtime | egress cost and latency |
| Bucket | `unit-talk-archive` (or an owner-chosen name) | one bucket; the layout separates domains |
| Visibility | **private** | there is no read path in this repository that needs a public object |
| Public read | **off** | see §4 |
| Versioning | off | manifests make an object's identity explicit; versioning would make "which bytes did we verify?" ambiguous |
| Lifecycle | none on `canonical/`, `manifests/`, `features/`, `training/`, `models/` | this is the durable copy |

Provisioning an additional lifecycle rule on `raw/` is an owner decision and is not assumed here.

## 2. Credentials

An access key pair scoped to this bucket only. It is used by:

- the scheduled conveyor (write), and
- an analyst or training job (read).

**Issue two key pairs, not one**: a write key for the conveyor and a read-only key for research.
The read path's deliverable is that model training needs no production write credential; a single
shared key would satisfy the letter of that and none of its purpose.

## 3. Where the values go

**GitHub repository secrets** (Settings → Secrets and variables → Actions). These names are read
by `.github/workflows/warehouse-archive-conveyor.yml` and by `scripts/warehouse/config.ts`:

| Secret | Contains |
|---|---|
| `UNIT_TALK_WAREHOUSE_S3_ENDPOINT` | e.g. `https://<region>.your-objectstorage.com` |
| `UNIT_TALK_WAREHOUSE_S3_REGION` | the bucket's region |
| `UNIT_TALK_WAREHOUSE_S3_BUCKET` | the bucket name |
| `UNIT_TALK_WAREHOUSE_S3_ACCESS_KEY_ID` | the **write** key id |
| `UNIT_TALK_WAREHOUSE_S3_SECRET_ACCESS_KEY` | the **write** secret |
| `UNIT_TALK_WAREHOUSE_SOURCE_DSN` | a **read-only** Postgres DSN for the source database |

Optional: `UNIT_TALK_WAREHOUSE_S3_FORCE_PATH_STYLE` (defaults to `true`, which Hetzner requires).

`UNIT_TALK_WAREHOUSE_LOCAL_ROOT` exists for local development only. It is never set in CI, and
`createObjectStoreFromEnv` has **no implicit fallback to a local directory** — a misconfigured run
fails rather than quietly archiving to the runner's disk and reporting success.

### The source DSN is read-only, and that is a provisioning requirement

The exporter attaches the source database `READ_ONLY` and the audit pins
`default_transaction_read_only`. Both are belt to the DSN's braces. Issue the DSN against a role
with `SELECT` and nothing else; do not reuse the service-role credential.

**The role must also bypass row-level security.** Production `provider_offer_history` has RLS
enabled on the parent and all 60 partitions and **no policy** (measured 2026-09-23). A plain
`SELECT`-only role therefore reads **zero rows** — and a zero-row export verified against a
zero-row source count passes `0 = 0`. The conveyor now refuses before exporting
(`assertSourceNotRowFiltered`, `row_security_filtered` / `row_security_unknown`), so the failure is
loud, but the role still has to be right.

Prepared for the owner — **production DDL plus a secret, so reserved; not executed**:

```sql
CREATE ROLE warehouse_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS PASSWORD '<owner-chosen>';
ALTER ROLE warehouse_reader SET default_transaction_read_only = on;
GRANT USAGE ON SCHEMA public TO warehouse_reader;
GRANT SELECT ON public.provider_offer_history TO warehouse_reader;
```

`postgres` on this project holds `CREATEROLE` and `BYPASSRLS` without superuser, so it can issue
this. Add `GRANT SELECT` on further relations only when a policy entry for them lands.

**Use the Supabase session pooler for `UNIT_TALK_WAREHOUSE_SOURCE_DSN`**
(`postgresql://warehouse_reader.zfzdnfwdarxucxtaojxm:<password>@<region>.pooler.supabase.com:5432/postgres`).
GitHub-hosted runners are IPv4-only and the direct host is IPv6; the transaction pooler (6543)
does not suit a long read-only session.

## 4. Confirming it without revealing anything

`pnpm warehouse doctor` prints **presence only** — `present`, `missing` or `placeholder` per key,
and never a value, including for the non-secret keys. Every error path in the CLI runs through
`redactSecrets`, which substitutes configured secret values and strips `//user:pass@` out of URIs
before anything is printed.

Non-secret success criteria the owner can confirm:

1. `pnpm warehouse doctor` reports `object_store_ready: true`.
2. An unauthenticated `GET` of `https://<endpoint>/<bucket>/manifests/_conveyor/heartbeat.json`
   returns **403 or 404 — not 200**. A 200 means the bucket is public and must be closed before
   anything else proceeds.
3. `pnpm warehouse plan` prints the window it would archive.
4. A `workflow_dispatch` of **Warehouse Archive Conveyor** with `dry_run: true` succeeds.
5. Then a real dispatch: `pnpm warehouse staleness` reports `stale: false`.

## 5. What is not provisioned and not requested

- No paid provider subscription, no SGO activation, no credential rotation.
- No production DDL.
- No change to production containment.
- No standing platform. DuckDB is a library invoked per run.
