# One image runs the web app and the API. Build: docker build -t perennial .
# The Railway "web" service runs the default command; the "housekeeping" cron
# service runs `bun --preload ./instrument.ts src/housekeeping.ts`; migrations run before each deploy.

# Bun workspaces: one lockfile at the root. Each stage copies every workspace's
# package.json (the lockfile names them all) and installs only what it needs.
FROM oven/bun:1.3.14 AS web
WORKDIR /app
COPY package.json bun.lock ./
COPY contract/package.json contract/
COPY web/package.json web/
COPY server/package.json server/
COPY scripts/package.json scripts/
RUN bun install --frozen-lockfile --filter perennial-web
# The wire contract: the app imports it from source too.
COPY contract/ contract/
COPY web/ web/
WORKDIR /app/web
COPY decks/ /app/decks/
# Public build-time settings (all optional).
ARG VITE_SENTRY_DSN=""
ARG VITE_POSTHOG_KEY=""
ARG VITE_POSTHOG_HOST=""
ARG VITE_TURNSTILE_SITE_KEY=""
# The commit this app was built from (Railway provides it), compared with the
# server's release so open tabs learn about a new deploy (web/src/data/server.ts).
# Source-map upload to Sentry during the build (optional; build stage only, so
# the token never reaches the final image).
ARG SENTRY_AUTH_TOKEN=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
ARG RAILWAY_GIT_COMMIT_SHA="dev"
ARG VITE_RELEASE="${RAILWAY_GIT_COMMIT_SHA}"
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY VITE_RELEASE=$VITE_RELEASE
RUN bunx vite build

FROM oven/bun:1.3.14-slim
WORKDIR /app
COPY package.json bun.lock ./
COPY contract/package.json contract/
COPY web/package.json web/
COPY server/package.json server/
COPY scripts/package.json scripts/
RUN bun install --frozen-lockfile --production --filter perennial-server
# The wire contract: the server imports it from source.
COPY contract/ contract/
COPY server/ server/
WORKDIR /app/server
COPY decks/ /app/decks/
COPY --from=web /app/web/dist /app/web/dist
ENV NODE_ENV=production PERENNIAL_STATIC=/app/web/dist PORT=8080
EXPOSE 8080
USER bun
CMD ["bun", "--preload", "./instrument.ts", "index.ts"]
