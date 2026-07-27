# Production image: Bridge API + static Web UI behind nginx
# glibc base (bookworm) so duckdb / better-sqlite3 native addons load.
# Alpine (musl) breaks glibc prebuilds (ld-linux-x86-64.so.2 missing).
FROM node:22-bookworm-slim AS build
WORKDIR /app
# node-pty (and occasional native rebuilds) need a toolchain; duckdb/better-sqlite3
# usually use glibc prebuilds on bookworm.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/bridge/package.json apps/bridge/
COPY apps/web/package.json apps/web/
COPY packages/ packages/
RUN npm ci
COPY . .
RUN npm run build:packages && npm run build -w @godmode/web && npm run build -w @godmode/bridge \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ARG GODMODE_VERSION=0.1.0
ARG GODMODE_COMMIT=unknown
RUN apt-get update \
  && apt-get install -y --no-install-recommends nginx bubblewrap \
  && rm -rf /var/lib/apt/lists/* \
  && rm -f /etc/nginx/sites-enabled/default
WORKDIR /app
# Reuse the production dependency tree from the build stage so multi-arch
# builds never recompile native modules under QEMU.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/bridge/package.json apps/bridge/
COPY --from=build /app/packages packages/
COPY --from=build /app/apps/bridge/dist apps/bridge/dist
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
ENV NODE_ENV=production
ENV GODMODE_VERSION=${GODMODE_VERSION}
ENV GODMODE_COMMIT=${GODMODE_COMMIT}
ENV DEPLOYMENT_MODE=hub
ENV BRIDGE_HOST=127.0.0.1
ENV BRIDGE_PORT=3847
EXPOSE 80
COPY deploy/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
