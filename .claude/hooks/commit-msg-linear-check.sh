#!/usr/bin/env bash
# Pre-commit hook: warns when committing on a UTV2-NNN branch without a
# close-intent marker in the message. Non-blocking — outputs systemMessage only.
#
# Close markers recognized (matches linear-auto-close.yml logic):
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
branch=$(git -C "$toplevel" rev-parse --abbrev-ref HEAD 2>/dev/null)

# Detect UTV2 issue on branch (case-insensitive — branches use lowercase utv2-)
issue=$(echo "$branch" | grep -ioE 'UTV2-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]')
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

# Check for a close-intent marker (case-insensitive verb, exact UTV2 prefix)
if echo "$msg" | grep -qiE '(closes|fixes|resolves)[[:space:]]+UTV2-[0-9]+'; then
  exit 0
fi
if echo "$msg" | grep -qE '^Linear-Close:[[:space:]]+UTV2-[0-9]+'; then
  exit 0
fi

# Warn but never block
echo "{\"systemMessage\": \"Reminder: commit on ${issue} branch has no close marker. Add 'Closes ${issue}' to the final commit to trigger Linear auto-close on merge.\"}"
exit 0
