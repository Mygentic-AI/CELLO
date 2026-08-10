#!/usr/bin/env python3
"""Publish ONE sealed session from the local daemon to the gallery.

WHY THIS EXISTS ALONGSIDE seed-gallery-archive.py
    That script reads the vault write-ups. It works for the early sessions
    because those documents contain the conversation verbatim, turn by turn.
    The newer write-ups do not — they are edited essays that QUOTE a few
    exchanges. Scraping them would put a sealed root next to a selection of
    messages that is not what was sealed, on the one page whose entire promise
    is that a stranger can check the record. So the transcript here comes from
    the daemon, which holds what was actually sealed under that root.

WHERE EACH FIELD COMES FROM
    transcript, timestamps  — `cello transcript <session>`
    receipt_hash            — `cello sealed-receipt <session>`, the sealed root
    title, summary          — supplied by the operator; editorial, and the only
                              fields here a hash cannot check
    verified_by, node_count — left NULL, deliberately. The daemon's receipt does
                              not record how many directory nodes attested, and
                              that badge sits beside the hash. Do not invent it.

SPEAKER MAPPING, AND WHY IT IS AN ARGUMENT
    The daemon stores direction (`sent` / `received`) relative to the agent
    whose database this is — not a name. Only the caller knows which agent that
    was, so it is passed in rather than guessed. Pass --local wrong and every
    line is attributed to the wrong agent, which is why --dry-run prints the
    first line of each turn with the name it would carry.

Usage:
    DATABASE_URL=postgres://... python3 infra/scripts/publish-session-receipt.py \
        --session <id> --local <moniker> --remote <moniker> \
        --title "..." --summary "..." [--dry-run]
"""

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

import psycopg2

# The same validator the gallery API runs. A row written here must pass exactly
# what a row written through the route would.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lambda" / "waitlist-gallery"))
from _receipt_validation import (  # noqa: E402
    ReceiptContentError,
    check_message_count,
    clean_transcript,
    validate_moniker,
    validate_prose,
    validate_seal_status,
)


def cello(*args):
    """Run a read-only cello CLI command and parse its JSON."""
    proc = subprocess.run(["cello", *args], capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"cello {' '.join(args)} failed:\n{proc.stderr.strip()}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        sys.exit(f"cello {' '.join(args)} did not return JSON:\n{proc.stdout[:400]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", required=True)
    ap.add_argument("--local", required=True, help="moniker of the agent whose daemon this is")
    ap.add_argument("--remote", required=True, help="moniker of the counterparty")
    ap.add_argument("--title", required=True)
    ap.add_argument("--summary", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    receipt = cello("sealed-receipt", args.session)
    if not receipt.get("ok") or not receipt.get("sealed_root"):
        sys.exit(f"session {args.session} has no sealed root — it cannot be a receipt.")
    root = receipt["sealed_root"]

    convo = cello("transcript", args.session)
    messages = convo.get("messages") or []
    if not messages:
        sys.exit(f"session {args.session} has no messages.")
    if convo.get("undecryptable"):
        sys.exit(f"session {args.session} has undecryptable messages — refusing to publish a partial record.")

    local = validate_moniker(args.local, "local")
    remote = validate_moniker(args.remote, "remote")

    turns = [
        {
            "speaker": local if m.get("direction") == "sent" else remote,
            "body": (m.get("text") or "").strip(),
        }
        for m in sorted(messages, key=lambda m: m["sequence"])
    ]
    turns = clean_transcript(turns)

    # The transcript's own ordering decides who opened, rather than the operator
    # asserting it — the first turn is the initiator by definition.
    initiator = turns[0]["speaker"]
    counterparty = remote if initiator == local else local

    # The sealed receipt carries no timestamp, so the last message stands in for
    # when the conversation ended. Precision is 'timestamp' because this one is
    # a real instant from the daemon, not a date parsed out of a write-up.
    last_ms = max(m["createdAt"] for m in messages)
    sealed_at = dt.datetime.fromtimestamp(last_ms / 1000, dt.timezone.utc)

    row = {
        "receipt_hash": root,
        "initiator_moniker": initiator,
        "counterparty_moniker": counterparty,
        "sealed_at": sealed_at,
        "message_count": len(turns),
        "seal_status": validate_seal_status("sealed"),
        "sealed_at_precision": "timestamp",
        "title": validate_prose(args.title, "title", 120),
        "summary": validate_prose(args.summary, "summary", 400),
        "transcript": turns,
    }
    check_message_count(row["message_count"], turns)

    print(f"session   {args.session}")
    print(f"root      {root}")
    print(f"between   {initiator} → {counterparty}")
    print(f"sealed_at {sealed_at.isoformat()}  ({row['message_count']} messages)")
    print(f"title     {row['title']}")
    print("turns:")
    for t in turns:
        print(f"  {t['speaker']:>16}: {t['body'][:90].replace(chr(10), ' ')}…")

    if args.dry_run:
        print("\n--dry-run: nothing written.")
        return

    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is required.")

    conn = psycopg2.connect(url)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO published_receipts
                    (receipt_hash, initiator_moniker, counterparty_moniker, sealed_at,
                     message_count, seal_status, sealed_at_precision, title, summary, transcript)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (receipt_hash) DO NOTHING
                """,
                (
                    row["receipt_hash"], row["initiator_moniker"], row["counterparty_moniker"],
                    row["sealed_at"], row["message_count"], row["seal_status"],
                    row["sealed_at_precision"], row["title"], row["summary"],
                    json.dumps(row["transcript"]),
                ),
            )
            written = cur.rowcount
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM published_receipts")
            total = cur.fetchone()[0]
    finally:
        conn.close()

    print(f"\n{'inserted' if written else 'already present, left alone'}. "
          f"published_receipts now holds {total} row(s).")
    print("The gallery page is a static build — it will not change until the site is redeployed.")


if __name__ == "__main__":
    try:
        main()
    except ReceiptContentError as e:
        sys.exit(f"refused: {e}")
