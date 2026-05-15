#!/usr/bin/env bash
# .claude/hooks/tier-c-path-guard.sh
# PreToolUse hook (matcher: Write|Edit): warns before writing to Tier C sensitive paths.
# Exit 0 = allow silently. Exit 2 = non-blocking warning surfaced to Claude.
#
# Tier C paths are defined in docs/05_operations/DELEGATION_POLICY.md sensitive-path matrix.
# These paths require PM plan approval + PM merge approval before any change.
#
# MANIFEST-AUTHORIZED BYPASS (UTV2-961):
# If the path is in an active lane manifest's file_scope_lock, the write is
# pre-authorized for that lane. The warning is still emitted (exit 2) but
# includes authorization context so Claude can proceed without PM confirmation.
# Authorization requirements:
#   1. docs/06_status/lanes/UTV2-NNN.json exists with status != done/closed
#   2. The file path appears in file_scope_lock
#   3. The branch matches the lane's branch field
# All three must be true; otherwise the standard Tier C warning applies.

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
  # Check for manifest-authorized bypass before emitting full Tier C warning.
  # Requires: active lane manifest on current branch with file in file_scope_lock.
  current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  manifest_authorized=false

  if [ -n "$current_branch" ] && command -v python3 >/dev/null 2>&1; then
    manifest_authorized=$(python3 - "$file_path" "$current_branch" <<'PYEOF'
import sys, json, os, glob

target_file = sys.argv[1]
current_branch = sys.argv[2]
lanes_dir = "docs/06_status/lanes"

for manifest_path in glob.glob(f"{lanes_dir}/UTV2-*.json"):
    try:
        with open(manifest_path) as f:
            m = json.load(f)
        if m.get("status") in ("done", "closed", "cancelled"):
            continue
        if m.get("branch") != current_branch:
            continue
        scope_lock = m.get("file_scope_lock", [])
        # Match exact path or glob-style prefix (ends with /**)
        for pattern in scope_lock:
            if pattern == target_file:
                print(m.get("issue_id", "unknown"))
                sys.exit(0)
            if pattern.endswith("/**") and target_file.startswith(pattern[:-3]):
                print(m.get("issue_id", "unknown"))
                sys.exit(0)
            if pattern.endswith("/*") and "/" in target_file:
                dir_part = target_file.rsplit("/", 1)[0] + "/"
                if dir_part == pattern[:-1]:
                    print(m.get("issue_id", "unknown"))
                    sys.exit(0)
    except Exception:
        pass

print("")
PYEOF
)
  fi

  if [ -n "$manifest_authorized" ]; then
    echo "TIER-C MANIFEST-AUTHORIZED: $matched"
    echo "Reason: $reason"
    echo "Authorization: Active lane $manifest_authorized has $matched in file_scope_lock. Pre-authorized write — proceed."
    exit 2
  fi

  echo "TIER-C WARNING: $matched"
  echo "Reason: $reason"
  echo "Confirm: correct tier classification, PM in session (or standing authorization applies). Hook: tier-c-path-guard."
  exit 2
fi

exit 0
