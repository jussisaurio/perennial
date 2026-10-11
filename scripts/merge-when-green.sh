#!/usr/bin/env bash
# Merge a PR once every CI job on its current head commit has passed.
#   scripts/merge-when-green.sh <pr-number>
# Exits non-zero (without merging) on any failure, or if the head moves.
set -euo pipefail
pr=$1
sha=$(gh pr view "$pr" --json headRefOid -q .headRefOid)
while :; do
  sleep 30
  [ "$(gh pr view "$pr" --json headRefOid -q .headRefOid)" = "$sha" ] || { echo "head moved; not merging"; exit 1; }
  runs=$(gh run list --commit "$sha" --workflow CI --json status,conclusion -q '.[]|"\(.status) \(.conclusion)"')
  [ -n "$runs" ] || continue                         # not registered yet
  echo "$runs" | grep -q "completed failure\|completed cancelled" && { echo "CI failed"; exit 1; }
  echo "$runs" | grep -vq "completed success" && continue   # still running
  gh pr merge "$pr" --merge --match-head-commit "$sha"
  exit 0
done
