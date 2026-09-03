#!/usr/bin/env bash
# .claude/hooks/post-compact-reinjector.sh
# PostCompact hook: re-injects mission state after context compaction.
#
# Previously this re-injected lane manifests, dispatch slots and ghost-lane
# warnings — the admission machinery that is no longer the execution primitive.
# It now re-injects exactly what session-start.sh injects, by forcing that
# generator to run: one implementation of "what is the current state", so the
# two injections can never drift apart.
#
# Always runs — no staleness check (compaction itself is the trigger).

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
GEN="$ROOT/.claude/hooks/session-start.sh"

if [ ! -f "$GEN" ]; then
  echo '{"systemMessage": "[post-compact] Context compacted. Re-read CLAUDE.md and docs/mission/plan.md."}'
  exit 0
fi

# Force a regeneration rather than reusing a possibly-stale cached summary.
rm -f "$ROOT/.out/ops/session-state/.state-stamp" 2>/dev/null || true

OUT=$(bash "$GEN" 2>/dev/null || echo "")

python3 - "$OUT" <<'PY' 2>/dev/null || echo '{"systemMessage": "[post-compact] Context compacted. Re-read CLAUDE.md and docs/mission/plan.md."}'
import json, sys
raw = sys.argv[1].strip()
msg = ""
try:
    msg = json.loads(raw).get("systemMessage", "")
except Exception:
    msg = ""
msg = msg.replace("[session-start]", "[post-compact] Context compacted.", 1)
if not msg:
    msg = "[post-compact] Context compacted. Re-read CLAUDE.md and docs/mission/plan.md."
else:
    msg += " | Re-read CLAUDE.md and docs/mission/plan.md before continuing."
print(json.dumps({"systemMessage": msg}))
PY

exit 0
