# syntax=docker/dockerfile:1
# Multi-stage monorepo build for Unit Talk V2 pipeline services.
# Targets: api | worker | ingestor | discord-bot
# Build: docker build --target <service> -t unit-talk/<service> .

# ── Stage 1: builder ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

# Layer-cache package manifests separately from source
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.json tsconfig.base.json ./
COPY packages/alert-runtime/package.json packages/alert-runtime/
COPY packages/config/package.json            packages/config/
COPY packages/contracts/package.json         packages/contracts/
COPY packages/db/package.json                packages/db/
COPY packages/domain/package.json            packages/domain/
COPY packages/events/package.json            packages/events/
COPY packages/intelligence/package.json      packages/intelligence/
COPY packages/observability/package.json     packages/observability/
COPY packages/verification/package.json      packages/verification/
COPY apps/api/package.json                   apps/api/
COPY apps/worker/package.json                apps/worker/
COPY apps/ingestor/package.json              apps/ingestor/
COPY apps/discord-bot/package.json           apps/discord-bot/

RUN pnpm install --frozen-lockfile

# Copy source and build everything
COPY packages/ packages/
COPY apps/api/    apps/api/
COPY apps/worker/ apps/worker/
COPY apps/ingestor/ apps/ingestor/
COPY apps/discord-bot/ apps/discord-bot/
COPY .env.example ./

RUN pnpm build

# ── Stage 2: api ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS api
WORKDIR /repo

COPY --from=builder /repo/node_modules           ./node_modules
COPY --from=builder /repo/packages               ./packages
COPY --from=builder /repo/apps/api               ./apps/api
COPY --from=builder /repo/.env.example           ./.env.example
COPY --from=builder /repo/package.json           ./package.json

# Workspace symlinks in apps/api/node_modules point into /repo/packages (set
# by pnpm at install time inside the container), so packages/ must travel with.

ENV NODE_ENV=production
EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "apps/api/dist/index.js"]

# ── Stage 3: worker ───────────────────────────────────────────────────────────
FROM node:22-alpine AS worker
WORKDIR /repo

COPY --from=builder /repo/node_modules           ./node_modules
COPY --from=builder /repo/packages               ./packages
COPY --from=builder /repo/apps/worker            ./apps/worker
COPY --from=builder /repo/.env.example           ./.env.example
COPY --from=builder /repo/package.json           ./package.json

ENV NODE_ENV=production

CMD ["node", "apps/worker/dist/index.js"]

# ── Stage 4: ingestor ─────────────────────────────────────────────────────────
FROM node:22-alpine AS ingestor
WORKDIR /repo

COPY --from=builder /repo/node_modules           ./node_modules
COPY --from=builder /repo/packages               ./packages
COPY --from=builder /repo/apps/ingestor          ./apps/ingestor
COPY --from=builder /repo/.env.example           ./.env.example
COPY --from=builder /repo/package.json           ./package.json

ENV NODE_ENV=production

CMD ["node", "apps/ingestor/dist/index.js"]

# ── Stage 5: discord-bot ──────────────────────────────────────────────────────
FROM node:22-alpine AS discord-bot
WORKDIR /repo

COPY --from=builder /repo/node_modules           ./node_modules
COPY --from=builder /repo/packages               ./packages
COPY --from=builder /repo/apps/discord-bot       ./apps/discord-bot
COPY --from=builder /repo/.env.example           ./.env.example
COPY --from=builder /repo/package.json           ./package.json

ENV NODE_ENV=production

CMD ["node", "apps/discord-bot/dist/index.js"]
