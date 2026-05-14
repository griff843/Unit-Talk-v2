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

MSG="[post-compact] Context compacted. Branch: $BRANCH | Tree: $TREE_LINE | Active lanes: $LANE_SUMMARY | Full state: docs/06_status/SYSTEM_STATE.md"

python3 -c "
import json, sys
print(json.dumps({'systemMessage': sys.argv[1]}))
" "$MSG" 2>/dev/null \
  || echo '{"systemMessage": "[post-compact] Context compacted. Run /system-state-loader to reload state."}'

exit 0
