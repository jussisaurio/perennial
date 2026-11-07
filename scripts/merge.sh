#!/usr/bin/env bash
# Merge a PR now, without waiting for CI (CLAUDE.md "Before merge"), and delete its branch.
#   scripts/merge.sh <pr-number>
# Works from any checkout or worktree. `gh pr merge --delete-branch` also tries
# to switch the local checkout to main, which fails when another worktree has
# main checked out, so the remote branch is deleted through the API instead.
set -euo pipefail
pr=$1
branch=$(gh pr view "$pr" --json headRefName -q .headRefName)
gh pr merge "$pr" --merge
state=$(gh pr view "$pr" --json state -q .state)
[ "$state" = MERGED ] || { echo "PR #$pr is $state, not MERGED"; exit 1; }
# GitHub may already have deleted it (the repo's auto-delete setting); 422 then means "no such ref".
gh api -X DELETE "repos/{owner}/{repo}/git/refs/heads/$branch" 2>/dev/null || echo "branch $branch already gone"
echo "PR #$pr MERGED"
