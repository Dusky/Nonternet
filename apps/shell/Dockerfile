# Build context is the repo root: docker build -f apps/shell/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/shell ./apps/shell
RUN pnpm install --frozen-lockfile --filter @app/shell...
RUN pnpm --filter @app/shell build

# Static files only. Caddy (the front door) routes to this container.
FROM caddy:2-alpine
COPY deploy/caddy/Caddyfile.shell /etc/caddy/Caddyfile
COPY --from=build /repo/apps/shell/dist /srv
EXPOSE 80
