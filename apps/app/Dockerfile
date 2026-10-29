# Build from the repo root: docker build -f apps/app/Dockerfile .
# Not built in CI yet (no Docker on the build box).
FROM node:24-alpine AS build
WORKDIR /repo
COPY packages ./packages
COPY apps/app ./apps/app
WORKDIR /repo/apps/app
RUN npm ci && npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
ENV NGINX_ENVSUBST_FILTER="^(SERVER_URL|WORKER_SHARED_SECRET|SOLANA_RPC_URL)$"
COPY apps/app/docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY apps/app/docker/rpc-url.envsh /docker-entrypoint.d/15-rpc-url.envsh
COPY --from=build /repo/apps/app/dist /usr/share/nginx/html
EXPOSE 8080
