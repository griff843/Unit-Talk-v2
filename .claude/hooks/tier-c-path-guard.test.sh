#!/usr/bin/env bash
# .claude/hooks/tier-c-path-guard.test.sh
#
# Integration test / captured-behavior proof for UTV2-1570's fix to the
# manifest-authorized branch of tier-c-path-guard.sh. Invokes the hook
# binary directly with real PreToolUse-shaped JSON stdin, captures the
# hook's real stdout, and asserts it is valid JSON containing the expected
# hookSpecificOutput.permissionDecision / additionalContext fields plus a
# top-level systemMessage -- the design lane's acceptance criterion (a
# design assertion that the mechanism "should" work per documentation,
# without a captured test artifact, does not satisfy this requirement).
#
# Also asserts the two behaviors this change must NOT alter:
#   - a Tier C path with no manifest authorization still blocks (exit 2)
#   - an ordinary (non-Tier-C) path still passes with empty stdout
#
# Usage: bash .claude/hooks/tier-c-path-guard.test.sh
# Exit 0 = all assertions passed. Exit 1 = at least one assertion failed.
#
# Wired into `pnpm test:hooks`, part of the `pnpm test` chain reached by
# `pnpm verify` (package.json).

set -uo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT" || exit 1

HOOK="$ROOT/.claude/hooks/tier-c-path-guard.sh"
FAILURES=0

fail() {
  echo "FAIL: $1" >&2
  FAILURES=$((FAILURES + 1))
}

pass() {
  echo "PASS: $1"
}

# A Tier C path per the hook's own grep matrix (packages/domain/src/).
TEST_FILE="packages/domain/src/__tier_c_guard_test_fixture__.ts"
TEST_ISSUE_ID="UTV2-9999998"
TEST_MANIFEST="$ROOT/docs/06_status/lanes/${TEST_ISSUE_ID}.json"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

if [ -e "$TEST_MANIFEST" ]; then
  fail "test fixture manifest path already exists on disk -- refusing to overwrite: $TEST_MANIFEST"
  exit 1
fi

cleanup() {
  rm -f "$TEST_MANIFEST"
}
trap cleanup EXIT

mkdir -p "$(dirname "$TEST_MANIFEST")"

# ── Fixture 1: manifest-authorized Tier C write ─────────────────────────────
cat > "$TEST_MANIFEST" <<JSONEOF
{
  "issue_id": "${TEST_ISSUE_ID}",
  "status": "started",
  "branch": "${CURRENT_BRANCH}",
  "file_scope_lock": ["${TEST_FILE}"]
}
JSONEOF

payload=$(python3 -c "import json,sys; print(json.dumps({'tool_input': {'file_path': sys.argv[1]}}))" "$TEST_FILE")
stdout=$(echo "$payload" | bash "$HOOK" 2>/tmp/tier-c-guard-test-stderr.$$)
exit_code=$?
rm -f /tmp/tier-c-guard-test-stderr.$$

if [ "$exit_code" -eq 0 ]; then
  pass "manifest-authorized write exits 0 (allow, not block)"
else
  fail "manifest-authorized write exited $exit_code, expected 0"
fi

if [ -z "$stdout" ]; then
  fail "manifest-authorized write produced no stdout -- notice was not emitted at all"
else
  if echo "$stdout" | python3 -c "import json,sys; json.load(sys.stdin)" >/dev/null 2>&1; then
    pass "manifest-authorized stdout is valid JSON"
  else
    fail "manifest-authorized stdout is not valid JSON: $stdout"
  fi

  decision=$(echo "$stdout" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('hookSpecificOutput',{}).get('permissionDecision',''))" 2>/dev/null)
  if [ "$decision" = "allow" ]; then
    pass "hookSpecificOutput.permissionDecision is 'allow'"
  else
    fail "hookSpecificOutput.permissionDecision was '$decision', expected 'allow'"
  fi

  additional_context=$(echo "$stdout" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('hookSpecificOutput',{}).get('additionalContext',''))" 2>/dev/null)
  if echo "$additional_context" | grep -q "TIER-C NOTICE"; then
    pass "hookSpecificOutput.additionalContext carries the Tier C notice"
  else
    fail "hookSpecificOutput.additionalContext missing or empty: '$additional_context'"
  fi

  if echo "$additional_context" | grep -q "$TEST_ISSUE_ID"; then
    pass "additionalContext identifies the authorizing lane ($TEST_ISSUE_ID)"
  else
    fail "additionalContext does not identify the authorizing lane: '$additional_context'"
  fi

  system_message=$(echo "$stdout" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('systemMessage',''))" 2>/dev/null)
  if echo "$system_message" | grep -q "TIER-C NOTICE"; then
    pass "top-level systemMessage carries the Tier C notice"
  else
    fail "top-level systemMessage missing or empty: '$system_message'"
  fi

  hook_event=$(echo "$stdout" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('hookSpecificOutput',{}).get('hookEventName',''))" 2>/dev/null)
  if [ "$hook_event" = "PreToolUse" ]; then
    pass "hookSpecificOutput.hookEventName is 'PreToolUse'"
  else
    fail "hookSpecificOutput.hookEventName was '$hook_event', expected 'PreToolUse'"
  fi
fi

rm -f "$TEST_MANIFEST"

# ── Fixture 2: same Tier C path, NO manifest authorization -> must still block ──
payload2=$(python3 -c "import json,sys; print(json.dumps({'tool_input': {'file_path': sys.argv[1]}}))" "$TEST_FILE")
stdout2=$(echo "$payload2" | bash "$HOOK" 2>/tmp/tier-c-guard-test-stderr2.$$)
exit_code2=$?
stderr2=$(cat /tmp/tier-c-guard-test-stderr2.$$ 2>/dev/null)
rm -f /tmp/tier-c-guard-test-stderr2.$$

if [ "$exit_code2" -eq 2 ]; then
  pass "un-authorized Tier C write still blocks (exit 2) -- manifest bypass fix did not weaken this path"
else
  fail "un-authorized Tier C write exited $exit_code2, expected 2 (blocking preserved)"
fi

if echo "$stderr2" | grep -q "TIER-C WARNING"; then
  pass "un-authorized Tier C write still emits its stderr warning"
else
  fail "un-authorized Tier C write stderr warning missing: '$stderr2'"
fi

# ── Fixture 3: ordinary non-Tier-C path -> exit 0, no notice fabricated ─────
payload3=$(python3 -c "import json; print(json.dumps({'tool_input': {'file_path': 'docs/06_status/some-note.md'}}))")
stdout3=$(echo "$payload3" | bash "$HOOK" 2>/dev/null)
exit_code3=$?

if [ "$exit_code3" -eq 0 ]; then
  pass "ordinary non-Tier-C path exits 0"
else
  fail "ordinary non-Tier-C path exited $exit_code3, expected 0"
fi

if [ -z "$stdout3" ]; then
  pass "ordinary non-Tier-C path produces no fabricated notice"
else
  fail "ordinary non-Tier-C path unexpectedly produced stdout: '$stdout3'"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "tier-c-path-guard.test.sh: all assertions passed"
  exit 0
else
  echo "tier-c-path-guard.test.sh: $FAILURES assertion(s) failed"
  exit 1
fi
