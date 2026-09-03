#!/usr/bin/env bash
# .claude/hooks/reserved-surface-guard.sh
# PreToolUse hook (matcher: Write|Edit).
#
# Replaces tier-c-path-guard.sh, which classified writes against the lane
# DELEGATION_POLICY tier matrix and hard-blocked (exit 2) unless an active lane
# manifest pre-authorized the path. With lane manifests gone as an execution
# primitive, that guard would block every edit to packages/domain/**,
# apps/worker/**, apps/api/src/auth.ts and supabase/migrations/** with no way to
# authorize the write — it would stop the mission, not protect it.
#
# What replaces it, and why this shape:
#
#   1. Reserved surfaces are read from the SAME policy the merge gate uses
#      (docs/05_operations/RESERVED_RISK_SURFACES.json, classified by
#      scripts/ops/merge-authority.cjs). One source of truth, not a second list
#      that drifts.
#   2. A reserved surface is ADVISORY here and BLOCKING at merge. Per
#      docs/mission/intent.md, a human gate blocks that change, not the mission:
#      a reserved diff may be written and opened as a PR; it merges only with
#      Griff's approval artifact. Blocking the keystroke buys nothing the merge
#      gate does not already enforce, and costs the ability to prepare the work.
#   3. One genuine hard block remains: hand-editing a generated file is always
#      wrong and no approval makes it right.
#
# Exit 0 = allow (optionally with an advisory systemMessage). Exit 2 = block.
# Fails soft on a missing/unreadable policy: the merge gate fails CLOSED on the
# same condition, so an advisory-only hook cannot let anything through.

input=$(cat)

if command -v python3 >/dev/null 2>&1; then
  file_path=$(echo "$input" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('file_path', ''))
except Exception:
    print('')
" 2>/dev/null)
else
  file_path=$(echo "$input" | grep -o '"file_path":"[^"]*"' | head -1 | sed 's/"file_path":"//;s/"$//')
fi

[ -z "$file_path" ] && exit 0

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# Normalize to a repo-relative POSIX path.
rel=$(echo "$file_path" | sed 's|\\|/|g' | sed 's|^\./||')
case "$rel" in
  "$ROOT"/*) rel="${rel#"$ROOT"/}" ;;
esac

# ── Hard block: generated files are never hand-edited ────────────────────────
if [ "$rel" = "packages/db/src/database.types.ts" ]; then
  echo "BLOCKED: $rel is a GENERATED file." >&2
  echo "Regenerate it instead: pnpm supabase:types (after the migration is applied)." >&2
  echo "Hook: reserved-surface-guard." >&2
  exit 2
fi

# ── Advisory: reserved-surface classification ────────────────────────────────
notice=$(node -e '
const path = require("path");
const root = process.argv[1];
const file = process.argv[2];
try {
  const ma = require(path.join(root, "scripts/ops/merge-authority.cjs"));
  const policy = ma.loadPolicy(root);
  // An empty patch, not an absent one: this hook sees a path, never a diff, and
  // an absent patch makes the classifier reserve on content rules alone. Added-line
  // rules (destructive SQL) are enforced where a diff exists — the merge gate — and
  // at the command level by bash-safety-guard.
  const r = ma.classifyDiff({ files: [{ filename: file, patch: "" }], policy });
  const surfaces = r.surfaces.filter((s) => s !== "unclassifiable");
  if (r.authority === "human" && surfaces.length > 0) {
    process.stdout.write(surfaces.join(", "));
  }
} catch (e) {
  // Policy or classifier unavailable — stay silent. The merge gate fails closed
  // on the same condition, so nothing is released by this hook being quiet.
}
' "$ROOT" "$rel" 2>/dev/null || echo "")

if [ -n "$notice" ]; then
  python3 -c "
import json, sys
surface = sys.argv[1]
print(json.dumps({'systemMessage':
  '[reserved-surface] ' + sys.argv[2] + ' touches a reserved surface (' + surface + '). '
  'Writing it is allowed; MERGING it requires Griff: the griff-approved label plus a head-bound '
  'pm-verdict/v1 APPROVED comment. Say so in the PR body under \"## Risk surfaces\", and describe '
  'the production effect and how it is reversed. Policy: docs/05_operations/RESERVED_RISK_SURFACES.json'}))
" "$notice" "$rel" 2>/dev/null || true
fi

exit 0
