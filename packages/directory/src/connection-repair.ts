/**
 * DOD-M12-CONN-DIR-RELAY-1 / DOD-M12-CONN-AE-1 — repairing a libp2p connection this process holds.
 *
 * WHY THIS EXISTS AS ONE MODULE. The directory holds long-lived connections on two links — to the
 * relay (`network-relay-adapter`) and to its peer directories (`ae-sync-service`) — and both had the
 * same defect, fixed the same way. The relay package solved it first and solved four things this
 * side initially got wrong: narrowing to a lost connection, logging the repair's OUTCOME, rendering
 * a thrown plain object legibly, and counting what a peer-scoped eviction destroyed. Rather than
 * carry those four fixes twice more and drift again, they live here once.
 *
 * NOT shared with `packages/relay`, deliberately. The relay must stay a standalone shippable
 * artifact with no directory import (the relay-extractability invariant), so it keeps its own copy.
 *
 * ── THE DEFECT, IN ONE PARAGRAPH ─────────────────────────────────────────────────────────────────
 * `libp2p.dial()` does not always reach the network. `openConnection` calls `findExistingConnection`,
 * which filters registered connections on `con.status === 'open'` and NEVER inspects the muxer, and
 * returns the first match. So when a connection's muxer dies while its socket still reads open, a
 * redial resolves from the registry, hands the same dead object back, and the retry fails on the
 * check that just failed. Measured on the relay's end of the same link: 38 refused seals, a redial
 * on every one, none repaired. Evicting first is what makes the redial able to work at all.
 */
import type { Logger } from "@cello-protocol/interfaces";

/**
 * Render a thrown value for a log field.
 *
 * `String(err)` on a plain object yields the literally useless "[object Object]", and libp2p dial
 * failures throw aggregates rather than Errors — so an anti-entropy round that could not reach a
 * peer reported its cause as "[object Object]" and an operator learned nothing at all. Errors must
 * name their cause; that includes the ones that are not Error instances.
 */
export function describeThrown(err: unknown): string {
  if (err instanceof Error) {
    // AggregateError carries the real reasons in .errors; the outer message is usually generic.
    const inner = (err as { errors?: unknown[] }).errors;
    if (Array.isArray(inner) && inner.length > 0) {
      return `${err.message} [${inner.map((e) => (e instanceof Error ? e.message : String(e))).join("; ")}]`;
    }
    return err.message;
  }
  if (err !== null && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const parts = ["name", "code", "message", "reason"]
      .filter((k) => typeof o[k] === "string" || typeof o[k] === "number")
      .map((k) => `${k}=${String(o[k])}`);
    if (parts.length > 0) return parts.join(" ");
    try {
      return JSON.stringify(err).slice(0, 300);
    } catch {
      return "unserialisable thrown object";
    }
  }
  return String(err);
}

/**
 * The transport surface repair needs. Structurally satisfied by `CelloNode`; `hangUp` and the
 * connection `status` field are optional because this repo floats on published
 * `@cello-protocol/transport` and a node built before they existed must still run.
 */
export interface RepairableTransport {
  hangUp?(peerId: string): Promise<void>;
  getConnections?(): Array<{ peerId: string; status?: string; muxerStatus?: string }>;
}

/** Did the eviction happen, and if not, why not — carried into the outcome log so it is never guessed. */
export type EvictionOutcome = "evicted" | "unavailable" | "failed";

/**
 * Is this the "the connection I hold is unusable" error?
 *
 * `CelloNode` throws STRUCTURED PLAIN OBJECTS carrying `reason`, not Errors, so the shape is what
 * identifies it — `err instanceof Error` is false for every throw out of `newStream`.
 *
 * NARROW DELIBERATELY. Evicting is peer-scoped and therefore destructive (see `socketStatuses`), so
 * it must not fire on `protocol_not_supported`, `invalid_peer_id`, or `no_connection`. Reconnecting
 * repairs none of those: the first is a version skew, the second a config fault, and the third
 * already means there is nothing registered to evict — the dial alone genuinely reconnects.
 */
export function isConnectionLost(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null &&
    (err as { reason?: unknown }).reason === "connection_lost"
  );
}

/**
 * What libp2p holds for this peer right now, as a DISCRIMINATED answer.
 *
 * Returning a bare array conflated three states on the one measurement this tier was opened to
 * obtain: nothing registered (informative — it means the dial WILL genuinely reconnect), the call
 * threw, and an older transport that has no `getConnections` at all. Each sends a reader somewhere
 * different, so none of them is an empty list.
 *
 * `status` is the SOCKET status and is NOT the muxer's — separate fields, checked muxer-first when
 * opening a stream. `status: "open"` beside a muxer failure is the case a plain redial cannot help,
 * because that is exactly the connection `dial()` will hand back.
 */
export function socketStatuses(
  transport: RepairableTransport,
  peerId: string,
): { registered: number; statuses: string[]; muxerStatuses: string[] } | { unavailable: string } {
  if (typeof transport.getConnections !== "function") {
    return { unavailable: "transport_has_no_getConnections" };
  }
  try {
    const conns = transport.getConnections().filter((c) => c.peerId === peerId);
    return {
      registered: conns.length,
      statuses: conns.map((c) => c.status ?? "unreported"),
      // DOD-M12-CONN-MUXER-OBSERVE-1: the socket alone cannot identify the failure. The signature is
      // socket "open" WITH muxer "closed", and `newStream` checks the muxer first, so the error
      // returns before the socket is examined. `unreported` when the transport predates the field.
      muxerStatuses: conns.map((c) => c.muxerStatus ?? "unreported"),
    };
  } catch (err: unknown) {
    return { unavailable: describeThrown(err) };
  }
}

/**
 * Evict every connection registered for a peer so the next dial must build a new one.
 *
 * PEER-SCOPED, AND THAT IS A REAL COST. `hangUp` closes EVERY connection registered for the peer,
 * and on both of the directory's links the other side dials us independently — so a second, inbound
 * connection can exist under the same peer id and be carrying a seal verdict or serving an
 * anti-entropy round right now. Evicting is still correct (the outbound one is unusable and nothing
 * else removes it), but a count above one is logged so a failure we caused is ATTRIBUTABLE rather
 * than appearing to the peer as our fault and to us as theirs.
 *
 * Never throws. The caller is repairing something already unusable, and the dial that follows may
 * still succeed — failing the repair on its own fixer would turn a recoverable stale handle into a
 * hard error.
 */
export async function evictForRepair(
  transport: RepairableTransport,
  peerId: string,
  logger: Logger | undefined,
  events: { unavailable: string; failed: string; multiple: string },
  context: Record<string, unknown> = {},
): Promise<EvictionOutcome> {
  if (typeof transport.hangUp !== "function") {
    // ABSENT IS REPORTED, NEVER DEFAULTED. Without this the node keeps exactly the behaviour this
    // unit removes and its logs are indistinguishable from a repaired one — the failure mode that
    // let the 2026-08-08 fix look complete for eleven days.
    logger?.error(events.unavailable, {
      ...context, peerId,
      impact: "this node's @cello-protocol/transport predates hangUp, so a redial can only return "
        + "the dead connection already held — a connection whose muxer has died cannot be replaced "
        + "until this node is rebuilt on a newer transport",
    });
    return "unavailable";
  }
  const before = socketStatuses(transport, peerId);
  try {
    await transport.hangUp(peerId);
  } catch (err: unknown) {
    logger?.warn(events.failed, {
      ...context, peerId,
      reason: describeThrown(err),
      impact: "the dead connection may still be registered, so the redial can return it",
    });
    return "failed";
  }
  if ("registered" in before && before.registered > 1) {
    logger?.warn(events.multiple, {
      ...context, peerId,
      connectionsDestroyed: before.registered,
      socketStatuses: before.statuses,
      impact: "hangUp is peer-scoped, so a SECOND connection to this peer was closed alongside the "
        + "dead one — if a stream was in flight on it, its failure originates HERE, not at the peer",
    });
  }
  return "evicted";
}
