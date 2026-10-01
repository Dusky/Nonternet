# Build context is the repo root: docker build -f apps/core/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
# The lockfile covers every workspace package, so pnpm wants each one's manifest present.
COPY e2e/package.json ./e2e/package.json
COPY apps/core ./apps/core
RUN pnpm install --frozen-lockfile --filter @app/core...
RUN pnpm --filter @app/core build

FROM node:22-alpine
ENV NODE_ENV=production
# pg_dump and tar are used by the operator's backup and restore-test commands.
RUN apk add --no-cache postgresql16-client tar
WORKDIR /app
COPY --from=build /repo/apps/core/dist ./
# Native modules (argon2, sharp) are installed here, not bundled.
RUN npm install --omit=dev --no-audit --no-fund && chown -R node:node /app
# Homepage files live here; a named volume mounted on it starts with these permissions.
RUN mkdir -p /data/homes && chown -R node:node /data
USER node
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "main.cjs"]
