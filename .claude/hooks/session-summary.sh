#!/usr/bin/env bash
# .claude/hooks/session-summary.sh
# Stop hook: prints a compact session summary.
# Always exits 0 — never blocks.

echo "--- Session Summary ---"

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

changed=$(git -C "$ROOT" diff --name-only HEAD 2>/dev/null)
if [ -n "$changed" ]; then
  count=$(echo "$changed" | wc -l | tr -d ' ')
  echo "Files changed vs HEAD ($count):"
  echo "$changed" | head -8 | sed 's/^/  /'
  [ "$count" -gt 8 ] && echo "  ... and $((count - 8)) more"
else
  echo "No unstaged changes vs HEAD."
fi

echo "Run: pnpm test to verify"

# Advisory: check for active lanes with stale heartbeats.
# Reads from docs/06_status/lanes/*.json — the authoritative manifest source.
# Non-blocking — always exits 0.
LANE_DIR="$ROOT/docs/06_status/lanes"
if [ -d "$LANE_DIR" ]; then
  ACTIVE_COUNT=$(node -e "
    try {
      const fs = require('fs'), path = require('path');
      const ACTIVE = new Set(['started','in_progress','in_review','blocked','reopened']);
      const count = fs.readdirSync('$LANE_DIR')
        .filter(f => f.endsWith('.json') && f !== 'README.md')
        .map(f => { try { return JSON.parse(fs.readFileSync(path.join('$LANE_DIR', f), 'utf8')); } catch(e) { return null; } })
        .filter(m => m && ACTIVE.has(m.status)).length;
      process.stdout.write(String(count));
    } catch(e) { process.stdout.write('0'); }
  " 2>/dev/null || echo "0")

  if [ "$ACTIVE_COUNT" -gt 0 ]; then
    STALE_COUNT=$(node -e "
      try {
        const fs = require('fs'), path = require('path');
        const ACTIVE = new Set(['started','in_progress','in_review','blocked','reopened']);
        const cutoff = Date.now() - 4 * 60 * 60 * 1000;
        const stale = fs.readdirSync('$LANE_DIR')
          .filter(f => f.endsWith('.json') && f !== 'README.md')
          .map(f => { try { return JSON.parse(fs.readFileSync(path.join('$LANE_DIR', f), 'utf8')); } catch(e) { return null; } })
          .filter(m => m && ACTIVE.has(m.status) && m.heartbeat_at && new Date(m.heartbeat_at).getTime() < cutoff);
        process.stdout.write(String(stale.length));
      } catch(e) { process.stdout.write('0'); }
    " 2>/dev/null || echo "0")

    echo ""
    echo "Active lanes: $ACTIVE_COUNT"
    if [ "$STALE_COUNT" -gt 0 ]; then
      echo "  Advisory: $STALE_COUNT lane(s) with heartbeat older than 4h."
      echo "  Consider updating heartbeats or running: pnpm ops:reconcile"
    else
      echo "  All lanes have fresh heartbeats."
    fi
  fi
fi

echo "-----------------------"
exit 0
