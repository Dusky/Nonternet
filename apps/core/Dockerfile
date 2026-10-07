# Build context is the repo root: docker build -f apps/core/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
# The lockfile covers every workspace package, so pnpm wants each one's manifest present.
COPY e2e/package.json ./e2e/package.json
COPY apps/core ./apps/core
# The app packages people can add (docs/10), built here and served by the homes server from APPS_DIR.
COPY packs ./packs
# "./packs/apps/*..." is not enough: a directory glob with "..." installs the packs but skips
# their workspace dependencies' own deps (pnpm 10), so penpal never landed and the build failed.
# A name glob with "..." does include the dependency closure, and the plain glob catches any
# pack that does not use the @app/pack-* name.
RUN pnpm install --frozen-lockfile --filter @app/core... --filter "./packs/apps/*" --filter "@app/pack-*..."
RUN pnpm --filter @app/core build && pnpm --filter "./packs/apps/*" build

FROM node:22-alpine
ENV NODE_ENV=production
# pg_dump and tar are used by the operator's backup and restore-test commands.
RUN apk add --no-cache postgresql16-client tar
WORKDIR /app
COPY --from=build /repo/apps/core/dist ./
COPY --from=build /repo/packs/build ./apps
ENV APPS_DIR=/app/apps
# Native modules (argon2, sharp) are installed here, not bundled.
RUN npm install --omit=dev --no-audit --no-fund && chown -R node:node /app
# Homepage files live here; a named volume mounted on it starts with these permissions.
# Every named volume mounted under /data must exist here, or it mounts root-owned and the container
# (USER node) cannot write to it: gemini-data (its TLS key, EACCES key.pem on first boot) and
# files-data (uploads, avatars, wallpapers, ring banners, which fail on the first write).
RUN mkdir -p /data/homes /data/files /data/gemini && chown -R node:node /data
USER node
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "main.cjs"]
