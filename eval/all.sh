#!/usr/bin/env bash
# Evaluate each candidate model in turn with mlx_lm.server.
# Usage: VENV=/path/to/venv eval/all.sh [model ...]
set -u
cd "$(dirname "$0")/.."
. "${VENV:?set VENV to a venv with mlx-lm}/bin/activate"
MODELS=("$@")
[ ${#MODELS[@]} -eq 0 ] && MODELS=(
  mlx-community/Qwen3.5-2B-MLX-4bit
  mlx-community/gemma-4-e2b-it-4bit
  mlx-community/Ministral-3-3B-Instruct-2512-4bit
  mlx-community/Qwen3.5-4B-MLX-4bit
  mlx-community/Qwen3-4B-4bit
  mlx-community/gemma-4-e4b-it-4bit
  mlx-community/Ministral-3-8B-Instruct-2512-4bit
  mlx-community/Qwen3.5-9B-MLX-4bit
)
for m in "${MODELS[@]}"; do
  name=$(basename "$m")
  OUT=${OUT_DIR:-eval/out}
  mkdir -p "$OUT"
  [ -f "$OUT/$name.json" ] && { echo "skip $name"; continue; }
  pkill -f mlx_lm.server; sleep 2
  mlx_lm.server --model "$m" --port 8080 > "$OUT/$name.server.log" 2>&1 &
  for i in $(seq 1 900); do curl -s localhost:8080/v1/models >/dev/null && break; sleep 1; done
  # Warm up (first request downloads/loads weights).
  curl -s localhost:8080/v1/chat/completions -H 'content-type: application/json' \
    -d "{\"model\":\"$m\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":5}" > /dev/null
  echo "=== $m"
  bun eval/run.ts --model "$m" --out "$OUT/$name.json" ${EVAL_ARGS:-}
done
pkill -f mlx_lm.server
echo ALL DONE
