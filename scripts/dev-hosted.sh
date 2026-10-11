#!/usr/bin/env bash
# Run Perennial locally in hosted mode with everything mocked:
#   - mock LLM (OpenAI + Anthropic formats)       :8788
#   - stripe-mock (Stripe's official API mock)    :12111  (needs Docker)
#   - Perennial server (dev outbox for email)     :8787
#   - Vite dev server                             :5173
# Ctrl-C stops everything.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
DB=${PERENNIAL_DB:-/tmp/perennial-dev.db}

# Refuse to half-start next to an old instance (it would keep serving, maybe
# with a deleted database).
for port in 8787 8788 5173 12111; do
  if lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Stop the other process first:"
    echo "  lsof -ti tcp:$port -sTCP:LISTEN | xargs kill"
    exit 1
  fi
done

pids=()
cleanup() {
  kill "${pids[@]}" 2>/dev/null || true
  docker rm -f perennial-stripe-mock >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

(cd server && PORT=8788 bun mock-llm.ts) & pids+=($!)

if docker info >/dev/null 2>&1; then
  docker rm -f perennial-stripe-mock >/dev/null 2>&1 || true
  docker run -d --rm --name perennial-stripe-mock -p 12111:12111 stripe/stripe-mock:latest >/dev/null
  STRIPE_ENV="STRIPE_SECRET_KEY=sk_test_local STRIPE_WEBHOOK_SECRET=whsec_local STRIPE_PRICE_MONTHLY=price_monthly STRIPE_PRICE_YEARLY=price_yearly STRIPE_HOST=localhost STRIPE_PORT=12111 STRIPE_PROTOCOL=http"
else
  echo "Docker is not running: billing is off (everything else works)."
  STRIPE_ENV=""
fi

(cd server && env PORT=8787 PERENNIAL_DB="$DB" PERENNIAL_DEV=1 APP_URL=http://localhost:5173 \
  ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:8788 \
  FREE_CREDITS="${FREE_CREDITS:-25}" $STRIPE_ENV bun index.ts) & pids+=($!)

(cd web && bunx vite --port 5173 --strictPort) & pids+=($!)

sleep 2
cat <<MSG

  Perennial (hosted, mocked) → http://localhost:5173

  Sign-in codes are printed above as "[mail] …" lines.
  To make an account Pro after clicking Upgrade:
    bun server/scripts/simulate-subscription.ts you@example.com active
  Database: $DB  (delete it to start over)

MSG
wait
