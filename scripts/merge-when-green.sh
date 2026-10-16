#!/usr/bin/env bash
# Merge a PR once every CI job on its current head commit has passed.
#   scripts/merge-when-green.sh <pr-number> [--git]
# --git merges with git in a temporary worktree instead of `gh pr merge`, for
# PRs that touch .github/workflows (the gh token has no workflow scope).
# Exits non-zero (without merging) on any failure, or if the head moves.
set -euo pipefail
pr=$1
mode=${2:-}
# A PR stacked on another branch merges into that branch, not main (it happened to #291).
base=$(gh pr view "$pr" --json baseRefName -q .baseRefName)
[ "$base" = main ] || { echo "PR #$pr targets $base, not main; retarget it first"; exit 1; }
sha=$(gh pr view "$pr" --json headRefOid -q .headRefOid)
first=1
while :; do
  # Check at once, so a PR whose CI already passed merges without waiting.
  [ $first = 1 ] || sleep 30
  first=0
  [ "$(gh pr view "$pr" --json headRefOid -q .headRefOid)" = "$sha" ] || { echo "head moved; not merging"; exit 1; }
  runs=$(gh run list --commit "$sha" --workflow CI --json status,conclusion -q '.[]|"\(.status) \(.conclusion)"')
  # GitHub runs no CI for a PR that conflicts with its base: say so, don't wait forever.
  # (UNKNOWN is GitHub still computing; it settles within seconds.)
  [ "$(gh pr view "$pr" --json mergeable -q .mergeable)" = CONFLICTING ] && { echo "PR #$pr conflicts with $base; rebase it first"; exit 1; }
  [ -n "$runs" ] || continue                         # not registered yet
  echo "$runs" | grep -q "completed failure\|completed cancelled" && { echo "CI failed"; exit 1; }
  echo "$runs" | grep -vq "completed success" && continue   # still running
  if [ "$mode" = "--git" ]; then
    dir=$(mktemp -d)
    git fetch -q origin main
    git worktree add -q --detach "$dir" origin/main
    (cd "$dir" && git merge -q --no-ff "$sha" -m "Merge pull request #$pr" && git push -q origin HEAD:main)
    git worktree remove --force "$dir"
  else
    gh pr merge "$pr" --merge --match-head-commit "$sha"
  fi
  exit 0
done
