#!/usr/bin/env bash
# .claude/hooks/bash-safety-guard.sh
# PreToolUse hook: hard-blocks destructive bash commands.
# Exit 0 = allow silently. Exit 2 = BLOCKS the tool call (PreToolUse semantics —
# any non-zero exit denies the call and surfaces stderr to Claude). This is a
# deliberate fail-closed block, not a warning: retrying the same command hits
# the same block. The sanctioned exits are named in the stderr message.

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
  echo "SAFETY BLOCK: Destructive pattern blocked — $matched" >&2
  echo "This call was denied (fail-closed). If the operation is genuinely required:" >&2
  echo "  - use the sanctioned script for it (e.g. ops:lane-clean for worktree removal, ops:merge-wrapper for branch ops), or" >&2
  echo "  - ask the operator to run or explicitly approve the exact command." >&2
  echo "Do not retry the same command verbatim. Hook: bash-safety-guard." >&2
  exit 2
fi

exit 0
