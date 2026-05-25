#!/usr/bin/env bash
# .claude/hooks/session-start.sh
# UserPromptSubmit hook: injects a compact system-state summary at session start.
#
# Logic:
#   - Reads .claude/.state-stamp (unix timestamp of last generation)
#   - If stamp is < 30 min old: exits 0 silently (no disruption mid-session)
#   - If stale: generates SYSTEM_STATE.md from local sources and outputs a
#     compact systemMessage so Claude starts the session warm
#
# Sources (local only — no MCP, no network):
#   - docs/06_status/lanes/*.json → active lane state
#   - docs/06_status/PROGRAM_STATUS.md → active milestone
#   - git log / git status      → recent commits and working tree
#
# Always exits 0 — never blocks a user prompt.

set -euo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
STAMP_FILE="$ROOT/.claude/.state-stamp"
STATE_FILE="$ROOT/docs/06_status/SYSTEM_STATE.md"
MAX_AGE=1800  # 30 minutes

# ── Staleness check ──────────────────────────────────────────────────────────
if [ -f "$STAMP_FILE" ]; then
  STAMP=$(cat "$STAMP_FILE" 2>/dev/null || echo "0")
  NOW=$(date +%s)
  AGE=$(( NOW - STAMP ))
  if [ "$AGE" -lt "$MAX_AGE" ]; then
    exit 0
  fi
fi

# ── Gather state from local sources ─────────────────────────────────────────
BRANCH=$(git -C "$ROOT" branch --show-current 2>/dev/null || echo "unknown")
TODAY=$(date '+%Y-%m-%d %H:%M')

# Recent commits (last 5, one-line)
RECENT=$(git -C "$ROOT" log --oneline -5 2>/dev/null || echo "unavailable")

# Working tree summary
DIRTY=$(git -C "$ROOT" status --short 2>/dev/null | wc -l | tr -d ' ')
if [ "$DIRTY" -gt 0 ]; then
  TREE_LINE="$DIRTY file(s) modified/untracked"
else
  TREE_LINE="Clean"
fi

# Active milestone — extract from PROGRAM_STATUS.md if it exists
MILESTONE="unknown"
PROG_FILE="$ROOT/docs/06_status/PROGRAM_STATUS.md"
if [ -f "$PROG_FILE" ]; then
  MILESTONE=$(grep -m1 -iE '\|\s*Phase\s*\|' "$PROG_FILE" 2>/dev/null \
    | sed 's/.*|\s*//' | sed 's/\s*|.*//' | head -c 80 || echo "")
  [ -z "$MILESTONE" ] && MILESTONE=$(grep -m1 -iE 'Phase [0-9]' "$PROG_FILE" 2>/dev/null \
    | sed 's/.*\(Phase [0-9A-Za-z ]*\).*/\1/' | head -c 80 || echo "")
  [ -z "$MILESTONE" ] && MILESTONE="see PROGRAM_STATUS.md"
fi

# Lane state — parse canonical lane manifests with node (always available in this repo)
LANES_OUT=$(node -e "
try {
  const fs = require('fs');
  const path = require('path');
  const dir = '$ROOT/docs/06_status/lanes';
  const activeStatuses = new Set(['started','in_progress','in_review','blocked','reopened']);
  if (!fs.existsSync(dir)) {
    process.stdout.write('  no lane manifest directory');
    process.exit(0);
  }
  const active = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch(e) { return null; } })
    .filter(l => l && activeStatuses.has(String(l.status || '').toLowerCase()));
  if (active.length === 0) {
    process.stdout.write('  none');
  } else {
    active.forEach(l => {
      const pr  = l.pr_url ? '  PR #' + l.pr_url.split('/').pop() : '';
      const ttl = (l.title || l.branch || '').slice(0, 55);
      process.stdout.write('  [' + (l.status || '?').toUpperCase() + '] ' + (l.issue_id || '?') + ' - ' + ttl + pr + '\n');
    });
  }
} catch(e) {
  process.stdout.write('  lane manifests unreadable: ' + e.message);
}
" 2>/dev/null || echo "  unavailable")

# ── Build compact one-liner for systemMessage ────────────────────────────────
LANE_COUNT=$(echo "$LANES_OUT" | grep -c '^\s*\[' || echo "0")
if [ "$LANE_COUNT" -eq 0 ]; then
  LANE_SUMMARY="no active lanes"
else
  LANE_SUMMARY="$LANE_COUNT active lane(s)"
fi

# Compute dispatch slots from manifests
SLOT_INFO=$(node -e "
try {
  const fs = require('fs');
  const path = require('path');
  const dir = '$ROOT/docs/06_status/lanes';
  const configPath = '$ROOT/docs/governance/CONCURRENCY_CONFIG.json';
  const config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
    : { executors: { claude: 2, codex: 4 } };
  if (!fs.existsSync(dir)) { process.stdout.write('slots:unknown'); process.exit(0); }
  const active = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && f !== 'README.md')
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')); } catch(e) { return null; } })
    .filter(m => m && ['started','in_progress','in_review','blocked','reopened'].includes(m.status));
  const claudeUsed = active.filter(m => m.executor === 'claude').length;
  const codexUsed = active.filter(m => ['codex-cli','codex-cloud'].includes(m.executor)).length;
  process.stdout.write('claude:' + claudeUsed + '/' + config.executors.claude + ' codex:' + codexUsed + '/' + config.executors.codex);
} catch(e) { process.stdout.write('slots:error'); }
" 2>/dev/null || echo "slots:unavailable")

# Ghost lane detection — local only, no network
GHOST_WARNING=$(node -e "
try {
  const fs = require('fs');
  const path = require('path');
  const dir = '$ROOT/docs/06_status/lanes';
  if (!fs.existsSync(dir)) { process.stdout.write(''); process.exit(0); }
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const ACTIVE = new Set(['started','in_progress','in_review','blocked','reopened']);
  const ghosts = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && f !== 'README.md')
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')); } catch(e) { return null; } })
    .filter(m => m && ACTIVE.has(m.status) && m.heartbeat_at && new Date(m.heartbeat_at).getTime() < cutoff);
  if (ghosts.length === 0) { process.stdout.write(''); }
  else {
    const ids = ghosts.map(m => m.issue_id).join(', ');
    process.stdout.write('⚠ ' + ghosts.length + ' stale lane(s) — run lane-reconciler: ' + ids);
  }
} catch(e) { process.stdout.write(''); }
" 2>/dev/null || echo "")

# Dispatch candidates — read from today's cached digest if available (no network)
DISPATCH_SUMMARY=$(node -e "
try {
  const fs = require('fs');
  const path = require('path');
  const today = new Date().toISOString().slice(0,10);
  const digestPath = path.join('$ROOT', '.out', 'ops', 'digest', today + '.json');
  if (!fs.existsSync(digestPath)) { process.stdout.write('dispatch:no-digest'); process.exit(0); }
  const d = JSON.parse(fs.readFileSync(digestPath, 'utf8'));
  const candidates = (d.dispatch_candidates || []).length;
  process.stdout.write('dispatch:' + candidates + '-ready');
} catch(e) { process.stdout.write('dispatch:error'); }
" 2>/dev/null || echo "dispatch:unavailable")

# Codex health check (fast — 5s timeout)
CODEX_STATUS=$(node -e "
const { spawnSync } = require('child_process');
const r = spawnSync('codex', ['--version'], { encoding: 'utf8', stdio: 'pipe', shell: process.platform==='win32', timeout: 5000 });
if (r.error || r.status !== 0) { process.stdout.write('codex:unavailable'); }
else { process.stdout.write('codex:ok(' + (r.stdout||'').trim().split('\n')[0] + ')'); }
" 2>/dev/null || echo "codex:unknown")

# ── Write SYSTEM_STATE.md ────────────────────────────────────────────────────
mkdir -p "$(dirname "$STATE_FILE")"
cat > "$STATE_FILE" << STATE
# System State — $TODAY

## Branch
$BRANCH

## Active Milestone
$MILESTONE

## Active Lanes
$LANES_OUT

## Dispatch Slots
$SLOT_INFO

## Ghost Lanes
${GHOST_WARNING:-none}

## Dispatch Queue
$DISPATCH_SUMMARY

## Codex Status
$CODEX_STATUS

## Working Tree
$TREE_LINE

## Recent Commits
$RECENT
STATE

# ── Update stamp ─────────────────────────────────────────────────────────────
date +%s > "$STAMP_FILE"

GHOST_PART=""
[ -n "$GHOST_WARNING" ] && GHOST_PART=" | $GHOST_WARNING"
MSG="[session-start] State loaded $TODAY | branch: $BRANCH | $LANE_SUMMARY | $SLOT_INFO | $CODEX_STATUS$GHOST_PART | $DISPATCH_SUMMARY | tree: $TREE_LINE | Full state: docs/06_status/SYSTEM_STATE.md"

# ── Output systemMessage JSON ─────────────────────────────────────────────────
python3 -c "
import json, sys
msg = sys.argv[1]
print(json.dumps({'systemMessage': msg}))
" "$MSG" 2>/dev/null || echo "{\"systemMessage\": \"[session-start] State loaded $TODAY — see docs/06_status/SYSTEM_STATE.md\"}"

exit 0
