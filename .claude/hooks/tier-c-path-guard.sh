#!/usr/bin/env bash
# .claude/hooks/tier-c-path-guard.sh
# PreToolUse hook (matcher: Write|Edit): warns before writing to Tier C sensitive paths.
# Exit 0 = allow silently. Exit 2 = non-blocking warning surfaced to Claude.
#
# Tier C paths are defined in docs/05_operations/DELEGATION_POLICY.md sensitive-path matrix.
# These paths require PM plan approval + PM merge approval before any change.

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

# Normalize: forward slashes, strip leading ./ and repo-root prefix
file_path=$(echo "$file_path" | sed 's|\\|/|g' | sed 's|^\./||' | sed 's|^.*/Unit-Talk-v2-main/||')

matched=""
reason=""

echo "$file_path" | grep -qE '^supabase/migrations/' \
  && matched="$file_path" \
  && reason="Migration — Tier C. PM plan approval + serial merge required (never merge two migrations in one deploy)."

echo "$file_path" | grep -qE '^packages/contracts/src/' \
  && matched="$file_path" \
  && reason="Cross-package contracts — Tier C. PM plan + merge approval required."

echo "$file_path" | grep -qE '^packages/domain/src/' \
  && matched="$file_path" \
  && reason="Pure domain logic — Tier C. No I/O, no DB, no HTTP allowed. PM plan + merge approval required."

echo "$file_path" | grep -qE '^apps/api/src/distribution-service\.ts$' \
  && matched="$file_path" \
  && reason="Routing/gating/GOVERNANCE_BRAKE_SOURCES — Tier C. PM plan + merge approval required."

echo "$file_path" | grep -qE '^apps/api/src/auth\.ts$' \
  && matched="$file_path" \
  && reason="Auth/RBAC — Always escalate. Security posture change."

echo "$file_path" | grep -qE '^apps/worker/' \
  && matched="$file_path" \
  && reason="Worker delivery adapters — Tier C. Exactly-one-DeliveryOutcome invariant must not drift."

echo "$file_path" | grep -qE '^packages/db/src/(lifecycle|repositories|runtime-repositories)\.ts$' \
  && matched="$file_path" \
  && reason="DB write authority / lifecycle FSM — Tier C."

echo "$file_path" | grep -qE '^packages/db/src/database\.types\.ts$' \
  && matched="$file_path" \
  && reason="GENERATED FILE — do not hand-edit. Regenerate only via: pnpm supabase:types"

echo "$file_path" | grep -qE '^docs/05_operations/DELEGATION_POLICY\.md$' \
  && matched="$file_path" \
  && reason="Self-amendment — Tier C regardless of diff size. PM must be in session."

echo "$file_path" | grep -qE '^\.github/workflows/proof-coverage-guard\.yml$' \
  && matched="$file_path" \
  && reason="Proof coverage guard — Tier C. Orchestrator cannot widen its own autonomy."

if [ -n "$matched" ]; then
  echo "TIER-C WARNING: $matched"
  echo "Reason: $reason"
  echo "Confirm: correct tier classification, PM in session (or standing authorization applies). Hook: tier-c-path-guard."
  exit 2
fi

exit 0
