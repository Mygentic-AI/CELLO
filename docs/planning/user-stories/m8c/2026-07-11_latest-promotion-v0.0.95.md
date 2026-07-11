---
name: latest-promotion-v0.0.95
type: runbook
date: 2026-07-11
topics: [publish, npm, dist-tag, latest, promotion, cli-parity, cursor-durable, operator-run]
status: awaiting-operator
description: >
  The `latest` promotion command set for the v0.0.95 cascade (daemon 0.0.47, cli 0.0.45) — DOD-CLI-PARITY-1
  + DOD-CURSOR-DURABLE-1. PREPARED, NOT RUN. Promotion is Andre's to execute (/cello-publish step 6).
---

# `latest` promotion — v0.0.95 (daemon 0.0.47, cli 0.0.45)

> **NOT RUN.** Per `/cello-publish` step 6, promotion to `latest` is **operator-run** and needs Andre's
> explicit go. This file is the prepared command set, nothing more. **Verify the beta tarballs first**
> (below) — the truth is what is on npm, never what is in the commit.

## What changed, and why an operator should want it

- **`DOD-CURSOR-DURABLE-1`** — before this, *any* stateless client could speak **once** in a session and
  was then blocked forever the moment the counterparty replied. That included the `cello` CLI and any
  **reconnecting** MCP client. Two-way conversation from bash was impossible.
- **`DOD-CLI-PARITY-1`** — every daemon capability that was MCP-only is now a `cello` command, so any
  bash-capable agent operates a CELLO node with no MCP dependency.

## Only two packages moved

`connect` is **not** in the cascade: it depends on client/crypto/transport, **not** daemon — it reaches
the daemon over the socket, and an operator picks the new daemon up transitively through `cli`
(`cli` pins `daemon` at an **exact** version, so `cli@latest` always drags the right daemon).

| package | latest today | → promote to |
|---|---|---|
| `daemon` | 0.0.46 | **0.0.47** |
| `cli` | 0.0.44 | **0.0.45** |
| crypto / protocol-types / transport / client / connect | unchanged | (re-affirm at current versions) |

## 1. Verify the beta artifacts FIRST (do not skip — verify the binary, not the commit)

```bash
for p in crypto protocol-types transport client daemon cli connect; do
  echo "$p beta: $(npm view @cello-protocol/$p@beta version)"
done
# daemon@0.0.47 must actually CONTAIN the new gate:
cd /tmp && npm pack @cello-protocol/daemon@0.0.47 && tar xzf cello-protocol-daemon-0.0.47.tgz
grep -c "getUnreadReceivedCount" package/dist/daemon.js        # must be > 0 (the durable clause)
grep -c "safeWatermarkAdvance"   package/dist/daemon.js        # must be > 0 (AC3)
# cli@0.0.45 must contain the new commands, and pin the NEW daemon (never workspace:*):
npm view @cello-protocol/cli@0.0.45 dependencies
```

## 2. The promotion command set (Andre runs this)

Promote **all seven** so the whole `latest` graph stays consistent — the five unchanged ones just print
a harmless *"latest is already set"* warning.

```bash
npm dist-tag add @cello-protocol/cli@0.0.45 latest
npm dist-tag add @cello-protocol/daemon@0.0.47 latest
npm dist-tag add @cello-protocol/connect@0.0.65 latest
npm dist-tag add @cello-protocol/client@0.0.48 latest
npm dist-tag add @cello-protocol/crypto@0.0.18 latest
npm dist-tag add @cello-protocol/transport@0.0.17 latest
npm dist-tag add @cello-protocol/protocol-types@0.0.19 latest
```

Each prints `+latest: @cello-protocol/<pkg>@<ver>` — **that line is the authoritative confirmation**, not
the verify loop below (npm's CDN can lag 1–2 minutes on a just-set dist-tag).

```bash
for p in connect cli daemon client crypto transport protocol-types; do
  echo "$p latest: $(npm view @cello-protocol/$p@latest version)"
done
```

## 3. Then operators just install `@latest` — no pinning, ever

```bash
npm i -g @cello-protocol/cli@latest @cello-protocol/connect@latest
cello logout && cello login     # restart the daemon onto the new binary (CLI lifecycle, not pkill)
# then reconnect the MCP: /mcp   (or restart Claude Code)
cello status
```

## 4. What an operator can do that they could not before

```bash
cello --help                      # a described command table (DOD-ONBOARD-HELP-1)
cello agents                      # JSON on stdout; every command is scriptable
cello use-agent alice             # durable across invocations
SID=$(cello initiate <pubkey> --agent alice | jq -r .sessionId)
cello send "$SID" "hello" --agent alice
cello receive "$SID" --agent bob --timeout-ms 30000
cello send "$SID" "reply" --agent bob      # ← this is what DOD-CURSOR-DURABLE-1 unblocked
cello close "$SID" --agent alice
cello sealed-receipt "$SID" --agent alice  # the notarized bilateral seal
```

The full reusable proof is `cello-client/scripts/bash-only-smoke.sh`.

## Related

- [[2026-07-11_cli-mcp-parity-plan]] · [[2026-07-11_cursor-durable-read-before-write-design]]
- [[M8C-DEFINITION-OF-DONE]] · [[M8C-BUILD-JOURNAL]]
