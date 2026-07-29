/**
 * J-END — `DOD-END-JOURNEY-1`: the client-supplied source, live, across real processes.
 *
 * Bob's agent supplies an endorsement for Alice; the PORTAL authenticates, scans, mints, notarizes
 * and delivers; Alice receives it PENDING and accepts; Alice presents to Charlie; Charlie verifies
 * and consumes it as quoted-untrusted. Real daemons, a real directory, a real Postgres — and the
 * portal's REAL ingress modules, not a re-implementation (see `portal-ingress.ts` for why that
 * distinction is the difference between this journey and a false green).
 *
 * BUILT IN HOPS, deliberately. Each `it` asserts one hop and leaves state for the next, so a break
 * names the hop that broke instead of failing a 200-line block with one opaque expectation. The DoD
 * calls for four more cases (refusal-with-message, subject-offline-at-mint, same-operator positive,
 * self-endorsement refused, withdrawal reaching a prior recipient); this file starts with the CORE
 * JOB — severity 1 in the milestone's own triage — and the others land on top of the same fixture.
 *
 * Run: pnpm --filter @cello-protocol/e2e-tests test:spine -- j-end
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { InMemoryKeyProvider } from "@cello-protocol/crypto";
import {
  startSpineCluster,
  startDaemon,
  connectMcp,
  cello,
  psqlSpine,
  AUTH_DIRECTORY_NODE_KEY_HEX,
  AUTH_DIRECTORY_NODE_ID,
  AUTH_DIRECTORY_NODE_PUBKEY,
  writeConsortiumManifest,
  PORTAL_ROOT,
  type SpineCluster,
  type Proc,
  type McpConn,
  type ManifestEnv,
} from "./live-harness.js";

let cluster: SpineCluster;
let manifestEnv: ManifestEnv;
const daemons: Proc[] = [];
const mcpConns: McpConn[] = [];
const dirs: string[] = [];

/**
 * The portal's intake keypair. The SEED stays here (the portal opens seals with it); the PUBLIC half
 * rides the consortium manifest, which is the whole reason the manifest was chosen as the channel —
 * officer signatures cover it automatically, so a substituted key cannot seal endorsements to an
 * attacker (`M10B-D11`).
 */
const INTAKE_KEY_ID = "intake-j-end";
const INTERNAL_API_KEY = `jend-internal-${randomBytes(8).toString("hex")}`;
const intakeSeed = new Uint8Array(randomBytes(32));

/** Bob issues; Alice is the subject; Charlie is the recipient who verifies. */
const dirFor: Record<string, string> = {};

beforeAll(async () => {
  cluster = await startSpineCluster({
    directoryNodeKeyHex: AUTH_DIRECTORY_NODE_KEY_HEX,
    // The portal reaches the queue over `/internal/*`; without a key the directory does not start
    // that server at all under CELLO_ENV=local.
    internalApiKey: INTERNAL_API_KEY,
  });
  const intakePub = Buffer.from(await new InMemoryKeyProvider(intakeSeed).getPublicKey()).toString("hex");
  manifestEnv = writeConsortiumManifest(
    cluster.tmpDir,
    "j-end",
    [{
      nodeId: AUTH_DIRECTORY_NODE_ID,
      pubkey: AUTH_DIRECTORY_NODE_PUBKEY,
      region: "local",
      provider: "aws",
      endpoint: cluster.directoryUrl,
    }],
    // WITHOUT THIS the daemon refuses every submission with `intake_key_absent` — which is exactly
    // what the deployed dev environment does today, because nothing provisions the key there.
    { intakeKey: { key_id: INTAKE_KEY_ID, pubkey: intakePub } },
  );

  for (const who of ["bob", "alice", "charlie"]) {
    const dir = mkdtempSync(join(tmpdir(), `cello-jend-${who}-`));
    dirs.push(dir);
    dirFor[who] = dir;
    const d = await startDaemon(dir, cluster.directoryUrl, `jend-${who}`, { manifestEnv });
    daemons.push(d);
  }
}, 180_000);

afterAll(async () => {
  // EACH close() GUARDED. Several of these point at daemons stopped in later hops, and one
  // rejection would abort the loop — leaving spawned relay/directory binaries, bound ports and the
  // Docker Postgres alive for the next journey to inherit.
  for (const c of mcpConns) { try { await c.close(); } catch { /* the daemon may already be gone */ } }
  for (const d of daemons) await d.stop();
  await cluster?.stop();
  for (const dir of dirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

type Status = { directory_signaling?: string };
const waitConnected = async (dir: string, label: string): Promise<void> => {
  for (let i = 0; i < 50; i++) {
    const s = JSON.parse(cello(["status"], { CELLO_DIR: dir }).stdout) as Status;
    if ((s.directory_signaling ?? "") === "connected") return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`directory_signaling never connected (${label})`);
};

describe("J-END — DOD-END-JOURNEY-1: an endorsement from Bob about Alice, end to end", () => {
  const pubkeys: Record<string, string> = {};

  it("HOP 0: three agents register and connect", async () => {
    for (const who of ["bob", "alice", "charlie"]) {
      const dir = dirFor[who];
      const created = cello(["create-agent", who], { CELLO_DIR: dir });
      expect(created.status, `create-agent ${who}: ${created.stdout}`).toBe(0);
      cello(["use-agent", who], { CELLO_DIR: dir });
      // A `DEV-` token is the local pre-auth bypass every spine journey uses; production requires a
      // real single-use token from the ops agent.
      const reg = cello(["register-agent", who, `DEV-jend-${who}-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dir });
      expect(reg.status, `register-agent ${who}: ${reg.stdout}`).toBe(0);
      await waitConnected(dir, who);

      const agents = JSON.parse(cello(["agents"], { CELLO_DIR: dir }).stdout) as { agents: Array<{ name: string; pubkey: string }> };
      const me = agents.agents.find((a) => a.name === who);
      expect(me?.pubkey, `${who} has a pubkey`).toBeTruthy();
      pubkeys[who] = me!.pubkey;
    }
  }, 120_000);

  it("HOP 1: Bob issues an endorsement about Alice, and it lands SEALED in the directory's queue", async () => {
    const conn = await connectMcp(dirFor["bob"], "jend-bob");
    mcpConns.push(conn);
    await conn.call("cello_use_agent", { name: "bob" });

    const statement = "Alice led the payments migration and shipped it with no incident.";
    const res = (await conn.call("cello_trust_signals_issue", {
      subject_pubkey: pubkeys["alice"],
      body: statement,
    })) as { ok?: boolean; reason?: string; guidance?: string; submission_id?: string };
    expect(res.ok, `issue refused: ${res.reason} — ${res.guidance}`).toBe(true);
    expect(res.submission_id, "the submission id is content-derived").toMatch(/^[0-9a-f]{64}$/);

    // THE DIRECTORY HOLDS A MAILBOX IT CANNOT READ. Assert the row exists, that it is sealed to the
    // manifest's intake generation, and — the load-bearing part — that Bob's words are NOT in it.
    const rows = psqlSpine(
      `SELECT submission_id, intake_key_id, encode(ciphertext,'escape') AS blob FROM submission_queue WHERE submission_id = '${res.submission_id}'`,
    );
    expect(rows, "the submission reached the queue").toContain(res.submission_id!);
    expect(rows, "sealed to the manifest's intake key generation").toContain(INTAKE_KEY_ID);
    expect(rows, "the directory must not be able to read the endorsement").not.toContain("payments migration");
    expect(rows, "nor the subject").not.toContain(pubkeys["alice"]);
  }, 120_000);

  it("HOP 2: the PORTAL drains, authenticates, scans, mints and delivers", async () => {
    // THE REAL PORTAL MODULES — not a re-implementation. If this ever reverts to seeding
    // `signal_records` directly, the journey stops testing the thing it exists to test.
    const { loadPortalIngress } = await import("./portal-ingress.js");
    const { HttpDirectoryClient } = await import(
      pathToFileURL(join(PORTAL_ROOT, "src/server/directory/http-client.ts")).href
    ) as { HttpDirectoryClient: new (baseUrl: string, apiKey: string) => unknown };
    const { getSubmissionSigner } = await import(
      pathToFileURL(join(PORTAL_ROOT, "src/server/trust/submission-signer.ts")).href
    ) as { getSubmissionSigner: (env: string) => unknown };

    const portal = await loadPortalIngress();
    // SELF-SUFFICIENT: apply the portal's migrations rather than assuming the container still has
    // them. A Docker restart recreates it, and without this the mint throws, the per-row catch
    // swallows it, and the journey reports "nothing minted" with every counter zero — an
    // environment fault wearing a code fault's clothes.
    await portal.migrate();
    await portal.prepareIntakeScanner();

    // ENROL THE PORTAL AS AN AUTHORIZED ISSUER — the step a real deployment performs out of band.
    //
    // The directory refuses a mint from any key not in `authorized_issuers`, and it is RIGHT to:
    // that set is the chokepoint the whole notary model rests on (spec §6's amendment collapses it
    // to portal keys). Seeding it here is enrolment, not a bypass — the submission still travels the
    // real signed path and is refused if the signature does not verify.
    const signer = getSubmissionSigner("local") as { getPublicKeyHex(): Promise<string> };
    const portalPubkey = await signer.getPublicKeyHex();
    psqlSpine(
      `INSERT INTO authorized_issuers (pubkey, role, status, label) ` +
      // ROLE is 'submitter', not 'portal' — the table's own CHECK allows only submitter|registry.
      // `issuer_kind: portal` on the ENVELOPE is a different axis entirely: it says whose voice the
      // claim is in, while this says what the key is permitted to do at the chokepoint.
      `VALUES ('${portalPubkey}', 'submitter', 'active', 'j-end portal signer') ` +
      `ON CONFLICT (pubkey) DO UPDATE SET status = 'active'`,
    );

    const result = await portal.drainAndMint({
      client: new HttpDirectoryClient(cluster.internalApiUrls[0], INTERNAL_API_KEY),
      // Keyed BY GENERATION, matching what the manifest published.
      intakeSeeds: new Map([[INTAKE_KEY_ID, intakeSeed]]),
      signer,
      // The MINT posts to /internal/signal/submit, which lives on the INTERNAL api port — not the
      // health/bootstrap port the daemons use. Pointing this at directoryUrl produced a 404 that
      // read as "directory rejected submit", i.e. a refusal, when it was a wrong address.
      directoryBaseUrl: cluster.internalApiUrls[0],
    });

    expect(result.nodeErrors, `a node failed to drain: ${JSON.stringify(result.nodeErrors)}`).toEqual([]);
    expect(result.drained, "the queued submission was drained").toBeGreaterThanOrEqual(1);
    expect(result.minted, `nothing minted — rejected:${result.rejected} poison:${result.poison} unhandledOps:${result.unhandledOps}`).toBe(1);

    // NOTARIZED: the signal exists in the directory's ledger, issued by the PORTAL (not by Bob —
    // the portal is the only issuer; Bob's identity rides inside the payload as the statement's
    // author, which is what keeps INV-UNTRUSTED and the issuer model intact).
    const notarized = psqlSpine(
      `SELECT issuer_kind, type, scanner_version FROM signal_records WHERE is_tombstone = false ORDER BY created_at DESC LIMIT 1`,
    );
    // ATTRIBUTED TO BOB, not to the portal. INV-ATTRIBUTION binds `issuer_pubkey` to the
    // authenticated identity that supplied the plaintext; the portal SIGNS the submission at the
    // chokepoint but does not author the claim. This assertion originally said "portal" and passing
    // it was the bug — the consent gate keys on `issuer_kind: agent`, so a portal-attributed
    // endorsement was auto-accepted on arrival and the whole consent mechanism was inert.
    expect(notarized, "the envelope attributes the claim to the AGENT who made it").toContain("agent");
    expect(notarized).toContain("endorsement");
    // The DERIVED scanner version, never the internal constant — the directory cannot re-run the
    // scan, so this field is the only evidence of which rules judged Bob's text.
    expect(notarized, "the signed scanner_version must name the INTAKE scanner").toMatch(/intake-v1\+[0-9a-f]{12}/);

    // THE QUEUE ROW IS GONE: the portal acked a terminal outcome.
    expect(psqlSpine(`SELECT count(*) FROM submission_queue`).replace(/\s/g, "")).toContain("0");
  }, 120_000);

  it("HOP 3: Alice receives it PENDING — inert until she decides", async () => {
    // THE DIRECTORY PUSHES PICKUPS ON RECONNECT, not on enqueue (`directory-node.ts` drains the
    // queue onto a freshly-established signaling stream). Alice connected in HOP 0, BEFORE the mint
    // in HOP 2, so her connect-time drain found nothing and the delivery is waiting for her next
    // connect. That is the documented shape — "the envelope sits there and lands when the daemon
    // next comes online" — and a subject who was already online is simply the same case with a
    // longer wait, so the journey models the reconnect explicitly rather than sleeping and hoping.
    const aliceDaemon = daemons[1];
    await aliceDaemon.stop();
    const restarted = await startDaemon(dirFor["alice"], cluster.directoryUrl, "jend-alice-2", { manifestEnv });
    daemons[1] = restarted;

    const conn = await connectMcp(dirFor["alice"], "jend-alice");
    mcpConns.push(conn);
    await conn.call("cello_use_agent", { name: "alice" });

    // The envelope arrives on the existing sealed pickup path — no new trigger, no new transport
    // (M10B / DOD-END-DELIVER-1). Poll rather than assume: a subject who is not instantly ready is
    // the NORMAL case, and the delivery is asynchronous by design.
    let pending: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 40; i++) {
      const res = (await conn.call("cello_consent_list", {})) as { ok?: boolean; pending?: Array<Record<string, unknown>> };
      pending = res.pending ?? [];
      if (pending.length > 0) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(pending.length, "the endorsement reached Alice's consent queue").toBe(1);

    const item = pending[0];
    expect(item.type).toBe("endorsement");
    // SHE CAN READ WHAT SHE IS BEING ASKED TO STAND BEHIND. Returning a byte count here was review
    // finding F2 — the surface told her to read the plaintext and handed her a number, so accepting
    // was necessarily blind.
    expect(item.payload, "the issuer's actual words, not a byte count").toBeTruthy();
    expect(JSON.stringify(item.payload)).toContain("payments migration");
    expect(item.payload_is_untrusted_text, "flagged as the issuer's words, not CELLO's").toBe(true);

    // INERT UNTIL ACCEPTED: nothing pending is presentable, by any path.
    const held = (await conn.call("cello_trust_signals_list", {})) as { signals?: Array<{ consent_state?: string }> };
    const endorsements = (held.signals ?? []).filter((x) => x.consent_state === "pending");
    expect(endorsements.length, "held, and awaiting her decision").toBe(1);
  }, 120_000);

  it("HOP 4: Alice ACCEPTS, and only then is it presentable", async () => {
    const conn = mcpConns[mcpConns.length - 1];
    const listed = (await conn.call("cello_consent_list", {})) as { pending?: Array<{ signal_hash: string }> };
    const hash = listed.pending?.[0]?.signal_hash;
    expect(hash, "still pending before the decision").toBeTruthy();

    const accepted = (await conn.call("cello_consent_accept", { hash_prefix: hash!.slice(0, 16) })) as {
      ok?: boolean; consent_state?: string; reason?: string; guidance?: string;
    };
    expect(accepted.ok, `accept refused: ${accepted.reason} — ${accepted.guidance}`).toBe(true);
    expect(accepted.consent_state).toBe("accepted");

    // The queue is empty and the signal is presentable — the two halves of the same decision.
    const after = (await conn.call("cello_consent_list", {})) as { pending?: unknown[] };
    expect(after.pending, "nothing left awaiting a decision").toHaveLength(0);

    const held = (await conn.call("cello_trust_signals_list", {})) as { signals?: Array<{ consent_state?: string }> };
    expect((held.signals ?? []).some((x) => x.consent_state === "accepted"), "now presentable").toBe(true);
  }, 120_000);

  it("HOP 5: Alice presents to Charlie, who verifies it and sees BOB'S voice, not CELLO's", async () => {
    const alice = mcpConns[mcpConns.length - 1];
    // Bare `.ok).toBe(true)` assertions give "expected false to be true" and nothing else, which is
    // useless at 3am. Every call here reports what it actually got.
    const added = (await alice.call("cello_contact_add", { pubkey: pubkeys["charlie"] })) as Record<string, unknown>;
    expect(added.ok, `contact_add: ${JSON.stringify(added)}`).toBe(true);
    // Alice is ALREADY current from HOP 4, and re-selecting returns
    // `{ok:false, reason:"agent_already_current"}` — a benign no-op whose own guidance says "No
    // action needed". Worth noting as an API wrinkle (a script branching on `ok` reads a no-op as a
    // failure), but the journey simply does not need the redundant call.

    const charlie = await connectMcp(dirFor["charlie"], "jend-charlie");
    mcpConns.push(charlie);
    const started = (await charlie.call("cello_start_agent", { name: "charlie" })) as Record<string, unknown>;
    expect(started.ok, `start_agent(charlie): ${JSON.stringify(started)}`).toBe(true);
    const usedC = (await charlie.call("cello_use_agent", { name: "charlie" })) as Record<string, unknown>;
    expect(usedC.ok, `use_agent(charlie): ${JSON.stringify(usedC)}`).toBe(true);

    const awaiting = charlie.call("cello_await_session", { timeout_ms: 30_000 });
    const init = (await alice.call("cello_initiate_session", { target_pubkey: pubkeys["charlie"] })) as { ok?: boolean };
    expect(init.ok, `initiate failed: ${JSON.stringify(init)}`).toBe(true);

    const inbound = (await awaiting) as {
      type?: string;
      trust_signals?: Array<{ type: string; issuer: string; claim: Record<string, unknown> }>;
    };
    expect(inbound.type).toBe("new_session");
    expect(inbound.trust_signals, "Charlie must receive the endorsement Alice accepted").toBeDefined();

    const endorsement = inbound.trust_signals!.find((x) => x.type === "endorsement");
    expect(endorsement, `no endorsement presented: ${JSON.stringify(inbound.trust_signals)}`).toBeTruthy();

    // ── INV-UNTRUSTED, ALL THE WAY TO A CONSUMING CONTEXT ────────────────────────────────────────
    // This is the assertion the whole milestone builds toward. Charlie's agent is about to put this
    // in an LLM's context, and the two voices must still be distinguishable at that point:
    //
    //   - CELLO's `claim` says only what CELLO knows — that a key signed it and it passed the scan.
    //   - Bob's `statement` is his own words, flagged untrusted, with his key beside them.
    //
    // If these had merged upstream, a stranger's sentence would arrive wearing CELLO's authority and
    // nothing downstream could tell. That is why the portal's claim is asserted NOT to contain his
    // text rather than merely asserting his text is present somewhere.
    const claim = endorsement!.claim;
    expect(claim.statement, "Bob's words, verbatim").toContain("payments migration");
    expect(claim.statement_is_untrusted).toBe(true);
    expect(claim.statement_author_pubkey, "attributed to BOB, the author").toBe(pubkeys["bob"]);

    // ── THE WRAPPER, NOT ONLY THE PAYLOAD ────────────────────────────────────────────────────────
    // A review showed the earlier version of this block was BYPASSABLE: it asserted only on fields
    // nested inside `claim`, so adding `summary: \`${type}: ${statement}\`` to the projection would
    // have put Bob's sentence in front of the model under `directory_verified: true` with every
    // assertion still green. M10B-D13 says exactly that — the payload split alone does not satisfy
    // INV-UNTRUSTED.
    expect(endorsement!.issuer, "framed as peer-claimed, not platform-verified").toBe("peer-claimed");
    const projected = endorsement as unknown as Record<string, unknown>;
    expect(projected.content_is_peer_claimed).toBe(true);
    expect(String(projected.framing), "and told how to treat it").toMatch(/did NOT verify|does not vouch/i);

    // NO PART OF THE PROJECTION OUTSIDE `statement` MAY CARRY BOB'S WORDS. Asserted over the whole
    // object rather than one field, because the bypass was a NEW field — checking only the fields
    // that exist today cannot catch a field added tomorrow.
    const withoutStatement = JSON.stringify({ ...projected, claim: { ...claim, statement: "" } });
    for (const phrase of ["payments migration", "led the payments", "no incident"]) {
      expect(withoutStatement, `"${phrase}" leaked outside the quoted statement`).not.toContain(phrase);
    }

    // The session-level attestation must not claim CELLO verified the CONTENT.
    const attestation = String((inbound as unknown as Record<string, unknown>).directory_attestation ?? "");
    expect(attestation, "the attestation covers provenance, not truth").not.toMatch(/each verified by the CELLO directory/i);
    expect(attestation).toMatch(/peer-claimed/i);

    // THE DIRECTORY IS THE ENFORCER, not Charlie's daemon — worth stating precisely, because the
    // DoD clause reads "Charlie verifies" and he does not: `inbound-sessions.ts` records the verdict
    // the DIRECTORY supplied. The directory strips non-active signals from the assignment before it
    // is sent, which is why this must be bound to the hash Charlie actually received rather than to
    // "some endorsement, somewhere" — an unbound query here cannot fail without the assertions above
    // having already failed.
    const presentedHash = (endorsement as unknown as { signal_hash?: string }).signal_hash;
    expect(presentedHash, "the projection carries the hash it was verified under").toMatch(/^[0-9a-f]{64}$/);
    expect(psqlSpine(
      `SELECT effective_status FROM signal_records_effective WHERE signal_hash = '${presentedHash}'`,
    ), "the hash Charlie holds is live in the notary ledger").toContain("active");
  }, 120_000);

  it("HOP 6 (case a): Alice REFUSES a second endorsement with a message — and it never reaches Charlie", async () => {
    const bob = mcpConns[0];
    const alice = mcpConns[1];

    // ── Bob issues a SECOND endorsement, one Alice will not stand behind ──
    const wrong = "Alice single-handedly rewrote the billing system over a weekend.";
    const issued = (await bob.call("cello_trust_signals_issue", {
      subject_pubkey: pubkeys["alice"], body: wrong,
    })) as { ok?: boolean; reason?: string; guidance?: string };
    expect(issued.ok, `issue refused: ${issued.reason} — ${issued.guidance}`).toBe(true);

    const { loadPortalIngress } = await import("./portal-ingress.js");
    const portal = await loadPortalIngress();
    const { HttpDirectoryClient } = await import(
      pathToFileURL(join(PORTAL_ROOT, "src/server/directory/http-client.ts")).href
    ) as { HttpDirectoryClient: new (baseUrl: string, apiKey: string) => unknown };
    const { getSubmissionSigner } = await import(
      pathToFileURL(join(PORTAL_ROOT, "src/server/trust/submission-signer.ts")).href
    ) as { getSubmissionSigner: (env: string) => unknown };

    const pass = await portal.drainAndMint({
      client: new HttpDirectoryClient(cluster.internalApiUrls[0], INTERNAL_API_KEY),
      intakeSeeds: new Map([[INTAKE_KEY_ID, intakeSeed]]),
      signer: getSubmissionSigner("local"),
      directoryBaseUrl: cluster.internalApiUrls[0],
    });
    expect(pass.minted, `second endorsement not minted: ${JSON.stringify(pass)}`).toBe(1);

    // ── It lands PENDING; Alice refuses it, WITH a message (M10B-D4) ──
    // Reconnect: the directory pushes pickups on reconnect, not on enqueue (see HOP 3).
    await daemons[1].stop();
    daemons[1] = await startDaemon(dirFor["alice"], cluster.directoryUrl, "jend-alice-3", { manifestEnv });
    const alice2 = await connectMcp(dirFor["alice"], "jend-alice-refuse");
    mcpConns.push(alice2);
    await alice2.call("cello_use_agent", { name: "alice" });

    let pending: Array<{ signal_hash: string }> = [];
    for (let i = 0; i < 40; i++) {
      const res = (await alice2.call("cello_consent_list", {})) as { pending?: Array<{ signal_hash: string }> };
      pending = res.pending ?? [];
      if (pending.length > 0) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(pending.length, "the second endorsement is awaiting her decision").toBe(1);

    const refused = (await alice2.call("cello_consent_refuse", {
      hash_prefix: pending[0].signal_hash.slice(0, 16),
      message: "I reviewed that migration, I did not write it. Happy to be endorsed for the review.",
    })) as { ok?: boolean; consent_state?: string; message_queued?: boolean; message_error?: string };
    expect(refused.ok, `refuse failed: ${JSON.stringify(refused)}`).toBe(true);
    expect(refused.consent_state).toBe("refused");
    // THE REFUSAL IS RECORDED WHETHER OR NOT THE MESSAGE GOES ANYWHERE — the decision must never be
    // contingent on the network, or Alice believes she rejected something that is still pending.
    expect(refused.message_queued, `message not queued: ${refused.message_error}`).toBe(true);

    // THE REFUSAL IS DURABLE, asserted HERE rather than inferred from a later hop. A review found
    // this hop passed for the wrong reason: presentation filters on `consent_state = 'accepted'`, so
    // a `consent_refuse` that was a total no-op would leave the endorsement PENDING — equally
    // unpresentable — and the "exactly one" count below would still be green. The count
    // distinguishes accepted-from-not, never refused-from-pending.
    const afterRefusal = (await alice2.call("cello_consent_list", {})) as { pending?: unknown[] };
    expect(afterRefusal.pending, "no decision is left outstanding").toHaveLength(0);
    const heldNow = (await alice2.call("cello_trust_signals_list", {})) as { signals?: Array<{ consent_state?: string }> };
    expect(
      (heldNow.signals ?? []).filter((x) => x.consent_state === "refused"),
      "the refusal is RECORDED, not merely reported",
    ).toHaveLength(1);

    // Her message rides the SAME submission queue as an `op: refuse` — the same injection surface
    // pointed the other way, scanned identically at intake. Proven by the next drain classifying it
    // as an unhandled op (the handler is not built), not merely by a row existing.
    expect(psqlSpine(`SELECT count(*) FROM submission_queue`).replace(/\s/g, ""), "the refusal message is queued").not.toBe("0");
    const refusePass = await portal.drainAndMint({
      client: new HttpDirectoryClient(cluster.internalApiUrls[0], INTERNAL_API_KEY),
      intakeSeeds: new Map([[INTAKE_KEY_ID, intakeSeed]]),
      signer: getSubmissionSigner("local"),
      directoryBaseUrl: cluster.internalApiUrls[0],
    });
    expect(refusePass.unhandledOps, "the queued row is a `refuse` op, recognised and left queued").toBe(1);
    expect(refusePass.minted, "a refusal must never mint anything").toBe(0);

    // ── AND CHARLIE NEVER SEES IT. The refused endorsement is unpresentable by every path. ──
    const charlie = mcpConns[mcpConns.length - 2];
    const awaiting = charlie.call("cello_await_session", { timeout_ms: 30_000 });
    const init = (await alice2.call("cello_initiate_session", { target_pubkey: pubkeys["charlie"] })) as { ok?: boolean };
    expect(init.ok, `second session failed: ${JSON.stringify(init)}`).toBe(true);

    const inbound = (await awaiting) as { trust_signals?: Array<{ type: string; claim: Record<string, unknown> }> };
    const endorsements = (inbound.trust_signals ?? []).filter((x) => x.type === "endorsement");
    // EXACTLY ONE — the accepted one. Two would mean a refused endorsement was presentable; zero
    // would mean the accepted one had stopped being. Both are failures, and only an exact count
    // catches both.
    expect(endorsements.length, `Charlie saw ${endorsements.length} endorsements; only the ACCEPTED one may present`).toBe(1);
    expect(String(endorsements[0].claim.statement)).toContain("payments migration");
    expect(String(endorsements[0].claim.statement), "the refused claim must not appear").not.toContain("billing system");
  }, 180_000);

  it("HOP 7 (case a2): Alice is OFFLINE when Bob submits — nothing is lost, and she is TOLD on return", async () => {
    // A SUBJECT WHO NEVER ACTS IS THE NORMAL CASE, not an error case. Nothing in the mint path may
    // assume the subject is present, and the operator must not have to go looking.
    const bob = mcpConns[0];

    // Alice's daemon goes DOWN before Bob submits anything.
    await daemons[1].stop();

    const issued = (await bob.call("cello_trust_signals_issue", {
      subject_pubkey: pubkeys["alice"],
      body: "Alice reviewed the auth rewrite and caught two race conditions.",
    })) as { ok?: boolean; reason?: string; guidance?: string };
    expect(issued.ok, `issue refused while subject offline: ${issued.reason} — ${issued.guidance}`).toBe(true);

    const { loadPortalIngress } = await import("./portal-ingress.js");
    const portal = await loadPortalIngress();
    const { HttpDirectoryClient } = await import(
      pathToFileURL(join(PORTAL_ROOT, "src/server/directory/http-client.ts")).href
    ) as { HttpDirectoryClient: new (baseUrl: string, apiKey: string) => unknown };
    const { getSubmissionSigner } = await import(
      pathToFileURL(join(PORTAL_ROOT, "src/server/trust/submission-signer.ts")).href
    ) as { getSubmissionSigner: (env: string) => unknown };

    // THE MINT MUST SUCCEED WITH THE SUBJECT DOWN. If it required her to be online, an endorsement
    // would be undeliverable exactly when it is most ordinary — the recipient is simply not at
    // their desk.
    const pass = await portal.drainAndMint({
      client: new HttpDirectoryClient(cluster.internalApiUrls[0], INTERNAL_API_KEY),
      intakeSeeds: new Map([[INTAKE_KEY_ID, intakeSeed]]),
      signer: getSubmissionSigner("local"),
      directoryBaseUrl: cluster.internalApiUrls[0],
    });
    expect(pass.minted, `mint failed with the subject offline: ${JSON.stringify(pass)}`).toBe(1);

    // The envelope waits in the pickup path rather than being dropped.
    expect(psqlSpine(`SELECT count(*) FROM pickup_queue WHERE acked_at IS NULL`).replace(/\s/g, ""), "the envelope is waiting for her").not.toBe("0");

    // ── She comes back ──
    daemons[1] = await startDaemon(dirFor["alice"], cluster.directoryUrl, "jend-alice-4", { manifestEnv });
    const alice3 = await connectMcp(dirFor["alice"], "jend-alice-return");
    mcpConns.push(alice3);

    // SELECTING THE AGENT TELLS HER SOMETHING IS WAITING. This is the clause a review found had zero
    // coverage: the store methods were tested, the response field was not, and an implementation
    // that computed the count and never attached it passed everything.
    let nudge: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) {
      nudge = (await alice3.call("cello_use_agent", { name: "alice" })) as Record<string, unknown>;
      if (nudge.pending_consent !== undefined && nudge.pending_consent !== 0) break;
      // Re-selecting the current agent is a no-op, so switch away and back to re-trigger it.
      await alice3.call("cello_use_agent", { name: "charlie" }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(nudge.pending_consent, `no pending-consent nudge on selection: ${JSON.stringify(nudge)}`).toBe(1);
    expect(String(nudge.pending_consent_guidance), "and told what to run about it").toMatch(/consent/i);

    // NOTHING WAS LOST: the endorsement is there, awaiting her decision.
    const listed = (await alice3.call("cello_consent_list", {})) as { pending?: Array<{ signal_hash: string }> };
    expect(listed.pending, "the endorsement survived her absence").toHaveLength(1);

    // AND THE NOTIFICATION DOES NOT REPEAT once seen. `cello_consent_list` above stamped
    // `consent_notified_at`, so a fresh selection must now carry no nudge.
    //
    // A FRESH CONNECTION IS REQUIRED, and the previous version of this got it wrong: re-selecting
    // the already-current agent early-returns `agent_already_current` BEFORE the nudge block runs,
    // so its response has no `pending_consent` field whatever the state. Asserting on that proved
    // nothing — it was `void second;`, asserting literally nothing, while the DoD claimed the clause
    // proven.
    const alice4 = await connectMcp(dirFor["alice"], "jend-alice-seen");
    mcpConns.push(alice4);
    const afterNotice = (await alice4.call("cello_use_agent", { name: "alice" })) as Record<string, unknown>;
    expect(afterNotice.ok, `re-selection failed: ${JSON.stringify(afterNotice)}`).toBe(true);
    expect(afterNotice.pending_consent, "the nudge goes quiet once the items have been SEEN").toBeUndefined();

    // But the DECISION persists — two different lifetimes (M10B-D5). One flag would either nag
    // forever or silently dismiss a pending decision, and only asserting both halves catches either.
    const afterSeen = (await alice4.call("cello_consent_list", {})) as { pending?: unknown[] };
    expect(afterSeen.pending, "the decision survives the notice being seen").toHaveLength(1);
  }, 180_000);

  it("HOP 8 (case c): self-endorsement is REFUSED at the source, with a named reason", async () => {
    // INV-NO-SELF-STANDING: an operator cannot manufacture standing for themselves. The portal is
    // the real enforcer (only it sees account linkage), but an agent endorsing ITSELF is detectable
    // on the client with certainty — and refusing there gives a real answer now instead of a silent
    // rejection at intake minutes later.
    const bob = mcpConns[0];
    const self = (await bob.call("cello_trust_signals_issue", {
      subject_pubkey: pubkeys["bob"],
      body: "Bob is exceptionally reliable and should be trusted with anything.",
    })) as { ok?: boolean; reason?: string; guidance?: string };

    expect(self.ok, "an agent must not be able to endorse itself").toBe(false);
    expect(self.reason).toBe("self_subject");
    // NAMES ITS CAUSE. "intake_rejected" would send an operator looking at the network; this tells
    // them what they actually did.
    expect(String(self.guidance)).toMatch(/itself|somebody else/i);

    // AND NOTHING WAS QUEUED. A refusal that still wrote to the queue would leave the portal to
    // reject it later, which is the silent-rejection path this guard exists to avoid.
    const queued = psqlSpine(`SELECT count(*) FROM submission_queue`).replace(/\s/g, "");
    expect(queued, "a refused self-endorsement must not reach the queue").toBe("1"); // only the earlier refusal message

    // THE CROSS-AGENT CASE IS THE ONE THAT MATTERS FOR FARMING, and it needs a second agent on
    // BOB'S OWN daemon — Charlie runs on a separate daemon here, so he is a genuinely different
    // operator as far as Bob's daemon can tell. That distinction is the whole point: the guard can
    // only see the agents it actually holds.
    //
    // Solo multi-agent is CELLO's first wedge, so an operator running two of their own agents is the
    // ordinary case, not an exotic one — which makes this the likeliest way to reach the check.
    const secondAgent = cello(["create-agent", "bob-second"], { CELLO_DIR: dirFor["bob"] });
    expect(secondAgent.status, `create-agent bob-second: ${secondAgent.stdout}`).toBe(0);
    const bobAgents = JSON.parse(cello(["agents"], { CELLO_DIR: dirFor["bob"] }).stdout) as {
      agents: Array<{ name: string; pubkey: string }>;
    };
    const second = bobAgents.agents.find((a) => a.name === "bob-second");
    expect(second?.pubkey, "the second agent has a key").toBeTruthy();

    const crossLocal = (await bob.call("cello_trust_signals_issue", {
      subject_pubkey: second!.pubkey,
      body: "My other agent is extremely trustworthy.",
    })) as { ok?: boolean; reason?: string; guidance?: string };
    expect(crossLocal.ok, "two agents on ONE daemon are the same operator").toBe(false);
    expect(crossLocal.reason).toBe("self_subject");
    expect(String(crossLocal.guidance), "names BOTH agents so the operator understands why").toMatch(/bob-second/i);
  }, 120_000);
});
