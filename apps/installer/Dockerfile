# The installer (docs/19). Build context is the repo root; sitectl builds and runs it:
#   docker build -f apps/installer/Dockerfile -t site-installer .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY e2e/package.json ./e2e/package.json
COPY apps/installer ./apps/installer
RUN pnpm install --frozen-lockfile --filter @app/installer...
RUN pnpm --filter @app/installer build

FROM node:22-alpine
WORKDIR /installer
COPY --from=build /repo/apps/installer/dist/install.mjs ./install.mjs
# sitectl runs it as the host user, with the deploy folder at /deploy and the host's network.
ENTRYPOINT ["node", "/installer/install.mjs"]
