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

# Legacy lane heartbeat advisories were removed with the lane execution
# primitive (docs/mission/intent.md). Lanes still open are finished through
# /legacy:lane-recovery, not chased by a stop-hook reminder every session.

echo "-----------------------"
exit 0
