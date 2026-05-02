# Backup and Disaster Recovery Policy

## Scope

This policy defines the Unit Talk V2 second-provider backup target, encryption controls, retention schedule, restore procedure, alerting split, and secret-handling rules. Hetzner Storage Box remains the first backup target. Cloudflare R2 is the second-provider target and does not replace or modify existing Hetzner backup configuration.

## Provider Selection

Cloudflare R2 is the approved second-provider backup target for database and configuration backups.

- R2 is S3-compatible, allowing rclone and standard S3 clients to upload and restore objects without provider-specific backup code.
- R2 is off-Hetzner, reducing correlated failure risk with the primary Hetzner Storage Box target.
- R2 does not charge egress fees for object reads, which keeps restore drills and emergency recovery predictable.
- R2 provides AES-256 encryption at rest by default.
- All backup transfers to R2 must use TLS in transit through the R2 HTTPS endpoint.

## Encryption

Backups use layered encryption:

- Cloudflare R2 provides AES-256 encryption at rest by default.
- Database dumps and configuration archives must be GPG envelope encrypted before upload.
- The backup scripts use `GPG_BACKUP_KEY_ID` from the runtime environment to select the recipient key.
- Plaintext dump or archive files must not be uploaded to R2.
- GPG private keys are recovery secrets and must be stored in the vault-approved recovery location, not in this repository or on shared hosts.

## Retention And RPO

The R2 retention target is:

- Daily database snapshots retained for 7 days.
- Weekly snapshots retained for 30 days.
- Monthly snapshots retained for 90 days.

The recovery point objective is 24 hours. A valid backup object from the last 24 hours must exist in R2. `scripts/backup/backup-verify.sh` enforces the freshness check for the second-provider target.

Retention pruning may be implemented through R2 lifecycle rules or an external scheduled job. Any pruning job must preserve the daily, weekly, and monthly retention windows above.

## Backup Layout

Database backup objects are written to:

```text
db-backups/YYYY/MM/DD/dump-YYYYMMDDHHMMSS.sql.gz.gpg
```

Configuration backup objects are written to:

```text
config-backups/YYYY/MM/DD/configs-YYYYMMDDHHMMSS.tar.gz.gpg
```

## Restore Procedure

Use this procedure to restore a database dump from R2. Replace object names, output paths, and database connection values with the recovery target values from the incident runbook.

1. Confirm the target restore host has `rclone`, `gpg`, `gunzip`, and `psql` installed.
2. Export R2 credentials from the vault into the current shell. Do not paste credentials into scripts or commit them to files.
3. Configure an ephemeral rclone remote for Cloudflare R2, or use the helper scripts' environment-driven rclone config pattern:

```bash
export R2_ACCOUNT_ID="<from-vault>"
export R2_ACCESS_KEY_ID="<from-vault>"
export R2_SECRET_ACCESS_KEY="<from-vault>"
export R2_BUCKET="<from-vault>"
export R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
```

4. Pull the encrypted object from R2:

```bash
rclone copyto "r2:${R2_BUCKET}/db-backups/YYYY/MM/DD/dump-YYYYMMDDHHMMSS.sql.gz.gpg" ./restore.sql.gz.gpg
```

5. Decrypt the object with the recovery private key:

```bash
gpg --decrypt --output ./restore.sql.gz ./restore.sql.gz.gpg
```

6. Validate and decompress the gzip payload:

```bash
gzip -t ./restore.sql.gz
gunzip --keep ./restore.sql.gz
```

7. Restore with `psql` into the approved recovery database:

```bash
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --file ./restore.sql
```

8. Run the post-restore smoke checks required by the active incident runbook before promoting the restored database.

## Alert Strategy

Storage Box and R2 failures must alert separately so operators can tell whether the first provider, second provider, or both providers are degraded.

- Hetzner Storage Box backup failures alert to the existing Storage Box backup alert channel.
- Cloudflare R2 upload, verification, freshness, or decrypt-test failures alert to the R2 backup alert channel.
- Alert names must include the provider name, for example `backup.storage_box.failure` and `backup.r2.failure`.
- A failure in one provider must not suppress alerts for the other provider.
- A simultaneous failure in both providers is treated as a disaster recovery escalation because the 24-hour RPO is at risk.

## Secret Handling

The following values are secrets or secret-derived runtime configuration and must be stored only in the approved vault or runtime environment:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_ENDPOINT`
- `GPG_BACKUP_KEY_ID`

These values must never be hardcoded in scripts, committed to repository files, printed in logs, or stored in plaintext `.env`, `local.env`, `*.pem`, or `*.key` files. Backup scripts must read them from the process environment and fail closed when required values are absent.

