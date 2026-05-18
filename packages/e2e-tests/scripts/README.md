# E2E Test Scripts

Standalone scripts for CELLO PERSIST-E2E-001 acceptance criteria that require
real process lifecycle control (SIGKILL, restart, process termination) and cannot
be expressed as in-process Vitest tests.

## Prerequisites

All scripts require Docker Compose running with a clean database:

```bash
cd /path/to/trustless-cello
docker compose up -d
pnpm --filter @cello/directory exec flyway migrate
```

Set the environment:
```bash
export CELLO_ENV=local
export DATABASE_URL="postgresql://postgres:dev@localhost:5433/cello_dev"
export SERVICE_DATABASE_URL="postgresql://cello_service:cello_service_dev@localhost:5433/cello_dev"
export DEV_ENVELOPE_KEY="0000000000000000000000000000000000000000000000000000000000000001"
export AUDIT_LOG_PATH="/tmp/cello-audit.log"
```

## Scripts

### `test-wal-crash-recovery.mjs` — AC-002 / SI-002

Verifies the relay reconstructs Merkle state from WAL after SIGKILL.

```bash
node packages/e2e-tests/scripts/test-wal-crash-recovery.mjs
```

**Pass criteria:** relay restarts, reads WAL, reports sequence_number=6, accepts seq=7 without agent re-submission.

---

### `test-wal-corruption.mjs` — DB-001

Verifies corrupt WAL returns RELAY_SESSION_UNRECOVERABLE, not a partial reconstruction.

```bash
node packages/e2e-tests/scripts/test-wal-corruption.mjs
```

**Pass criteria:** `relay.wal.unrecoverable` logged, relay rejects session recovery, agents fall back.

---

### `test-sqlcipher-wrong-key.mjs` — AC-006 / SI-003

Verifies SQLCipher database is unreadable with a wrong key, even when copied to another location.

```bash
node packages/e2e-tests/scripts/test-sqlcipher-wrong-key.mjs
```

**Pass criteria:** correct key succeeds; wrong key throws `SQLITE_NOTADB`; second wrong-key attempt on a copy also fails.

---

### `test-kms-failure-blocks-insert.mjs` — SI-006

Verifies the directory refuses to INSERT an agent_key_share when EnvelopeKeyProvider fails.

```bash
DATABASE_URL="$DATABASE_URL" node packages/e2e-tests/scripts/test-kms-failure-blocks-insert.mjs
```

**Pass criteria:** `key.encrypted.failed` logged; INSERT never executes; no plaintext share in logs or DB.

---

### `test-hash-chain-tamper.mjs` — SI-005

Verifies chain verification detects a superuser UPDATE to a hash-chained row.

```bash
DATABASE_URL="$DATABASE_URL" node packages/e2e-tests/scripts/test-hash-chain-tamper.mjs
```

**Pass criteria:** `verifyChain()` returns `{ valid: false, breakAt: N }` at the tampered row.

---

### `test-pgaudit-immutable.mjs` — SI-007

Verifies `cello_service` role cannot DELETE or TRUNCATE pgaudit infrastructure.

```bash
DATABASE_URL="$DATABASE_URL" node packages/e2e-tests/scripts/test-pgaudit-immutable.mjs
```

**Pass criteria:** both DELETE and TRUNCATE as `cello_service` throw permission denied errors.

---

## Running all scripts

```bash
node packages/e2e-tests/scripts/run-all.mjs
```

Exit code 0 means all passed. Exit code 1 means at least one failed.
