#!/usr/bin/env bash
# Make an agent's worktree on a new branch from an up-to-date origin/main, install
# its packages, and make its scratch folder. Prints both paths.
#   scripts/agent-worktree.sh <name>
# Agents make their own worktree, instead of being started with `isolation: worktree`,
# because that isolation's shell check refuses heredocs, `$(...)`, loops and git
# chains, and can't be turned off (#982).
set -euo pipefail
name=$1
# The name is the branch, the folder and part of the e2e database's name
# (web/e2e/worktree.ts): a slash would nest folders, and "a_b" and "a-b" would share a database.
[[ $name =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "the name takes lowercase letters, digits and dashes: $name" >&2; exit 1; }
# The owner's checkout, also when this runs from inside another worktree.
root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
# Under .claude/worktrees/ (gitignored), the worktree's name gives e2e runs their own
# ports and database (web/e2e/worktree.ts), as for the worktrees Claude Code makes.
dir=$root/.claude/worktrees/$name
git -C "$root" fetch -q origin main
start=$(git -C "$root" rev-parse origin/main)
# --no-track: an upstream is written to .git/config, which parallel agents then fight
# over ("could not lock config file", #656). The lock names the Claude session and the
# start commit, so scripts/clean-worktrees.sh keeps the worktree while it may be in use.
git -C "$root" worktree add -q --no-track --lock --reason "agent from $start (pid ${CLAUDE_PID:?run this from a Claude Code session})" -b "$name" "$dir" "$start"
# The root install covers every workspace (web, server, contract, scripts). Its output
# goes to stderr, so stdout has only the paths.
(cd "$dir" && bun install >&2)
# In the owner's checkout, not the worktree, so it stays after the worktree is removed.
scratch=$root/.scratch/$name
mkdir -p "$scratch"
echo "worktree: $dir"
echo "scratch:  $scratch"
