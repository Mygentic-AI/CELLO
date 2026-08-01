# CELLO Directory Service — ECS Fargate Dockerfile (DEPLOY-002)
#
# Multi-stage build:
#   Stage 1 (build): install deps, compile TypeScript
#   Stage 2 (production): Flyway CLI + compiled dist + migrations + entrypoint
#
# Target: linux/amd64 (ECS Fargate requirement)
# crypto/transport/protocol-types resolved from npm (REPOSPLIT-002).

# ─── Stage 1: Build ────────────────────────────────────────────────────────
FROM --platform=linux/amd64 mirror.gcr.io/library/node:24-slim AS build

WORKDIR /app

# Install build tools required for native addons (hnswlib-node, better-sqlite3)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# Copy workspace root files for pnpm workspace resolution
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
# Patched dependencies. `pnpm.patchedDependencies` in the root package.json names files under
# patches/, and WITHOUT them pnpm installs the UNPATCHED package -- an image that boots fine and
# silently loses the fix. @libp2p/autonat's dial-back closes a connection it did not open, which
# tears down anti-entropy. Verified post-build by the `force: true` assertion below.
COPY patches/ patches/
COPY packages/interfaces/package.json packages/interfaces/
COPY packages/directory/package.json packages/directory/

# Install all dependencies (workspace mode)
RUN pnpm install --frozen-lockfile

# Copy source code for workspace packages needed by directory
COPY packages/interfaces/ packages/interfaces/
COPY packages/directory/ packages/directory/

# Build all packages in dependency order (tsconfig.build.json excludes tests
# so the relay package — only needed by test files — is not required here)
RUN pnpm --filter @cello-protocol/interfaces run typecheck && \
    cd packages/directory && npx tsc --build tsconfig.build.json

# ─── Stage 2: Production ───────────────────────────────────────────────────
FROM --platform=linux/amd64 mirror.gcr.io/library/node:24-slim AS production

# Install curl (health check), Java (Flyway), build tools (native addons), awscli (Secrets Manager fetch), psql (ECS Exec operations)
#
# postgresql-client-17 from PGDG, NOT Debian's default: bookworm ships client 15, and pg_dump
# REFUSES to run against a newer server ("aborting because of server version mismatch"). Cloud SQL
# here is Postgres 17, so the default client cannot back this node up at all — and the failure is a
# nightly backup that produces nothing, on the only copy of that node's FROST shares that exists
# off the VM. Pin the major to the server major when the server major changes.
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates gnupg default-jre-headless python3 python3-pip make g++ unzip && \
    install -d /usr/share/postgresql-common/pgdg && \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc && \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends postgresql-client-17 && \
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
# Patched dependencies. `pnpm.patchedDependencies` in the root package.json names files under
# patches/, and WITHOUT them pnpm installs the UNPATCHED package -- an image that boots fine and
# silently loses the fix. @libp2p/autonat's dial-back closes a connection it did not open, which
# tears down anti-entropy. Verified post-build by the `force: true` assertion below.
COPY patches/ patches/
COPY packages/interfaces/package.json packages/interfaces/
COPY packages/directory/package.json packages/directory/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Assert the patch is actually in the shipped tree. A patch that silently fails to apply is the
# whole failure mode this guards -- the node would run, anti-entropy would fail, and nothing would
# say why. Fails the build, not production.
RUN set -eu; \
    f=$(find node_modules/.pnpm -path '*@libp2p/autonat/dist/src/autonat.js' | head -1); \
    [ -n "$f" ] || { echo 'FATAL: @libp2p/autonat not found in the production tree'; exit 1; }; \
    grep -q 'force: true' "$f" || { echo "FATAL: @libp2p/autonat is UNPATCHED at $f"; exit 1; }; \
    echo "ok: @libp2p/autonat patched at $f"

# Copy compiled dist from build stage
COPY --from=build /app/packages/interfaces/dist/ packages/interfaces/dist/
COPY --from=build /app/packages/directory/dist/ packages/directory/dist/

# Copy Flyway migrations — to both Flyway's location and the app's expected path
COPY packages/directory/db/migrations/ /flyway/sql/
COPY packages/directory/db/migrations/ /app/packages/directory/db/migrations/

# Copy entrypoint script
COPY packages/directory/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Operational scripts run by systemd units on the node (the GCP backup timer overrides the
# entrypoint to reach pg-backup-to-gcs.sh). They must SHIP, not merely exist in the repo — the
# unit references an absolute path inside the image, and a missing file there fails at 04:17 UTC
# on a node nobody is watching.
COPY packages/directory/scripts/ /app/packages/directory/scripts/
RUN chmod +x /app/packages/directory/scripts/*.sh

# Non-root user for security
RUN useradd -r -s /bin/false cello
USER cello

EXPOSE 8080

ENTRYPOINT ["/app/docker-entrypoint.sh"]
