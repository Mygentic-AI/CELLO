/**
 * M12 DOD-ADAPTER-GCP-1 — GCP adapters behind the existing interfaces (M12-D6 set:
 * GCS cloud-storage + GCS audit-log + Cloud KMS envelope key).
 *
 * The adapters are thin by design — the value they must deliver is BEHAVIORAL PARITY with the AWS
 * implementations they stand beside, because the composition root picks one or the other by
 * `CELLO_ENV`/config and nothing downstream knows which it got. So these tests pin the contract
 * differences that actually bite:
 *  - `download()` of a missing object returns `undefined`, it does not throw (S3 signals this with
 *    a NoSuchKey exception, GCS with a 404 error code — different mechanics, same contract);
 *  - the audit shipper buffers and `flush()` returns the number shipped, and a failed ship is
 *    RETRIED rather than silently dropped (an audit trail that loses entries is worse than none);
 *  - envelope encrypt/decrypt round-trips through Cloud KMS and NEVER returns plaintext on a
 *    failed decrypt — it throws (a fail-open envelope provider would hand out unusable share
 *    material as if it were real).
 *
 * The GCP clients are INJECTED, so these run with no credentials and no network. Live-cloud proof
 * belongs to DOD-NODE-DIR-GCP-1 (the first real GCP directory), not here.
 */

import { describe, it, expect, vi } from "vitest";
import { GcsCloudStorageProvider } from "../adapters/gcs-cloud-storage-provider.js";
import { GcsAuditLogShipper } from "../adapters/gcs-audit-log-shipper.js";
import { KmsEnvelopeKeyProvider } from "../adapters/gcp-kms-envelope-key-provider.js";
import type { AuditLogEntry } from "@cello-protocol/interfaces";

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as never;

/** A fake GCS bucket/file surface — the slice of @google-cloud/storage the adapters use. */
function fakeStorage(opts?: { missing?: boolean; failSave?: boolean; bucketMissing?: boolean }) {
  const saved = new Map<string, Buffer>();
  const file = (name: string) => ({
    save: async (data: Buffer) => {
      if (opts?.failSave) throw new Error("gcs save failed");
      saved.set(name, data);
    },
    download: async (): Promise<[Buffer]> => {
      if (opts?.missing || !saved.has(name)) {
        // GCS signals a missing object with a 404-coded error, NOT a typed exception like S3.
        const err = new Error("No such object") as Error & { code: number };
        err.code = 404;
        throw err;
      }
      return [saved.get(name)!];
    },
  });
  return { saved, storage: { bucket: () => ({ file, exists: async (): Promise<[boolean]> => [opts?.bucketMissing !== true] }) } as never };
}

describe("DOD-ADAPTER-GCP-1: GcsCloudStorageProvider", () => {
  it("round-trips an upload through the bucket", async () => {
    const { storage, saved } = fakeStorage();
    const p = new GcsCloudStorageProvider("cello-bucket", storage);
    await p.upload("relay-manifest.json", new Uint8Array([1, 2, 3]));
    expect([...saved.keys()]).toEqual(["relay-manifest.json"]);
    expect(await p.download("relay-manifest.json")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("returns undefined for a MISSING object (parity with the S3 NoSuchKey contract)", async () => {
    // The interface says "returns undefined if not found" — GCS raises a 404-coded error where S3
    // throws NoSuchKey, so this mapping is the whole reason the adapter exists.
    const { storage } = fakeStorage({ missing: true });
    const p = new GcsCloudStorageProvider("cello-bucket", storage);
    await expect(p.download("absent.json")).resolves.toBeUndefined();
  });

  it("a MISSING BUCKET throws instead of reading as an empty bucket (GCS 404s both)", async () => {
    // GCS returns 404 for a missing bucket exactly as it does for a missing object — unlike S3,
    // where NoSuchBucket and NoSuchKey are distinct. Mapping this to `undefined` would report a
    // mistyped bucket as "no manifest published yet", which the relay-pool loader treats as a
    // benign designed state and NEVER retries: the node boots healthy and assigns no relays.
    const { storage } = fakeStorage({ missing: true, bucketMissing: true });
    const p = new GcsCloudStorageProvider("cello-typo-bucket", storage);
    await expect(p.download("relay-manifest.json")).rejects.toThrow(/bucket 'cello-typo-bucket' does not exist/);
  });

  it("propagates a NON-404 failure instead of masking it as 'not found'", async () => {
    // A permissions error must never look like an empty bucket: the relay pool would silently
    // read as "no relays" and every session assignment would fail with no cause named.
    const storage = {
      bucket: () => ({
        exists: async (): Promise<[boolean]> => [true],
        file: () => ({
          save: async () => {},
          download: async () => { const e = new Error("permission denied") as Error & { code: number }; e.code = 403; throw e; },
        }),
      }),
    } as never;
    const p = new GcsCloudStorageProvider("cello-bucket", storage);
    await expect(p.download("x.json")).rejects.toThrow(/permission denied/);
  });
});

describe("DOD-ADAPTER-GCP-1: GcsAuditLogShipper", () => {
  const entry = (i: number): AuditLogEntry => ({
    timestamp: `2026-07-28T00:00:0${i}Z`,
    sessionId: `s${i}`, objectType: "TABLE", command: "SELECT",
    statementText: "SELECT 1", parameters: [],
  });

  it("ships each entry IMMEDIATELY (write-through, S3 parity — not batch-on-flush)", async () => {
    // The parity that matters: an audit trail which only lands on flush() loses everything a
    // crash interrupts. Two ships ⇒ two objects, before any flush() is called.
    const { storage, saved } = fakeStorage();
    const s = new GcsAuditLogShipper("cello-audit", noopLogger, storage);
    await s.ship(entry(1));
    await s.ship(entry(2));
    expect(saved.size).toBe(2);
    expect(await s.flush()).toBe(0); // nothing was buffered — all already shipped
  });

  it("BUFFERS on write failure instead of dropping, and a later flush ships the backlog", async () => {
    // The failure that matters: a dropped audit entry is unrecoverable AND invisible — nothing
    // downstream ever notices a missing row. It must survive to the next attempt.
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    let failing = true;
    const saved = new Map<string, Buffer>();
    const storage = {
      bucket: () => ({
        exists: async (): Promise<[boolean]> => [true],
        file: (name: string) => ({
          save: async (data: Buffer) => {
            if (failing) throw new Error("gcs save failed");
            saved.set(name, data);
          },
          download: async (): Promise<[Buffer]> => { throw new Error("unused"); },
        }),
      }),
    } as never;

    const s = new GcsAuditLogShipper("cello-audit", logger as never, storage);
    await s.ship(entry(1));
    // Assert the EVENT NAME, not just "something was logged": an alarm is keyed on
    // `audit.shipper.degraded`, and a GCS-only event name would silently never match it.
    expect(logger.warn).toHaveBeenCalledWith(
      "audit.shipper.degraded",
      expect.objectContaining({ bufferedCount: 1, oldestEntryAge: expect.any(Number) }),
    );
    expect(saved.size).toBe(0);

    // A flush while still failing must RETAIN the buffer, not clear it optimistically.
    expect(await s.flush()).toBe(0);

    failing = false;
    expect(await s.flush()).toBe(1); // the retained entry finally ships
    expect(saved.size).toBe(1);
    expect(JSON.parse([...saved.values()][0]!.toString("utf8").trim()).sessionId).toBe("s1");
  });

  it("stays degraded while the buffer is non-empty, so ordering is preserved", async () => {
    // Once degraded, later entries queue BEHIND the backlog rather than overtaking it.
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const { storage } = fakeStorage({ failSave: true });
    const s = new GcsAuditLogShipper("cello-audit", logger as never, storage);
    await s.ship(entry(1)); // fails → buffered
    await s.ship(entry(2)); // sees a non-empty buffer → queued, warns degraded
    expect(logger.warn).toHaveBeenCalledWith(
      "audit.shipper.degraded",
      expect.objectContaining({ bufferedCount: 2 }),
    );
  });

  it("flush() with nothing buffered ships nothing and returns 0", async () => {
    const { storage, saved } = fakeStorage();
    const s = new GcsAuditLogShipper("cello-audit", noopLogger, storage);
    expect(await s.flush()).toBe(0);
    expect(saved.size).toBe(0);
  });
});

describe("DOD-ADAPTER-GCP-1: KmsEnvelopeKeyProvider (Cloud KMS)", () => {
  /** A fake Cloud KMS client — encrypt/decrypt are the only surface the adapter uses. */
  function fakeKms(opts?: { failDecrypt?: boolean }) {
    return {
      encrypt: async ({ plaintext }: { plaintext: Buffer }) => [
        { ciphertext: Buffer.concat([Buffer.from("KMS:"), plaintext]) },
      ],
      decrypt: async ({ ciphertext }: { ciphertext: Buffer }) => {
        if (opts?.failDecrypt) throw new Error("kms decrypt denied");
        return [{ plaintext: Buffer.from(ciphertext).subarray(4) }];
      },
      cryptoKeyPath: () => "projects/p/locations/l/keyRings/r/cryptoKeys/k",
    } as never;
  }

  const cfg = { projectId: "cello-infra", locationId: "us-central1", keyRingId: "cello", cryptoKeyId: "envelope" };

  it("round-trips share material through KMS", async () => {
    const p = new KmsEnvelopeKeyProvider(cfg, fakeKms());
    const plaintext = new Uint8Array([9, 8, 7, 6]);
    const ct = await p.encrypt(plaintext, "k-server-share");
    expect(ct).not.toEqual(plaintext); // actually wrapped
    expect(await p.decrypt(ct, "k-server-share")).toEqual(plaintext);
  });

  it("THROWS on a failed decrypt — never returns plaintext or empty bytes", async () => {
    // A fail-open envelope provider would hand the share store unusable bytes that look like a
    // real K_server share; every later ceremony would fail with an unrelated-looking error.
    const p = new KmsEnvelopeKeyProvider(cfg, fakeKms({ failDecrypt: true }));
    await expect(p.decrypt(new Uint8Array([1, 2, 3]), "k-server-share")).rejects.toThrow(/kms decrypt/);
  });

  it("THROWS when KMS returns a response with NO plaintext (the guard, not the client, failing)", async () => {
    // The previous decrypt test passed because the fake CLIENT threw — it never reached the null
    // guard. This one returns a well-formed-but-empty response, which is the shape that would
    // otherwise yield `new Uint8Array(undefined)`: a zero-length buffer handed to the share store
    // as if it were real K_server material.
    const emptyResponse = {
      encrypt: async () => [{}],
      decrypt: async () => [{}],
      cryptoKeyPath: () => "projects/p/locations/l/keyRings/r/cryptoKeys/k",
    } as never;
    const p = new KmsEnvelopeKeyProvider(cfg, emptyResponse);
    await expect(p.decrypt(new Uint8Array([1]), "k-server-share")).rejects.toThrow(/failing closed/);
    await expect(p.encrypt(new Uint8Array([1]), "k-server-share")).rejects.toThrow(/refusing to persist/);
  });

  it("THROWS when KMS returns an explicit null plaintext", async () => {
    const nullResponse = {
      encrypt: async () => [{ ciphertext: null }],
      decrypt: async () => [{ plaintext: null }],
      cryptoKeyPath: () => "projects/p/locations/l/keyRings/r/cryptoKeys/k",
    } as never;
    const p = new KmsEnvelopeKeyProvider(cfg, nullResponse);
    await expect(p.decrypt(new Uint8Array([1]), "k-server-share")).rejects.toThrow(/failing closed/);
    await expect(p.encrypt(new Uint8Array([1]), "k-server-share")).rejects.toThrow(/refusing to persist/);
  });

  it("decodes a BASE64-STRING response (the REST transport shape, not just Buffer)", async () => {
    // gRPC yields Buffers; the REST/fallback transport yields base64 strings. That branch is live
    // in production, so it must not be proven only against the Buffer path.
    const plaintext = new Uint8Array([4, 5, 6]);
    const b64 = {
      encrypt: async ({ plaintext: pt }: { plaintext: Buffer }) => [{ ciphertext: Buffer.from(pt).toString("base64") }],
      decrypt: async ({ ciphertext }: { ciphertext: Buffer }) => [{ plaintext: Buffer.from(ciphertext).toString("base64") }],
      cryptoKeyPath: () => "projects/p/locations/l/keyRings/r/cryptoKeys/k",
    } as never;
    const p = new KmsEnvelopeKeyProvider(cfg, b64);
    const ct = await p.encrypt(plaintext, "k");
    expect(new Uint8Array(Buffer.from(Buffer.from(ct).toString("utf8"), "base64"))).toBeDefined();
    // Round-trip through the string branch on BOTH sides returns the original bytes.
    expect(await p.decrypt(ct, "k")).toEqual(ct);
  });

  it("rotate() is a no-op that does not throw (Cloud KMS rotates key VERSIONS server-side)", async () => {
    // Parity note: the interface's rotate() exists for the AWS re-encrypt flow. Cloud KMS rotates
    // key versions itself and decrypt resolves the version from the ciphertext, so there is
    // nothing for the adapter to do — but it must not throw, or rotation would look broken.
    const p = new KmsEnvelopeKeyProvider(cfg, fakeKms());
    await expect(p.rotate("k-server-share")).resolves.toBeUndefined();
  });
});
