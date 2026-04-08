#!/usr/bin/env bash
# .claude/hooks/linear-sync-reminder.sh
# PostToolUse(Bash) hook: reminds Claude to update Linear after a PR merge.
# Exit 2 = non-blocking feedback.

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
  # Extract PR number if present
  pr_num=$(echo "$command" | grep -oE '[0-9]+' | head -1)
  echo "REMINDER: PR #${pr_num} merged — update Linear now."
  echo "  Run: pnpm linear:close -- <issue-id> --comment '<verdict>'"
  echo "  Or mark Done via Linear MCP: mcp__claude_ai_Linear__save_issue(id, state='Done')"
  echo "  Do not batch Linear updates — mark each issue Done immediately after its lane closes."
  exit 2
fi

exit 0
