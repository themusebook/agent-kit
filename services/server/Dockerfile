# Build from the repo root: docker build -f services/server/Dockerfile .
# Untested in this repo's CI (no Docker on the build box yet).
FROM oven/bun:1.4.3-alpine
WORKDIR /app/services
COPY services/tsconfig.base.json ./
COPY services/toolkit ./toolkit
COPY services/server ./server
WORKDIR /app/services/server
RUN bun install --frozen-lockfile --production
CMD ["bun", "src/index.ts"]
