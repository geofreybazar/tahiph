# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:24-slim AS build
WORKDIR /repo
# Prisma's CLI needs OpenSSL to generate the client; the runtime stage doesn't.
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends openssl >/dev/null
RUN npm install -g npm@12.0.2
COPY . .
RUN npm ci
RUN npx turbo prune @tahi/api --docker --out-dir=/pruned
WORKDIR /app
# turbo prune keeps workspace files only, so the shared TypeScript config is copied by hand.
RUN cp -r /pruned/json/. . && cp -r /pruned/full/. . && cp /repo/tsconfig.base.json . && npm ci
RUN npx turbo run build --filter=@tahi/api
RUN npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app .
USER node
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
