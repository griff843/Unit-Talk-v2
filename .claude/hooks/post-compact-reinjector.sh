#!/usr/bin/env bash
# .claude/hooks/post-compact-reinjector.sh
# PostCompact hook: re-injects system state after context compaction.
# Prevents loss of lane state, active milestone, and working tree context mid-session.
# Always runs — no staleness check (compaction itself is the trigger).

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
STATE_FILE="$ROOT/docs/06_status/SYSTEM_STATE.md"
LANES_FILE="$ROOT/.claude/lanes.json"

# Build a compact state summary
BRANCH=$(git -C "$ROOT" branch --show-current 2>/dev/null || echo "unknown")
DIRTY=$(git -C "$ROOT" status --short 2>/dev/null | wc -l | tr -d ' ')
TREE_LINE="$DIRTY file(s) modified"
[ "$DIRTY" -eq 0 ] && TREE_LINE="Clean"

# Extract active lanes
LANE_SUMMARY=$(node -e "
try {
  const fs = require('fs');
  const d = JSON.parse(fs.readFileSync('$LANES_FILE', 'utf8'));
  const active = (d.lanes || []).filter(l =>
    !['done','merged','cancelled'].includes((l.status || '').toLowerCase())
  );
  if (active.length === 0) process.stdout.write('none');
  else active.forEach(l =>
    process.stdout.write('[' + (l.status||'?').toUpperCase() + '] ' + (l.id||'?') + ' — ' + (l.title||l.branch||'').slice(0,50) + '\n')
  );
} catch(e) { process.stdout.write('lanes.json unreadable'); }
" 2>/dev/null || echo "unavailable")

# Dispatch slot counts from manifests
SLOT_INFO=$(node -e "
try {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join('$ROOT', 'docs', '06_status', 'lanes');
  if (!fs.existsSync(dir)) { process.stdout.write('slots:unknown'); process.exit(0); }
  const ACTIVE = new Set(['started','in_progress','in_review','blocked','reopened']);
  const active = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && f !== 'README.md')
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')); } catch(e) { return null; } })
    .filter(m => m && ACTIVE.has(m.status));
  const claudeUsed = active.filter(m => m.executor === 'claude').length;
  const codexUsed = active.filter(m => ['codex-cli','codex-cloud'].includes(m.executor)).length;
  process.stdout.write('claude:' + claudeUsed + '/2 codex:' + codexUsed + '/3');
} catch(e) { process.stdout.write('slots:error'); }
" 2>/dev/null || echo "slots:unavailable")

# Codex health (fast — 5s timeout)
CODEX_STATUS=$(node -e "
const { spawnSync } = require('child_process');
const r = spawnSync('codex', ['--version'], { encoding: 'utf8', stdio: 'pipe', shell: process.platform==='win32', timeout: 5000 });
if (r.error || r.status !== 0) { process.stdout.write('codex:unavailable'); }
else { process.stdout.write('codex:ok(' + (r.stdout||'').trim().split('\n')[0] + ')'); }
" 2>/dev/null || echo "codex:unknown")

# Ghost lane warning (local only)
GHOST_WARNING=$(node -e "
try {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join('$ROOT', 'docs', '06_status', 'lanes');
  if (!fs.existsSync(dir)) { process.stdout.write(''); process.exit(0); }
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const ACTIVE = new Set(['started','in_progress','in_review','blocked','reopened']);
  const ghosts = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && f !== 'README.md')
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')); } catch(e) { return null; } })
    .filter(m => m && ACTIVE.has(m.status) && m.heartbeat_at && new Date(m.heartbeat_at).getTime() < cutoff);
  if (ghosts.length === 0) process.stdout.write('');
  else process.stdout.write('⚠ ' + ghosts.length + ' stale lane(s): ' + ghosts.map(m => m.issue_id).join(', '));
} catch(e) { process.stdout.write(''); }
" 2>/dev/null || echo "")

GHOST_PART=""
[ -n "$GHOST_WARNING" ] && GHOST_PART=" | $GHOST_WARNING"
MSG="[post-compact] Context compacted. Branch: $BRANCH | $SLOT_INFO | $CODEX_STATUS$GHOST_PART | Active lanes: $LANE_SUMMARY | Full state: docs/06_status/SYSTEM_STATE.md"

python3 -c "
import json, sys
print(json.dumps({'systemMessage': sys.argv[1]}))
" "$MSG" 2>/dev/null \
  || echo '{"systemMessage": "[post-compact] Context compacted. Run /system-state-loader to reload state."}'

exit 0
