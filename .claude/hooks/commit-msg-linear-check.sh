#!/usr/bin/env bash
# Pre-commit hook: warns when a commit omits its repository work identity. Non-blocking — outputs systemMessage only.
#
# Historical tracker close markers remain optional:
#   Closes UTV2-NNN
#   Fixes UTV2-NNN
#   Resolves UTV2-NNN
#   Linear-Close: UTV2-NNN

input=$(cat)
command=$(echo "$input" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('command', ''))
except Exception:
    pass
" 2>/dev/null)

# Only care about git commit commands that carry -m / --message inline
if ! echo "$command" | grep -qE '^git commit'; then
  exit 0
fi

# Get current branch
toplevel=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
branch=$(git -C "$toplevel" branch --show-current 2>/dev/null)

# Detect UTV2 issue on branch (case-insensitive — branches use lowercase utv2-)
issue=$(echo "$branch" | grep -ioE '(UTV2|UNI|WORK)-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]')
if [ -z "$issue" ]; then
  exit 0
fi

# Extract message value from -m "..." or -m '...' or --message="..."
msg=$(echo "$command" | grep -oP '(?<=-m )("([^"]*)"|\x27([^\x27]*)\x27)' | tr -d '"'"'" | head -1)
if [ -z "$msg" ]; then
  msg=$(echo "$command" | grep -oP '(?<=--message=)("([^"]*)"|\x27([^\x27]*)\x27)' | tr -d '"'"'" | head -1)
fi

# If we couldn't parse a message (e.g. heredoc), skip the check
if [ -z "$msg" ]; then
  exit 0
fi

# Repository identity is required; tracker-close syntax is optional.
if echo "$msg" | grep -qiF "$issue"; then
  exit 0
fi
echo "{\"systemMessage\": \"Reminder: reference repository work ${issue} in the commit message. Tracker close markers are optional; completion uses governed lane closeout.\"}"
exit 0
