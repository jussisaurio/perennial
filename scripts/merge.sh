#!/usr/bin/env bash
# Merge a PR when its required checks pass (CLAUDE.md "Before merge"), and delete its branch.
#   scripts/merge.sh <pr-number>
# It returns only when the PR is merged (exit 0) or can't merge (exit 1, with the reason).
# GitHub holds the list of required checks (the ruleset on main). The wait ends when
# those checks end, so it needs no timeout of its own.
# Works from any checkout or worktree. `gh pr merge --delete-branch` also tries
# to switch the local checkout to main, which fails when another worktree has
# main checked out, so the remote branch is deleted through the API instead.
set -euo pipefail
pr=$1

not_merged() {
  echo "PR #$pr is NOT merged: $1"
  # Turn auto-merge off again, so a later push can't merge the PR with nobody watching.
  # It fails when auto-merge is not on (GitHub turns it off itself when the PR closes or the head moves).
  gh pr merge "$pr" --disable-auto 2>/dev/null || true
  exit 1
}

# A PR stacked on another branch merges into that branch, not main (it happened to #291).
base=$(gh pr view "$pr" --json baseRefName -q .baseRefName)
[ "$base" = main ] || { echo "PR #$pr targets $base, not main; retarget it first"; exit 1; }
branch=$(gh pr view "$pr" --json headRefName -q .headRefName)

# --auto asks GitHub to merge when the required checks pass. When they have passed
# already, gh merges at once.
gh pr merge "$pr" --merge --auto

while :; do
  state=$(gh pr view "$pr" --json state -q .state)
  [ "$state" = MERGED ] && break
  [ "$state" = OPEN ] || not_merged "it is $state"
  # GitHub runs no CI for a PR that conflicts with its base, so the checks would never end.
  # (UNKNOWN is GitHub still computing; it settles within seconds.)
  [ "$(gh pr view "$pr" --json mergeable -q .mergeable)" = CONFLICTING ] && not_merged "it conflicts with $base; rebase it first"
  # This fails for a few seconds after a push, until the checks are registered: then ask again.
  checks=$(gh pr checks "$pr" --required --json name,bucket,link \
    -q '.[] | select(.bucket == "fail" or .bucket == "cancel") | "\(.name): \(.link)"') || checks=
  [ -z "$checks" ] || not_merged "a required check failed
$checks"
  # GitHub has no call that waits for a merge, so ask again every 10 s.
  sleep 10
done

# GitHub may already have deleted it (the repo's auto-delete setting); 422 then means "no such ref".
gh api -X DELETE "repos/{owner}/{repo}/git/refs/heads/$branch" 2>/dev/null || echo "branch $branch already gone"
echo "PR #$pr MERGED"
