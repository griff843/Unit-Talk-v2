#!/usr/bin/env bash
# .github/workflows/linear-auto-close.test.sh
#
# Shared extraction function + standalone test harness for
# linear-auto-close.yml. Sourced by the workflow at runtime; runnable
# directly for manual verification.
#
# Context: shipped under UTV2-523 in PR #226 as a bare 'UTV2-[0-9]+'
# matcher, which caused a false-positive that incorrectly closed
# UTV2-497 when PR #227 merged (PR only shipped the dispatch packet,
# not the implementation — see the infra bug issue tracked under
# UTV2-five-three-six, ID obscured here to avoid this commit's own
# prior-workflow firing on the wrong identifier during the transition).
#
# The fix tightens extraction to close-intent syntax only:
#   - inline verb: Closes / Fixes / Resolves UTV2-NNN (word-bounded,
#     verb is case-insensitive, identifier prefix is case-sensitive)
#   - commit trailer: "Linear-Close: UTV2-NNN" anchored to line start
#
# Free-form mentions (dispatch packet references, follow-up notes,
# file path literals, examples, "supersedes X" wording) are IGNORED.
#
# Usage
# -----
#   bash .github/workflows/linear-auto-close.test.sh
#
#   # Or source the function from another script:
#   source .github/workflows/linear-auto-close.test.sh
#   ids=$(echo "$COMMIT_MSG" | extract_linear_close_ids)

# ---------------------------------------------------------------------------
# Shared function
# ---------------------------------------------------------------------------

# Reads a commit message from $1 (if provided) or from stdin, extracts
# the Linear issue identifiers that should be closed, and prints them
# space-separated (sorted + deduped). Prints an empty string if none.
#
# The function does NOT error on no-match; callers check `[ -z "$ids" ]`.
extract_linear_close_ids() {
  local msg
  if [ $# -gt 0 ]; then
    msg="$1"
  else
    msg=$(cat)
  fi

  if [ -z "$msg" ]; then
    return 0
  fi

  # Inline verb form: \b(Closes|Fixes|Resolves)\s+UTV2-\d+
  #   - verb is case-insensitive via grep -i
  #   - identifier prefix is case-sensitive (grep is case-sensitive by default
  #     for the second grep, so lowercase "utv2-NNN" is ignored)
  #   - \b word boundary prevents "unclosed" style false-positives
  local inline_matches inline_ids
  inline_matches=$(echo "$msg" | grep -oiE '\b(closes|fixes|resolves)[[:space:]]+UTV2-[0-9]+' 2>/dev/null)
  inline_ids=$(echo "$inline_matches" | grep -oE 'UTV2-[0-9]+' 2>/dev/null)

  # Trailer form: ^Linear-Close:\s*UTV2-\d+ (anchored to line start)
  #   - allows zero-or-more whitespace after the colon for tabs or spaces
  #   - must be at start of line — prevents "fix: blah - Linear-Close: X" style
  #     from matching when the trailer appears mid-line
  local trailer_ids
  trailer_ids=$(echo "$msg" | grep -oE '^Linear-Close:[[:space:]]*UTV2-[0-9]+' 2>/dev/null | grep -oE 'UTV2-[0-9]+' 2>/dev/null)

  # Collect all candidate close IDs
  local all_ids
  all_ids=$(printf '%s\n%s\n' "$inline_ids" "$trailer_ids" \
    | sort -u \
    | grep -v '^$')

  # UTV2-548: No-close opt-out — if message contains "No-close: UTV2-NNN"
  # or "plan-only" or "partial-fix", remove the referenced IDs
  local no_close_ids
  no_close_ids=$(echo "$msg" | grep -oE 'No-close:[[:space:]]*UTV2-[0-9]+' 2>/dev/null | grep -oE 'UTV2-[0-9]+' 2>/dev/null)

  local has_plan_only=false
  if echo "$msg" | grep -qiE '\bplan-only\b|\bpartial-fix\b' 2>/dev/null; then
    has_plan_only=true
  fi

  # If plan-only/partial-fix marker present, suppress ALL close IDs
  if [ "$has_plan_only" = true ]; then
    return 0
  fi

  # Remove specific No-close IDs
  local filtered_ids=""
  for id in $all_ids; do
    local suppressed=false
    for nc_id in $no_close_ids; do
      if [ "$id" = "$nc_id" ]; then
        suppressed=true
        break
      fi
    done
    if [ "$suppressed" = false ]; then
      filtered_ids="$filtered_ids $id"
    fi
  done

  echo "$filtered_ids" | xargs | tr ' ' '\n' | sort -u | tr '\n' ' ' | sed 's/ $//'
}

# ---------------------------------------------------------------------------
# Test harness — runs only when invoked directly, not when sourced
# ---------------------------------------------------------------------------

# Detect direct invocation. When sourced, BASH_SOURCE[0] != $0.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  pass=0
  fail=0

  assert_match() {
    local label="$1"
    local input="$2"
    local expected="$3"
    local actual
    actual=$(extract_linear_close_ids "$input")
    if [ "$actual" = "$expected" ]; then
      echo "  PASS  $label"
      pass=$((pass + 1))
    else
      echo "  FAIL  $label"
      echo "        input:    $(printf '%s' "$input" | head -c 100)"
      echo "        expected: '$expected'"
      echo "        actual:   '$actual'"
      fail=$((fail + 1))
    fi
  }

  echo ""
  echo "=== MUST CLOSE ==="

  assert_match \
    "inline Closes with verb prefix" \
    "feat(utv2-519): atomic RPC (#223). Closes UTV2-519." \
    "UTV2-519"

  assert_match \
    "inline Fixes" \
    "fix: review guard. Fixes UTV2-521" \
    "UTV2-521"

  assert_match \
    "inline Resolves" \
    "docs: bundle. Resolves UTV2-494" \
    "UTV2-494"

  assert_match \
    "case-insensitive closes lowercase" \
    "closes UTV2-100" \
    "UTV2-100"

  assert_match \
    "case-insensitive CLOSES uppercase" \
    "CLOSES UTV2-101" \
    "UTV2-101"

  assert_match \
    "trailer Linear-Close at line start" \
    $'feat: something\n\nLinear-Close: UTV2-533' \
    "UTV2-533"

  assert_match \
    "trailer with tab separator" \
    $'feat: something\n\nLinear-Close:\tUTV2-534' \
    "UTV2-534"

  assert_match \
    "multi-close same verb" \
    "Closes UTV2-1, Closes UTV2-2, Closes UTV2-3" \
    "UTV2-1 UTV2-2 UTV2-3"

  assert_match \
    "inline and trailer combined" \
    $'feat: Closes UTV2-10 at start\n\nLinear-Close: UTV2-20' \
    "UTV2-10 UTV2-20"

  assert_match \
    "deduplication — same id via two verbs" \
    "Closes UTV2-50, Fixes UTV2-50" \
    "UTV2-50"

  echo ""
  echo "=== MUST NOT CLOSE ==="

  assert_match \
    "dispatch packet false-positive case (the original incident)" \
    "docs: delegation policy + codex queue cleanup + UTV2-497 dispatch packet (#227)" \
    ""

  assert_match \
    "follow-up mention — 'follow-up to UTV2-NNN'" \
    "fix(utv2-522): hygiene fix — follow-up to UTV2-519 corrective" \
    ""

  assert_match \
    "supersedes mention" \
    "chore: supersedes UTV2-450 dispatch packet" \
    ""

  assert_match \
    "example reference" \
    "refs UTV2-323 as an example" \
    ""

  assert_match \
    "file path literal — UTV2-NNN.md" \
    "chore: remove stale UTV2-497 codex dispatch packet file" \
    ""

  assert_match \
    "unclosed is not closes (word boundary)" \
    "this behavior is unclosed but mentions UTV2-200" \
    ""

  assert_match \
    "trailer not at line start" \
    "feat: x - Linear-Close: UTV2-300" \
    ""

  assert_match \
    "lowercase utv2- prefix not matching (case-sensitive on id)" \
    "Closes utv2-400" \
    ""

  assert_match \
    "empty message" \
    "" \
    ""

  assert_match \
    "UTV2 without dash (space-separated id form)" \
    "Closes UTV2 500" \
    ""

  assert_match \
    "inline verb in scope prefix not matching (conventional commit)" \
    "fix(utv2-536): tighten regex" \
    ""

  assert_match \
    "closes the loop on — not immediately followed by id" \
    "docs: closes the loop on prior UTV2-450 work" \
    ""

  echo ""
  echo "=== UTV2-548: OPT-OUT AND PLAN-ONLY ==="

  assert_match \
    "No-close suppresses specific ID" \
    $'Closes UTV2-539\n\nNo-close: UTV2-539' \
    ""

  assert_match \
    "No-close suppresses one ID but not another" \
    $'Closes UTV2-100, Closes UTV2-200\n\nNo-close: UTV2-100' \
    "UTV2-200"

  assert_match \
    "plan-only marker suppresses all close IDs" \
    $'Closes UTV2-539\n\nplan-only' \
    ""

  assert_match \
    "partial-fix marker suppresses all close IDs" \
    $'Closes UTV2-539\n\npartial-fix' \
    ""

  assert_match \
    "Parent issue reference alone — not close intent" \
    "docs+ops(utv2-539): cleanup plan. Parent issue: UTV2-539" \
    ""

  assert_match \
    "Links reference alone — not close intent" \
    "feat: something. Links: UTV2-539" \
    ""

  echo ""
  echo "Results: $pass passed, $fail failed"

  if [ "$fail" -gt 0 ]; then
    exit 1
  fi
fi
