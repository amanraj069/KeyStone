# syntax=docker/dockerfile:1
#
# Keystone API image (also the worker: same image, command `node dist/worker.js`).
# Build from the repo root:  docker build -f apps/api/Dockerfile .
#
# Node 22 (not 20): the root package.json requires node >= 22 and pnpm refuses to
# install a project whose `engines` do not match; Node 20 is also past end-of-life.

ARG NODE_VERSION=22

# ---------------------------------------------------------------- base: Node + pnpm
FROM node:${NODE_VERSION}-slim AS base
# The exact pnpm the lockfile was made with (package.json "packageManager").
RUN npm install --global pnpm@10.33.0 && npm cache clean --force
WORKDIR /repo

# ---------------------------------------------------------------- build: compile shared + api
FROM base AS build
# Manifests first, so the dependency layer is cached until a package.json or the lockfile changes.
# apps/web/package.json is only there so the lockfile matches the workspace; web is not built here.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @keystone/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
# build:docker emits the same JavaScript as `nest build` but skips type checking, which
# needs ~530 MB of heap (openai, aws-sdk, MCP types) and dies on a 1 GB instance.
# Type errors are caught on the laptop instead: scripts/deploy.sh runs `typecheck` first.
# build:docker peaks around 400 MB of heap; the cap stops it from growing past that.
RUN pnpm --filter @keystone/shared build && \
    NODE_OPTIONS=--max-old-space-size=512 pnpm --filter @keystone/api build:docker

# ---------------------------------------------------------------- prod-deps: runtime node_modules only
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod --filter @keystone/api... --config.ignore-scripts=true

# ---------------------------------------------------------------- runtime
FROM base AS runtime
ENV NODE_ENV=production
# The workspace layout is kept (/repo/apps/api), so findRepoRoot() finds /repo,
# DATA_DIR=./data means /repo/data (mounted from the host) and `pnpm seed` works.
COPY --from=prod-deps /repo/package.json /repo/pnpm-workspace.yaml ./
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/apps/api/dist ./apps/api/dist
# The published benchmark results (tracked by git): GET /bench/results serves them, so a new run
# reaches the site with a commit and a deploy, no upload of the data folder.
COPY apps/api/bench-results ./apps/api/bench-results
# The data folder belongs to the non-root `node` user (uid 1000, like `ubuntu` on the EC2 host).
RUN mkdir -p /repo/data && chown node:node /repo/data
USER node
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["node", "dist/main.js"]
