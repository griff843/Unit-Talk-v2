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

# Advisory: check for active lanes that may need a snapshot before closing.
# Non-blocking — always exits 0.
LANES_FILE="$ROOT/.claude/lanes.json"
if [ -f "$LANES_FILE" ]; then
  # Count active lanes (grep-based, no deps)
  ACTIVE_COUNT=$(grep -c '"status": "active"' "$LANES_FILE" 2>/dev/null || echo "0")

  if [ "$ACTIVE_COUNT" -gt 0 ]; then
    # Use node to check snapshot freshness (node is always present in this repo)
    STALE_COUNT=$(node -e "
      try {
        const fs = require('fs');
        const raw = fs.readFileSync('$LANES_FILE', 'utf8');
        const d = JSON.parse(raw);
        const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
        const stale = (d.lanes || []).filter(l =>
          l.status === 'active' &&
          (!l.snapshotAt || new Date(l.snapshotAt).getTime() < cutoff)
        );
        process.stdout.write(String(stale.length));
      } catch(e) { process.stdout.write('0'); }
    " 2>/dev/null || echo "0")

    echo ""
    echo "Active lanes: $ACTIVE_COUNT"
    if [ "$STALE_COUNT" -gt 0 ]; then
      echo "  Advisory: $STALE_COUNT lane(s) without a recent snapshot."
      echo "  Consider capturing state before closing:"
      echo "    pnpm lane:list"
      echo "    pnpm lane:snapshot -- --issue <ID> --next \"exact next action\""
    else
      echo "  All lanes have recent snapshots."
    fi
  fi
fi

echo "-----------------------"
exit 0
