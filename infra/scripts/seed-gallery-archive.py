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

VAULT = (
    Path(__file__).resolve().parents[2]
    / "docs/planning/milestone-writeups/live-session-e2e-proofs"
)

TURN = re.compile(r"^\*\*([A-Za-z0-9_\- ]+?)(?:\s*\(seq\s*(\d+)\))?:\*\*\s*(.*)$")
ROOT = re.compile(r"sealed_?[ _]?root[\"*: ]+`?\"?([0-9a-f]{64})", re.I)
SEAL = re.compile(r"Seal status\*\*:\s*`([a-z_]+)`\s*(?:—\s*(.*))?$", re.M | re.I)
DATE = re.compile(r"\*\*Date[^*]*\*\*:?\s*`?(\d{4}-\d{2}-\d{2})", re.M)
# A whole line in italics is the write-up's voice, not an agent's.
NARRATION = re.compile(r"\*[^*].*[^*]\*")


def transcript(text):
    m = re.search(r"^## Transcript\s*$", text, re.M)
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
            print(f"  skip {path.name} (root={bool(root)}, turns={len(turns)})")
            continue

        seal = SEAL.search(text)
        status = seal.group(1) if seal else "sealed"
        detail = (seal.group(2) or "").strip() if seal else None
        # Backticks are markdown, and the API refuses markup rather than
        # escaping it later.
        detail = re.sub(r"[`<>]", "", detail) if detail else None
        speakers = list(dict.fromkeys(t["speaker"] for t in turns))
        date = DATE.search(text)
        if not date or len(speakers) < 2:
            print(f"  skip {path.name} (date={bool(date)}, speakers={len(speakers)})")
            continue

        yield {
            "source": path.name,
            "receipt_hash": root.group(1),
            "initiator_moniker": speakers[0],
            "counterparty_moniker": speakers[1],
            "sealed_at": f"{date.group(1)}T00:00:00Z",
            "sealed_at_precision": "date",
            "message_count": len(turns),
            "verified_by": None,
            "node_count": None,
            "seal_status": status if status in ("sealed", "seal_deferred") else "sealed",
            "seal_detail": detail,
            "transcript": turns,
        }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    rows = list(receipts())
    if not rows:
        sys.exit("No publishable sessions found — refusing to report success.")

    print(f"\n{len(rows)} publishable receipt(s):")
    for r in rows:
        print(
            f"  {r['receipt_hash'][:12]}  {r['initiator_moniker']} / {r['counterparty_moniker']}"
            f"  {r['sealed_at'][:10]}  {r['message_count']} msgs  {r['seal_status']}"
        )

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
                         seal_status, seal_detail, transcript)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (receipt_hash) DO NOTHING
                    """,
                    (
                        r["receipt_hash"], r["initiator_moniker"], r["counterparty_moniker"],
                        r["sealed_at"], r["sealed_at_precision"], r["message_count"],
                        r["verified_by"], r["node_count"], r["seal_status"], r["seal_detail"],
                        json.dumps(r["transcript"]),
                    ),
                )
            cur.execute("SELECT count(*) FROM published_receipts")
            print(f"\npublished_receipts now holds {cur.fetchone()[0]} row(s).")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
