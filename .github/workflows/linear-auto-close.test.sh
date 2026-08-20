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

  # Closeout form: ^chore(lanes): close UTV2-NNN  (anchored to line start)
  #
  # UTV2-1724: the sanctioned closeout path emits the BARE IMPERATIVE "close",
  # which none of the forms above match:
  #
  #   post-merge-lane-close.yml:536
  #     git commit -m "chore(lanes): close $ISSUE_ID — lane closed, sync file removed"
  #
  # So every commit the sanctioned closeout path produced fell through to
  # decision=no_close, silently, for 24 days — 25 merged lanes were left as
  # Linear ghosts. See has_lane_closeout_signature() below for the tripwire
  # that makes a recurrence fail loudly instead of accumulating.
  #
  # Deliberately NOT added to the inline alternation above. Bare "close" is a
  # common English word; matching it anywhere would close an issue on prose
  # like "do not close UTV2-1", "close UTV2-1 was reverted", or a body line
  # quoting an earlier commit. This form is anchored to line start AND
  # requires the literal chore(lanes) scope, so it matches the sanctioned
  # producer and nothing else. The other chore(lanes) commits — lane-start
  # metadata, PR binding, truth-check result, auto-reconcile — do not carry
  # the "close " verb and are unaffected.
  local closeout_ids
  closeout_ids=$(echo "$msg" | grep -oE '^chore\(lanes\):[[:space:]]+close[[:space:]]+UTV2-[0-9]+' 2>/dev/null | grep -oE 'UTV2-[0-9]+' 2>/dev/null)

  # Collect all candidate close IDs
  local all_ids
  all_ids=$(printf '%s\n%s\n%s\n' "$inline_ids" "$trailer_ids" "$closeout_ids" \
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
# Fail-closed tripwire (UTV2-1724)
# ---------------------------------------------------------------------------
#
# Returns 0 (true) when the commit message carries a LANE-CLOSEOUT SIGNATURE:
# it was produced by the sanctioned closeout path and therefore MUST resolve to
# at least one close ID.
#
# Why this exists as a separate predicate rather than as part of extraction:
# the original defect was not that extraction was wrong, but that being wrong
# was INVISIBLE. A closeout commit that matched nothing logged
# `decision=no_close reason=no_close_intent` as a ::notice — the same output a
# perfectly ordinary non-closing commit produces. An aggregate green conflated
# "nothing to close here" with "the one thing this workflow exists to do did
# not happen". That is the evidence-conflation class already in KNOWN_DEBT.
#
# The signature is intentionally derived from the closeout path's OWN output
# and is broader than the grammar that consumes it. If the closeout template
# changes again, the signature keeps matching while the grammar stops — and the
# workflow fails loudly on the very first drifted commit instead of quietly
# stranding lanes for weeks.
#
# Suppression markers (No-close:, plan-only, partial-fix) are honoured: a
# deliberate opt-out is not drift. The caller checks those before consulting
# this predicate.
has_lane_closeout_signature() {
  local msg
  if [ $# -gt 0 ]; then
    msg="$1"
  else
    msg=$(cat)
  fi

  [ -z "$msg" ] && return 1

  # Signature 1: the conventional-commit scope the closeout path always uses,
  # combined with a close verb in any form.
  if echo "$msg" | grep -qE '^chore\(lanes\):[[:space:]]+clos(e|es|ed|ing)[[:space:]]' 2>/dev/null; then
    return 0
  fi

  # Signature 2: the literal trailer phrase emitted by
  # post-merge-lane-close.yml, independent of the subject line's shape.
  if echo "$msg" | grep -qE 'lane closed, sync file removed' 2>/dev/null; then
    return 0
  fi

  return 1
}

# Returns 0 (true) when the message carries an explicit opt-out. Kept separate
# so the tripwire can distinguish "deliberately not closing" from "failed to
# recognise a closeout".
has_close_suppression_marker() {
  local msg
  if [ $# -gt 0 ]; then
    msg="$1"
  else
    msg=$(cat)
  fi

  [ -z "$msg" ] && return 1

  if echo "$msg" | grep -qiE '\bplan-only\b|\bpartial-fix\b' 2>/dev/null; then
    return 0
  fi
  if echo "$msg" | grep -qE 'No-close:[[:space:]]*UTV2-[0-9]+' 2>/dev/null; then
    return 0
  fi

  return 1
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
  echo "=== UTV2-1724: SANCTIONED CLOSEOUT COMMITS ==="

  # The exact byte-for-byte string emitted by post-merge-lane-close.yml:536,
  # em dash included. This is the case that failed for 24 days.
  assert_match \
    "sanctioned closeout commit (verbatim producer output)" \
    "chore(lanes): close UTV2-1614 — lane closed, sync file removed" \
    "UTV2-1614"

  assert_match \
    "sanctioned closeout, ASCII hyphen instead of em dash" \
    "chore(lanes): close UTV2-1721 - lane closed, sync file removed" \
    "UTV2-1721"

  assert_match \
    "sanctioned closeout with a body" \
    $'chore(lanes): close UTV2-1590 — lane closed, sync file removed\n\n[skip ci]' \
    "UTV2-1590"

  # Other chore(lanes) producers MUST NOT close. Each string below is taken
  # from a real commit template in this repo.
  assert_match \
    "lane-start manifest commit does not close (lane-start.ts:1380)" \
    "chore(lanes): UTV2-1724 lane manifest and sync metadata" \
    ""

  assert_match \
    "lane readmission commit does not close (lane-start.ts:1183)" \
    "chore(lanes): UTV2-1724 existing branch readmission metadata" \
    ""

  assert_match \
    "PR binding commit does not close (lane-pr-binding.yml:115)" \
    "chore(lanes): bind UTV2-1724 to PR #1500" \
    ""

  assert_match \
    "truth-check record commit does not close (lane-close.ts:1180)" \
    "chore(lanes): UTV2-1724 record lane-close truth-check result" \
    ""

  assert_match \
    "auto-reconcile commit does not close (reconcile-stale-lanes.yml:49)" \
    "chore(lanes): auto-reconcile stale manifests" \
    ""

  # Bare "close" is only honoured under the anchored chore(lanes) scope.
  assert_match \
    "bare close verb in prose does not close" \
    "fix: do not close UTV2-777 until the gate lands" \
    ""

  assert_match \
    "bare close verb mid-line does not close" \
    "chore: we will close UTV2-778 next week" \
    ""

  assert_match \
    "closeout form must be anchored to line start" \
    "see also: chore(lanes): close UTV2-779 — lane closed, sync file removed" \
    ""

  assert_match \
    "closeout form honours No-close opt-out" \
    $'chore(lanes): close UTV2-780 — lane closed, sync file removed\n\nNo-close: UTV2-780' \
    ""

  echo ""
  echo "=== UTV2-1724: FAIL-CLOSED TRIPWIRE ==="

  assert_signature() {
    local label="$1"
    local input="$2"
    local expected="$3"
    local actual
    if has_lane_closeout_signature "$input"; then actual="yes"; else actual="no"; fi
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

  assert_signature \
    "sanctioned closeout carries the signature" \
    "chore(lanes): close UTV2-1614 — lane closed, sync file removed" \
    "yes"

  assert_signature \
    "trailer phrase alone carries the signature" \
    $'chore(lanes): terminate UTV2-1614\n\nlane closed, sync file removed' \
    "yes"

  assert_signature \
    "past-tense closeout subject carries the signature" \
    "chore(lanes): closed UTV2-1614" \
    "yes"

  assert_signature \
    "lane-start metadata commit carries no signature" \
    "chore(lanes): UTV2-1724 lane manifest and sync metadata" \
    "no"

  assert_signature \
    "ordinary feature commit carries no signature" \
    "feat: something. Closes UTV2-123." \
    "no"

  # The control proved by making it FAIL on the condition it names, not by
  # presence plus a green run: a message that LOOKS like a closeout to the
  # signature but that the grammar cannot extract from. This is the exact
  # shape a future template drift would take, and it must be detectable.
  drift_msg="chore(lanes): terminate UTV2-1614 — lane closed, sync file removed"
  drift_ids=$(extract_linear_close_ids "$drift_msg")
  if has_lane_closeout_signature "$drift_msg" && [ -z "$drift_ids" ]; then
    echo "  PASS  drifted closeout template is detectable (signature yes, ids empty)"
    pass=$((pass + 1))
  else
    echo "  FAIL  drifted closeout template is detectable (signature yes, ids empty)"
    echo "        signature: $(has_lane_closeout_signature "$drift_msg" && echo yes || echo no)"
    echo "        ids:       '$drift_ids'"
    fail=$((fail + 1))
  fi

  # And the converse: a deliberate opt-out on a real closeout must NOT be
  # reported as drift, or every intentional no-close would break the build.
  optout_msg=$'chore(lanes): close UTV2-1614 — lane closed, sync file removed\n\nNo-close: UTV2-1614'
  if has_close_suppression_marker "$optout_msg"; then
    echo "  PASS  deliberate opt-out is distinguishable from drift"
    pass=$((pass + 1))
  else
    echo "  FAIL  deliberate opt-out is distinguishable from drift"
    fail=$((fail + 1))
  fi

  echo ""
  echo "Results: $pass passed, $fail failed"

  if [ "$fail" -gt 0 ]; then
    exit 1
  fi
fi
