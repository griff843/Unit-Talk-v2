# PROOF: UTV2-1771

MERGE_SHA: null

ASSERTIONS:

- [x] The preservation path refuses any source other than production project
  `zfzdnfwdarxucxtaojxm` and any restore target other than staging project
  `xskgrzbteyqdufktjrjx`.
- [x] Live catalog discovery must return exactly the eight daily partitions
  from June 23 through June 30 with matching bounds.
- [x] Missing or checksum-corrupt snapshots make the restorability gate fail.
- [x] Snapshot objects are content-addressed, immutable, encrypted, downloaded
  back from R2, decrypted, restored, and re-exported before reconciliation.
- [ ] Credentialed production export and full staging restore have completed
  twice with matching source/restore counts and checksums.

EVIDENCE:

```text
TAP version 13
# Subtest: UTV2-1771 preservation fails closed for identity, partition, missing, and corrupt snapshot drift
ok 1 - UTV2-1771 preservation fails closed for identity, partition, missing, and corrupt snapshot drift
1..1
# tests 1
# pass 1
# fail 0
```

## Pre-implementation specification

Frozen before `scripts/ops/preserve-june-offer-history.ts` was created. This
section resolves the three choices left open by the issue contract.

1. **Snapshot destination:** the existing private Cloudflare R2 backup bucket
   selected by the vault-only `R2_BUCKET` value, under the exact object prefix
   `db-backups/provider-offer-history/UTV2-1771/2026-06/`. Each partition is
   stored as
   `<partition-name>.<canonical-csv-sha256>.csv.gz.gpg`; the generated receipt
   is stored as `receipt.json` under the same prefix. The committed proof names
   the object keys and a SHA-256 identity of the resolved bucket without
   exposing its vault-only name. R2 is independent object storage, outside the
   production Supabase Postgres project and its hot
   `public.provider_offer_history` table. Objects are GPG envelope-encrypted
   before upload and transfers use the repository's established R2 TLS/S3
   path.
2. **Non-production restore target:** Supabase staging project
   `xskgrzbteyqdufktjrjx`, schema `utv2_1771_restore`. The script refuses any
   restore URL that resolves to production project `zfzdnfwdarxucxtaojxm` and
   refuses a source URL that does not resolve to that production project. All
   eight snapshots are restored into staging tables in that schema, then
   re-exported in canonical order for count and SHA-256 reconciliation.
3. **Receipt location and schema:** the script writes the machine-readable
   receipt to `docs/06_status/proof/UTV2-1771/evidence.json` and uploads the
   same bytes to the R2 `receipt.json` object above. The script, not an
   operator, determines the verdict. The schema is:

   - `schema_version: 2` (integer literal; the repository's current evidence
     contract, because schema v1 is historical read-only)
   - `issue_id: "UTV2-1771"` (string literal)
   - `tier: "T1"`, `lane_type: "verification"`, and
     `proof_profile: "static"` (string literals required by the lane manifest)
   - `sha_binding: { merge_sha: string | null, verified_source_sha: string,
     evidence_commit_sha: string, current_pr_head_sha: string }`
   - `static_proof: object` (focused/static command receipts; populated even
     while hosted runtime proof is deferred)
   - `runtime_proof: { status: string, queries: object[], row_counts: object[],
     receipts: object[] }`
   - `generated_at: string` (UTC ISO-8601)
   - `verdict: "PASS" | "FAIL"`
   - `prerequisite_for: "UTV2-1370"` (string literal)
   - `snapshot_set_id: string` (SHA-256 over ordered partition identities)
   - `source: { project_ref: string, parent_table: string, read_only: boolean,
     rows_before: integer, rows_after: integer, unchanged: boolean }`
   - `destination: { provider: "cloudflare-r2", bucket_identity_sha256:
     string, object_prefix: string, receipt_object_key: string,
     schema_object_key: string, schema_object_sha256: string,
     format: "canonical-csv+restore-ddl", outside_hot_table: boolean,
     encrypted: boolean }`
   - `restore_target: { project_ref: string, schema: string,
     production: boolean }`
   - `partitions: Array<{ partition_name: string, lower_bound: string,
     upper_bound: string, source_row_count: integer, source_total_bytes:
     integer, source_heap_bytes: integer, canonical_csv_bytes: integer,
     canonical_csv_sha256: string, encrypted_object_bytes: integer,
     encrypted_object_sha256: string, object_key: string, captured_at: string,
     restored_row_count: integer, restored_csv_sha256: string,
     count_matches: boolean, checksum_matches: boolean }>`
   - `checks: { exact_partition_set: boolean, production_rows_unchanged:
     boolean, all_objects_uploaded: boolean, full_restore_completed: boolean,
     all_counts_match: boolean, all_checksums_match: boolean,
     idempotent_replay: boolean }`
   - `failures: string[]`
   - `receipt_sha256: string` (SHA-256 over canonical receipt JSON with this
     field omitted)

The prefix also contains an encrypted, content-addressed `restore-schema.sql`
object with standalone table DDL and the canonical column order. Restoration
therefore does not depend on the target already containing the hot production
table.

The exact required source set is
`provider_offer_history_p20260623` through
`provider_offer_history_p20260630`, inclusive. Runtime discovery must return
exactly that set and the expected daily bounds or the receipt verdict is
`FAIL` and UTV2-1370 remains blocked.

## Verification

Status: implementation and local static proof complete; credentialed runtime
proof pending. No success receipt has been hand-authored.

Planned focused command:

```text
npx tsx --test scripts/ops/preserve-june-offer-history.ts
```

Required static commands:

```text
pnpm type-check
pnpm test
pnpm verify:static
```

Required staging/production evidence command (through the `staging-ci` GitHub
environment with production source export credentials, staging target
credentials, and vault-backed R2 credentials):

```text
npx tsx scripts/ops/preserve-june-offer-history.ts preserve --receipt docs/06_status/proof/UTV2-1771/evidence.json
```

The preservation command must run twice against the same work directory. The
second run must reuse the content-addressed objects without inserting duplicate
restore rows. A missing/corrupt snapshot is exercised by `self-test` and must
produce a failing restorability verdict.

Writable live-DB proof is blocked/deferred: target identity could not be
resolved from its URL (host=unparseable). Writable DB verification requires
`xskgrzbteyqdufktjrjx`. Run it through the `staging-ci` GitHub environment with
`CI_SUPABASE_*` credentials.
