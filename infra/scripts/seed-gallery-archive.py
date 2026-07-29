#!/usr/bin/env python3
"""Publish the build-in-public sessions to the gallery (DOD-GALLERY-SEED-1).

Reads `docs/planning/milestone-writeups/live-session-e2e-proofs/` and inserts
one row per session that HAS A SEALED ROOT. The root is the primary key and the
only thing a visitor can check, so a session without one cannot be a receipt.

WHY THIS WRITES DIRECTLY RATHER THAN CALLING /gallery/publish
    That route requires a session cookie AND that the publishing agent is linked
    to the caller via `waitlist_agent_links` — a table with three readers and no
    writer (M11 DoD). No publish call can currently succeed. These rows are
    archive material published by the operator, not by a user, so a direct
    insert is the honest shape; it does NOT excuse the missing portal action,
    which DOD-GALLERY-PRIVACY-1 still owes for real users.

WHAT IS NEVER INVENTED
    `verified_by` / `node_count` are left NULL. No write-up records what the
    directory attested, and that badge sits beside the hash on a page whose
    whole purpose is that a stranger can check it. The seal state each document
    DOES record is stored instead, and the states genuinely differ.

Usage:
    DATABASE_URL=postgres://... python3 infra/scripts/seed-gallery-archive.py [--dry-run]

Targets the PORTAL/waitlist database. It touches exactly one table,
`published_receipts`, and nothing in the directory's schema.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import psycopg2

# ONE VALIDATOR, SHARED WITH THE API. Every guard the gallery Lambda enforces
# used to be unreachable from here, and this is the path that wrote every row in
# the table — so the rules protecting an irrevocable public page ran only on the
# route nobody used.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lambda" / "waitlist-gallery"))
from _receipt_validation import (  # noqa: E402
    ReceiptContentError,
    check_message_count,
    clean_transcript,
    validate_moniker,
    validate_prose,
    validate_seal_status,
)

VAULT = (
    Path(__file__).resolve().parents[2]
    / "docs/planning/milestone-writeups/live-session-e2e-proofs"
)

TURN = re.compile(r"^\*\*([A-Za-z0-9_\- ]+?)(?:\s*\(seq\s*(\d+)\))?:\*\*\s*(.*)$")
ROOT = re.compile(r"sealed_?[ _]?root[\"*: ]+`?\"?([0-9a-f]{64})", re.I)
SEAL = re.compile(r"Seal status\*\*:\s*`([a-z_]+)`\s*(?:—\s*(.*))?$", re.M | re.I)
DATE = re.compile(r"\*\*Date[^*]*\*\*:?\s*`?(\d{4}-\d{2}-\d{2})", re.M)
# "Agent A (initiator)" / "Agent A pubkey (reviewer)" — the document naming
# which side opened the session.
INITIATOR = re.compile(r"\*\*Agent A \(initiator\)\*\*:?\s*([A-Za-z0-9_\-]+)", re.M)
# A whole line in italics is the write-up's voice, not an agent's.
NARRATION = re.compile(r"\*[^*].*[^*]\*")
# The document's own title, minus a prefix that is redundant on a page about
# agent conversations.
TITLE = re.compile(r"^name:\s*\"?(.*?)\"?\s*$", re.M)
TITLE_PREFIX = re.compile(r"^Agent-to-Agent Conversation:\s*", re.I)

# EDITORIAL, AND THE ONLY EDITORIAL THING HERE. One line per session saying what
# it is, because "Agent A / Agent B, 25 messages" tells a visitor nothing about
# why that session is worth reading. Every other field is extracted; these are
# written, drawn from the transcript and the write-up, and they make no claim
# that a hash could check.
SUMMARIES = {
    "8f9c7efbd39eae91db79c8dd834b4aa9bd66f9f402d34c5df86e21df9b0412ad":
        "The first message ever sent over a signed, hash-chained CELLO channel. Two agents "
        "verify each other with no human relay and no platform vouching for either of them, "
        "then seal the exchange.",
    "9e31a4fe94c42544205f30e8cf907ad83058b8b1881505714e601d2a2d79abbb":
        "Two agents review the protocol's own defects — twelve bugs found the first time it "
        "touched real Postgres — and surface a gap in the seal-to-checkpoint path that no test "
        "had covered.",
    "04cba3717980a66a1b4c6e80d14190b8b72d4757f772960f4da6b37cc1ae840d":
        "A working session about unfinished work: the agents agree a duplicate migration is a "
        "hard prerequisite rather than housekeeping, and predict where the next failures will be.",
    "e18c5bba38cb48451c2daa72e5e2e0809fbc82b948b63e901d22678aac3654c6":
        "The first session across the live three-region federation, sealed by a threshold "
        "ceremony no single node could complete alone.",
    "1a29969b440bb72f890064d3f415aee252a3e11b46919e78a08b56967202f1d9":
        "An agent was asked for feedback and chose its own topic: a papercut it had hit earlier "
        "that same session. Nobody scripted the subject, and the defect was real and unlogged.",
}


def transcript(text):
    # "## Conversation Transcript" exists in the vault too. An exact match
    # reported those files as having no turns, which is a different fact.
    m = re.search(r"^##\s+(?:[A-Za-z ]+\s)?Transcript\s*$", text, re.M)
    if not m:
        return []
    body = text[m.end():]
    end = re.search(r"^## ", body, re.M)
    if end:
        body = body[: end.start()]

    turns, current = [], None
    for line in body.splitlines():
        hit = TURN.match(line)
        if hit:
            if current:
                turns.append(current)
            current = {"speaker": hit.group(1).strip(), "body": hit.group(3).strip()}
        elif current is not None:
            stripped = line.strip()
            if stripped in ("", "---"):
                continue
            if NARRATION.fullmatch(stripped):
                turns.append(current)
                current = None
                continue
            current["body"] += " " + stripped
    if current:
        turns.append(current)
    return turns


def receipts():
    for path in sorted(VAULT.glob("*.md")):
        text = path.read_text()
        root = ROOT.search(text)
        turns = transcript(text)
        if not root or not turns:
            # No root: never sealed, so nothing to verify. No transcript: the
            # smoke-test log covers two sessions and its root cannot be
            # attributed to one bilateral exchange.
            print(f"  skip {path.name} (root={bool(root)}, turns={len(turns)})", file=sys.stderr)
            continue

        seal = SEAL.search(text)
        if not seal:
            # Never default. An absent seal line means the document does not say
            # what happened, and "sealed" is a positive cryptographic claim.
            sys.exit(f"{path.name}: no 'Seal status' line — refusing to assume one.")
        status = seal.group(1)
        detail = (seal.group(2) or "").strip()
        # Backticks are markdown, and the API refuses markup rather than
        # escaping it later.
        detail = re.sub(r"[`<>]", "", detail) if detail else None
        speakers = list(dict.fromkeys(t["speaker"] for t in turns))
        date = DATE.search(text)
        if not date or len(speakers) < 2:
            print(f"  skip {path.name} (date={bool(date)}, speakers={len(speakers)})", file=sys.stderr)
            continue

        # THE INITIATOR IS STATED, NOT INFERRED FROM WHO SPEAKS FIRST. Turn order
        # happens to agree in all five documents, but a write-up that logged the
        # responder's greeting first would publish a reversed, permanent
        # attribution. Where the document names one, it wins and the inference is
        # asserted against it.
        title_match = TITLE.search(text)
        title = TITLE_PREFIX.sub("", title_match.group(1)).strip() if title_match else None

        stated = INITIATOR.search(text)
        initiator = stated.group(1).strip() if stated else speakers[0]
        if stated and initiator != speakers[0]:
            sys.exit(
                f"{path.name}: document names {initiator!r} as initiator but "
                f"{speakers[0]!r} speaks first — refusing to guess."
            )
        counterparty = next(sp for sp in speakers if sp != initiator)

        # EVERY ROW GOES THROUGH THE API'S OWN RULES before it can be emitted.
        # Refusing here is the whole point: these rows are written by direct SQL,
        # so this is the only place the guards can run at all.
        try:
            turns = clean_transcript(turns)
            validate_seal_status(status)
            validate_moniker(initiator, "initiator_moniker")
            validate_moniker(counterparty, "counterparty_moniker")
            title = validate_prose(title, "title", 120)
            summary = validate_prose(SUMMARIES.get(root.group(1)), "summary", 400)
            check_message_count(len(turns), turns)
            if detail and ("<" in detail or ">" in detail):
                raise ReceiptContentError("markup_in_seal_detail", "seal_detail contains markup.")
        except ReceiptContentError as err:
            sys.exit(f"{path.name}: {err.code} — {err.message}")

        yield {
            "source": path.name,
            "receipt_hash": root.group(1),
            "initiator_moniker": initiator,
            "counterparty_moniker": counterparty,
            "sealed_at": f"{date.group(1)}T00:00:00Z",
            "sealed_at_precision": "date",
            "message_count": len(turns),
            "verified_by": None,
            "node_count": None,
            "title": title,
            "summary": summary,
            "seal_status": status,
            # Left NULL deliberately and recorded here rather than silently: no
            # waitlist user published these, and inventing an owner would be a
            # false attribution on a permanent page. DOD-GALLERY-PRIVACY-1's
            # portal action is what gives real rows a real publisher.
            "seal_detail": detail,
            "transcript": turns,
        }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--emit-sql",
        action="store_true",
        help="Print the INSERTs instead of connecting. The portal RDS is not "
             "publicly accessible, so the only route in is the VPC-Lambda hop in "
             "infra/scripts/portal-db-query.sh, which takes SQL rather than a "
             "connection.",
    )
    args = ap.parse_args()

    rows = list(receipts())
    if not rows:
        sys.exit("No publishable sessions found — refusing to report success.")

    print(f"\n{len(rows)} publishable receipt(s):", file=sys.stderr)
    for r in rows:
        print(
            f"  {r['receipt_hash'][:12]}  {r['initiator_moniker']} / {r['counterparty_moniker']}"
            f"  {r['sealed_at'][:10]}  {r['message_count']} msgs  {r['seal_status']}",
            file=sys.stderr,
        )

    if args.emit_sql:
        # Dollar-quoted, with the tag proven absent from each value. No other
        # quoting is permitted here: the transcript is JSON, and any escape-
        # processing form mangles its backslashes.
        def lit(value):
            """Dollar-quoted, because backslashes must survive verbatim.

            The transcript is JSON, and JSON escapes a double quote as a
            backslash-quote. Ordinary SQL quoting then doubles that backslash —
            psycopg2 cannot know `standard_conforming_strings` without a
            connection, so it quotes defensively — and the JSON parser receives a
            literal backslash and rejects the whole value. Four of five rows
            failed that way; the fifth had no quotes in it and looked fine, which
            is how a partial seed reports success.

            Dollar-quoting performs NO escape processing, so bytes in are bytes
            out. The tag is verified absent from the value rather than assumed.
            """
            if value is None:
                return "NULL"
            tag = "cello"
            while f"${tag}$" in value:
                tag += "x"
            return f"${tag}${value}${tag}$"

        statements = []
        for r in rows:
            statements.append(
                "INSERT INTO published_receipts "
                "(receipt_hash, initiator_moniker, counterparty_moniker, sealed_at, "
                "sealed_at_precision, message_count, verified_by, node_count, "
                "seal_status, seal_detail, title, summary, transcript) VALUES ("
                + ", ".join([
                    lit(r["receipt_hash"]), lit(r["initiator_moniker"]),
                    lit(r["counterparty_moniker"]), lit(r["sealed_at"]),
                    lit(r["sealed_at_precision"]), str(r["message_count"]),
                    "NULL", "NULL", lit(r["seal_status"]), lit(r["seal_detail"]),
                    lit(r["title"]), lit(r["summary"]),
                    lit(json.dumps(r["transcript"])) + "::jsonb",
                ])
                # DO NOTHING for a receipt already here, EXCEPT the two editorial
                # columns while they are still empty. Those were added after
                # these rows were published, and leaving them blank forever would
                # mean the archive can never say what any session is.
                #
                # `WHERE title IS NULL` is the guard: this can FILL a blank and
                # can never rewrite. No verification field appears in the SET
                # list, so nothing a hash covers is reachable from here.
                + ") ON CONFLICT (receipt_hash) DO UPDATE SET "
                + "title = EXCLUDED.title, summary = EXCLUDED.summary "
                + "WHERE published_receipts.title IS NULL;"
            )
        # THE LAST STATEMENT IS THE VERIFICATION, because the runner reports only
        # the final statement's result. Without it a partially-applied seed
        # returns rowcount 1 and looks exactly like a complete one — which is
        # what a quoting bug did here: four rows failed, the fifth inserted, and
        # nothing said so.
        statements.append(
            "SELECT count(*) AS rows, count(transcript) AS with_transcript, "
            "count(verified_by) AS with_attestation_claim, "
            "count(*) FILTER (WHERE message_count <> jsonb_array_length(transcript)) "
            "AS count_mismatch FROM published_receipts;"
        )
        sys.stdout.write("\n".join(statements) + "\n")
        print(
            f"\nEmitted {len(rows)} INSERT(s) + a verification SELECT. "
            f"Expect rows >= {len(rows)}, with_attestation_claim = 0, count_mismatch = 0.",
            file=sys.stderr,
        )
        return

    if args.dry_run:
        print("\n--dry-run: nothing written.")
        return

    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is required.")

    conn = psycopg2.connect(url)
    try:
        with conn, conn.cursor() as cur:
            for r in rows:
                # DO NOTHING, never DO UPDATE: a published receipt is permanent,
                # and letting a re-run rewrite one would make that meaningless.
                cur.execute(
                    """
                    INSERT INTO published_receipts
                        (receipt_hash, initiator_moniker, counterparty_moniker, sealed_at,
                         sealed_at_precision, message_count, verified_by, node_count,
                         seal_status, seal_detail, title, summary, transcript)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (receipt_hash) DO NOTHING
                    """,
                    (
                        r["receipt_hash"], r["initiator_moniker"], r["counterparty_moniker"],
                        r["sealed_at"], r["sealed_at_precision"], r["message_count"],
                        r["verified_by"], r["node_count"], r["seal_status"], r["seal_detail"],
                        r["title"], r["summary"],
                        json.dumps(r["transcript"]),
                    ),
                )
            cur.execute("SELECT count(*) FROM published_receipts")
            print(f"\npublished_receipts now holds {cur.fetchone()[0]} row(s).")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
