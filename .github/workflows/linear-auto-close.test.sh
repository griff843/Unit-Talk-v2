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
  #
  # SUBJECT LINE ONLY, matching has_lane_closeout_signature().
  #
  # UTV2-1724: an earlier revision matched any line at column 0. Once the
  # signature was narrowed to the subject, that left an asymmetry a commit
  # could walk through: a body line at column 0 reading
  # "chore(lanes): close UTV2-N ..." would CLOSE that issue while the tripwire,
  # looking only at the subject, stayed structurally blind to it. Extraction
  # and signature must see the same text or the control does not cover the
  # behaviour. The producer writes a single-line message, so the subject is the
  # correct scope for both.
  local closeout_ids closeout_subject
  closeout_subject=$(echo "$msg" | head -n 1)
  closeout_ids=$(echo "$closeout_subject" | grep -oE '^chore\(lanes\):[[:space:]]+close[[:space:]]+UTV2-[0-9]+' 2>/dev/null | grep -oE 'UTV2-[0-9]+' 2>/dev/null)

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

  # SUBJECT LINE ONLY.
  #
  # UTV2-1724: this originally scanned the whole message. That made the
  # signature prose-sensitive, and it misfired on this lane's own commits —
  # which quote the closeout template in order to explain the defect. A commit
  # that merely DESCRIBES a closeout would have reddened main.
  #
  # The producer writes a single-line commit message, so the signature lives in
  # the subject and nowhere else. Restricting to the first line matches the
  # producer exactly and makes body prose — explanations, quoted examples,
  # changelogs — structurally incapable of triggering it.
  local subject
  subject=$(echo "$msg" | head -n 1)

  # A revert is not a closeout. `git revert` prefixes the reverted subject
  # verbatim, so "Revert \"chore(lanes): close UTV2-N — lane closed, sync file
  # removed\"" carries both signatures while extracting nothing — the tripwire
  # would fire and redden main on a legitimate, correct revert. Undoing a
  # closeout is a deliberate act, not template drift.
  case "$subject" in
    'Revert "'*|'Revert: '*|'revert: '*) return 1 ;;
  esac

  # Signature 1: the conventional-commit scope the closeout path always uses,
  # combined with a close verb in any form.
  if echo "$subject" | grep -qE '^chore\(lanes\):[[:space:]]+clos(e|es|ed|ing)[[:space:]]' 2>/dev/null; then
    return 0
  fi

  # Signature 2: the literal trailer phrase emitted by
  # post-merge-lane-close.yml, for a subject whose scope or verb has drifted.
  if echo "$subject" | grep -qE 'lane closed, sync file removed' 2>/dev/null; then
    return 0
  fi

  return 1
}

# Would this message have yielded close IDs if the opt-out filter were not
# applied? Runs the three close-intent FORMS only, skipping suppression.
#
# This exists so the tripwire can distinguish the two reasons extraction can
# come back empty:
#   - the forms matched, and an opt-out removed the result   -> deliberate
#   - no form matched at all                                 -> grammar drift
extract_close_ids_ignoring_suppression() {
  local msg="$1"
  [ -z "$msg" ] && return 0

  # Each form must be matched in the SAME SCOPE extract_linear_close_ids() uses
  # for it, or this predicate answers a different question than the one the
  # tripwire is asking.
  #
  # UTV2-1724: the closeout grep here read the whole message while extraction
  # and the signature had both been narrowed to the subject. That third,
  # unaligned scope reopened the hole twice already closed:
  #
  #   subject: chore(lanes): closing UTV2-9999 — lane closed, sync file removed
  #   body:    chore(lanes): close UTV2-1234 — lane closed, sync file removed
  #   -> ids=[]  signature=yes  suppression=yes  tripwire SILENT
  #
  # A drifted closeout was misclassified as a deliberate opt-out — the exact
  # silent-ghost outcome this lane exists to abolish. Scope alignment is the
  # invariant; it is asserted across all three functions by a case below.
  local inline trailer closeout subject
  subject=$(echo "$msg" | head -n 1)
  inline=$(echo "$msg" | grep -oiE '\b(closes|fixes|resolves)[[:space:]]+UTV2-[0-9]+' 2>/dev/null | grep -oE 'UTV2-[0-9]+' 2>/dev/null)
  trailer=$(echo "$msg" | grep -oE '^Linear-Close:[[:space:]]*UTV2-[0-9]+' 2>/dev/null | grep -oE 'UTV2-[0-9]+' 2>/dev/null)
  closeout=$(echo "$subject" | grep -oE '^chore\(lanes\):[[:space:]]+close[[:space:]]+UTV2-[0-9]+' 2>/dev/null | grep -oE 'UTV2-[0-9]+' 2>/dev/null)

  printf '%s\n%s\n%s\n' "$inline" "$trailer" "$closeout" | sort -u | grep -v '^$' | tr '\n' ' ' | sed 's/ $//'
}

# Was extraction's empty result caused by a DELIBERATE, EXPLICIT opt-out rather
# than by the grammar failing to match?
#
# UTV2-1724, first revision: this grepped the message for "plan-only",
# "partial-fix" or "No-close:". That was a prose escape hatch — this lane's own
# commit body, which merely describes the opt-out feature, switched off the
# control it was describing.
#
# UTV2-1724, second revision: it asked only whether the close-intent FORMS
# matched. That closed the prose hole for drifted subjects but opened a
# narrower one, because extract_linear_close_ids() still suppresses on bare
# prose:
#
#   chore(lanes): close UTV2-1614 — lane closed, sync file removed
#
#   this is not plan-only at all
#   -> forms matched, extraction suppressed on the word "plan-only",
#      tripwire read that as deliberate and stayed silent
#
# A well-formed sanctioned closeout was voided by one word in its body, with
# nothing going red — the exact ghost this lane exists to abolish.
#
# So "deliberate" now requires an EXPLICIT No-close: trailer naming an ID the
# forms actually found. Bare prose is not enough to silence the tripwire on a
# commit that carries a closeout signature: if someone really means to suppress
# a sanctioned closeout, they name it.
#
# extract_linear_close_ids()'s own opt-out semantics are pre-existing and
# deliberately left untouched — it still suppresses on prose. The difference is
# that doing so on a closeout commit is now LOUD instead of silent.
has_close_suppression_marker() {
  local msg
  if [ $# -gt 0 ]; then
    msg="$1"
  else
    msg=$(cat)
  fi

  [ -z "$msg" ] && return 1

  local raw
  raw=$(extract_close_ids_ignoring_suppression "$msg")
  [ -n "$raw" ] || return 1

  # An explicit No-close: naming one of the IDs the forms found.
  local nc
  nc=$(echo "$msg" | grep -oE 'No-close:[[:space:]]*UTV2-[0-9]+' 2>/dev/null | grep -oE 'UTV2-[0-9]+' 2>/dev/null)
  local id ncid
  for id in $raw; do
    for ncid in $nc; do
      [ "$id" = "$ncid" ] && return 0
    done
  done

  return 1
}


# ---------------------------------------------------------------------------
# Authoritative merge SHA resolution (UTV2-1724 P1)
# ---------------------------------------------------------------------------
#
# `github.sha` on a push is the SHA of the PUSHED commit. For an ordinary
# squash/merge to main that IS the implementation merge SHA, and comparing the
# manifest against it is correct.
#
# For the sanctioned closeout path it is not. post-merge-lane-close.yml pushes
# a SEPARATE commit AFTER the merge:
#
#   3ca047fa  UTV2-1721: port bounded harness corrections (#1432)   <- the merge
#   44068585  chore(lanes): close UTV2-1721 — lane closed, ...      <- pushed later
#
# The manifest's commit_sha is bound to the merge (3ca047fa). github.sha on the
# closeout push is 44068585. The completion gate's
# `[ "$m_sha" != "$MERGE_SHA" ]` therefore compares two SHAs that can never be
# equal, and every sanctioned closeout is refused with
# "manifest commit_sha X is not this merge SHA Y".
#
# That is a second, independent fail-open on the same path as the grammar
# defect: fixing extraction alone converts a silent `no_close_intent` ghost into
# a silent `completion withheld` ghost. Same stranded lane, different reason.
#
# This resolver deliberately introduces NO new contract. The authoritative merge
# SHA is the one the sanctioned closeout ALREADY recorded, in the two fields
# that already exist and are already cross-checked by the gate below:
#   manifest .commit_sha                          — the implementation merge
#   manifest .truth_check_history[-1].merge_sha   — the receipt bound to it
# The resolver reads them; it does not invent a third source of truth.
#
# Echoes the resolved SHA, or empty when it cannot be resolved. Empty on a
# closeout commit is drift and MUST fail closed at the call site.
resolve_authoritative_merge_sha() {
  local commit_msg="$1"
  local manifest_path="$2"
  local push_sha="$3"

  # Not a closeout commit: the pushed commit IS the merge. Unchanged behaviour.
  if ! has_lane_closeout_signature "$commit_msg"; then
    echo "$push_sha"
    return 0
  fi

  # Closeout commit: the pushed SHA is the closeout, never the merge.
  [ -f "$manifest_path" ] || { echo ""; return 0; }

  local m_sha r_sha
  m_sha=$(jq -r '.commit_sha // ""' "$manifest_path" 2>/dev/null)
  r_sha=$(jq -r '(.truth_check_history // []) | last | .merge_sha // ""' "$manifest_path" 2>/dev/null)

  # Both existing records must agree. If they disagree, the manifest is not a
  # trustworthy source for the merge SHA and we resolve nothing rather than
  # picking a side.
  if [ -z "$m_sha" ] || [ "$m_sha" = "null" ]; then echo ""; return 0; fi
  if [ "$r_sha" != "$m_sha" ]; then echo ""; return 0; fi

  echo "$m_sha"
}

# Is `sha` an ancestor of (or identical to) `push_sha` on the remote?
#
# The checkout is fetch-depth 1, so there is no local history to walk. Uses the
# compare API. With base=sha and head=push_sha it reports "ahead" when the base
# is reachable from the head, or "identical" when they are the same commit;
# those are the two statuses accepted below.
#
# Fails closed: any API error, missing token, or unrecognised status is treated
# as NOT an ancestor. A completion that cannot be proven does not happen.
sha_is_ancestor_of_push() {
  local sha="$1"
  local push_sha="$2"

  [ -n "$sha" ] || return 1
  [ -n "$push_sha" ] || return 1
  [ "$sha" = "$push_sha" ] && return 0

  local repo="${REPO:-griff843/Unit-Talk-v2}"
  local status
  status=$(gh api "repos/${repo}/compare/${sha}...${push_sha}" --jq '.status' 2>/dev/null) || return 1

  case "$status" in
    ahead|identical) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Completion decision (UTV2-1724)
# ---------------------------------------------------------------------------
#
# The truth-gated completion decision, moved out of the workflow YAML and into
# the shared file so the TEST HARNESS EXERCISES THE REAL DECISION PATH rather
# than a paraphrase of it. Testing ID extraction alone was how the SHA-comparison
# defect below survived: the grammar could be fixed and fully green while the
# gate that consumes its output still refused every sanctioned closeout.
#
# Echoes the reason completion is withheld, or empty when the issue may
# complete. Never exits non-zero — the caller branches on the string.
#
# Args: identifier, manifest_path, commit_msg, push_sha
evaluate_completion_block() {
  local identifier="$1"
  local manifest_path="$2"
  local commit_msg="$3"
  local push_sha="$4"

  if [ ! -f "$manifest_path" ]; then
    echo "no lane manifest at $manifest_path; a merge alone is not evidence of completion"
    return 0
  fi

  local effective_merge_sha
  effective_merge_sha=$(resolve_authoritative_merge_sha "$commit_msg" "$manifest_path" "$push_sha")

  if has_lane_closeout_signature "$commit_msg" && [ -z "$effective_merge_sha" ]; then
    echo "closeout commit but the manifest yields no agreed authoritative merge SHA (commit_sha absent, or truth-check receipt bound to a different SHA)"
    return 0
  fi

  local m_status m_sha r_verdict r_sha r_runner
  m_status=$(jq -r '.status // ""' "$manifest_path")
  m_sha=$(jq -r '.commit_sha // ""' "$manifest_path")
  r_verdict=$(jq -r '(.truth_check_history // []) | last | .verdict // ""' "$manifest_path")
  r_sha=$(jq -r '(.truth_check_history // []) | last | .merge_sha // ""' "$manifest_path")
  r_runner=$(jq -r '(.truth_check_history // []) | last | .runner // ""' "$manifest_path")

  if [ "$m_status" != "done" ] && [ "$m_status" != "merged" ]; then
    echo "lane status \"$m_status\" does not assert successful completion"
  elif [ "$r_verdict" != "pass" ]; then
    echo "latest truth-check verdict is \"$r_verdict\", not \"pass\""
  elif [ "$r_runner" != "ops:lane-close" ] && [ "$r_runner" != "ops:reconcile" ]; then
    echo "truth-check runner \"$r_runner\" is not a canonical runner"
  elif [ -z "$m_sha" ] || [ "$m_sha" != "$effective_merge_sha" ]; then
    echo "manifest commit_sha \"$m_sha\" is not the authoritative merge SHA $effective_merge_sha"
  elif ! sha_is_ancestor_of_push "$effective_merge_sha" "$push_sha"; then
    # For a closeout commit the comparison above is satisfied by construction,
    # because the resolver reads commit_sha itself. THIS is the check that
    # carries the real guarantee: the SHA the manifest claims as its merge must
    # actually be an ancestor of the commit being pushed to main. A manifest
    # naming a SHA that never landed cannot complete an issue.
    echo "manifest merge SHA $effective_merge_sha is not an ancestor of the pushed commit $push_sha; it did not land on main"
  elif [ "$r_sha" != "$m_sha" ]; then
    echo "truth-check receipt is bound to $r_sha, not to the manifest's $m_sha"
  else
    echo ""
  fi
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

  assert_match \
    "closeout form is subject-only: a column-0 BODY line must not close" \
    $'feat(api): unrelated change\n\nchore(lanes): close UTV2-1234 — lane closed, sync file removed' \
    ""

  assert_match \
    "reverting a closeout does not close" \
    'Revert "chore(lanes): close UTV2-1614 — lane closed, sync file removed"' \
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
    "trailer phrase in a DRIFTED SUBJECT carries the signature" \
    "chore(lanes): terminate UTV2-1614 — lane closed, sync file removed" \
    "yes"

  # The signature is deliberately subject-only. An earlier revision scanned the
  # whole message, and it misfired on this lane's own commits — they quote the
  # closeout template to explain the defect, so a commit that merely DESCRIBES a
  # closeout would have reddened main. The producer writes a single-line
  # message, so body prose can never be a real signature.
  assert_signature \
    "trailer phrase in the BODY does not carry the signature" \
    $'chore(lanes): terminate UTV2-1614\n\nlane closed, sync file removed' \
    "no"

  assert_signature \
    "a commit that merely describes the closeout template carries no signature" \
    $'fix(ci): explain the closeout grammar\n\nThe producer emits:\n  chore(lanes): close UTV2-1 — lane closed, sync file removed' \
    "no"

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

  # The opt-out test asks "did the FORMS match", not "does the text mention an
  # opt-out". An earlier revision grepped for the words plan-only / partial-fix
  # / No-close, which meant any commit whose prose mentioned them silently
  # disabled the tripwire — a fail-open inside the fix for a fail-open,
  # reproduced on this lane's own squash merge.
  prose_msg=$'chore(lanes): terminate UTV2-1614 — lane closed, sync file removed\n\nMentions plan-only and partial-fix in prose only.'
  if has_lane_closeout_signature "$prose_msg" && ! has_close_suppression_marker "$prose_msg"; then
    echo "  PASS  prose mentioning plan-only/partial-fix cannot silence the tripwire"
    pass=$((pass + 1))
  else
    echo "  FAIL  prose mentioning plan-only/partial-fix cannot silence the tripwire"
    fail=$((fail + 1))
  fi

  # Hatch 6: extract_linear_close_ids() suppresses on bare prose, so a
  # well-formed sanctioned closeout could be voided by one word in its body
  # while the tripwire read that as deliberate and stayed silent. Silencing now
  # requires an explicit No-close: naming an ID the forms actually found.
  prose_void_msg=$'chore(lanes): close UTV2-1614 — lane closed, sync file removed\n\nthis is not plan-only at all'
  if [ -z "$(extract_linear_close_ids "$prose_void_msg")" ] \
     && has_lane_closeout_signature "$prose_void_msg" \
     && ! has_close_suppression_marker "$prose_void_msg"; then
    echo "  PASS  prose cannot silently void a sanctioned closeout"
    pass=$((pass + 1))
  else
    echo "  FAIL  prose cannot silently void a sanctioned closeout"
    fail=$((fail + 1))
  fi

  # ...but a real, named opt-out still is deliberate.
  named_optout=$'chore(lanes): close UTV2-1614 — lane closed, sync file removed\n\nNo-close: UTV2-1614'
  if has_close_suppression_marker "$named_optout"; then
    echo "  PASS  an explicit No-close naming the found ID still silences the tripwire"
    pass=$((pass + 1))
  else
    echo "  FAIL  an explicit No-close naming the found ID still silences the tripwire"
    fail=$((fail + 1))
  fi

  # A revert is a deliberate undo, not template drift. git revert prefixes the
  # reverted subject verbatim, so without this the tripwire would redden main on
  # a correct revert.
  revert_msg='Revert "chore(lanes): close UTV2-1614 — lane closed, sync file removed"'
  if has_lane_closeout_signature "$revert_msg"; then
    echo "  FAIL  reverting a closeout does not fire the tripwire"
    fail=$((fail + 1))
  else
    echo "  PASS  reverting a closeout does not fire the tripwire"
    pass=$((pass + 1))
  fi

  # Extraction and signature must see the same text, or a commit walks through
  # the gap: a column-0 body line would close an issue the tripwire cannot see.
  asym_msg=$'feat(api): unrelated change\n\nchore(lanes): close UTV2-1234 — lane closed, sync file removed'
  asym_ids=$(extract_linear_close_ids "$asym_msg")
  asym_raw=$(extract_close_ids_ignoring_suppression "$asym_msg")
  if [ -z "$asym_ids" ] && [ -z "$asym_raw" ] && ! has_lane_closeout_signature "$asym_msg"; then
    echo "  PASS  all three scopes agree — extraction, raw-form and signature"
    pass=$((pass + 1))
  else
    echo "  FAIL  all three scopes agree — extraction, raw-form and signature"
    echo "        ids='$asym_ids' raw='$asym_raw'"
    fail=$((fail + 1))
  fi

  # The exploit a two-scope assertion could not catch: a DRIFTED subject whose
  # body carries a well-formed closeout line. If the raw-form scan reads the
  # body, it reports a form match, the tripwire reads that as a deliberate
  # opt-out, and real drift passes in silence.
  drift_body_msg=$'chore(lanes): closing UTV2-9999 — lane closed, sync file removed\nchore(lanes): close UTV2-1234 — lane closed, sync file removed'
  if has_lane_closeout_signature "$drift_body_msg" \
     && ! has_close_suppression_marker "$drift_body_msg" \
     && [ -z "$(extract_linear_close_ids "$drift_body_msg")" ]; then
    echo "  PASS  drifted subject is not silenced by a closeout line in the body"
    pass=$((pass + 1))
  else
    echo "  FAIL  drifted subject is not silenced by a closeout line in the body"
    fail=$((fail + 1))
  fi

  echo ""
  echo "=== UTV2-1724: FULL CLOSEOUT DECISION PATH ==="

  # These exercise extraction -> signature -> SHA resolution -> completion gate
  # against real manifest shapes and real closeout-commit ancestry. Ancestry is
  # stubbed so the suite stays hermetic; the stub is declared per-case so a case
  # cannot silently inherit another's ancestry assumption.

  _fixture_dir=$(mktemp -d)
  trap 'rm -r "$_fixture_dir" 2>/dev/null || true' EXIT

  MERGE="3ca047fa8fcae2a8768d2ba63cace8019a5a76ca"    # the implementation merge
  CLOSEOUT="44068585d1d5092f41a7cdaa01909df9b2a4358a" # the later closeout commit
  CLOSEOUT_MSG="chore(lanes): close UTV2-1721 — lane closed, sync file removed"

  write_manifest() {
    # $1 name, $2 status, $3 commit_sha, $4 verdict, $5 receipt_sha, $6 runner
    mkdir -p "$_fixture_dir/docs/06_status/lanes"
    jq -n --arg s "$2" --arg c "$3" --arg v "$4" --arg r "$5" --arg run "$6" \
      '{status:$s, commit_sha:$c, truth_check_history:[{verdict:$v, merge_sha:$r, runner:$run}]}' \
      > "$_fixture_dir/docs/06_status/lanes/$1.json"
    echo "$_fixture_dir/docs/06_status/lanes/$1.json"
  }

  stub_ancestry_true() { sha_is_ancestor_of_push() { return 0; }; }
  stub_ancestry_false() { sha_is_ancestor_of_push() { return 1; }; }

  assert_decision() {
    local label="$1" expected="$2" actual="$3"
    if [ "$expected" = "COMPLETE" ] && [ -z "$actual" ]; then
      echo "  PASS  $label"; pass=$((pass + 1)); return
    fi
    if [ "$expected" != "COMPLETE" ] && [ -n "$actual" ] && [[ "$actual" == *"$expected"* ]]; then
      echo "  PASS  $label"; pass=$((pass + 1)); return
    fi
    echo "  FAIL  $label"
    echo "        expected: '$expected'"
    echo "        actual:   '$actual'"
    fail=$((fail + 1))
  }

  # --- THE DEFECT, reproduced end to end -----------------------------------
  # A perfectly healthy lane: status done, verdict pass, canonical runner,
  # receipt bound to the merge. The ONLY thing wrong is that the pushed commit
  # is the closeout, not the merge.
  mf=$(write_manifest UTV2-1721 done "$MERGE" pass "$MERGE" ops:lane-close)
  stub_ancestry_true

  legacy_m_sha=$(jq -r '.commit_sha' "$mf")
  if [ "$legacy_m_sha" != "$CLOSEOUT" ]; then
    echo "  PASS  pre-fix: a healthy manifest compared against the pushed closeout SHA can never match"
    pass=$((pass + 1))
  else
    echo "  FAIL  pre-fix: a healthy manifest compared against the pushed closeout SHA can never match"
    fail=$((fail + 1))
  fi

  assert_decision \
    "sanctioned closeout on a healthy lane COMPLETES" \
    "COMPLETE" \
    "$(evaluate_completion_block UTV2-1721 "$mf" "$CLOSEOUT_MSG" "$CLOSEOUT")"

  # --- Resolution is correct, not merely permissive -------------------------
  resolved=$(resolve_authoritative_merge_sha "$CLOSEOUT_MSG" "$mf" "$CLOSEOUT")
  if [ "$resolved" = "$MERGE" ]; then
    echo "  PASS  resolver returns the implementation merge SHA, not the closeout SHA"
    pass=$((pass + 1))
  else
    echo "  FAIL  resolver returns the implementation merge SHA, not the closeout SHA"
    echo "        expected: $MERGE"
    echo "        actual:   $resolved"
    fail=$((fail + 1))
  fi

  ordinary=$(resolve_authoritative_merge_sha "feat: thing (#12). Closes UTV2-900." "$mf" "$CLOSEOUT")
  if [ "$ordinary" = "$CLOSEOUT" ]; then
    echo "  PASS  non-closeout commit still resolves to the pushed SHA (behaviour unchanged)"
    pass=$((pass + 1))
  else
    echo "  FAIL  non-closeout commit still resolves to the pushed SHA (behaviour unchanged)"
    fail=$((fail + 1))
  fi

  # --- Fail-closed cases ----------------------------------------------------
  stub_ancestry_true

  mf2=$(write_manifest UTV2-1731 done "" pass "$MERGE" ops:lane-close)
  assert_decision \
    "closeout with no commit_sha fails closed" \
    "no agreed authoritative merge SHA" \
    "$(evaluate_completion_block UTV2-1731 "$mf2" "$CLOSEOUT_MSG" "$CLOSEOUT")"

  mf3=$(write_manifest UTV2-1732 done "$MERGE" pass "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" ops:lane-close)
  assert_decision \
    "closeout whose receipt is bound to a different SHA fails closed" \
    "no agreed authoritative merge SHA" \
    "$(evaluate_completion_block UTV2-1732 "$mf3" "$CLOSEOUT_MSG" "$CLOSEOUT")"

  mf4=$(write_manifest UTV2-1733 in_review "$MERGE" pass "$MERGE" ops:lane-close)
  assert_decision \
    "closeout on a non-terminal lane is refused" \
    "does not assert successful completion" \
    "$(evaluate_completion_block UTV2-1733 "$mf4" "$CLOSEOUT_MSG" "$CLOSEOUT")"

  mf5=$(write_manifest UTV2-1734 done "$MERGE" fail "$MERGE" ops:lane-close)
  assert_decision \
    "closeout with a failing truth-check is refused" \
    "not \"pass\"" \
    "$(evaluate_completion_block UTV2-1734 "$mf5" "$CLOSEOUT_MSG" "$CLOSEOUT")"

  mf6=$(write_manifest UTV2-1735 done "$MERGE" pass "$MERGE" some-agent)
  assert_decision \
    "closeout with a non-canonical runner is refused" \
    "not a canonical runner" \
    "$(evaluate_completion_block UTV2-1735 "$mf6" "$CLOSEOUT_MSG" "$CLOSEOUT")"

  assert_decision \
    "missing manifest is refused" \
    "no lane manifest" \
    "$(evaluate_completion_block UTV2-1736 "$_fixture_dir/docs/06_status/lanes/UTV2-1736.json" "$CLOSEOUT_MSG" "$CLOSEOUT")"

  # --- Ancestry is load-bearing, proved by making it fail -------------------
  stub_ancestry_false
  assert_decision \
    "a merge SHA that never landed on main is refused (ancestry gate fires)" \
    "did not land on main" \
    "$(evaluate_completion_block UTV2-1721 "$mf" "$CLOSEOUT_MSG" "$CLOSEOUT")"

  stub_ancestry_true
  assert_decision \
    "and completes again once ancestry holds — the only variable was ancestry" \
    "COMPLETE" \
    "$(evaluate_completion_block UTV2-1721 "$mf" "$CLOSEOUT_MSG" "$CLOSEOUT")"

  # --- Extraction and gate agree on the same commit -------------------------
  ids=$(extract_linear_close_ids "$CLOSEOUT_MSG")
  gate=$(evaluate_completion_block UTV2-1721 "$mf" "$CLOSEOUT_MSG" "$CLOSEOUT")
  if [ "$ids" = "UTV2-1721" ] && [ -z "$gate" ]; then
    echo "  PASS  end to end: the same closeout commit both extracts an ID and passes the gate"
    pass=$((pass + 1))
  else
    echo "  FAIL  end to end: the same closeout commit both extracts an ID and passes the gate"
    echo "        ids='$ids' gate='$gate'"
    fail=$((fail + 1))
  fi

  echo ""
  echo "Results: $pass passed, $fail failed"

  if [ "$fail" -gt 0 ]; then
    exit 1
  fi
fi
