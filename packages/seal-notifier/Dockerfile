# ─── Seal-alert notifier Dockerfile ──────────────────────────────────────────
#
# Pub/Sub push → Telegram. The last link in the chain that ends "nothing watches anything".
#
# Build context is the MONOREPO ROOT, like the other services here, because pnpm workspace
# resolution needs the root lockfile:
#   docker build -f packages/seal-notifier/Dockerfile -t seal-notifier:local .
#
# BASE VIA mirror.gcr.io, not public.ecr.aws — Google's pull-through cache. Cloud Build pulling
# AWS's public registry started returning `toomanyrequests` and failed two builds in a row; the
# directory, relay and ops-agent Dockerfiles were all changed for the same reason.
FROM mirror.gcr.io/library/node:24-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages/seal-notifier/package.json ./packages/seal-notifier/
COPY packages/interfaces/package.json ./packages/interfaces/
RUN pnpm install --frozen-lockfile --filter @cello-protocol/seal-notifier...

COPY packages/seal-notifier ./packages/seal-notifier
COPY packages/interfaces ./packages/interfaces
RUN pnpm --filter @cello-protocol/seal-notifier run build

# ─── Runtime ─────────────────────────────────────────────────────────────────
FROM mirror.gcr.io/library/node:24-slim
WORKDIR /app
# NON-ROOT. This service holds a bot token in its environment; running it as root buys nothing and
# widens what a compromise reaches.
RUN useradd --create-home --shell /usr/sbin/nologin cello
COPY --from=build --chown=cello:cello /app/packages/seal-notifier/dist ./dist
USER cello
# No node_modules copied on purpose: this service has ZERO runtime dependencies — it uses only
# node:http and the built-in fetch. Verify with `pnpm why` before adding one; a dependency here is
# a dependency on the alerting path, which must not be able to fail for a reason of its own.
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/index.js"]
