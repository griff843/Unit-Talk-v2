#!/usr/bin/env bash
# .claude/hooks/pre-proof-validator.sh
# PreToolUse hook: validates proof bundles before git commit.
# Exit 0 = allow silently. Exit 2 = BLOCKS the commit (PreToolUse semantics —
# any non-zero exit denies the call and surfaces stderr to Claude). Deliberate
# fail-closed: a malformed proof bundle would fail CI's proof gates anyway, so
# fix the listed issues and re-run the commit.

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

is_git_commit=$(python3 - "$command" <<'PY'
import os
import shlex
import sys

command = sys.argv[1]
options_with_values = {
    '-C', '-c', '--config-env', '--exec-path', '--git-dir', '--namespace',
    '--super-prefix', '--work-tree',
}

try:
    lexer = shlex.shlex(command, posix=True, punctuation_chars=';&|()')
    lexer.whitespace_split = True
    lexer.commenters = ''
    tokens = list(lexer)
except ValueError:
    tokens = []

found = False
for index, token in enumerate(tokens):
    if os.path.basename(token).lower() not in ('git', 'git.exe'):
        continue
    cursor = index + 1
    while cursor < len(tokens):
        candidate = tokens[cursor]
        if candidate in (';', '&&', '||', '|', '(', ')'):
            break
        if candidate == '--':
            cursor += 1
            if cursor < len(tokens) and tokens[cursor] == 'commit':
                found = True
            break
        if candidate in options_with_values:
            cursor += 2
            continue
        if candidate.startswith(('-C', '-c')) and candidate not in ('-C', '-c'):
            cursor += 1
            continue
        if candidate.startswith('--') and '=' in candidate:
            cursor += 1
            continue
        if candidate.startswith('-'):
            cursor += 1
            continue
        if candidate == 'commit':
            found = True
        break
    if found:
        break

print('yes' if found else 'no')
PY
)
if [ "$is_git_commit" != yes ]; then
  # A commit invoked indirectly -- bash -c "git commit ...", sh -c, eval -- is
  # not an argv chain the tokenizer above can walk, so it would read as "not a
  # commit". The legacy substring detection did cover those forms; keep it as a
  # fail-closed fallback so this rewrite is a strict superset, never a bypass.
  if echo "$command" | grep -Eq 'git[[:space:]]+([-_./=[:alnum:]]+[[:space:]]+)*commit([[:space:]]|$)'; then
    is_git_commit=yes
  fi
fi

[ "$is_git_commit" = yes ] || exit 0

# BEGIN MERGE-AWARE SELECTION
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "PROOF VALIDATOR: commit blocked — cannot resolve repository root" >&2
  exit 2
}
git_dir=$(git rev-parse --git-dir 2>/dev/null) || {
  echo "PROOF VALIDATOR: commit blocked — cannot resolve worktree git directory" >&2
  exit 2
}

case "$git_dir" in
  /*) ;;
  *) git_dir="$repo_root/$git_dir" ;;
esac

# A merge result contains files inherited from each parent. Parent identity
# excludes inherited content; Git's automatic merge tree additionally exposes
# conflict resolutions and post-merge edits that happen to match one parent.
selection_file=$(mktemp) || {
  echo "PROOF VALIDATOR: commit blocked — cannot allocate selection workspace" >&2
  exit 2
}
trap 'rm -f "$selection_file"' EXIT

if ! python3 - "$repo_root" "$git_dir" >"$selection_file" <<'PY'
import ast
import os
import re
import subprocess
import sys

repo_root, git_dir = sys.argv[1:]

def git(*args):
    return subprocess.run(
        ["git", "-C", repo_root, *args],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    ).stdout

def staged_paths(parent=None):
    args = [
        "diff",
        "--cached",
        "--no-renames",
        "--name-only",
        "-z",
        "--diff-filter=ACDMRTUXB",
    ]
    if parent is not None:
        args.append(parent)
    args.append("--")
    return {path for path in git(*args).split(b"\0") if path}

def automatic_merge_tree(parent):
    result = subprocess.run(
        ["git", "-C", repo_root, "merge-tree", "--write-tree", "HEAD", parent],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    # merge-tree returns 1 for conflicts but still writes the synthetic tree id
    # as its first line. Both clean and conflicted results are usable baselines.
    first_line = result.stdout.splitlines()[0] if result.stdout else b""
    if not re.fullmatch(rb"[0-9a-f]{40,64}", first_line):
        raise RuntimeError("git merge-tree did not produce an automatic merge tree")
    return first_line.decode("ascii")

merge_head_path = os.path.join(git_dir, "MERGE_HEAD")
if not os.path.isfile(merge_head_path):
    try:
        git("rev-parse", "--verify", "HEAD")
        authored = staged_paths("HEAD")
    except subprocess.CalledProcessError:
        authored = staged_paths()
else:
    with open(merge_head_path, "rb") as handle:
        merge_heads = [line.strip() for line in handle if line.strip()]
    if not merge_heads:
        raise RuntimeError("MERGE_HEAD is empty")

    parent_diffs = [staged_paths("HEAD")]
    parent_diffs.extend(staged_paths(parent.decode("ascii")) for parent in merge_heads)

    if len(merge_heads) == 1:
        # Combined-diff identity excludes content inherited from either parent.
        authored = set(parent_diffs[0])
        authored.intersection_update(parent_diffs[1])

        # Comparing against Git's automatic merge result catches deliberate
        # post-merge edits, deletes, renames, and conflict resolutions even when
        # the final bytes exactly match HEAD or MERGE_HEAD.
        auto_tree = automatic_merge_tree(merge_heads[0].decode("ascii"))
        authored.update(staged_paths(auto_tree))
    else:
        # Octopus merges are not used for lane syncs. Without a single automatic
        # merge tree, prefer conservative fail-closed selection over allowing a
        # topic-authored proof edit to hide behind one of several parents.
        authored = set().union(*parent_diffs)

    merge_message_path = os.path.join(git_dir, "MERGE_MSG")
    conflicts = set()
    if os.path.isfile(merge_message_path):
        in_conflicts = False
        with open(merge_message_path, "rb") as handle:
            for raw_line in handle:
                line = raw_line.rstrip(b"\r\n")
                if line == b"# Conflicts:":
                    in_conflicts = True
                    continue
                if not in_conflicts:
                    continue
                if not line.startswith(b"#\t"):
                    if line and not line.startswith(b"#"):
                        break
                    continue
                path = line[2:]
                if path.startswith(b'"'):
                    path = os.fsencode(ast.literal_eval(path.decode("utf-8")))
                conflicts.add(path)
    authored.update(conflicts)

for path in sorted(authored):
    sys.stdout.buffer.write(path + b"\0")
PY
then
  echo "PROOF VALIDATOR: commit blocked — unable to determine authored files" >&2
  exit 2
fi

mapfile -d '' -t staged_files <"$selection_file"
[ "${#staged_files[@]}" -eq 0 ] && exit 0

has_proof=false
for f in "${staged_files[@]}"; do
  if [[ "$f" == docs/06_status/proof/* ]]; then
    has_proof=true
    break
  fi
done
[ "$has_proof" = false ] && exit 0
# END MERGE-AWARE SELECTION

failures=()

for f in "${staged_files[@]}"; do
  [[ "$f" =~ ^docs/06_status/proof/.*/evidence\.json$ ]] || continue
  if ! git -C "$repo_root" cat-file -e ":$f" 2>/dev/null; then
    failures+=("[$f] proof file is staged as deleted or unavailable")
    continue
  fi
  result=$(python3 - "$repo_root" "$f" <<'PY'
import json, re, subprocess, sys
failures = []
try:
    staged = subprocess.run(
        ['git', '-C', sys.argv[1], 'show', ':' + sys.argv[2]],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    ).stdout
    d = json.loads(staged)
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
    failures.append('cannot parse evidence: ' + str(e))
for msg in failures:
    print(msg)
PY
)
  if [ -n "$result" ]; then
    while IFS= read -r line; do
      failures+=("[$f] $line")
    done <<< "$result"
  fi
done

for f in "${staged_files[@]}"; do
  [[ "$f" =~ ^docs/06_status/proof/.*/verification.*\.md$ ]] || continue
  if ! git -C "$repo_root" cat-file -e ":$f" 2>/dev/null; then
    failures+=("[$f] proof file is staged as deleted or unavailable")
    continue
  fi
  result=$(python3 - "$repo_root" "$f" <<'PY'
import subprocess, sys
staged = subprocess.run(
    ['git', '-C', sys.argv[1], 'show', ':' + sys.argv[2]],
    check=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
).stdout
if b'## Verification' not in staged:
    print("missing '## Verification' header")
if len(staged) <= 100:
    print(f'file too small ({len(staged)} bytes, need >100)')
PY
)
  if [ -n "$result" ]; then
    while IFS= read -r line; do
      failures+=("[$f] $line")
    done <<< "$result"
  fi
done

if [ "${#failures[@]}" -gt 0 ]; then
  echo "PROOF VALIDATOR: commit blocked — staged proof bundle has issues (fix and re-commit):" >&2
  for msg in "${failures[@]}"; do
    echo "  - $msg" >&2
  done
  exit 2
fi

exit 0
