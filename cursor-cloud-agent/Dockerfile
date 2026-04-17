# syntax=docker/dockerfile:1
# Production image: Next.js via bin/dev.mjs --start (see package.json "start").
# Persist data with: -v clr_data:/root/.cursor-local-remote (sessions.db + cloud-workdirs).
# Inspect DB in-container: sqlite3 /root/.cursor-local-remote/sessions.db
#
# Cursor Agent CLI: https://cursor.com/docs/cli/installation — `agent` must be on PATH (see src/lib/cursor-cli.ts).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl sqlite3 \
  && rm -rf /var/lib/apt/lists/*

# Official installer: places `agent` in ~/.local/bin (root: /root/.local/bin)
RUN curl https://cursor.com/install -fsS | bash

ENV PATH="/root/.local/bin:${PATH}"

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3100

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/.cursor ./.cursor

EXPOSE 3100

# `--log` → bin/dev.mjs sets CLR_DEV_HTTP_LOG=1 so Next logs each HTTP request (visible in docker logs).
# Diagnostics: `[cloud-agent:run]` (agent start/finish, Cursor CLI), `[cloud-agent:git]` (clone, publish, push.skip vs push.start).
# CLR_CLOUD_AGENT_LOG=0 silences both; CLR_RUN_LOG=0 or CLR_GIT_LOG=0 silences one channel.
CMD ["npm", "run", "start", "--", "-p", "3100", "--log"]
