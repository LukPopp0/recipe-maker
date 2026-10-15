# syntax=docker/dockerfile:1

# Must equal the "playwright" version installed in server/ so the bundled
# Chromium matches the library (see docs/self-hosting.md).
ARG PLAYWRIGHT_VERSION=1.61.1

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# better-sqlite3's install script always runs node-gyp, which needs make even
# when the bundled prebuild is used and nothing is compiled.
RUN apt-get update && apt-get install -y --no-install-recommends make \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# Build stage: full install, generate the ingredient manifest, build the web app.
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter shared run generate:manifest && pnpm --filter web run build

# Runtime stage: production dependencies for the server and shared only.
FROM base AS runtime
ENV NODE_ENV=production
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY server/package.json server/
COPY shared/package.json shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter server...
COPY --from=build /app/shared/src shared/src
COPY --from=build /app/shared/assets shared/assets
COPY --from=build /app/server/src server/src
COPY --from=build /app/server/assets server/assets
COPY --from=build /app/server/tsconfig.json server/
COPY --from=build /app/apps/web/dist apps/web/dist

# pnpm --ignore-scripts skips native builds; rebuild the two native modules.
RUN pnpm --filter server rebuild better-sqlite3 sharp

RUN mkdir -p /app/data/db /app/data/images && chown -R pwuser:pwuser /app/data
USER pwuser

ENV PORT=8787 \
    RECIPE_STORE=sqlite \
    RECIPE_DB_PATH=/app/data/db/recipes.db \
    IMAGE_DATA_DIR=/app/data/images \
    INGREDIENT_ASSET_DIR=/app/shared/assets/ingredients \
    WEB_DIST_DIR=/app/apps/web/dist
EXPOSE 8787
VOLUME ["/app/data/db", "/app/data/images"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

WORKDIR /app/server
CMD ["node", "--import", "tsx", "src/index.ts"]
