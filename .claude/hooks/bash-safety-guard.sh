#!/usr/bin/env bash
# .claude/hooks/bash-safety-guard.sh
# PreToolUse hook: warns on destructive bash commands.
# Exit 0 = allow silently. Exit 2 = non-blocking warning shown to Claude.

input=$(cat)
command=$(echo "$input" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('command', ''))
except Exception:
    print('')
" 2>/dev/null || echo "")

[ -z "$command" ] && exit 0

matched=""

echo "$command" | grep -qE 'git\s+reset\s+--hard'       && matched="git reset --hard"
echo "$command" | grep -qE 'git\s+push\s+(--force[^-]|--force$|-f\s|-f$)'  && matched="git push --force / -f"
echo "$command" | grep -qE 'git\s+checkout\s+--\s'      && matched="git checkout --"
echo "$command" | grep -qE 'git\s+restore\s+\.'         && matched="git restore ."
echo "$command" | grep -qE 'git\s+clean\s+.*-f'         && matched="git clean -f"
echo "$command" | grep -qE 'rm\s+-rf'                   && matched="rm -rf"
echo "$command" | grep -qi 'DROP\s+TABLE'                && matched="DROP TABLE"
# DELETE FROM without a WHERE clause (no WHERE anywhere on the same logical line)
if echo "$command" | grep -qi 'DELETE\s+FROM'; then
  if ! echo "$command" | grep -qi 'WHERE'; then
    matched="DELETE FROM (no WHERE clause)"
  fi
fi

if [ -n "$matched" ]; then
  echo "SAFETY WARNING: Destructive pattern detected — $matched"
  echo "Confirm this is intentional before proceeding. Hook: bash-safety-guard."
  exit 2
fi

exit 0
