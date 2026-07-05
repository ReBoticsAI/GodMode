# Production image: Bridge API + static Web UI behind nginx
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/bridge/package.json apps/bridge/
COPY apps/web/package.json apps/web/
COPY packages/ packages/
RUN npm ci
COPY . .
RUN npm run build -w @godmode/web && npm run build -w @godmode/bridge

FROM node:22-alpine AS runtime
RUN apk add --no-cache nginx
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/bridge/package.json apps/bridge/
RUN npm ci --omit=dev -w @godmode/bridge
COPY --from=build /app/apps/bridge/dist apps/bridge/dist
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/http.d/default.conf
ENV NODE_ENV=production
ENV DEPLOYMENT_MODE=hub
ENV BRIDGE_HOST=127.0.0.1
ENV BRIDGE_PORT=3847
EXPOSE 80
COPY deploy/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
