#!/usr/bin/env bash
# Foreign issue-reference guard (branch discipline, pre-emptive).
#
# `Check issue references` CI (scripts/ops/branch-discipline-guard.ts) parses the
# PR title, PR body, AND every commit subject/body on the branch. Any UTV2-###
# other than the lane's own fails the check -- and because it scans every commit
# in the PR, a follow-up commit CANNOT clear it. The only remedy is a history
# rewrite, which invalidates every head-pinned artifact (executor-result,
# pm-verdict, independent review) and forces a full re-authorization cycle.
#
# The existing commit-msg-linear-check.sh only parses `-m "..."` and
# `--message="..."`. Commits written with `-F <file>` -- the normal way to write
# a multi-paragraph message -- fall straight through it, as do PR bodies passed
# with `--body-file`. Both were real, repeated escapes.
#
# This guard covers: git commit (-m, --message, -F, --file), gh pr create/edit
# (--body, --body-file, --title), and git push (scans the outgoing commit range).
# It fails CLOSED on a foreign reference and explains the cheap fix.
set -uo pipefail

input=$(cat)
command=$(printf '%s' "$input" | python3 -c "
import json, sys
try:
    print(json.load(sys.stdin).get('tool_input', {}).get('command', ''))
except Exception:
    pass
" 2>/dev/null)
[ -z "$command" ] && exit 0

case "$command" in
  *"git commit"*|*"gh pr create"*|*"gh pr edit"*|*"git push"*) ;;
  *) exit 0 ;;
esac

toplevel=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
branch=$(git -C "$toplevel" rev-parse --abbrev-ref HEAD 2>/dev/null)
# Enforce ONLY on lane branches. `claude/utv2-###-*` and `codex/utv2-###-*` are
# the branches that become PRs and therefore get scanned by CI. Preservation
# branches (`preserve/utv2-###-*`) carry inherited history by design and never
# open a PR -- blocking them would be a false positive that stops legitimate
# preservation work.
case "$branch" in
  claude/utv2-[0-9]*|codex/utv2-[0-9]*) ;;
  *) exit 0 ;;
esac
own=$(printf '%s' "$branch" | grep -ioE 'UTV2-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]')
[ -z "$own" ] && exit 0

# An explicit refspec push (e.g. `git push origin <sha>:refs/heads/preserve/...`)
# is not publishing this branch's history to a PR; scanning origin/main..HEAD
# would judge the wrong commits.
if printf '%s' "$command" | grep -qE 'git push[^|]*refs/heads/'; then
  exit 0
fi

# Collect every text surface this command would publish.
scan=""

# -m / --message inline
scan+=$(printf '%s' "$command" | grep -oP '(?<=-m )("[^"]*"|\x27[^\x27]*\x27)' || true)
scan+=$(printf '%s' "$command" | grep -oP '(?<=--message=)("[^"]*"|\x27[^\x27]*\x27)' || true)

# -F / --file / --body-file : read the referenced file
for f in $(printf '%s' "$command" | grep -oP '(?<=-F )[^ ]+|(?<=--file[= ])[^ ]+|(?<=--body-file[= ])[^ ]+' || true); do
  [ "$f" = "-" ] && continue
  [ -f "$f" ] && scan+=$'\n'"$(cat "$f")"
done

# --body / --title inline
scan+=$(printf '%s' "$command" | grep -oP '(?<=--body )("[^"]*"|\x27[^\x27]*\x27)' || true)
scan+=$(printf '%s' "$command" | grep -oP '(?<=--title )("[^"]*"|\x27[^\x27]*\x27)' || true)

# git push: scan the whole outgoing commit range, since CI scans every commit.
if printf '%s' "$command" | grep -q "git push"; then
  base=$(git -C "$toplevel" rev-parse --verify origin/main 2>/dev/null || echo "")
  if [ -n "$base" ]; then
    scan+=$'\n'"$(git -C "$toplevel" log --format='%B' "${base}..HEAD" 2>/dev/null || true)"
  fi
fi

[ -z "${scan//[[:space:]]/}" ] && exit 0

foreign=$(printf '%s' "$scan" | grep -oiE 'UTV2-[0-9]+' | tr '[:lower:]' '[:upper:]' | sort -u | grep -v "^${own}$" || true)
[ -z "$foreign" ] && exit 0

{
  echo "BRANCH DISCIPLINE BLOCK: foreign issue reference(s) for lane ${own}"
  echo
  echo "Found: $(printf '%s' "$foreign" | tr '\n' ' ')"
  echo
  echo "CI (Check issue references) scans the PR title, PR body, and EVERY commit"
  echo "on the branch. A later commit cannot clear this -- the only remedy is a"
  echo "history rewrite, which invalidates every head-pinned artifact."
  echo
  echo "Fix: refer to other issues generically ('the superseded lane', 'PR #1234'),"
  echo "or put the ID in a COMMITTED FILE (proof bundle, code comment) -- those are"
  echo "not scanned. Only commit messages and PR title/body are."
} >&2
exit 2
