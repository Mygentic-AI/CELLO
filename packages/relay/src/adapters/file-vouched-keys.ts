/**
 * DOD-M15-RELAYAUTH-1 review H2 — **durable vouching, because the mailbox it guards is durable.**
 *
 * `recordAssignment` vouches both participants of a directory-signed assignment, and content-park
 * pull/confirm refuse anyone not vouched. Held only in memory, that gate had a failure mode worse
 * than the one it closed: park mail for an agent, roll the relay (a deploy, a MIG roll, a crash),
 * and on reconnect the agent is TOLD content is waiting and then refused when it asks for it —
 * because the vouched set came up empty and a client does not re-present its assignment on
 * reconnect. The mail sat there, uncollectable, until some new session happened to be brokered on
 * that same relay.
 *
 * A gate over durable state has to be as durable as the state. This is that persistence, and it is
 * deliberately the dumbest thing that works: **one empty file per vouched key.** Creating a file is
 * atomic, so there is no partial write; there is nothing to parse, so there is no corruption mode
 * and no schema to migrate; and loading is a `readdir`. Compare a JSON-lines file, which would have
 * brought append interleaving, truncation on a crash mid-write, and a decode path that could fail
 * closed and re-strand the mailbox — reintroducing the bug in a new place.
 *
 * Growth is bounded by the number of distinct agents this relay has ever brokered a session for,
 * one empty inode each. Never pruned, matching the in-memory set it replaces and the real lifecycle:
 * an agent that finishes one session is still the same registered agent for the next.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "@cello-protocol/interfaces";

/** A pubkey is a real participant here — named by at least one assignment this relay recorded. */
export interface VouchedKeyStore {
  /** Everything vouched before this process started. Called once, at construction. */
  load(): Set<string>;
  /** Record a vouch durably. Must not throw — a failure here must never fail the assignment. */
  add(pubkeyHex: string): void;
}

/**
 * The default for tests and `CELLO_ENV=local`, where the content store is in-memory too: nothing
 * outlives the process on either side, so there is no mailbox left behind to be stranded.
 */
export class InMemoryVouchedKeyStore implements VouchedKeyStore {
  load(): Set<string> {
    return new Set<string>();
  }
  add(): void {
    /* nothing to persist */
  }
}

export interface FileVouchedKeyStoreOptions {
  walDir: string;
  logger: Logger;
}

export class FileVouchedKeyStore implements VouchedKeyStore {
  readonly #root: string;
  readonly #logger: Logger;
  /** Written-through cache, so a repeated vouch for the same key costs no syscall. */
  readonly #written = new Set<string>();

  constructor(opts: FileVouchedKeyStoreOptions) {
    this.#root = join(opts.walDir, "vouched");
    this.#logger = opts.logger;
  }

  load(): Set<string> {
    try {
      mkdirSync(this.#root, { recursive: true });
      // Only well-formed 64-hex names are accepted. Anything else in this directory did not come
      // from `add()` below, and silently trusting it would make the gate depend on whatever else
      // can write to WAL_DIR.
      const keys = readdirSync(this.#root).filter((name) => /^[0-9a-f]{64}$/.test(name));
      for (const k of keys) this.#written.add(k);
      this.#logger.info("relay.vouched.loaded", {
        count: keys.length,
        impact: "agents vouched before this restart can collect parked content without waiting for a new session",
      });
      return new Set(keys);
    } catch (err: unknown) {
      /**
       * Loud, and named for the consequence. Failing to read this is not cosmetic: every agent with
       * mail parked here is refused when it tries to collect it, which is precisely the outage this
       * class exists to prevent. Returning an empty set is the safe direction (it can only refuse,
       * never over-admit), so the relay still starts — but nobody should have to infer that from a
       * bare filesystem error.
       */
      this.#logger.error("relay.vouched.load_failed", {
        error: err instanceof Error ? err.message : String(err),
        impact: "agents with content parked here will be refused when they try to collect it until a new session re-vouches them",
      });
      return new Set<string>();
    }
  }

  add(pubkeyHex: string): void {
    if (this.#written.has(pubkeyHex)) return;
    try {
      mkdirSync(this.#root, { recursive: true });
      writeFileSync(join(this.#root, pubkeyHex), "");
      this.#written.add(pubkeyHex);
    } catch (err: unknown) {
      // Never rethrow: an assignment that verified against a directory signature must be recorded
      // whatever the disk is doing. The cost of this failure is bounded — the in-memory set still
      // has the key, so it is only a RESTART that would forget it.
      this.#logger.error("relay.vouched.persist_failed", {
        error: err instanceof Error ? err.message : String(err),
        impact: "this agent is vouched for the life of this process, but a restart will forget it and refuse its parked content",
      });
    }
  }
}
