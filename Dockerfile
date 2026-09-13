# syntax=docker/dockerfile:1

FROM oven/bun:1.4.2 AS bun

# Node runs Vite and the server; bun is only the package manager.
FROM node:24-slim AS base
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

FROM base AS build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM base AS deps
COPY package.json bun.lock ./
# Bun installs peers by default, which drags vite, typescript and drizzle-kit in via kit and better-auth
RUN bun install --frozen-lockfile --production --omit=peer

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    # Receipts are up to 10 MB, sent base64-encoded (~13.4 MB)
    BODY_SIZE_LIMIT=15M
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
CMD ["node", "build"]
