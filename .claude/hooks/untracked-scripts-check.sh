#!/usr/bin/env bash
# Stop hook: warns if untracked files exist in scripts/ at session end.
# Uses python3 for safe JSON serialization.

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
untracked=$(git -C "$ROOT" ls-files --others --exclude-standard -- 'scripts/' 'apps/*/src/scripts/' 'packages/*/src/scripts/' 2>/dev/null)

if [ -n "$untracked" ]; then
  python3 -c "
import json, sys
files = sys.argv[1]
print(json.dumps({'systemMessage': 'WARNING: Untracked files in scripts/ at session end — commit or delete before closing:\n' + files}))
" "$untracked" 2>/dev/null || echo '{"systemMessage": "WARNING: Untracked files in scripts/ — see git status"}'
fi

exit 0
