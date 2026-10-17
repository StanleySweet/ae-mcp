#!/bin/zsh
# Cherry-pick an agent branch onto the current branch, one commit at a time.
# Append-only conflicts are resolved by keeping both sides:
#   docs/agents/code-map.md      -> drop the markers
#   one-line string lists        -> union (build.ts, match-names.test.ts, operations.test.ts)
# Any other conflict stops with "MANUAL: <file>"; resolve it, run `npm run check`,
# then run this script again with --continue.
# Usage: scripts/agents/merge-branch.sh <branch> [<count>] | --continue
set -u
here=${0:A:h}
resolve() {
  local f
  for f in $(git diff --name-only --diff-filter=U); do
    case $f in
      docs/agents/code-map.md) sed -i '' '/^<<<<<<< /d;/^=======$/d;/^>>>>>>> /d' $f; git add $f;;
      packages/bridge/src/build.ts|packages/bridge/src/match-names.test.ts|packages/server/src/operations.test.ts)
        python3 $here/union-lists.py $f; git add $f;;
      *) echo "MANUAL: $f";;
    esac
  done
  ! git diff --name-only --diff-filter=U | grep -q .
}
step() {
  while git rev-parse -q --verify CHERRY_PICK_HEAD >/dev/null; do
    resolve || { git log --oneline -1 | cat; exit 1; }
    GIT_EDITOR=true git cherry-pick --continue >/dev/null 2>&1 || true
  done
}
if [ "${1:-}" = "--continue" ]; then
  git add -A packages docs scripts skills apps 2>/dev/null
  GIT_EDITOR=true git cherry-pick --continue >/dev/null 2>&1 || true
  step
else
  branch=$1
  count=${2:-$(git rev-list --count HEAD..$branch)}
  git cherry-pick "$branch~$count..$branch" >/dev/null 2>&1 || true
  step
fi
git log --oneline -1 | cat
