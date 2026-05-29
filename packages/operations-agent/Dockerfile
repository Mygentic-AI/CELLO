# ─── Operations Agent Dockerfile ─────────────────────────────────────────────
#
# AC-006 / SI-001: Multi-stage build, Node 24-slim, non-root user cello.
# Production stage contains only: compiled dist/, node_modules (production only).
#
# SI-001: @cello-protocol/crypto key generation and FROST modules are NOT in the
# dependency graph of @cello-protocol/operations-agent. The operations-agent is a
# registration bot — it does not participate in FROST DKG or Ed25519 signing.
# Verify: pnpm why @cello-protocol/crypto from packages/operations-agent → not found.
#
# Build context: MONOREPO ROOT (required for pnpm workspace dependency resolution).
# docker build --platform linux/amd64 -t cello-operations-agent:local \
#   -f packages/operations-agent/Dockerfile .
#
# The monorepo root must be the build context because pnpm workspace packages
# (@cello-protocol/interfaces) are resolved from the workspace root's node_modules.

# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM public.ecr.aws/docker/library/node:24-slim AS build

WORKDIR /app

# Install build tools for native deps (hnswlib-node) and pnpm
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ make python3 && \
    rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10.33.2

# Copy workspace manifests and lockfile first (Docker layer cache)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy all package.json files for workspace dependency resolution
# This ensures pnpm can resolve workspace: protocol references
COPY packages/interfaces/package.json ./packages/interfaces/
COPY packages/protocol-types/package.json ./packages/protocol-types/
COPY packages/operations-agent/package.json ./packages/operations-agent/

# Install all dependencies (includes devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source files for packages that operations-agent depends on
COPY packages/protocol-types/src ./packages/protocol-types/src
COPY packages/protocol-types/tsconfig.json ./packages/protocol-types/
COPY packages/interfaces/src ./packages/interfaces/src
COPY packages/interfaces/tsconfig.json ./packages/interfaces/
COPY packages/operations-agent/src ./packages/operations-agent/src
COPY packages/operations-agent/tsconfig.json ./packages/operations-agent/
COPY tsconfig.base.json ./

# Build interfaces (dependency) — must emit dist/ not just typecheck
RUN pnpm --filter @cello-protocol/interfaces run build

# Build operations-agent — emits dist/ for the production stage to copy
RUN pnpm --filter @cello-protocol/operations-agent run build

# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM public.ecr.aws/docker/library/node:24-slim AS production

# AC-006: runs as non-root user cello
RUN groupadd --gid 1001 cello && \
    useradd --uid 1001 --gid cello --shell /bin/sh --create-home cello

WORKDIR /app

# Install pnpm for production install
RUN npm install -g pnpm@10.33.2

# Copy workspace manifests for production install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/interfaces/package.json ./packages/interfaces/
COPY packages/protocol-types/package.json ./packages/protocol-types/
COPY packages/operations-agent/package.json ./packages/operations-agent/

# AC-006: install production dependencies ONLY
RUN pnpm install --frozen-lockfile --prod

# Copy compiled output from build stage
COPY --from=build /app/packages/interfaces/dist ./packages/interfaces/dist
COPY --from=build /app/packages/protocol-types/dist ./packages/protocol-types/dist
COPY --from=build /app/packages/operations-agent/dist ./packages/operations-agent/dist

# AC-006: switch to non-root user before running
USER cello

# Health check endpoint on port 8080
EXPOSE 8080

# Run the composition root
CMD ["node", "packages/operations-agent/dist/server.js"]
