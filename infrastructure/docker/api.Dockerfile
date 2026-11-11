# syntax=docker/dockerfile:1.7
# NestJS API image. The same image runs three roles (docs/DOCKER_ARCHITECTURE.md §1):
#   api     : node dist/main.js           (default CMD)
#   worker  : node dist/main.worker.js
#   migrate : npx prisma migrate deploy   (workdir /app/packages/database)
# Build from the repository root:  docker build -f infrastructure/docker/api.Dockerfile .
ARG NODE_IMAGE=node:24.22.1-alpine

FROM ${NODE_IMAGE} AS base
ENV TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN npx --yes turbo@2.11.10 prune @tahi/api --docker

FROM base AS builder
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY --from=pruner /repo/out/full/ .
RUN npx turbo run build --filter=@tahi/api \
 && npm prune --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder --chown=node:node /repo/package.json ./package.json
COPY --from=builder --chown=node:node /repo/node_modules ./node_modules
COPY --from=builder --chown=node:node /repo/packages ./packages
COPY --from=builder --chown=node:node /repo/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=node:node /repo/apps/api/dist ./apps/api/dist
USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
