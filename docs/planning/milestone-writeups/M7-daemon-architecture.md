---
name: M7 Daemon Architecture & Ephemeral Session Transport
type: milestone-writeup
date: 2026-06-12
updated: 2026-06-24
milestone: M7
status: E2E-proven — published to npm + demo agent live end-to-end on the deployed cluster (Stage-1, via relay); direct-dial + NAT-traversal + doc/recovery hardening remain
description: >
  Living writeup for M7. Each story appends a section when it closes.
  Format: what was delivered, bugs found and fixed, what this unblocks.
---

# M7 — Daemon Architecture & Ephemeral Session Transport

## M7-DAEMON-001 — Daemon Foundation

**Delivered:** Long-running daemon process with Unix domain socket IPC, lock file
management, agent identity loading from `~/.cello/agents/*.yaml`, structured JSON
logging, status/shutdown IPC methods, and CLI binary (`cello-daemon`). 52 tests.

**Branch:** `m7/daemon-001` in cello-client

**Unblocks:** M7-DAEMON-002, M7-MCP-001, M7-SIGNAL-001

---

## M7-DAEMON-002 — Ephemeral Session Nodes

**Delivered:** `SessionNodeManager` managing per-session ephemeral libp2p nodes
with fresh transport key + Peer ID. Standing receiver node (pre-created, open
gater, immediately replaced on handoff). `SessionConnectionGater` and
`DirectoryConnectionGater` enforcing single-peer allowlists in both inbound and
outbound directions. 32-node cap enforced on both `createSessionNode` and
`acceptSession`. SQLite session tracking (`active` → `sealed`/`interrupted`).
SIGKILL orphan detection at startup. Standing receiver bounded retry (3 attempts,
exponential backoff) with `session.standing_receiver.permanently_unavailable`
alert. 76 tests total (28 new in session-node-manager.test.ts).

**Branch:** `m7/daemon-002` in cello-client (stacked on daemon-001)

**Bugs found and fixed:**

| Symptom | Root cause | Fix | Rule |
|---------|-----------|-----|------|
| `gracefulShutdown` logged `session.node.destroyed` even when node stop failed | `.catch().then()` chain — catch resolves, so then always fires | `.then().catch()` — destroyed only on success | Observability events must only fire on the condition they describe |
| AC-012 test always green | Assertion wrapped in `if (caughtError !== null)` + old stream API | Unconditional assertion + server stop to force error + v3 API | Tests must not conditionally assert the behavior they verify |
| Standing receiver permanently unavailable after one factory failure | No retry in the catch handler | Bounded retry (3 attempts, exponential backoff) | Background infrastructure must self-heal with bounded retries |
| `INSERT OR REPLACE` overwrites `created_at` on duplicate sessionId | SQLite `REPLACE` = DELETE + INSERT | Plain `INSERT` — let constraint violation surface | Use plain INSERT unless idempotency is an explicit requirement |
| DirectoryConnectionGater missing outbound gate | Only `denyInbound` implemented | Added `denyOutbound` with shared `#denyIfNotDirectory` | Defense-in-depth: gate both directions on every gater |
| `daemon.shutdown.failed` indistinguishable between SIGTERM and logout | IPC path logged `{ error }` only | Added `signal: "logout"` field | Every error event must carry enough context to identify the trigger path |
| Binary AC-009 test: SIGTERM didn't mark synthetic rows interrupted | `gracefulShutdown()` iterated in-memory map only | Batch `UPDATE ... WHERE status = 'active'` covers all rows | Shutdown must update all persistent state, not just in-memory tracked objects |

**Unblocks:** M7-DAEMON-003, M7-WIRE-001, M7-SESSION-001, M7-MCP-002

---

## M7 verification pivot — journey-based live-binary testing (J-SPINE → J-LOOPBACK)

After the daemon/transport foundation, M7's remaining scope was verified by a **live-binary
journey harness** (`packages/e2e-tests/src/spine/`, `live-harness.ts`): each test spawns the REAL
shipped binaries — `cello-directory`, `cello-relay`, `cello-daemon`, `cello-mcp`, `cello` — on
localhost over real TCP/Noise/crypto/IPC, and asserts the DoD lines against them (directory-side
assertions via `psqlSpine` against the directory's own Postgres, which the daemon cannot fabricate).
The discipline: anchor every assertion to the BINARY, never the in-process library; never construct
nodes in-process; grow the lowest non-green DoD line. The full DoD scoreboard is
`docs/planning/user-stories/m7/M7-DEFINITION-OF-DONE.md`; the day-by-day archaeology is
`M7-BUILD-JOURNAL.md`.

### Journeys delivered (all green vs the real binaries)

| Journey | DoD | What it proves live |
|---|---|---|
| **J-SPINE** | SPINE-1..7 | register (real DKG) → connect → converse → bilateral FROST seal, byte-identical root |
| **J-AUTH** | AUTH-1/2 | directory step-6 bidirectional identity auth; consortium manifest; 6–12h manifest poll |
| **J-SIG** | SIG-1 | kill signaling → reconnect to a different directory node → queued ops drain |
| **J-INT** | INT-1/2, RETRY-1 | both parties SIGKILLed mid-session → interrupted → seal-interrupted bilateral agreement; retry queue + nonce-dedup survive restart |
| **J-CONTENT** | MSG-1..8 | content delivery; offline → relay parks ciphertext → recover/decrypt; oversize rejected; replay deduped; tamper desyncs; irreducible-loss kept alive |
| **J-UNILATERAL** | SEAL-1/2/3, LIVE-1/2/3 | A seals while B is GONE → directory rebuilds+verifies the root, FROST-notarizes B ABSENT; relay-observed liveness → ABSENT vs DELIVERED; verifiable cert |
| **J-LEGIBILITY** | LEG-1..4 | receipt-not-assent seal cert (attests:receipt, implies_assent:false); malicious tail reads delivered-but-unanswered; per-party signed frontier re-derive guard (co-sign abort on an inflated frontier) |
| **J-PERSIST** | LOG-1 | durable AES-256-GCM-at-rest transcript survives daemon restart; relay/directory never see plaintext (INV-3) |
| **J-LOOPBACK** | LOOP-1 | two of the operator's own K_locals converse on ONE daemon → bilateral seal, byte-identical root, no 2nd process (session core re-keyed to (agent, session_id)) |
| **J-UPGRADE** | UP-1/2 | B online+verified auto-co-signs (UP-2); B KILLED → A unilateral → B returns, recovers+verifies, RATIFIES → superseding bilateral notarization (UP-1) |

## The two largest units (this session, both `cello-done-auditor` EARNED)

### DOD-UP-1 — unilateral → bilateral seal upgrade (CELLO-M7-UPGRADE-001)

**Delivered:** a returning ABSENT party (B) RATIFIES the existing unilateral sealed root R1 (Model 2
— B does NOT re-seal a new root). V31 migration relaxes `seal_notarizations` `UNIQUE(session_id)` →
`UNIQUE(session_id, seal_type)` so a bilateral row can SUPERSEDE the unilateral one (append-only,
`supersedes_notarization_id` FK, the unilateral row never mutated). New `seal_upgrade_request` frame;
directory `#processSealUpgradeRequest`; daemon `seal-upgrade.ts` (extracted for testability) —
attemptSealUpgrade (the KERNEL) + verifyUpgradeConfirmedCert (AC-008). 7 increments, two-reviewer +
done-auditor. Live: `j-upgrade-bilateral.spine.test.ts`.

**THE KERNEL:** B signs its ratification ONLY after recovering + integrity-verifying the content
(content-possession precondition); refuses `content_tamper` / `content_unrecoverable` /
`content_incomplete` — never co-signs content it could not verify.

### DOD-SEAL-2 — relationship-graph producer (Sybil / reputation-farming defense)

**Delivered:** the directory now populates `conversation_seals` + `conversation_participation` +
`conversation_attestations` on every seal (`recordConversationSeal`, atomic + hash-chained), wired
into the unilateral + both bilateral paths (the upgrade skips — `conversation_id` UNIQUE; the edge
already exists). These feed `analytics-job`'s `conversation_graph_edges` + `pseudonym_stats` — the
graph that detects clusters of mutually-sealing agents farming reputation. **Privacy:** relationship
metadata + the sealed root HASH only, NEVER content (INV-3). Live: `j-loopback` (MUTUAL_SEAL + the
edge query derives one A↔B edge) + `j-upgrade-bilateral` (SEAL_UNILATERAL + upgrade-skip).

## Bugs found and fixed (this session)

| Symptom | Root cause | Fix | Rule |
|---|---|---|---|
| Every pre-V31 `seal_notarizations` row would break `verifyChain` after V31 | `verifyChain` does `SELECT *` + re-serialize; the new `seal_type`/`supersedes` columns read back the `'bilateral'` default for old rows, diverging from the chained hash | Exclude both V31 columns from chain serialization (the sessions-V29 / M4-bug-#7 precedent); the FROST signature is the bilateral truth, not the label | A column added to a hash-chained table with a DEFAULT must be excluded from the chain or it breaks every pre-existing row |
| UP-1: every upgrade would be refused (dead on arrival) | B's daemon called `verifyUnilateralCertificate` to verify A's seal sig — but that verifies against the LOCAL agent's own key; B does NOT hold the initiator's group key | Removed it — B accepts R1 on the authenticated daemon↔directory Noise channel (the documented responder asymmetry); the content cross-check is B's real gate | The responder cannot channel-independently verify the initiator's group signature; don't assume a verify helper works for the other party's key |
| UP-1 first live run: B reconnected but never got the `seal_unilateral_notification` → upgrade never triggered | The directory PUSHES the queued notification during the keystone's auth/reconnect drain — BEFORE `cello_start_agent` registers the per-agent handler | Register the absent-party upgrade listener at the KEYSTONE too (mirrors `registerSessionSealedListener`) | Listeners for frames the directory PUSHES on reconnect must be registered at daemon-startup, not only in startAgent |
| UP-1 [HIGH security]: a malicious directory could sign B's "ratification" with a throwaway key and force B to tear down a live session as sealed | `verifyAndApplyUpgradeConfirmed` verified the returning sig against `returning_pubkey` taken FROM THE FRAME, not bound to the session's real participants | Bind the cert's {present, returning} pubkeys to {self, our counterparty} from the LOCAL session record; reject `unknown_session` / `participant_mismatch` | Never verify a signature against a pubkey the untrusted sender chose; bind it to known session state (sovereign-node invariant) |
| SEAL-2: `conversation_seals` chain invalid | `seal_date` is a DATE; node-pg returns it as a LOCAL-midnight Date and `toISOString()` shifts it → insert vs verify serialize differently | Exclude `seal_date` from the chain + compute it as a UTC `YYYY-MM-DD` string (analytics correctness, TZ-independent) | DATE columns don't round-trip deterministically through the chain serializer; exclude or store as a UTC string |
| DoD carried CORE-invariant statuses worse than reality | INV-4 (sender=counterparty) read "❓ was BROKEN 2026-06-11"; INV-3 read "park store ❌ not built"; both were actually built+tested | Verified the code + ran the tests, flipped INV-2/3/4 → 🟢 with citations | A 🟡/❓ status is a claim to re-verify against code before trusting; stale-pessimistic statuses hide completed work |

## M7 E2E (2026-06-23/24) — published to npm, live operator path, demo agent end-to-end

The substantive build was verified on localhost spines; this phase took it to the **deployed cluster
and real npm packages**. Full archaeology in `M7-BUILD-JOURNAL.md` (entries "E2E part 1/2/3").

**Directory push + publish (part 1/2).** Pushed both repos; the 3-region directory deploy ran clean
after one stale directory unit-test fix (`seal_interrupted_ack` nonce). Publishing surfaced — and fixed —
a cluster of latent packaging gaps, all the same shape (a piece built + tested but never wired into the
shipped composition root): the M7 `daemon`/`cli` packages were missing from the CI publish list AND the
root `tsconfig` build graph (so they published empty); `crypto` had gained `content-seal` without a version
bump (stale on npm → the daemon crashed importing `sealToRecipient`); the daemon spawned with its stdout
piped to the cli, so it EPIPE-crashed when the cli exited. **Final published + latest-promoted set:** crypto
0.0.9, protocol-types 0.0.6, transport 0.0.6, client 0.0.35, daemon 0.0.7, cli 0.0.5, connect 0.0.47,
interfaces 0.0.3. The publish pipeline now **self-defends** with three CI guards (Publish-completeness check,
propagation-tolerant verify, and a `cello login`+`status` smoke test on the published artifacts).

**Demo agent rehosted on M7 — WORKS END-TO-END (part 3, Stage 1).** A fresh agent on a laptop established a
real session with the reworked demo agent on EC2 and ran the full 4-message sequence — chain: laptop →
directory (FROST-signed assignment) → relay → demo on EC2 → responses. The M6 demo (which spawned
`cello-mcp` as the whole node) was rewritten for the M7 shim+daemon model and the new receiver tool surface;
a small daemon fix lets a publicly-hosted standing receiver bind/announce a routable address
(`CELLO_LISTEN_ADDR`/`CELLO_ANNOUNCE_ADDRS`). The session went over **relay transport, not direct** — proving
the whole vanilla pipeline (Stage 1); direct-dial-to-public-endpoint and NAT traversal are Stage 2.

**Real gaps this phase exposed (each fixed or noted):** a returning agent that lost local state can't
recover — the directory replies `already_registered` and skips the re-DKG, and the local FROST share isn't
reconstructable (NOTED — needs design); the deployed directory's `PgTokenValidator` rejects `DEV-` tokens
(real bot tokens required for a fresh DKG); `persistFrostKeyShare` is fire-and-forget (register → wait →
verify before touching the daemon); the relay must be restarted to re-register after any directory redeploy.

## CELLO-M7-CONN-001 (2026-06-26) — per-agent directory connections; the keystone is deleted

The live operator path surfaced the **Demo1 bug**: registering a fresh agent right after removing another
timed out (it blocked registering Demo1 after removing Ms_Chelly). Root cause: the daemon held ONE shared
"keystone" directory connection that borrowed the lexicographically-first ("primary") agent's identity.
Removing that agent cleared the primary but never tore down + re-established the connection, so it lingered
authenticated as the removed agent (its pubkey pinged the directory 6 min after removal) and the next
registration's DKG had no working directory door.

**A verification pass drove the design.** All 19 frame types on the authenticated signaling stream were
enumerated: 18 are agent-scoped; only the manifest poll is daemon-level — and the manifest is public,
self-authenticating data (threshold-signed; root keys pinned locally), so it can move to unauthenticated
HTTP. Decision: **delete the keystone, go fully per-agent**, and rehome the one daemon-level operation
(the manifest poll) to `GET /manifest`. Locked invariant: nothing agent-specific ever goes in the
consortium manifest.

**Built in three red-first phases (foreground):** (1) the manifest poll moved to unauthenticated HTTP
(`http-manifest-poll.ts`), preserving the TUF verify-before-adopt policy and running daemon-level even
with zero agents — the property the keystone could never provide; a directory `GET /manifest` handler +
ALB `ManifestPathRule` serve it. (2) inbound `session_assignment` / `seal_interrupted` responders wired
**per-agent** (closing the SPINE-5 gap where only the primary received them). (3) the keystone deleted
(`primaryAgent` / `getAuthIdentity` / `wireKeystonePrimary`); every site re-homed to the owning agent via
`signalingFor` / `sendOver`; create/register/start + a startup loop bring up **each agent's own**
connection. Three read-only reviewers (code-reviewer, fallback-finder, test-attacker) ran; every finding
was fixed — notably a HIGH (loaded agents weren't connected at startup → no inbound after a restart) and
two MEDs (a swallowed manifest-store throw; a status field that masked a partial per-agent outage).

**Proven at every layer.** Live close gate against the real binaries: **j-conn 2/2** (the Demo1 repro +
name-reuse-after-removal), **j-spine 7/7** (non-regressive; the stale DOD-SPINE-4 flat-file assertion was
updated to the PERSIST-002 SQLCipher model), **j-remove 3/3**. Published daemon 0.0.13 / cli 0.0.11 to
`latest` (binary-verified, smoke-tag green). Operator-confirmed on a laptop — remove an agent → register a
fresh one → DKG completed (`primary_pubkey` returned), `directory_signaling: connected` — and corroborated
in the directory Postgres (Demo2 `active` in us-east-1) and replicated to eu-central-1 + ap-northeast-1
(`agent_profiles` is in `cello_pub`). The keystone stranding bug is dead.

## What M7 unblocks

- **Clean agent lifecycle** (CELLO-M7-CONN-001): removing an agent and registering a fresh one no longer
  strands the daemon — every agent runs its OWN directory connection; removal is per-agent and self-healing.
- **Live operator onboarding** is real: `npx @cello-protocol/connect` + `@cello-protocol/cli` → `cello login`
  → register → converse, all against the deployed cluster, proven by the demo-agent round-trip.
- **Beta**: identity + connect + converse + seal (unilateral & bilateral & upgrade) + durable encrypted
  transcript + Sybil-defense relationship graph are live-proven against the real binaries AND the published
  packages.

## What remains

- **Direct-dial-to-public-endpoint** (Stage 2 start): the demo currently advertises the relay because
  `selectAdvertisedAddress` only picks the direct addr when AutoNAT confirms dialability, which stub-mode
  doesn't. Treat a configured `CELLO_ANNOUNCE_ADDRS` as authoritative dialability for static-public hosts.
- **NAT-traversal dialer** (Stage 2): wire `CelloNodeTransportDialer` into `cello-daemon.ts` + reconcile the
  dialer's connection with the session node (the documented seam in `daemon.ts` `cello_initiate_session`).
- **Returning-user recovery** — design the lost-local-share recovery path (directory says `already_registered`
  but the agent can't sign); affects any reinstall.
- **Demo cleanup** — update the published demo AgentID to `bc94ead6…`, rewrite `demo/runbook.md` +
  `demo/CLAUDE.md` for M7, update `infra/STATE.md` (redeploy, relay restart), remove the throwaway test driver.
- **DOD-CONN-3 manifest-over-HTTP directory deploy** — the `GET /manifest` code is merged to main; the
  end-to-end live poll needs the CI/CD directory image + `deploy.sh` for the ALB `/manifest` rule across all
  3 regions + STATE.md. Degrades gracefully (`manifest_http_unreachable` → cached, 6–12h schedule) until then.
- **Multi-node failover** (INV-1) — needs >1 node; the single-node spine harness can't model it → E2E.
- **Relay-SIGNED sequence verification** (DOD-MSG-4 Finding 2) — needs the relay's signing identity
  plumbed to the daemon; named-deferred (RC-1) to the transport-security-audit hardening story.
- **Unilateral `attestation_mode` TBS-binding** — deferred (RC-1): low-severity (delivered-copy only;
  authoritative record correct) vs. real risk of breaking the working seal co-sign flow.
- **Assembly-wide discipline audits** (INV-6/8 — error-message / no-console.log / correlationId).
- **DOD-LOG-2/3** dispute/abuse export bundles — ⬜ NOT STORIED follow-ons on the durable transcript.

## Related documents

- `docs/planning/user-stories/m7/M7-DEFINITION-OF-DONE.md` — the DoD scoreboard (authoritative status)
- `docs/planning/user-stories/m7/M7-BUILD-JOURNAL.md` — day-by-day archaeology + design decisions
- `docs/planning/user-stories/m7/M7-PROCEDURE.md` — the per-unit loop + severity triage + overnight rules
