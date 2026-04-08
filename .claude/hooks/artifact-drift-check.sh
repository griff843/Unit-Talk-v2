#!/usr/bin/env bash
# .claude/hooks/artifact-drift-check.sh
# PostToolUse hook: warns on generated artifacts under src/, status doc edits,
# and migration numbering conflicts.
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
  echo "WARNING: Generated artifact written under src/: $fp"
  echo "Files matching *.js / *.d.ts / *.js.map under src/ should not be committed."
  echo "Delete if unintentional, or verify this is expected (e.g. a deliberate JS file, not tsc output)."
  exit 2
fi

# --- Check 2: migration file written — verify numbering sequence ---
if echo "$fp" | grep -qE '/supabase/migrations/[0-9]{14}_.*\.sql$'; then
  migration_file=$(basename "$fp")
  migration_ts="${migration_file:0:14}"

  # Find the highest existing migration timestamp (excluding the one just written)
  migrations_dir=$(echo "$fp" | sed 's|/[^/]*$||')
  if [ -d "$migrations_dir" ]; then
    highest=$(ls "$migrations_dir"/*.sql 2>/dev/null \
      | xargs -I{} basename {} \
      | grep -oE '^[0-9]{14}' \
      | grep -v "^${migration_ts}$" \
      | sort -n \
      | tail -1)

    if [ -n "$highest" ] && [ "$migration_ts" -le "$highest" ]; then
      echo "WARNING: Migration numbering conflict detected!"
      echo "  Written:  $migration_ts"
      echo "  Highest existing: $highest"
      echo "  New migration must use a timestamp > $highest"
      echo "  Rename before committing to avoid Supabase apply-order failure."
      exit 2
    fi
  fi
fi

# --- Check 3: status doc edited — remind to keep siblings consistent ---
status_docs=("status_source_of_truth.md" "current_phase.md" "active_roadmap.md")
for doc in "${status_docs[@]}"; do
  if echo "$fp" | grep -q "$doc"; then
    others=""
    for other in "${status_docs[@]}"; do
      [ "$other" != "$doc" ] && others="$others  - $other\n"
    done
    echo "REMINDER: $doc was updated."
    printf "Verify these are consistent with the same active week label:\n$others"
    exit 2
  fi
done

exit 0
