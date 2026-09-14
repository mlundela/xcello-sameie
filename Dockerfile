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
    # Receipts are up to 10 MB; the upload form sends the raw bytes
    BODY_SIZE_LIMIT=11M
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
# The migrations themselves: the .sql files plus meta/_journal.json. The
# migrator that reads them lives in drizzle-orm, already present in
# node_modules above -- drizzle-kit is NOT needed at runtime and stays a
# devDependency. Without this COPY the app starts against whatever schema
# happens to exist, which is how it once served 200s on / with no tables.
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
CMD ["node", "build"]
