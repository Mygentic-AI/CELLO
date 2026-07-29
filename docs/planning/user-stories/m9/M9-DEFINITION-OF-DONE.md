---
name: M9 Definition of Done
type: definition-of-done
date: 2026-07-29
milestone: M9
status: active
topics: [m9, security-governance-layer, gateway, connect-unit, definition-of-done, sqlcipher, config-surface, d2, d3, d4, d5, d11]
description: >
  The yardstick for M9, the security and governance layer — modernized 2026-07-29 to the M10B
  standard and reopened for the CONNECT UNIT. Phase 1 built the whole layer and went gate-green on
  2026-06-23; the 2026-07-27 policy surface audit proved none of it runs in the shipped product
  (the composition root never sets config.securityGateway, so every daemon boots passthrough).
  Tier 1 here is the fix: wire the layer in enforcing (D-2), move its stores into the encrypted
  database and the backup unit (D-3, closing DOD-CRYPTO-AT-REST-1), build the control surface with
  the CLI loosen-confirm (D-4, absorbing DOD-CONFIG-1), remove the environment-variable bypass
  (D-5), and ship the "what did my policy do" command (D-11). Decisions-of-record:
  2026-07-27_2049 policy surface audit §10.
---

# M9 — Definition of Done

## How to use this
- **Read [[M9-PROCEDURE]] FIRST** — self-contained (read order, severity triage, reviewer lenses,
  publish sequencing, the design-note template).
- This is the **target**. Find the lowest-numbered line not ✅ in the open tier; that's the next
  unit.
- **Evidence discipline:** a flipped tag carries ONE line of evidence plus `→ Entry C·N`. Full
  proofs live in [[M9-BUILD-JOURNAL]]. This document stays a scoreboard.
- **The enforcer for Tier 1 is the composition-root live gate** (`DOD-M9C-GATE-1`): it spawns the
  SHIPPED `cello-daemon` binary with zero test injection. The June 2026 gate injected the gateway
  client itself — it proved the layer works when connected and hid that only the test connects it.
  No Tier-1 line cites an injection-seam test as its proof.
- Every line carries **observability ACs**: named `domain.noun.verb` events, context fields,
  correlationId threading, error-path coverage. Lines name only headline events; each unit's design
  note names the FULL set before code, and the reviewer verifies against the design note.
- Client-side lines ship via the publish cascade (/cello-publish); `DOD-M9C-PUBLISH-1` is not ✅
  until the published artifact works.

## Status legend
✅ PROVEN (enforcer-green) · 🟡 BUILT/UNVERIFIED-LIVE · 🟠 PARTIAL · ❌ NOT BUILT · 🅿️ PARKED

---

## Orientation — why this milestone reopened (read this before any line)

**The layer never runs in the shipped product.** Evidence chain (policy audit §0, verified
2026-07-27):

1. `core/daemon/src/daemon.ts` — `config.securityGateway ?? new PassthroughGatewayClient()`. The
   fallback is an always-allow stub.
2. The composition root (`core/daemon/src/bin/cello-daemon.ts`) is the only production caller of
   `startDaemon` and never sets `config.securityGateway`.
3. `LocalSidecarGatewayClient` — the real adapter — is constructed only in test files.
4. `spawnGatewaySidecar` has zero non-test callers.
5. Live proof from Andre's own daemon log, every boot:
   `{"event":"security.gateway.connected","mode":"passthrough"}`.

So everything Phase 1 built — inbound sanitization, the injection matcher, the language allowlist,
outbound secret redaction (222-rule gitleaks), PII whitelist + bulk-dump warn, rate limiting, the
four governance dispositions, the versioned config store, the hash-chained records — is written,
unit-green, gate-green, **and inert**. `DOD-M9INT-1` (M8C) was honestly earned for the *seam*: the
daemon genuinely calls `screenInbound`/`screenOutbound` at the two right places. It calls them on a
stub.

**The connect unit is wiring, custody, surface, and gate integrity — not construction.** If a
Tier-1 plan starts designing new detection logic, it has mis-scoped the unit.

**Two custody defects ride along and are closed here, not separately:** the stores are plaintext
`node:sqlite` in files outside the encrypted database and outside the backup
(`DOD-CRYPTO-AT-REST-1`, M8C), and four `CELLO_GATEWAY_*` environment variables sit under the
config store as defaults, letting anyone loosen a guard with no confirmation and no versioned row
(D-5). The ESLint quarantine allowlist in `cello-client/eslint.config.mjs` names the two store
files; this unit empties those entries.

## Scope fence

**IN:** the composition-root wiring + sidecar lifecycle + fail-closed behavior (D-2); the stores'
move into SQLCipher under the daemon's key, inside `cello_backup`/`cello_restore` (D-3); the
`cello config` surface, MCP read/tighten parity, and the interactive CLI loosen-confirm (D-4,
absorbing M8C's parked `DOD-CONFIG-1`); removal of the four policy env overrides (D-5); the D-11
policy-log command (security half); the composition-root live gate; the beta publish cascade.

**OUT (parked in their named homes):** the DeBERTa model runtime (deferred by decision 2026-06-23
— `M9-IN-002` part 2; the absent-model → Layer-2-off graceful path is already built and stays);
the hook engine, moderation, and the override policy engine (Day 2 list); Phase 2
(`M9-REMOTE-001`, `M9-ATTEST-001`, `M9-GATE-2`) — note D-3 RELOCATES the separate-key guarantee
there; the Generic Reject frame, refusal notification, and the reachability half of the D-11
command (policy audit §15 items 5–8 — a different unit; the D-11 command ships here reading the
security records, shaped so the reachability source can join later); anything gated on policy D-12
(tabled); the portal passkey confirm (replaces the CLI prompt when the portal connects to this
layer — later).

---

## Tier I — Invariants (must hold in every Tier-1 line)

- **INV-1 — No-LLM base.** Deterministic pipeline; the only model is the deferred DeBERTa scanner;
  no network calls in the base path. — standing
- **INV-2 — Not a moderation tool.** No toxicity / sentiment / bias / topic policing. — standing
- **INV-3 — Judgment is Day 2.** Via hooks or upstream, never the base pipeline. — standing
- **INV-4 — AMENDED (M9C-D2, from policy D-3).** The gateway owns its config and records **in
  SQLCipher storage opened with the daemon's key, inside the backup unit.** The former
  separate-file/separate-key clause and `M9-CFG-001 SI-001` are RE-SCOPED to the remote gateway
  (Phase 2), where they are physically enforceable. Any doc asserting local separate-key
  protection is superseded by this line.
- **INV-5 — Unified seam.** All inbound passes `ingestReceivedContent`; all outbound passes
  `cello_send`; no content path bypasses the gateway, including recovered park content. — standing
- **INV-6 — Never lies, never hangs.** Every `cello_send` returns a terminal verdict within a
  deadline; a timeout is a verdict (block + reason). — standing
- **INV-7 — Error discipline.** Distinct code per cause; actionable `guidance`; injected logger;
  `domain.noun.verb`; correlationIds. — standing
- **INV-8 — Sovereign nodes (Phase 2).** The attestation table, when built, is hash-chained, RLS,
  region-independent. — standing, Phase 2
- **INV-9 — NEW: Connected by default; passthrough is test-only.** No shipped code path constructs
  `PassthroughGatewayClient`. A daemon that cannot screen does not pretend it can: content fails
  closed with a named cause, and the degradation is ANNOUNCED. The mode announced at boot is the
  mode the process is in. — ❌ until `DOD-M9C-WIRE-1`
- **INV-10 — NEW: The loosen gate has no side door.** Every loosening flows through the versioned
  store's confirm gate, and the confirmation is produced only by an interactive human act (CLI
  prompt now, passkey later). No environment variable, MCP tool, IPC verb, or file import can
  loosen silently. — ❌ until `DOD-M9C-ENV-1` + `DOD-M9C-SURFACE-1`

---

## Tier 0 — What Phase 1 shipped (June 2026) — the record, compressed

All gate-green 2026-06-23 against the injection-seam gate (`m9-gate-1.test.ts`), done-auditor
ruled: 7 EARNED initially, the rest resolved to EARNED by named commits. Statuses are final; the
per-story detail lives in the journal and the old YAMLs (superseded — do not build from them).

| Story | What it is | Status |
|---|---|---|
| M9-CORE-001 | Gateway program + `SecurityGatewayClient` interface + the two daemon call sites | ✅ |
| M9-IN-001 | Inbound Layer-1 sanitization (invisible-char strip, RE2 patterns, entropy, encoded-payload decode, special-token strip, size caps) + Step-9 injection matcher | ✅ |
| M9-IN-002 | Injection scanner verdict logic + model installer built ✅ · **the real DeBERTa runtime 🅿️ DEFERRED by decision (2026-06-23)** — absent model → Layer 2 off, graceful | 🟠 by design |
| M9-IN-003 | Language allowlist detector (confident-only) + terminal-block inbound seam | ✅ |
| M9-OUT-001 | Outbound secrets: full 222-rule gitleaks dictionary + entropy catch-all, typed `[REDACTED:rule]` | ✅ |
| M9-OUT-002 | Outbound PII: whitelist + single/bulk warn + drip | ✅ |
| M9-OUT-003 | Outbound exfil: egress strip, image-exfil, encoded-blob, injection-artifact block | ✅ |
| M9-OUT-004 | Outbound rate limiting keyed on agent identity | ✅ |
| M9-FEED-001 | The governance feedback channel: four dispositions, never-hang, fail-closed + circuit breaker, `governance_decisions` re-send (`allow_once`/`allow_always` gated by `autonomous_override`) | ✅ |
| M9-CFG-001 | Versioned append-only config store, tighten-free / loosen-confirmed, hash-chained | ✅ logic · ❌ storage clause (plaintext — fixed by `DOD-M9C-STORE-1`) · SI-001 re-scoped to Phase 2 (INV-4) |
| M9-REC-001 | Hash-chained security-pass records, every screened message, tamper-evident | ✅ logic · ❌ storage clause (same — `DOD-M9C-STORE-1`) |
| M9-GATE-1 | End-to-end loop, two daemons + two gateways, one machine | ✅ as an injection-seam gate — **superseded as enforcer by `DOD-M9C-GATE-1`** |

**Retired in the June prune (do not build):** REDACT-002 (LLM-call governor), REDACT-003
(deny-all fs/URL), the moderation parts of SCAN-003.

---

## Tier 1 — THE CONNECT UNIT (opened 2026-07-29) — wiring, custody, surface, gate integrity

Build order is line order. Design-significant lines (STORE-1, WIRE-1, SURFACE-1) get a design note
in the journal before any code ([[M9-PROCEDURE]] §6).

- **DOD-M9C-STORE-1** — **custody: the stores move into encrypted storage and the backup unit
  (D-3, closes `DOD-CRYPTO-AT-REST-1`).** The gateway's config store and record store live in
  SQLCipher storage opened with the daemon's key — the design note decides the topology (tables in
  an existing daemon DB vs a sibling SQLCipher file under the same key; the deciding test is
  Andre's: *the database is what we back up*) and how the key reaches the sidecar (never argv,
  never world-readable). `cello_backup` captures and `cello_restore` restores them, proven by a
  round-trip test that finds the config versions and records intact. An existing plaintext store
  is imported ONCE at first encrypted boot and the plaintext file is then DELETED (leaving it
  defeats the point); the hash chains restart at a genesis row recording the import; no plaintext
  store present is normal first boot, not an error. Zero `node:sqlite` imports remain in
  `core/gateway` production code; the two gateway entries in the `eslint.config.mjs` quarantine
  allowlist are REMOVED (the allowlist only shrinks); absence is asserted on the BUILT artifact.
  The false "the daemon does the same" comments die with the files. `M9-CFG-001`'s SI-001 clause
  carries the INV-4 amendment note in the YAML itself, so nobody re-reads the stale guarantee.
  Headline events: `gateway.store.opened` (with `encrypted:true`, never a key), `gateway.store.
  imported` (row counts, one-time), `gateway.store.import_failed` (+ cause, refuses to proceed).
  — ❌

- **DOD-M9C-WIRE-1** — **the connect: the shipped daemon runs the layer, enforcing (D-2).** The
  composition root (`core/daemon/src/bin/cello-daemon.ts`) constructs the real gateway client and
  spawns the sidecar; no shipped path constructs `PassthroughGatewayClient` (INV-9) — the stub
  moves to test-only visibility. Every guard Phase 1 built runs and acts: inbound sanitization +
  matcher + language allowlist, outbound secrets + PII + exfil + rate limit, the four dispositions,
  records on every screened message. The DeBERTa runtime stays deferred: absent model → Layer 2
  off, graceful (already built — verify, don't rebuild). Lifecycle: the sidecar starts with the
  daemon, dies with the daemon (no orphans — the SQLite-lock discipline), and its failure modes are
  fail-closed and ANNOUNCED: spawn/readiness failure or a screening timeout yields a terminal
  verdict naming the real cause (`sidecar_spawn_failed`, `gateway_unavailable`,
  `governance_timeout` — never a generic label, never a hang, never unscreened flow-through). The
  boot event tells the truth: `security.gateway.connected` with `mode:"enforcing"` (the value the
  informed skeptic greps for), and the mode value is derived from the actual construction, not a
  constant. — ❌

- **DOD-M9C-SURFACE-1** — **the control surface + the human confirm (D-4, absorbs M8C
  `DOD-CONFIG-1`).** `cello config list` / `get <key>` / `set <key> <value>` against the versioned
  store, covering all five keys (`autonomous_override`, `pii_whitelist`, `language_allow`,
  `rate_max_per_window`, `rate_window_ms`). The store's own classifier decides tighten vs loosen:
  a TIGHTENING applies immediately; a LOOSENING renders what is changing (key, from, to, and that
  it weakens protection) and requires an interactive TTY confirmation — that confirmation, and
  nothing else, produces the store's `confirmed` flag. MCP parity for reads and tightenings
  (`cello_config_get`/`list`/`set`); a loosening attempted via MCP or a non-TTY stdin is REFUSED
  with guidance naming the exact CLI command to run — recorded as decision `M9C-D3`, so the parity
  checker reads the asymmetry as design, not gap. Parameter names verified wired end-to-end on
  both surfaces (the M10B SURFACE-1 lesson). `allow_always` — a persisted loosening — rides the
  same gate. Every change lands as a versioned, hash-chained row; `list` shows current values with
  version and provenance. Headline events: `gateway.config.changed` (key, direction, version,
  correlationId), `gateway.config.loosen_refused` (+ surface, cause). — ❌

- **DOD-M9C-ENV-1** — **the side door closes (D-5).** The four policy fallbacks in
  `core/gateway/src/bin/cello-gateway.ts` — `CELLO_GATEWAY_AUTONOMOUS_OVERRIDE`,
  `CELLO_GATEWAY_PII_WHITELIST`, `CELLO_GATEWAY_RATE_MAX_PER_WINDOW`,
  `CELLO_GATEWAY_RATE_WINDOW_MS` — are REMOVED. Security settings come from the store only;
  plumbing envs that carry no policy (socket path, store location, request log) survive only if
  set by the daemon's own spawn plumbing, and none of them can loosen a guard. Tests that used the
  env path inject config through the store or the constructor instead. Proven by a negative test
  IN THE LIVE GATE: booting the shipped daemon with `CELLO_GATEWAY_AUTONOMOUS_OVERRIDE=1` in the
  environment has NO effect on screening behavior and leaves no config row. Grep-level absence of
  the four names in built gateway output, asserted on the artifact. — ❌

- **DOD-M9C-AUDIT-1** — **"what did my policy do" (D-11, security half — ships WITH the flip, by
  decision).** One command (CLI + MCP read parity): a single reverse-chronological list from the
  record store — timestamp, direction, disposition (clean / redacted / blocked / warned), the rule
  or check that fired, and the correlationId — with a `--since` filter and a bounded default.
  Deliberately not a dashboard. This is the attribution answer D-2 promised Andre ("is this new
  error the flip or my other work?") — so it lands in the same publish as WIRE-1, never later. The
  output shape leaves room for the reachability source (refusals, tier gates, away responses) to
  join in the later refusal unit without a breaking change. — ❌

- **DOD-M9C-GATE-1** — **the composition-root live gate — the enforcer, and the lesson encoded.**
  A live test that spawns the REAL `cello-daemon` binary from `dist/` (the shipped bin; zero
  `config.securityGateway` injection, zero direct construction of gateway internals) plus its real
  sidecar, drives real traffic, and asserts: (1) boot announces `mode:"enforcing"`; (2) an
  outbound message carrying a real-shaped credential arrives REDACTED at the peer and the sender's
  LLM is told what was redacted; (3) a crafted inbound (invisible-character concealment) arrives
  sanitized with notes; (4) both produce hash-chained records readable by the AUDIT-1 command;
  (5) the ENV-1 negative case (override env var inert); (6) kill the sidecar mid-session → the
  next send returns the fail-closed verdict with the real cause, nothing flows unscreened, and the
  daemon has announced the degradation. Green means the PRODUCT screens, not that the layer can.
  — ❌

- **DOD-M9C-PUBLISH-1** — **it reaches the operator.** The whole unit ships as ONE batched cascade
  (gateway → daemon → cli → adapter/connect as the graph requires) to npm **beta** via
  /cello-publish (loaded for THIS publish); the published BINARY is verified (real semver deps,
  never `workspace:*`; the gateway bin and its assets present in the packed tarball); the local
  install is pinned and the pin VERIFIED (`claude mcp get cello`). After Andre's next daemon
  restart, his own `~/.cello/daemon.log` — the artifact that exposed the defect — shows
  `mode:"enforcing"`. The `latest` promotion and the `/mcp` reconnect are prepared and handed
  over, never run. — ❌

---

## Tier 2 — Phase 2: non-local (unchanged, not this reopening)

| Story | What it builds | Status |
|---|---|---|
| M9-REMOTE-001 | The gateway as a standalone service on a machine the operator does NOT control; daemon reaches it over mTLS; config lives with the remote gateway — **this is where the D-3-relocated separate-key/SI-001 guarantee becomes real**, and where the fail-closed-vs-availability question (policy audit D-3 note) must be named before build | ❌ |
| M9-ATTEST-001 | Tamper-proof records: fingerprints attested to the directory; new `security_attestations` migration (+ `OpsAgentExpectedMigrationVersion` bump); the tamper/gap check job | ❌ |
| M9-GATE-2 | End-to-end non-local gate | ❌ |

Until M9-ATTEST-001 is built, do not market "tamper-proof" — that claim becomes true only when
records are attested to the directory.

---

## Day 2 — named and parked (not silently dropped)

- **Hook engine** — the ONLY extension seam for operator-authored / LLM policy (V3 design). Note:
  policy D-12 (tabled) decides what, if anything, an LLM policy may overrule — nothing here builds
  before that.
- **Moderation** — LLM-judgment only, via hooks or upstream. Never first-party CELLO logic.
- **Override policy engine** — CASL rules + isolated LLM judge for `allow_*` residual.
- **Expanded PII set · financial redaction · output-volume cap · canary tokens · SIEM streaming ·
  honey tokens · M-of-N approval · `transform` hook capability · `context_depth`.**
- **DeBERTa runtime (M9-IN-002 part 2)** — deferred by decision until the 568 MB model + runtime
  infra are lined up; built WITH that infra, not blind.
- **Portal passkey confirm** — replaces the CLI prompt as the D-4 human confirmation when the
  portal connects to this layer.

---

## Decisions

- **M9C-D1 (from policy D-2, Andre 2026-07-28)** — reconnect ENFORCING, everything except the
  DeBERTa model. The escape hatch (SURFACE-1) ships in the same unit: enforcing without a way to
  relax a misfiring rule is the one combination that can strand the operator.
- **M9C-D2 (from policy D-3, Andre 2026-07-28)** — one encrypted home, one key, covered by backup;
  SI-001's separate-key guarantee is re-scoped to M9-REMOTE-001 where it is physically
  enforceable. The local separate-key store was theatre: whoever owns the laptop can simply not
  run the scanner. Recorded as the INV-4 amendment; M9-CFG-001.yaml carries the note.
- **M9C-D3 (from policy D-4, Andre 2026-07-28)** — the human confirmation is a CLI prompt at
  launch (portal passkey later). Loosening is therefore CLI-only; MCP refuses loosenings with
  guidance. Reads and tightenings have MCP/CLI parity. This asymmetry is design, not a parity gap.
- **M9C-D4 (from policy D-5, Andre 2026-07-28)** — the four `CELLO_GATEWAY_*` policy overrides are
  removed from shipped builds. Tests inject config directly. A gate with a published bypass is not
  a gate.
- **M9C-D5 (from policy D-11, Andre 2026-07-28)** — the policy-log command ships WITH the
  enforcement flip, as its attribution mitigation. Security half here; reachability half joins in
  the refusal unit (§15 items 5–8).
- *(build decisions `M9C-D6+` are appended here as the design notes make them)*

## Open questions
- None blocking Tier 1. The design notes own: store topology, key handoff mechanism, chain-genesis
  wording, confirm-prompt rendering. Each lands as an `M9C-D*` entry when made.

## Parked
- Everything in the Day 2 list, each with its named home above.
- Phase 2 (Tier 2) — including the relocated SI-001 guarantee and the fail-closed-vs-availability
  question for a remote scanner.
- The reachability half of the D-11 command — joins in the refusal unit.

---

## Related Documents

- [[M9-PROCEDURE]] — the runbook (read first)
- [[M9-BUILD-JOURNAL]] — evidence home; connect-unit entries numbered C1…
- [[2026-07-27_2049_policy-surface-audit-touchpoints-and-open-decisions]] — §0 the finding, §10 the
  decisions, §14.4 the config-store register entry, §15 the work list
- [[M8C-DEFINITION-OF-DONE]] — `DOD-CRYPTO-AT-REST-1` (closed by STORE-1) and `DOD-CONFIG-1`
  (absorbed by SURFACE-1) — mark both there when Tier 1 closes
- [[M9-CAPABILITY-HARVEST]] — June design decisions (background; predates the INV-4 amendment)
