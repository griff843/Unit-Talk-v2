# Warehouse Object Storage — Provisioning

**Status:** Active — WORK-2026092101; credential design and bucket corrected WORK-2026092405 (PM-approved in principle 2026-09-24)
**Owner action required.** No bucket is provisioned by this lane. Provisioning object storage
and issuing credentials are owner actions; this document is the exact, non-secret specification
of what to create and how to confirm it, so the owner action is one bounded step.

**Nothing in this document is a secret, and no secret value may ever be added to it.**

---

## 1. What to provision

| Property | Value | Why it is not negotiable |
|---|---|---|
| Provider | Hetzner Object Storage (S3-compatible) | preferred per the work packet; any S3-compatible endpoint works |
| Region | the region the bucket already lives in | egress cost and latency |
| Bucket | **`unit-talk-prod-warehouse` — already exists. Do not create or recreate a bucket.** | one bucket; the layout separates domains |
| Visibility | **private** | there is no read path in this repository that needs a public object |
| Public read | **off** | see §4 |
| Versioning | off | manifests make an object's identity explicit; versioning would make "which bytes did we verify?" ambiguous |
| Lifecycle | none on `canonical/`, `manifests/`, `features/`, `training/`, `models/` | this is the durable copy |

Provisioning an additional lifecycle rule on `raw/` is an owner decision and is not assumed here.
The quarantine archive is filed under `raw/provider_offers_legacy/`
([`WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md`](WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md) §4), and PM has
placed it under a standing prune hold. **A lifecycle rule that expires `raw/` would delete it**, so
none may be added while the hold stands.

The same Hetzner project also holds `unit-talk-prod-backups`. Nothing in this repository writes
to it, and its purpose is not yet established. The design below is built so that no warehouse
credential can reach it.

## 2. Credentials

**Design approved in principle by PM, 2026-09-24.** Three identities, each with one job:

| Identity | Lives in | Allowed on `unit-talk-prod-warehouse` | Anything else | Stored in |
|---|---|---|---|---|
| **writer** | a separate, keys-only Hetzner project | `s3:ListBucket`, `s3:GetObject`, `s3:PutObject` | nothing | the `warehouse-archive` GitHub environment only (§3) |
| **reader** | the same keys-only project | `s3:ListBucket`, `s3:GetObject` | nothing | the research operator's own environment; **never** alongside the writer |
| **admin** | the bucket's own project | project-wide (Hetzner default) | every bucket in that project | **nowhere** — created to apply the policy, then deleted |

### Why a separate project

A Hetzner S3 key is project-wide by default: "every key has read and write permissions for every
existing and new Bucket within the same project"
([Hetzner, S3 credentials FAQ](https://docs.hetzner.com/storage/object-storage/faq/s3-credentials/)).
A writer created next to the bucket could therefore also write, overwrite or delete
`unit-talk-prod-backups`.

There are two ways to restrict it:

- **Deny + `NotPrincipal`** on every bucket in the project. This works only if the backups bucket
  also gets a policy, and one written without knowing who writes backups risks locking out that
  writer.
- **Keys in a separate project, with an `Allow` policy on this one bucket.** A key from another
  project has no access to anything until a bucket policy grants it, so it reaches this bucket and
  nothing else. It needs no change to `unit-talk-prod-backups`.

The second is chosen. Hetzner documents the pattern, and notes that "you still need at least one
key pair in the same projects as your Buckets so that you can apply your bucket policies". That
key pair is the admin identity above.

### Multipart is deliberately not granted

`scripts/warehouse/object-store.ts` issues exactly four S3 operations: `PutObject` (one whole-object
PUT), `HeadObject`, `GetObject` and `ListObjectsV2`. It never starts a multipart upload, and a
single PUT holds up to 5 GB. The largest backfill window is about 2.74M rows. Granting
`s3:AbortMultipartUpload` / `s3:ListMultipartUploadParts` would add actions nothing uses. Add them
only when the client starts using multipart, and in the same change.

Neither identity is granted `s3:DeleteObject`. The conveyor overwrites an interrupted object with
a fresh PUT and never deletes.

### Cost (checked 2026-09-24)

Hetzner documents Object Storage billing as **per account**: "You are charged per hour with a
monthly price cap, regardless of how many Buckets you have and how many different projects or
locations they are in", and "the storage and traffic consumption of all Buckets across all
projects are combined and billed as one". A charge accrues for "every hour you have at least one
active Bucket" ([Hetzner, Object Storage overview](https://docs.hetzner.com/storage/object-storage/overview/)).

The account already pays that base price, because it already has buckets. A keys-only project
holds **no bucket**, so by those terms it adds no base charge. Hetzner's billing FAQ describes no
charge for a project itself. Stored bytes and egress are billed account-wide, as they would be
under any key layout.

**One confirmation remains an owner action**, because Hetzner's documentation does not state it
in a sentence: after creating the keys-only project, the Hetzner console's cost preview for the
account shows **no new line item**. If it shows one, stop and return it to PM. Nothing else
proceeds.

### The bucket policy

Applied once, with the admin key, to `unit-talk-prod-warehouse` only. `<keys_project_id>`,
`<writer_access_key>` and `<reader_access_key>` are the keys-only project's numeric id and the two
access-key **ids**. Key ids are not secrets; the secret keys never appear in a policy.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "WarehouseWriter",
      "Effect": "Allow",
      "Principal": { "AWS": ["arn:aws:iam:::user/p<keys_project_id>:<writer_access_key>"] },
      "Action": ["s3:ListBucket", "s3:GetObject", "s3:PutObject"],
      "Resource": [
        "arn:aws:s3:::unit-talk-prod-warehouse",
        "arn:aws:s3:::unit-talk-prod-warehouse/*"
      ]
    },
    {
      "Sid": "WarehouseResearchReader",
      "Effect": "Allow",
      "Principal": { "AWS": ["arn:aws:iam:::user/p<keys_project_id>:<reader_access_key>"] },
      "Action": ["s3:ListBucket", "s3:GetObject"],
      "Resource": [
        "arn:aws:s3:::unit-talk-prod-warehouse",
        "arn:aws:s3:::unit-talk-prod-warehouse/*"
      ]
    }
  ]
}
```

```bash
# admin key in the environment for this one command only; never written to a file or to GitHub
aws s3api put-bucket-policy --endpoint-url "https://<region>.your-objectstorage.com" \
  --bucket unit-talk-prod-warehouse --policy file://warehouse-policy.json
aws s3api get-bucket-policy --endpoint-url "https://<region>.your-objectstorage.com" \
  --bucket unit-talk-prod-warehouse          # read it back
```

**Rollback:** `aws s3api delete-bucket-policy --bucket unit-talk-prod-warehouse` with the admin
key. This removes only the two grants. It deletes no object, and the bucket's own-project access
is unaffected.

### Verification matrix — required before any secret reaches GitHub

Run with each key in turn. Every **deny** row must fail with `AccessDenied`. A success on a deny
row means the design has not held: stop, and do not provision secrets.

| # | Key | Operation | Target | Expected |
|---|---|---|---|---|
| V1 | writer | `put-object` `manifests/_provisioning/probe-writer.json` | warehouse | **allow** |
| V2 | writer | `get-object`, `head-object`, `list-objects-v2` | warehouse | **allow** |
| V3 | writer | `delete-object` of V1's key | warehouse | **deny** |
| V4 | writer | `list-objects-v2`, `get-object`, `put-object` | `unit-talk-prod-backups` | **deny** |
| V5 | reader | `list-objects-v2`, `get-object` V1's key | warehouse | **allow** |
| V6 | reader | `put-object` `manifests/_provisioning/probe-reader.json` | warehouse | **deny** |
| V7 | reader | `delete-object` of V1's key | warehouse | **deny** |
| V8 | reader | `list-objects-v2`, `get-object` | `unit-talk-prod-backups` | **deny** |
| V9 | none (anonymous) | `GET https://<endpoint>/unit-talk-prod-warehouse/manifests/_provisioning/probe-writer.json` | warehouse | **403 or 404, never 200** |
| V10 | admin | deleted after the policy is applied; the key id no longer authenticates | — | **fails** |

The V1 probe object stays in place: neither warehouse key can delete it, by design. It is a
2-byte marker under `manifests/_provisioning/`, which the prune gate never reads.

## 3. Where the values go

**Only after the §2 verification matrix passes.** PM direction 2026-09-24: production secrets are
not provisioned until the storage identities exist and are verified.

### The writer: a `warehouse-archive` GitHub environment, `main` only

Not repository secrets. An environment scopes a secret to the jobs that name it, and a deployment
branch policy restricts those jobs to trusted refs:

| Setting | Value |
|---|---|
| Environment | `warehouse-archive` |
| Deployment branches | **Selected branches: `main` only.** A job on a PR branch or a fork cannot receive these secrets. |
| Required reviewers | none for the scheduled conveyor. A backfill dispatch is gated by PM approval of the run itself (backfill plan §5). |

Environment secrets. These names are read by `.github/workflows/warehouse-archive-conveyor.yml` and
by `scripts/warehouse/config.ts`:

| Secret | Contains |
|---|---|
| `UNIT_TALK_WAREHOUSE_S3_ENDPOINT` | e.g. `https://<region>.your-objectstorage.com` |
| `UNIT_TALK_WAREHOUSE_S3_REGION` | the bucket's region |
| `UNIT_TALK_WAREHOUSE_S3_BUCKET` | `unit-talk-prod-warehouse` |
| `UNIT_TALK_WAREHOUSE_S3_ACCESS_KEY_ID` | the **writer** key id |
| `UNIT_TALK_WAREHOUSE_S3_SECRET_ACCESS_KEY` | the **writer** secret |
| `UNIT_TALK_WAREHOUSE_SOURCE_DSN` | the **read-only** `warehouse_reader` Postgres DSN |

**No admin credential is ever stored in GitHub** — not in an environment, not in a repository
secret, not in a variable.

### The reader: its own names, never beside the writer

The research reader uses different variable names, so a research environment cannot pick up the
writer by accident:

| Variable | Contains |
|---|---|
| `UNIT_TALK_WAREHOUSE_S3_READ_ACCESS_KEY_ID` | the **reader** key id |
| `UNIT_TALK_WAREHOUSE_S3_READ_SECRET_ACCESS_KEY` | the **reader** secret |

Endpoint, region and bucket are shared, non-secret names. The reader is not stored in GitHub at
all unless a research workflow needs it; if one does, it gets its own environment.

**Guard (to implement once #1643 releases `config.ts` and `cli.ts`):** the research commands
(`query`, and any training or read path) resolve credentials only from the `_READ_` names, and
**refuse to start** if `UNIT_TALK_WAREHOUSE_S3_ACCESS_KEY_ID` or
`UNIT_TALK_WAREHOUSE_S3_SECRET_ACCESS_KEY` is present in their environment. They refuse rather than
ignore, because a research job that runs with the writer present can write. The refusal names the
variable and never prints its value (`redactSecrets`). Tests: writer present → refusal; only
reader present → proceeds; the writer's value never appears in output.

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
GRANT SELECT ON public.provider_offers_legacy_quarantine TO warehouse_reader;
GRANT SELECT ON public.raw_payloads TO warehouse_reader;
GRANT SELECT ON public.odds_snapshots TO warehouse_reader;
GRANT SELECT ON public.system_runs TO warehouse_reader;
```

`postgres` on this project holds `CREATEROLE` and `BYPASSRLS` without superuser, so it can issue
this. The quarantine grant is for the one-time archive PM decided on 2026-09-24. That table has
RLS on and no policy, the same as history (measured 2026-09-24). The last three grants are for the
policy entries WORK-2026092607 added. All three have RLS enabled (measured 2026-09-26):
`system_runs` has no policy at all, and `raw_payloads` (2 policies) and `odds_snapshots` (1) have
policies written for the application roles. `BYPASSRLS` is what makes all of them readable in full,
and the conveyor refuses a row-filtered read either way. Add `GRANT SELECT` on further relations
only when a policy entry for them lands.

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
2. An unauthenticated `GET` of `https://<endpoint>/unit-talk-prod-warehouse/manifests/_conveyor/heartbeat.json`
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

## 6. Owner sequence

Each step's success criterion is non-secret. Stop at the first step that does not meet it.

1. **Create the keys-only project** in the Hetzner console, with no bucket and no server.
   *Success:* the account's cost preview shows no new line item. Anything else → stop, return to PM.
2. **Create the writer and reader key pairs** in that project.
   *Success:* two access-key ids recorded, secrets held only by the owner.
3. **Create a temporary admin key pair** in the bucket's project, apply the §2 policy, and read it
   back. *Success:* `get-bucket-policy` returns both statements.
4. **Run the §2 verification matrix V1–V9.** *Success:* every row matches its expected result.
5. **Delete the admin key pair** (V10). *Success:* that key id no longer authenticates.
6. **Create the `warehouse_reader` role** (§3 DDL) — production DDL, reserved.
   *Success:* a `SELECT count(*)` over the role's DSN matches the owner's count for one history day.
7. **Create the `warehouse-archive` environment and its secrets** (§3). *Success:*
   `pnpm warehouse doctor` in a `workflow_dispatch` dry run reports `object_store_ready: true`.

Starting the historical backfill after that is a separate PM-reserved action
([`WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md`](WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md) §5).
