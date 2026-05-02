# UTV2-783 DB Networking Policy

This policy defines the private networking and PostgreSQL exposure controls required before the Unit Talk V2 production database can be used outside preview or staging validation.

## AC-1: Private Networking Architecture

The production app server and production PostgreSQL server must run on the same Hetzner private network segment, using a Hetzner vSwitch or Cloud private network routed only inside the deployment boundary.

- The app server reaches PostgreSQL only by the DB server private address in the `10.0.0.0/8` range.
- PostgreSQL must not expose a public IPv4 or IPv6 listener.
- DNS names used by runtime services must resolve to the DB server private IP from the app server network namespace.
- Public maintenance access to the DB host must use hardened SSH or a bastion path; it must not expose PostgreSQL directly.

## AC-2: Postgres Bind Configuration

`postgresql.conf` must bind PostgreSQL to the DB server private IP only.

Required setting:

```conf
listen_addresses = '<db_private_ip>'
```

Forbidden values:

```conf
listen_addresses = '0.0.0.0'
listen_addresses = '*'
```

`pg_hba.conf` must restrict client access to the private subnet and named database roles only. A minimum production rule set is:

```conf
hostssl unit_talk app_user       10.0.0.0/8 scram-sha-256
hostssl unit_talk migration_user 10.0.0.0/8 scram-sha-256
hostssl unit_talk readonly_user  10.0.0.0/8 scram-sha-256
```

No `0.0.0.0/0` or `::/0` PostgreSQL client rules are allowed.

## AC-3: Connection Path Verification Procedure

Before go-live, verify that the app server connects over the private path.

1. SSH to the app server.
2. Confirm private route visibility:

   ```bash
   ip route get <db_private_ip>
   ```

   The selected interface must be the Hetzner private network or vSwitch interface.

3. Connect with `psql` using the private DB IP:

   ```bash
   psql "postgresql://app_user:<password>@<db_private_ip>:5432/unit_talk?sslmode=require"
   ```

4. Confirm PostgreSQL sees the private client address:

   ```sql
   select inet_client_addr(), inet_server_addr();
   ```

   Both addresses must be private `10.0.0.0/8` addresses.

5. Capture a basic latency check from the app server:

   ```bash
   ping -c 10 <db_private_ip>
   nc -vz <db_private_ip> 5432
   ```

Runtime connection strings must use this format:

```text
postgresql://app_user:<password>@<db_private_ip>:5432/unit_talk?sslmode=require
```

## AC-4: Firewall Rules Specification

The DB server firewall must deny PostgreSQL from public interfaces and allow PostgreSQL only from the app server private IP.

Required `ufw` baseline:

```bash
ufw default deny incoming
ufw allow in on <private_interface> from <app_private_ip> to <db_private_ip> port 5432 proto tcp
ufw deny in on <public_interface> to any port 5432 proto tcp
ufw enable
```

Equivalent `iptables` baseline:

```bash
iptables -A INPUT -i <private_interface> -p tcp -s <app_private_ip> -d <db_private_ip> --dport 5432 -j ACCEPT
iptables -A INPUT -i <public_interface> -p tcp --dport 5432 -j DROP
```

External denial must be tested from a host outside the Hetzner private network:

```bash
nmap -Pn -p 5432 <db_public_ip>
nc -vz <db_public_ip> 5432
```

The expected result is `filtered`, `closed`, timeout, or connection refused. A successful TCP connection from the public internet is a release blocker.

## AC-5: DB User Privilege Model

Production PostgreSQL must use separate roles for migrations, runtime writes, and read-only access.

- `migration_user`: owns migration execution and has DDL rights required to create, alter, and drop schema objects during approved releases.
- `app_user`: runtime service role with DML rights only on the application schema. It may `SELECT`, `INSERT`, `UPDATE`, and `DELETE` where the application contract requires, but it must not have broad DDL or superuser rights.
- `readonly_user`: operational inspection role with `SELECT` only on approved application schema objects.

Runtime services must use `app_user`. No runtime service may use a PostgreSQL superuser, database owner role, or `migration_user`.

## AC-6: TLS Policy

PostgreSQL TLS must be enabled on the DB server.

Required `postgresql.conf` settings:

```conf
ssl = on
ssl_cert_file = '/etc/postgresql/tls/server.crt'
ssl_key_file = '/etc/postgresql/tls/server.key'
```

Client certificate validation is optional for initial go-live but recommended for production hardening. If enabled, `pg_hba.conf` should use `clientcert=verify-full` for private-network clients with managed client certificates.

Certificate rotation procedure:

1. Generate or obtain the replacement server certificate and key.
2. Install both files with PostgreSQL-readable ownership and restrictive key permissions.
3. Validate certificate subject alternative names cover the private DNS name or private IP used by clients.
4. Reload PostgreSQL with `systemctl reload postgresql` or `select pg_reload_conf();`.
5. Verify a new `psql` connection with `sslmode=require`.
6. Remove retired private keys after the replacement is confirmed.

## AC-7: Manual Approval Boundary For Firewall Changes

Firewall and PostgreSQL client-access controls are manually approved production boundaries.

Any change to `ufw`, `iptables`, nftables, cloud firewall rules, or `pg_hba.conf` on the DB server requires:

- A pull request that describes the exact rule change and operational reason.
- Review by the PM.
- The `t1-approved` label before execution.

Automated jobs, deploy scripts, and application code must not change DB server firewall rules or `pg_hba.conf`.

## AC-8: Verification Checklist

Run this checklist before go-live:

1. Confirm the app server and DB server are attached to the same Hetzner vSwitch or private network.
2. Confirm the DB server PostgreSQL address is in `10.0.0.0/8` and not a public IPv4 or IPv6 address.
3. Confirm `listen_addresses` is the DB private IP only.
4. Confirm `pg_hba.conf` allows only approved roles from the private subnet and contains no public CIDR rule.
5. Confirm `psql` from the app server succeeds with `sslmode=require` against the private DB IP.
6. Confirm `inet_client_addr()` and `inet_server_addr()` show private addresses.
7. Confirm external `nmap` or `nc` against public port `5432` is denied.
8. Confirm any firewall or `pg_hba.conf` change has a PM-reviewed PR with the `t1-approved` label.
