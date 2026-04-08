#!/usr/bin/env bash
# .claude/hooks/linear-sync-reminder.sh
# PostToolUse(Bash) hook: reminds Claude to update Linear after a PR merge.
# Outputs JSON systemMessage — non-blocking feedback only.

input=$(cat)
command=$(echo "$input" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('command', ''))
except Exception:
    print('')
" 2>/dev/null || echo "")

if echo "$command" | grep -qE "gh pr merge"; then
  pr_num=$(echo "$command" | grep -oE '[0-9]+' | head -1)
  echo "{\"continue\": true, \"systemMessage\": \"PR #${pr_num} merged — mark Linear issue Done via MCP or pnpm linear:close.\"}"
fi

exit 0
