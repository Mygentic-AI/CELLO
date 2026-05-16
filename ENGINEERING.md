# ENGINEERING

How we build CELLO. Read this, `CONTEXT.md`, and `.claude/CLAUDE.md` — in that order — and you'll understand the project before touching a line of code.

---

## What This Project Is

CELLO is a peer-to-peer identity and trust layer for agent-to-agent communication. It handles split-key signing, tamper-evident conversation records, and prompt-injection defense without requiring a trusted central platform.

The full glossary of terms — what everything is called and what the boundaries are — lives in `CONTEXT.md`. Use those terms exactly.

---

## How Development Works

### The Rule: SPARC Every Story

Every piece of work starts from a user story YAML in `docs/planning/user-stories/`. The development process is non-negotiable:

1. **Specification** — read the story fully before writing anything
2. **Pseudocode** — write the algorithm before writing code; crypto must cite the RFC
3. **Architecture** — define TypeScript interfaces and confirm package boundaries
4. **Refinement** — write all tests first (red), then implement (green); no mocks for crypto
5. **Completion gate** — `pnpm run test` → `pnpm run lint` → `pnpm run typecheck` → build → code review → commit with story ID

The stories are in `docs/planning/` which is an Obsidian vault. Milestone outlines live in `docs/planning/user-stories/m{n}/outline.md` — read the outline before reading any story in that milestone.

---

## Environments

Three tiers. Two active today:

| Tier | Infrastructure | When to use |
|------|---------------|-------------|
| `local` | Docker Compose (Postgres), all local stubs, no AWS | Default for all development and unit/integration tests |
| `dev` | Real AWS (us-east-1), real KMS, isolated from production data | Testing the AWS seam — IAM, KMS, RDS, S3 |
| `staging` / `production` | 3-region federation (M5+) | Not yet active |

`CELLO_ENV` drives adapter selection in the composition root. The app fails at startup with a clear error if any required configuration is missing — it never starts silently misconfigured.

### Running Locally

```bash
# Start the database
docker compose up -d

# Apply migrations (PostgreSQL)
pnpm run db:migrate

# Run unit tests (no Docker required)
pnpm run test

# Run integration tests (Docker required)
pnpm run test:integration
```

Unit tests use `InMemoryDirectoryStore` — no Postgres needed. Integration tests use `PgDirectoryStore` against the Docker container. The distinction is enforced: unit tests must pass without Docker running.

### Testing Against `dev` (AWS)

The `dev` environment is the designated place to test behaviors that can't be emulated locally: real IAM policy evaluation, real KMS, real RDS failover. Code changes deploy in ~30 seconds via `lambda update-function-code` or `ecs update-service` — not a full CloudFormation redeploy.

---

## The Adapter Pattern

Every external dependency is behind a narrow interface. The interface is defined by what the consumer needs, not by what the external system can do.

```
packages/interfaces/          — TypeScript interfaces (DirectoryStore, Logger, EnvelopeKeyProvider, ...)
packages/interfaces/stubs/    — Local stub implementations (in-memory, stdout, file sink)
packages/{service}/           — Production implementations (PgDirectoryStore, KmsEnvelopeKeyProvider, ...)
```

The composition root (`server.ts` / `bin/directory.ts`) is the only place in the codebase that imports concrete adapter classes. Everything else imports from `packages/interfaces/`. This is enforced by a `no-restricted-imports` ESLint rule — not just by convention.

**Never add to an interface except in response to a specific failing test or a specific production behavior being implemented right now.**

---

## Migrations

Two databases, two tools:

- **Directory (PostgreSQL)** — Flyway Community Edition. Versioned SQL files in `packages/directory/db/migrations/` as `V{n}__{description}.sql`. Migrations run automatically at service startup and in CodeBuild before ECS deploy.
- **Client (SQLite/SQLCipher)** — lightweight custom runner. Flyway Community doesn't support SQLite. Same file naming convention, tracked in a `schema_migrations` table.

Migration files are immutable once applied. Fix a broken migration with a new migration file — never edit an applied one. Flyway's checksum validation detects and rejects modifications.

---

## Observability

Structured logging is mandatory. No `console.log` in implementation code. Every log call goes through the injected `Logger` interface:

```typescript
logger.info("session.started", { sessionId, agentId, relayId })
logger.error("key.unwrap.failed", error, { keyId, reason })
```

Event names follow `domain.noun.verb` taxonomy (e.g. `session.sealed`, `frost.dkg.round1.complete`, `relay.wal.reconstructed`). The canonical event taxonomy is in `docs/planning/discussion_logs/2026-05-16_0753_development-pipeline-and-local-iteration.md`.

Correlation IDs are minted once at flow initiation and threaded through every log event in that flow. A log event without a correlationId on an async multi-process flow is a bug.

---

## Package Boundaries

```
adapter-* → client → transport, crypto, protocol-types
directory → interfaces, protocol-types
relay     → interfaces, protocol-types
```

`client` never imports from `directory` or `relay`. It reaches them exclusively over libp2p streams. This boundary is real even when all packages run in the same Vitest process.

---

## CI/CD

Pushes to `main` trigger the AWS CodePipeline stack via a GitHub webhook Lambda. Path-based filtering (via `cello-pipeline-filter` Lambda) triggers only the pipelines affected by changed packages. Shared packages (`protocol-types`, `crypto`) trigger all downstream pipelines.

Each pipeline: lint → typecheck → test → apply migrations → deploy → smoke test.

The pipeline mapping config lives in the `cello-pipeline-filter` Lambda — data-driven JSON, not hardcoded Lambda logic. Adding a new package = updating the config file.

---

## Security Baseline

- Private key material never crosses the provider boundary. `SigningKeyProvider.sign()` returns a signature; the private key stays inside the provider.
- K_server_X shares are encrypted at rest via `EnvelopeKeyProvider` (AES-256-GCM locally, AWS KMS in dev/production) before any database write.
- All core protocol tables are append-only at the database level (RLS + no UPDATE/DELETE policy for `cello_service`). The hash chain makes tampering detectable even by a database superuser.
- Audit logs (pgaudit) are shipped to S3 with PutObject-only IAM. The `cello_service` role cannot delete or overwrite them.
- No secrets in environment variables that aren't injected via Secrets Manager. No secrets in Docker images.

---

## Vault

`docs/planning/` is an Obsidian vault. All design decisions, discussion logs, and user stories live here. When you add or modify a document, run `/cello-link` to wire it into the vault graph.

Every document needs YAML frontmatter: `name`, `type`, `date`, `topics`, `status`, `description`.
