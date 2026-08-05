# syntax=docker/dockerfile:1

# Node 24+ is required: the app stores data through the built-in `node:sqlite`
# module, so the image needs no C toolchain and no native rebuild step.
ARG NODE_VERSION=24-alpine

# The release this image was built from, reported at /api/version so the
# dashboard can tell a stale browser tab from a stale deployment.
ARG APP_VERSION=dev

# ---------- build ----------
FROM node:${NODE_VERSION} AS build
WORKDIR /app

# Copy manifests first so dependency layers cache across source-only changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN npm run build

# ---------- production dependencies ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts

# ---------- runtime ----------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION} \
    NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/data/dashboard.db \
    TZ=America/Detroit

RUN apk add --no-cache tzdata tini

COPY --from=deps  /app/node_modules            ./node_modules
COPY --from=build /app/package.json            ./package.json
COPY --from=build /app/packages/shared/dist    ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/apps/api/dist           ./apps/api/dist
COPY --from=build /app/apps/api/package.json   ./apps/api/package.json
COPY --from=build /app/apps/web/dist           ./apps/web/dist

# SQLite lives on a volume so the container stays disposable.
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/index.js"]
