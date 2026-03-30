# ---- Base ----
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps

# Copy workspace config and all package.json files for install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ui/package.json ./packages/ui/

RUN pnpm install --frozen-lockfile

# ---- Build ----
FROM deps AS build

COPY . .

# Build the server and its workspace dependencies
RUN pnpm run build --filter=@voice-claude/server...

# ---- Runner ----
FROM node:22-slim AS runner

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

ENV NODE_ENV=production
WORKDIR /app

# Copy full workspace structure from build stage
# (workspace packages export raw .ts files, so we need tsx at runtime)
COPY --from=deps /app/node_modules/ ./node_modules/
COPY --from=deps /app/apps/server/node_modules/ ./apps/server/node_modules/
COPY --from=deps /app/packages/contracts/node_modules/ ./packages/contracts/node_modules/
COPY --from=deps /app/packages/shared/node_modules/ ./packages/shared/node_modules/

# Copy package manifests for pnpm workspace resolution
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/pnpm-lock.yaml ./
COPY --from=build /app/tsconfig.json ./

# Copy built server
COPY --from=build /app/apps/server/dist/ ./apps/server/dist/
COPY --from=build /app/apps/server/package.json ./apps/server/
COPY --from=build /app/apps/server/tsconfig.json ./apps/server/

# Copy workspace packages (they export raw .ts, consumed via tsx)
COPY --from=build /app/packages/contracts/ ./packages/contracts/
COPY --from=build /app/packages/shared/ ./packages/shared/

EXPOSE 4000

# Use tsx since workspace packages export raw TypeScript
CMD ["node", "--import", "tsx", "apps/server/dist/src/index.js"]
