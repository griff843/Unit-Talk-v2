#!/usr/bin/env bash
# .claude/hooks/session-start.sh
# UserPromptSubmit hook: injects a compact mission-state summary.
#
# Previously this injected lane manifests, dispatch slots, ghost-lane warnings
# and the Linear dispatch digest — the state of the admission machinery. That
# machinery is no longer the execution primitive (docs/mission/intent.md), so
# injecting it every prompt kept re-establishing a workflow that has been
# superseded. It now injects mission state: the plan, its freshness, the branch,
# and the standing guardrails.
#
# Logic:
#   - Reads .out/ops/session-state/.state-stamp (unix timestamp of last generation)
#   - If stamp is < 30 min old: emits guardrails only (no disruption mid-session)
#   - If stale: regenerates .out/ops/session-state/SYSTEM_STATE.md from local
#     sources without dirtying tracked repo files.
#
# Sources (local only — no MCP, no network):
#   - docs/mission/plan.md           → current plan, freshness, in-flight work
#   - docs/mission/intent.md         → mission + stop conditions (pointer only)
#   - docs/05_operations/STANDING_GUARDRAILS.md → PM-maintained guardrails
#   - git log / git status           → recent commits and working tree
#
# Always exits 0 — never blocks a user prompt.

set -euo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SESSION_STATE_DIR="$ROOT/.out/ops/session-state"
STAMP_FILE="$SESSION_STATE_DIR/.state-stamp"
STATE_FILE="$SESSION_STATE_DIR/SYSTEM_STATE.md"
MAX_AGE=1800  # 30 minutes

# ── Standing guardrails ──────────────────────────────────────────────────────
# PM-maintained, dated lines in docs/05_operations/STANDING_GUARDRAILS.md.
# Checked every prompt (cheap) so guardrails never need re-pasting by hand,
# independent of the full state-refresh staleness window below.
GUARDRAILS_FILE="$ROOT/docs/05_operations/STANDING_GUARDRAILS.md"
GUARDRAILS_OUT=""
if [ -f "$GUARDRAILS_FILE" ]; then
  GUARDRAILS_OUT=$(grep -E '^\[[0-9]{4}-[0-9]{2}-[0-9]{2}\]' "$GUARDRAILS_FILE" || true)
fi

# ── Staleness check ──────────────────────────────────────────────────────────
if [ -f "$STAMP_FILE" ]; then
  STAMP=$(cat "$STAMP_FILE" 2>/dev/null || echo "0")
  NOW=$(date +%s)
  AGE=$(( NOW - STAMP ))
  if [ "$AGE" -lt "$MAX_AGE" ]; then
    if [ -n "$GUARDRAILS_OUT" ]; then
      python3 -c "
import json, sys
lines = sys.argv[1].strip().splitlines()
print(json.dumps({'systemMessage': '[guardrails] ' + ' || '.join(lines)}))
" "$GUARDRAILS_OUT" 2>/dev/null || true
    fi
    exit 0
  fi
fi

# ── Gather state from local sources ─────────────────────────────────────────
BRANCH=$(git -C "$ROOT" branch --show-current 2>/dev/null || echo "unknown")
TODAY=$(date '+%Y-%m-%d %H:%M')

RECENT=$(git -C "$ROOT" log --oneline -5 2>/dev/null || echo "unavailable")

DIRTY=$(git -C "$ROOT" status --short 2>/dev/null | wc -l | tr -d ' ')
if [ "$DIRTY" -gt 0 ]; then
  TREE_LINE="$DIRTY file(s) modified/untracked"
else
  TREE_LINE="Clean"
fi

# ── Mission plan: freshness + section headlines ─────────────────────────────
# The plan is the execution substrate. A plan that has not been reconciled
# against live truth recently is the single most dangerous thing to act on, so
# its age is surfaced first and loudly.
PLAN_FILE="$ROOT/docs/mission/plan.md"
PLAN_OUT=$(python3 - "$PLAN_FILE" <<'PY' 2>/dev/null || echo "mission plan unreadable"
import datetime, os, re, sys

path = sys.argv[1]
if not os.path.isfile(path):
    print("no docs/mission/plan.md — mission plan missing")
    raise SystemExit(0)

text = open(path, encoding="utf-8", errors="replace").read()

m = re.search(r"reconciled against live truth:\*{0,2}\s*(\d{4}-\d{2}-\d{2})", text, re.I)
if m:
    age = (datetime.date.today() - datetime.date.fromisoformat(m.group(1))).days
    freshness = f"plan reconciled {m.group(1)} ({age}d ago)"
    if age >= 3:
        freshness += " — STALE, re-verify against live main/PRs/runtime before acting"
else:
    freshness = "plan has no reconciliation date — treat as stale"
print(freshness)

# First-level items under the sections that say what to do next. Numbered
# items and ### headings only; a plan table's first column is used for the
# reserved list, where the items are rows rather than steps.
for heading in ("In flight", "Executable now", "Requires Griff"):
    body = re.search(
        rf"^##\s+{heading}[^\n]*\n(.*?)(?=^##\s|\Z)", text, re.S | re.M
    )
    if not body:
        continue
    section = body.group(1)
    items = re.findall(r"^(?:###\s+|\d+\.\s+)(.+)$", section, re.M)
    if not items:
        rows = [
            r.strip().strip("|").split("|")[0].strip()
            for r in section.splitlines()
            if r.strip().startswith("|")
        ]
        # Drop the header row and the |---|---| separator.
        items = [r for r in rows[1:] if r and not set(r) <= set("-: ")]
    cleaned = []
    for it in items:
        it = re.sub(r"[*`\[\]]", "", it).strip(" -\u2014")
        if it:
            cleaned.append(it[:70])
    if cleaned:
        print(f"{heading}: " + " ; ".join(cleaned[:4]))
PY
)

# Codex health check (fast — 5s timeout)
CODEX_STATUS=$(node -e "
const { spawnSync } = require('child_process');
const r = spawnSync('codex', ['--version'], { encoding: 'utf8', stdio: 'pipe', shell: process.platform==='win32', timeout: 5000 });
if (r.error || r.status !== 0) { process.stdout.write('codex:unavailable'); }
else { process.stdout.write('codex:ok(' + (r.stdout||'').trim().split('\n')[0] + ')'); }
" 2>/dev/null || echo "codex:unknown")

# ── Write SYSTEM_STATE.md ────────────────────────────────────────────────────
mkdir -p "$(dirname "$STATE_FILE")"
cat > "$STATE_FILE" << STATE
# System State — $TODAY

## Mission
Production Recovery — docs/mission/intent.md (intent, reserved decisions, stop conditions)
Live plan: docs/mission/plan.md

## Mission Plan
$PLAN_OUT

## Branch
$BRANCH

## Standing Guardrails
${GUARDRAILS_OUT:-none recorded}

## Codex Status
$CODEX_STATUS

## Working Tree
$TREE_LINE

## Recent Commits
$RECENT
STATE

date +%s > "$STAMP_FILE"

PLAN_LINE=$(printf '%s' "$PLAN_OUT" | tr '\n' ';' | head -c 400)
GUARDRAIL_PART=""
[ -n "$GUARDRAILS_OUT" ] && GUARDRAIL_PART=" | guardrails: $(printf '%s' "$GUARDRAILS_OUT" | tr '\n' ';' | head -c 300)"
MSG="[session-start] $TODAY | mission: Production Recovery (docs/mission/plan.md) | $PLAN_LINE | branch: $BRANCH | $CODEX_STATUS | tree: $TREE_LINE$GUARDRAIL_PART | Full state: .out/ops/session-state/SYSTEM_STATE.md"

python3 -c "
import json, sys
print(json.dumps({'systemMessage': sys.argv[1]}))
" "$MSG" 2>/dev/null || echo "{\"systemMessage\": \"[session-start] State loaded $TODAY — see .out/ops/session-state/SYSTEM_STATE.md\"}"

exit 0
