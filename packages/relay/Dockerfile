# CELLO Relay Service — ECS Fargate Dockerfile (DEPLOY-003)
#
# Multi-stage build:
#   Stage 1 (build): install deps, compile TypeScript
#   Stage 2 (production): compiled dist + node_modules
#
# Target: linux/amd64 (ECS Fargate requirement)
# The relay has no Flyway / no Java dependency — leaner than the directory image.
# crypto/transport/protocol-types resolved from npm (REPOSPLIT-002).

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
# Patched dependencies — the relay needs these as much as the directory does. @libp2p/autonat's
# dial-back RESPONDER closes a connection it did not open, and the relay is a SERVICE node so it
# keeps that responder. A client asking the relay to verify reachability therefore had its own
# relay connection torn down: `relay_connection_gone`, lost reservations, and seal leaves failing
# with `relay_stream_closed`. Without this COPY the image builds clean and installs the UNPATCHED
# package, so the assertion below fails the build rather than shipping it silently.
COPY patches/ patches/
COPY packages/interfaces/package.json packages/interfaces/
COPY packages/relay/package.json packages/relay/

# Install all dependencies (workspace mode)
RUN pnpm install --frozen-lockfile

# Copy source code for workspace packages needed by relay
COPY packages/interfaces/ packages/interfaces/
COPY packages/relay/ packages/relay/

# Build in dependency order
RUN pnpm --filter @cello-protocol/interfaces run typecheck && \
    pnpm --filter @cello-protocol/relay run typecheck

# ─── Stage 2: Production ───────────────────────────────────────────────────
FROM --platform=linux/amd64 public.ecr.aws/docker/library/node:24-slim AS production

WORKDIR /app

# Install curl (health check) + build tools for native addon compilation
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm for production deps
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# Copy workspace structure for production install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# Patched dependencies — the relay needs these as much as the directory does. @libp2p/autonat's
# dial-back RESPONDER closes a connection it did not open, and the relay is a SERVICE node so it
# keeps that responder. A client asking the relay to verify reachability therefore had its own
# relay connection torn down: `relay_connection_gone`, lost reservations, and seal leaves failing
# with `relay_stream_closed`. Without this COPY the image builds clean and installs the UNPATCHED
# package, so the assertion below fails the build rather than shipping it silently.
COPY patches/ patches/
COPY packages/interfaces/package.json packages/interfaces/
COPY packages/relay/package.json packages/relay/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

RUN set -eu; \
    f=$(find node_modules/.pnpm -path '*@libp2p/autonat/dist/src/autonat.js' | head -1); \
    [ -n "$f" ] || { echo 'FATAL: @libp2p/autonat not found in the production tree'; exit 1; }; \
    grep -q 'force: true' "$f" || { echo "FATAL: @libp2p/autonat is UNPATCHED at $f"; exit 1; }; \
    echo "ok: @libp2p/autonat patched at $f"

# Copy compiled dist from build stage
COPY --from=build /app/packages/interfaces/dist/ packages/interfaces/dist/
COPY --from=build /app/packages/relay/dist/ packages/relay/dist/

# Non-root user for security
RUN useradd -r -s /bin/false cello
USER cello

# Port 4001: libp2p relay protocol (agents connect here via the VPC)
# Port 4000: health check HTTP endpoint (VPC-internal only, directory pings GET /health)
EXPOSE 4001
EXPOSE 4000

CMD ["node", "/app/packages/relay/dist/bin/relay.js"]
