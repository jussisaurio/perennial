# One image runs the web app and the API. Build: docker build -t perennial .
# The Railway "web" service runs the default command; the "housekeeping" cron
# service runs `bun --preload ./instrument.ts src/housekeeping.ts`; migrations run before each deploy.

FROM oven/bun:1.3.14 AS web
WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
COPY decks/ /app/decks/
# Public build-time settings (all optional).
ARG VITE_SENTRY_DSN=""
ARG VITE_POSTHOG_KEY=""
ARG VITE_POSTHOG_HOST=""
ARG VITE_TURNSTILE_SITE_KEY=""
ARG VITE_RELEASE="dev"
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY VITE_RELEASE=$VITE_RELEASE
RUN bunx vite build

FROM oven/bun:1.3.14-slim
WORKDIR /app/server
COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY server/ ./
COPY decks/ /app/decks/
COPY --from=web /app/web/dist /app/web/dist
ENV NODE_ENV=production PERENNIAL_STATIC=/app/web/dist PORT=8080
EXPOSE 8080
USER bun
CMD ["bun", "--preload", "./instrument.ts", "index.ts"]
