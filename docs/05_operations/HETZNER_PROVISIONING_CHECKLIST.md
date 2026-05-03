# Hetzner Provisioning Checklist — UTV2-786

**Status:** Provisioning-prep GO (2026-05-03)  
**Production cutover:** NO-GO until all UTV2-770 gates pass  
**Parent:** UTV2-770 (Hetzner self-hosted migration track)

> **Warning:** Completing this checklist does not authorise production cutover. DNS, Discord env, provider env, and production DB write-path changes are blocked until the PM authorisation block in the migration runbook (`docs/05_operations/contracts/migration-runbook-v1.md` §9) is signed.

---

## Architecture baseline

| Server | Role | Spec | Price |
|--------|------|------|-------|
| CCX23 | App + worker host | 4 vCPU, 16 GB RAM, 240 GB NVMe | ~€17/mo |
| EX44 | Database (PG16) | 4-core, 64 GB RAM, 2×512 GB NVMe | €49/mo + €109 setup |
| BX11 | Storage Box (backup target) | 1 TB HDD | ~€4/mo |
| Off-site | Object storage (R2 or equivalent) | second backup copy | variable |

Regions: FSN1 (Falkenstein) or HEL1 (Helsinki) — both available for EX44. Use the same region for CCX23 + EX44 to avoid cross-region egress costs on private networking.

---

## Section 1 — EX44 DB Server

### 1.1 Purchase

- [ ] PM purchases EX44 in Hetzner Robot/Cloud Console
- [ ] Region: FSN1 or HEL1 (must match CCX23)
- [ ] OS: Ubuntu 22.04 LTS
- [ ] SSH key: deploy key added at purchase time
- [ ] Setup fee: €109 (one-time)
- [ ] Monthly: €49/month (no minimum contract)

### 1.2 OS baseline

- [ ] `apt update && apt upgrade -y`
- [ ] `apt install -y fail2ban ufw unattended-upgrades`
- [ ] Timezone set to UTC: `timedatectl set-timezone UTC`
- [ ] Deploy user created: `adduser deploy`
- [ ] SSH key copied to deploy user: `ssh-copy-id deploy@<EX44-IP>`
- [ ] Root SSH password login disabled (`PermitRootLogin no`, `PasswordAuthentication no` in `/etc/ssh/sshd_config`)

### 1.3 SSH hardening

- [ ] SSH port left at 22 (or moved to non-standard — record in secrets doc)
- [ ] `AllowUsers deploy` set in `sshd_config`
- [ ] `MaxAuthTries 3` set
- [ ] `ClientAliveInterval 300` and `ClientAliveCountMax 2` set
- [ ] `sshd` restarted: `systemctl restart sshd`
- [ ] fail2ban configured for SSH jail

### 1.4 Firewall (UFW)

- [ ] Default deny incoming: `ufw default deny incoming`
- [ ] Default allow outgoing: `ufw default allow outgoing`
- [ ] Allow SSH: `ufw allow ssh`
- [ ] Allow PostgreSQL only from CCX23 private IP: `ufw allow from <CCX23-private-IP> to any port 5432`
- [ ] UFW enabled: `ufw enable`

### 1.5 PostgreSQL 16 installation

- [ ] Add PostgreSQL APT repo:
  ```bash
  apt-get install -y curl ca-certificates
  install -d /usr/share/postgresql-common/pgdg
  curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt update
  ```
- [ ] Install PG16: `apt-get install -y postgresql-16 postgresql-client-16`
- [ ] Confirm version: `psql --version` → `psql (PostgreSQL) 16.x`
- [ ] `postgresql.conf` tuning applied for 64 GB RAM (see §1.6)
- [ ] PG16 service enabled: `systemctl enable postgresql`

### 1.6 PostgreSQL configuration

- [ ] `postgresql.conf` edits (in `/etc/postgresql/16/main/`):
  ```
  listen_addresses = 'localhost,<EX44-private-IP>'
  max_connections = 100
  shared_buffers = 16GB
  effective_cache_size = 48GB
  maintenance_work_mem = 2GB
  checkpoint_completion_target = 0.9
  wal_buffers = 64MB
  default_statistics_target = 100
  random_page_cost = 1.1
  work_mem = 64MB
  huge_pages = try
  wal_level = replica
  archive_mode = on
  archive_command = '/usr/local/bin/wal-archive.sh %p %f'
  max_wal_senders = 5
  ```
- [ ] `pg_hba.conf` updated to allow CCX23 private IP for app DBs:
  ```
  host unit_talk_app deploy <CCX23-private-IP>/32 scram-sha-256
  host unit_talk_ingest deploy <CCX23-private-IP>/32 scram-sha-256
  ```
- [ ] PG reloaded: `systemctl reload postgresql`

### 1.7 Database creation

- [ ] `unit_talk_app` database created
- [ ] `unit_talk_ingest` database created (if separate DB split is in scope)
- [ ] Least-privilege roles applied per `docs/05_operations/contracts/` role model
- [ ] `deploy` user has correct grants

### 1.8 WAL/backup wiring

- [ ] BX11 Storage Box mounted or accessible via rsync/sftp
- [ ] WAL archive script at `/usr/local/bin/wal-archive.sh` installed
- [ ] WAL archive script tested: `pg_walfile_name(pg_current_wal_lsn())` → archived successfully
- [ ] Daily `pg_dump` cron job installed:
  ```
  0 2 * * * pg_dump -U deploy -Fc unit_talk_app > /backup/unit_talk_app_$(date +%Y%m%d).dump
  0 3 * * * pg_dump -U deploy -Fc unit_talk_ingest > /backup/unit_talk_ingest_$(date +%Y%m%d).dump
  ```
- [ ] Off-site copy configured (R2 sync or equivalent)
- [ ] Backup failure alert wired to Ops Bot

---

## Section 2 — CCX23 App/Worker Server

### 2.1 Purchase

- [ ] PM purchases CCX23 in Hetzner Cloud Console
- [ ] Region: same as EX44 (FSN1 or HEL1)
- [ ] OS: Ubuntu 22.04 LTS
- [ ] SSH key: deploy key added at purchase time
- [ ] Private network created between CCX23 and EX44

### 2.2 OS baseline

- [ ] Same baseline steps as EX44 §1.2 (apt upgrade, fail2ban, UFW, UTC, deploy user)
- [ ] UFW rules: allow SSH + outbound only (no inbound app ports on public NIC)
- [ ] Docker CE installed:
  ```bash
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  ```
- [ ] `deploy` user added to `docker` group: `usermod -aG docker deploy`

### 2.3 Docker Compose + systemd

- [ ] Repo deploy key added to GitHub (read-only deploy key)
- [ ] Repo cloned to `/opt/unit-talk/` as deploy user
- [ ] `docker-compose.yml` (production variant) validated
- [ ] systemd unit installed at `/etc/systemd/system/unit-talk.service`:
  ```ini
  [Unit]
  Description=Unit Talk services
  After=docker.service
  Requires=docker.service

  [Service]
  Type=oneshot
  RemainAfterExit=yes
  WorkingDirectory=/opt/unit-talk
  ExecStart=/usr/bin/docker compose up -d
  ExecStop=/usr/bin/docker compose down
  User=deploy

  [Install]
  WantedBy=multi-user.target
  ```
- [ ] `systemctl enable unit-talk`

### 2.4 Caddy/TLS

- [ ] Caddy installed: `apt-get install -y caddy` or via official Caddy APT repo
- [ ] Caddyfile configured for API reverse proxy and any public-facing endpoints
- [ ] TLS auto-provision confirmed (ACME/Let's Encrypt)
- [ ] Caddy service enabled: `systemctl enable caddy`

---

## Section 3 — BX11 Storage Box

- [ ] PM purchases BX11 Storage Box in Hetzner Robot
- [ ] SSH access configured for `deploy` user on EX44
- [ ] Mount point or rsync target tested: `rsync -avz /backup/ deploy@<BX11-host>:/backup/`
- [ ] Backup rotation cron: retain 7 daily + 4 weekly + 2 monthly dumps
- [ ] Storage Box space monitored (alert if >80% full)

---

## Section 4 — Secrets and GitHub deploy requirements

> See `docs/05_operations/contracts/secrets-management-v1.md` for full rotation runbooks.

- [ ] `/opt/unit-talk/local.env` on CCX23 created with chmod 600
- [ ] Ownership: `deploy:deploy`
- [ ] Secrets included:
  - `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` (kept until cutover is complete)
  - `DATABASE_URL` → Hetzner EX44 connection string (post-migration)
  - `HETZNER_DATABASE_URL` → EX44 URL for comparison/migration scripts
  - `SGO_API_KEY` (active key: 3cc3)
  - `DISCORD_BOT_TOKEN`
  - `DISCORD_GUILD_ID`
  - `DISCORD_CHANNEL_*` IDs
- [ ] GitHub Actions secrets updated:
  - `HETZNER_SSH_HOST`, `HETZNER_SSH_USER`, `HETZNER_SSH_KEY` for CI/CD deploy
  - `DATABASE_URL` → EX44 URL (after cutover only)
- [ ] Deploy SSH key (`id_ed25519_deploy`) placed on CCX23 for GitHub repo access
- [ ] All secrets absent from Docker images, logs, and crash reports

---

## Section 5 — Private networking

- [ ] Hetzner Cloud private network created (10.0.0.0/24 or similar)
- [ ] CCX23 attached to private network (e.g., 10.0.0.2)
- [ ] EX44 attached to private network (e.g., 10.0.0.3)
- [ ] `DATABASE_URL` uses EX44 private IP, not public IP
- [ ] PostgreSQL `listen_addresses` includes EX44 private IP
- [ ] UFW on EX44 allows 5432 from CCX23 private IP only
- [ ] Network latency checked: `ping 10.0.0.2` from EX44 (expect <1ms)

---

## Section 6 — Provisioning smoke checks (pre-cutover)

These checks confirm the server is ready to receive a migration dump but do NOT constitute production cutover.

- [ ] `psql -h <EX44-private-IP> -U deploy -d unit_talk_app -c '\l'` succeeds from CCX23
- [ ] `pnpm db:compare --dry-run` (schema mode) succeeds from CCX23
- [ ] WAL archive test: create a table, checkpoint, confirm archive file appears on BX11
- [ ] Docker Compose `up` on CCX23: all service containers start without error
- [ ] Caddy TLS: HTTPS cert issued for staging domain (if applicable)
- [ ] Disk report baseline: `pnpm db:disk-report` against EX44 test DB records initial snapshot
- [ ] Backup restore test: restore a test dump into isolated schema, verify row counts

---

## Open PM authorisation required before production cutover

- [ ] **EX44 purchased** — PM action, not completed by this checklist
- [ ] **CCX23 purchased** — PM action
- [ ] **BX11 purchased** — PM action
- [ ] **Migration runbook §9 signed** — PM authorisation block
- [ ] **All UTV2-770 child gates passed** — see UTV2-770 for gate list

---

## Sequencing dependency

```
EX44 purchase (PM) → §1 (DB server setup)
CCX23 purchase (PM) → §2 (app server setup)
BX11 purchase (PM) → §3 (backup target setup)
§1 + §2 + §3 complete → §5 (private networking)
§5 complete → §6 (smoke checks)
§6 + all UTV2-770 gates + migration runbook §9 → production cutover (BLOCKED until PM sign-off)
```
