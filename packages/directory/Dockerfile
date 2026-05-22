# CELLO Directory Service — ECS Fargate Dockerfile (DEPLOY-002)
#
# Multi-stage build:
#   Stage 1 (build): install deps, compile TypeScript
#   Stage 2 (production): Flyway CLI + compiled dist + migrations + entrypoint
#
# Target: linux/amd64 (ECS Fargate requirement)

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
COPY packages/directory/package.json packages/directory/

# Install all dependencies (workspace mode)
RUN pnpm install --frozen-lockfile

# Copy source code for all workspace packages needed by directory
COPY packages/interfaces/ packages/interfaces/
COPY packages/protocol-types/ packages/protocol-types/
COPY packages/crypto/ packages/crypto/
COPY packages/transport/ packages/transport/
COPY packages/directory/ packages/directory/

# Build all packages in dependency order
RUN pnpm --filter @cello/interfaces run typecheck && \
    pnpm --filter @cello/protocol-types run typecheck && \
    pnpm --filter @cello/crypto run typecheck && \
    pnpm --filter @cello/transport run typecheck && \
    pnpm --filter @cello/directory run typecheck

# ─── Stage 2: Production ───────────────────────────────────────────────────
FROM --platform=linux/amd64 public.ecr.aws/docker/library/node:24-slim AS production

# Install curl (health check), Java (Flyway), build tools (native addons), awscli (Secrets Manager fetch)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl default-jre-headless python3 python3-pip make g++ unzip && \
    pip3 install --no-cache-dir awscli --break-system-packages && \
    rm -rf /var/lib/apt/lists/*

# Install Flyway CLI
ARG FLYWAY_VERSION=10.21.0
RUN curl -fsSL https://repo1.maven.org/maven2/org/flywaydb/flyway-commandline/${FLYWAY_VERSION}/flyway-commandline-${FLYWAY_VERSION}-linux-x64.tar.gz \
    | tar -xz -C /opt && \
    chmod -R a+rX /opt/flyway-${FLYWAY_VERSION} && \
    ln -s /opt/flyway-${FLYWAY_VERSION}/flyway /usr/local/bin/flyway

WORKDIR /app

# Install pnpm for production deps
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# Copy workspace structure for production install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/interfaces/package.json packages/interfaces/
COPY packages/protocol-types/package.json packages/protocol-types/
COPY packages/crypto/package.json packages/crypto/
COPY packages/transport/package.json packages/transport/
COPY packages/directory/package.json packages/directory/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy compiled dist from build stage
COPY --from=build /app/packages/interfaces/dist/ packages/interfaces/dist/
COPY --from=build /app/packages/protocol-types/dist/ packages/protocol-types/dist/
COPY --from=build /app/packages/crypto/dist/ packages/crypto/dist/
COPY --from=build /app/packages/transport/dist/ packages/transport/dist/
COPY --from=build /app/packages/directory/dist/ packages/directory/dist/

# Copy Flyway migrations
COPY packages/directory/db/migrations/ /flyway/sql/

# Copy entrypoint script
COPY packages/directory/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Non-root user for security
RUN useradd -r -s /bin/false cello
USER cello

EXPOSE 443

ENTRYPOINT ["/app/docker-entrypoint.sh"]
