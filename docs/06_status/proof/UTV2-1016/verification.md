# UTV2-1016 Verification — Uptime Kuma full provisioning automation

## How to Verify (post-merge)

### 1. SSH tunnel to the Hetzner node

```bash
ssh -L 3001:localhost:3001 deploy@46.225.14.123
```

Then open http://localhost:3001 in your browser and log in with:
- Username: `admin`
- Password: `UPTIME_KUMA_ADMIN_PASSWORD` (GitHub secret)

### 2. Check all 5 monitors are present and active

Navigate to the Uptime Kuma dashboard. All five monitors should appear:

| Monitor name | Expected type | Expected status |
|---|---|---|
| Unit Talk API Health | HTTP | Green (UP) |
| Unit Talk Host Ping | Ping | Green (UP) |
| Unit Talk Worker Liveness | HTTP | Green (UP) |
| Unit Talk Ingestor Freshness | HTTP | Green (UP) |
| Unit Talk Discord Bot | Docker or HTTP | Green (UP) |

### 3. Check Discord notification is wired

In Uptime Kuma: Settings -> Notifications -> "Discord Ops" should appear.
Click any monitor -> Edit -> the "Discord Ops" notification should be listed as active.

### 4. Verify via the REST API (no browser needed)

From the Hetzner node (or via the SSH tunnel):

```bash
# Login and list monitors
KUMA_PASS="$(cat /tmp/kuma-pass)"   # or supply interactively
TOKEN=$(curl -sf -X POST http://localhost:3001/api/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$KUMA_PASS\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -sf http://localhost:3001/api/monitors \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import json, sys
monitors = json.load(sys.stdin)
monitors = monitors if isinstance(monitors, list) else monitors.get('monitors', [])
for m in monitors:
    print(f\"{m['id']:3}  {m['type']:10}  {m['name']}\")
print(f'Total: {len(monitors)}')
"
```

Expected output (5 monitors, IDs may vary):

```
  1  http        Unit Talk API Health
  2  ping        Unit Talk Host Ping
  3  http        Unit Talk Worker Liveness
  4  http        Unit Talk Ingestor Freshness
  5  docker      Unit Talk Discord Bot
Total: 5
```

(Monitor 5 may show `http` if docker type was not available — this is expected and documented.)

### 5. Verify idempotency

Re-run the `Deploy Monitoring` workflow from GitHub Actions. The provisioning step should
complete with "SKIP (already exists)" for all 5 monitors and exit 0 without creating duplicates.

### 6. Verify Discord alert fires

From the Uptime Kuma web UI: click a monitor -> Edit -> scroll to Notifications ->
"Test" button. A test message should arrive in the configured Discord ops channel.

## Workflow step verification

After the workflow completes, the "Provision all Uptime Kuma monitors and notifications"
step output should contain:

```
Secrets loaded.
Login: OK (token obtained)

=== Provisioning Discord notification ===
Discord notification created/updated: ID=<N>

=== Provisioning monitors ===

[1/5] API health
  CREATED (ID=<N>): Unit Talk API Health
...
[5/5] Discord bot container
  CREATED (ID=<N>, type=docker): Unit Talk Discord Bot

=== Final monitor status ===
ID    Name                                     Type         Active
...
Total monitors: 5

Provisioning complete.
```

## Branch HEAD SHA

To be filled in after PR is created and CI runs.

## Merge SHA

To be filled in after PR merge.
