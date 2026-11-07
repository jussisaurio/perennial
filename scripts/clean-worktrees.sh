#!/usr/bin/env bash
# Remove finished agent worktrees under .claude/worktrees.
#   scripts/clean-worktrees.sh
# Keeps a worktree when a live agent holds its lock, when it has uncommitted
# changes, or when it has commits that are not on origin/main; it lists those.
# A removed worktree's local branch is deleted only when it is merged.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git fetch -q origin main
removed=0
while read -r dir; do
  lock=$(git worktree list --porcelain | awk -v d="$dir" '$1=="worktree"{w=$2} $1=="locked" && w==d{$1=""; print}')
  pid=$(sed -n 's/.*(pid \([0-9]*\).*/\1/p' <<<"$lock")
  # The lock names the Claude session that made it. While that session lives, an
  # agent may be working there even if the tree looks clean (it just started).
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "keep (live session $pid): $dir"; continue; fi
  if [ -n "$(git -C "$dir" status --porcelain 2>/dev/null)" ]; then echo "keep (uncommitted changes): $dir"; continue; fi
  head=$(git -C "$dir" rev-parse HEAD)
  if ! git merge-base --is-ancestor "$head" origin/main; then echo "keep (commits not on main): $dir"; continue; fi
  branch=$(git -C "$dir" symbolic-ref -q --short HEAD || true)
  git worktree unlock "$dir" 2>/dev/null || true
  git worktree remove --force "$dir"
  [ -n "$branch" ] && git branch -D "$branch" >/dev/null
  removed=$((removed + 1))
done < <(git worktree list --porcelain | awk '$1=="worktree" && $2 ~ /\/\.claude\/worktrees\//{print $2}')
git worktree prune
echo "removed $removed worktrees"
