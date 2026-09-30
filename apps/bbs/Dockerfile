# Build context is the repo root: docker build -f apps/bbs/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
# The lockfile covers every workspace package, so pnpm wants each one's manifest present.
COPY e2e/package.json ./e2e/package.json
COPY apps/bbs ./apps/bbs
RUN pnpm install --frozen-lockfile --filter @app/bbs...
RUN pnpm --filter @app/bbs build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/bbs/dist ./
RUN npm install --omit=dev --no-audit --no-fund && mkdir -p /data && chown -R node:node /app /data
USER node
ENV BBS_HOST_KEY_FILE=/data/ssh_host_ed25519_key BBS_ART_DIR=/app/art/default
EXPOSE 2323 2222 2380
CMD ["node", "main.cjs"]
