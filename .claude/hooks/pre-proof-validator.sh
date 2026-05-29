#!/usr/bin/env bash
# .claude/hooks/pre-proof-validator.sh
# PreToolUse hook: validates proof bundles before git commit.
# Exit 0 = allow silently. Exit 2 = non-blocking warning shown to Claude.

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

echo "$command" | grep -q 'git commit' || exit 0

staged=$(git diff --cached --name-only 2>/dev/null)
[ -z "$staged" ] && exit 0

echo "$staged" | grep -q 'docs/06_status/proof/' || exit 0

failures=()

evidence_files=$(echo "$staged" | grep -E 'docs/06_status/proof/.*/evidence\.json$')
for f in $evidence_files; do
  [ -f "$f" ] || continue
  result=$(python3 -c "
import json, sys, re
failures = []
try:
    with open('$f') as fh:
        d = json.load(fh)
    if not d.get('schema_version'):
        failures.append('schema_version missing or empty')
    sb = d.get('sha_binding', {})
    sha = sb.get('verified_source_sha', '')
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        failures.append('sha_binding.verified_source_sha must be 40 hex chars (got: ' + repr(sha) + ')')
    if not sb.get('ci_sentinels'):
        failures.append('sha_binding.ci_sentinels missing or empty')
    if not any(k in d for k in ('static_proof', 'runtime_proof', 'R1', 'R2')):
        failures.append('at least one of static_proof, runtime_proof, R1, R2 required')
    if 'status' not in d:
        failures.append('status field missing')
except Exception as e:
    sys.exit(0)
for msg in failures:
    print(msg)
" 2>/dev/null)
  if [ -n "$result" ]; then
    while IFS= read -r line; do
      failures+=("[$f] $line")
    done <<< "$result"
  fi
done

verification_files=$(echo "$staged" | grep -E 'docs/06_status/proof/.*/verification.*\.md$')
for f in $verification_files; do
  [ -f "$f" ] || continue
  grep -q '## Verification' "$f" || failures+=("[$f] missing '## Verification' header")
  size=$(wc -c < "$f" 2>/dev/null || echo 0)
  [ "$size" -gt 100 ] || failures+=("[$f] file too small (${size} bytes, need >100)")
done

if [ "${#failures[@]}" -gt 0 ]; then
  echo "PROOF VALIDATOR: staged proof bundle has issues:"
  for msg in "${failures[@]}"; do
    echo "  - $msg"
  done
  exit 2
fi

exit 0
