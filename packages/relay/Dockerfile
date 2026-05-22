# CELLO Relay Service — ECS Fargate Dockerfile (DEPLOY-003)
#
# Multi-stage build:
#   Stage 1 (build): install deps, compile TypeScript
#   Stage 2 (production): compiled dist + node_modules
#
# Target: linux/amd64 (ECS Fargate requirement)
# The relay has no Flyway / no Java dependency — leaner than the directory image.

# ─── Stage 1: Build ────────────────────────────────────────────────────────
FROM --platform=linux/amd64 public.ecr.aws/docker/library/node:24-slim AS build

WORKDIR /app

# Install build tools required for native addons (hnswlib-node, better-sqlite3)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# Copy workspace root files for pnpm workspace resolution
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages/interfaces/package.json packages/interfaces/
COPY packages/protocol-types/package.json packages/protocol-types/
COPY packages/crypto/package.json packages/crypto/
COPY packages/transport/package.json packages/transport/
COPY packages/relay/package.json packages/relay/

# Install all dependencies (workspace mode)
RUN pnpm install --frozen-lockfile

# Copy source code for all workspace packages needed by relay
COPY packages/interfaces/ packages/interfaces/
COPY packages/protocol-types/ packages/protocol-types/
COPY packages/crypto/ packages/crypto/
COPY packages/transport/ packages/transport/
COPY packages/relay/ packages/relay/

# Build all packages in dependency order
RUN pnpm --filter @cello/interfaces run typecheck && \
    pnpm --filter @cello/protocol-types run typecheck && \
    pnpm --filter @cello/crypto run typecheck && \
    pnpm --filter @cello/transport run typecheck && \
    pnpm --filter @cello/relay run typecheck

# ─── Stage 2: Production ───────────────────────────────────────────────────
FROM --platform=linux/amd64 public.ecr.aws/docker/library/node:24-slim AS production

WORKDIR /app

# Install build tools for native addon compilation in production install
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm for production deps
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# Copy workspace structure for production install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/interfaces/package.json packages/interfaces/
COPY packages/protocol-types/package.json packages/protocol-types/
COPY packages/crypto/package.json packages/crypto/
COPY packages/transport/package.json packages/transport/
COPY packages/relay/package.json packages/relay/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy compiled dist from build stage
COPY --from=build /app/packages/interfaces/dist/ packages/interfaces/dist/
COPY --from=build /app/packages/protocol-types/dist/ packages/protocol-types/dist/
COPY --from=build /app/packages/crypto/dist/ packages/crypto/dist/
COPY --from=build /app/packages/transport/dist/ packages/transport/dist/
COPY --from=build /app/packages/relay/dist/ packages/relay/dist/

# Non-root user for security
RUN useradd -r -s /bin/false cello
USER cello

# Port 4001: libp2p relay protocol (agents connect here via the VPC)
# Port 4000: health check HTTP endpoint (VPC-internal only, directory pings GET /health)
EXPOSE 4001
EXPOSE 4000

CMD ["node", "/app/packages/relay/dist/bin/relay.js"]
