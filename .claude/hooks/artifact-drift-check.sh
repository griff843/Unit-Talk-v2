#!/usr/bin/env bash
# .claude/hooks/artifact-drift-check.sh
# PostToolUse hook: warns when a generated build artifact is written under src/.
# (The former PROGRAM_STATUS.md -> "sync Linear" reminder was removed: Linear is
# portfolio-only and is not synchronized from repo state — docs/mission/intent.md.)
# Exit 2 = show as non-blocking feedback to Claude.

input=$(cat)
file_path=$(echo "$input" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('file_path', ''))
except Exception:
    print('')
" 2>/dev/null || echo "")

[ -z "$file_path" ] && exit 0

# Normalize backslashes to forward slashes
fp="${file_path//\\//}"

# --- Check 1: generated artifact under src/ ---
if echo "$fp" | grep -qE '/src/.*\.(js|d\.ts|js\.map)$'; then
  echo "WARNING: Generated artifact written under src/: $fp" >&2
  echo "Files matching *.js / *.d.ts / *.js.map under src/ should not be committed." >&2
  echo "Delete if unintentional, or verify this is expected (e.g. a deliberate JS file, not tsc output)." >&2
  exit 2
fi


exit 0
