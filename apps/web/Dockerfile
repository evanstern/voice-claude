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

# Build the web app and all its workspace dependencies
RUN pnpm run build --filter=@voice-claude/web...

# ---- Runner ----
FROM node:22-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

# Copy the built web app (server + client bundles)
COPY --from=build /app/apps/web/build/ ./build/

# Copy production node_modules needed at runtime
# React Router SSR needs its runtime dependencies
COPY --from=deps /app/node_modules/ ./node_modules/
COPY --from=deps /app/apps/web/node_modules/ ./apps/web/node_modules/

# Copy package.json for module resolution
COPY --from=build /app/apps/web/package.json ./

EXPOSE 3000

CMD ["node", "build/server/index.js"]
