FROM node:20-alpine AS builder

WORKDIR /repo

RUN apk add --no-cache libc6-compat curl \
  && corepack enable \
  && corepack prepare pnpm@10.29.3 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json tsconfig.base.json ./
COPY apps/command-center/package.json apps/command-center/package.json
COPY apps/command-center ./apps/command-center

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @unit-talk/command-center build

FROM node:20-alpine

WORKDIR /repo
ENV NODE_ENV=production
ENV PORT=4300
ENV NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache curl

COPY --from=builder /repo/apps/command-center/.next/standalone ./
COPY --from=builder /repo/apps/command-center/.next/static ./apps/command-center/.next/static
COPY --from=builder /repo/apps/command-center/public ./apps/command-center/public

EXPOSE 4300
CMD ["node", "apps/command-center/server.js"]
