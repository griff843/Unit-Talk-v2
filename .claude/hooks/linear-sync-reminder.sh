#!/usr/bin/env bash
# .claude/hooks/linear-sync-reminder.sh
# PostToolUse(Bash) hook: reminds Claude to update Linear after a PR merge.
# Outputs JSON with systemMessage so it shows as non-blocking feedback.

input=$(cat)
command=$(echo "$input" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('command', ''))
except Exception:
    print('')
" 2>/dev/null || echo "")

# Only fire on merge commands
if echo "$command" | grep -qE "gh pr merge"; then
  pr_num=$(echo "$command" | grep -oE '[0-9]+' | head -1)
  echo "{\"continue\": true, \"systemMessage\": \"PR #${pr_num} merged — update Linear: mark issue Done and attach PR link via Linear MCP or pnpm linear:close.\"}"
  exit 0
fi

exit 0
