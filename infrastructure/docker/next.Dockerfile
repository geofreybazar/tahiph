# syntax=docker/dockerfile:1.7
# Next.js app image (standalone output). One Dockerfile for dashboard, storefront and admin.
# Build from the repository root:
#   docker build -f infrastructure/docker/next.Dockerfile --build-arg APP=dashboard .
ARG NODE_IMAGE=node:24.22.1-alpine

FROM ${NODE_IMAGE} AS base
ENV TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo

FROM base AS pruner
ARG APP
RUN test -n "$APP" || (echo "APP build-arg is required (dashboard|storefront|admin)" && exit 1)
COPY . .
RUN npx --yes turbo@2.11.10 prune @tahi/${APP} --docker

FROM base AS builder
ARG APP
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY --from=pruner /repo/out/full/ .
RUN npx turbo run build --filter=@tahi/${APP}

FROM ${NODE_IMAGE} AS runner
ARG APP
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 APP=${APP}
WORKDIR /app
COPY --from=builder --chown=node:node /repo/apps/${APP}/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=builder --chown=node:node /repo/apps/${APP}/public ./apps/${APP}/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "exec node apps/${APP}/server.js"]
