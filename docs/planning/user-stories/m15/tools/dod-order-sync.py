#!/usr/bin/env python3
"""dod-order-sync — does the M15 scoreboard still agree with the work orders?

    python3 docs/planning/user-stories/m15/tools/dod-order-sync.py

Exit 0 = in sync. Exit 1 = drift, and every drift row names what to change.

WHY THIS EXISTS. The work orders are kept current — a unit flips its own `status:`
in the same commit as its verdict, because rule 5 of every order says so. The DoD
has no such forcing function, so it falls behind: an order closes, the line it
closes keeps its ❌, and the next person reads finished work as unstarted. That
has already cost this milestone twice (a stale row sent a lane to redo finished
work; a finished item sat unclaimed for a week).

THE CONTRACT THIS CHECKS. Every order frontmatter declares:

    dod_line:   DOD-M15-XXX-1[, DOD-M15-YYY-1 ...]   (or "none — housekeeping")
    dod_effect: closes | unit-of | none

`closes`  — when this order is complete, the line MUST be ✅.
`unit-of` — this order is one unit of a bigger line. The line stays open when the
            order completes, and that is correct, not drift. Say which unit and
            what still owes in the `dod_effect` text.
`none`    — housekeeping; closes no line.

The distinction is the whole point. Without it a checker cannot tell "unit 1 of 4
is done" from "somebody forgot to flip the tag", so it would either miss real
drift or cry wolf on every multi-unit line.
"""
import pathlib, re, sys

BASE = pathlib.Path(__file__).resolve().parent.parent
DOD = BASE / "M15-DEFINITION-OF-DONE.md"
MICRO = BASE / "micro"

TAGS = ("⬇️", "⬆️", "✅", "🟡", "❌", "🅿️")
HEAD = re.compile(r"^### `(DOD-M15-[A-Z0-9-]+)` — (.*)$")


def read_dod():
    lines = DOD.read_text().split("\n")
    backlog_at = next(
        (i for i, l in enumerate(lines) if l.startswith("# POST-LAUNCH BACKLOG")), len(lines)
    )
    out = {}
    for i, l in enumerate(lines):
        m = HEAD.match(l)
        if not m:
            continue
        tag = next((t for t in TAGS if m.group(2).startswith(t)), "?")
        out[m.group(1)] = {
            "tag": tag,
            "line_no": i + 1,
            # out of the gate = physically in the backlog, or marked ⬇️ in place.
            # ⬆️ is a backlog line Andre moved INTO the gate.
            "in_gate": tag != "⬇️" and (i < backlog_at or tag == "⬆️"),
        }
    return out


def read_orders():
    out = []
    for f in sorted(MICRO.glob("*.md")):
        txt = f.read_text()
        fm = txt.split("---")[1] if txt.startswith("---") else ""
        get = lambda k: (re.search(rf"^{k}:\s*(.*)$", fm, re.M) or [None, ""])[1].strip()
        out.append({
            "file": f.name,
            "id": f.name.split("-")[0],
            "status": get("status") or "?",
            "lines": re.findall(r"DOD-M15-[A-Z0-9-]+", get("dod_line")),
            "effect": (get("dod_effect").split(".")[0] or "").strip().lower(),
            "declared": bool(get("dod_line")),
        })
    return out


def main():
    dod, orders = read_dod(), read_orders()
    drift = []

    for o in orders:
        if not o["declared"]:
            drift.append(f"{o['id']}: no `dod_line:` in frontmatter — the order cannot be "
                         f"reconciled against the scoreboard at all. Add it.")
            continue
        if o["effect"] not in ("closes", "unit-of", "none"):
            drift.append(f"{o['id']}: `dod_effect: {o['effect'] or '(empty)'}` is not one of "
                         f"closes / unit-of / none.")
        for lid in o["lines"]:
            if lid not in dod:
                drift.append(f"{o['id']}: declares {lid}, which is not a line in the DoD "
                             f"(renamed, split, or a typo).")
                continue
            tag = dod[lid]["tag"]
            if o["effect"] == "closes" and o["status"] == "complete" and tag != "✅":
                drift.append(f"{o['id']} is complete and declares it CLOSES {lid}, but the line "
                             f"reads {tag} (DoD:{dod[lid]['line_no']}). Flip the line or change "
                             f"dod_effect to unit-of.")
            if o["effect"] == "closes" and o["status"] != "complete" and tag == "✅":
                drift.append(f"{lid} reads ✅ but its only order {o['id']} is "
                             f"'{o['status']}' — the tag is ahead of the work.")

    owned = {lid for o in orders for lid in o["lines"]}
    orphans = [
        (lid, d) for lid, d in sorted(dod.items(), key=lambda kv: kv[1]["line_no"])
        if d["in_gate"] and d["tag"] in ("❌", "🟡", "🅿️", "⬆️") and lid not in owned
    ]

    print("=" * 74)
    print(f"IN-GATE OPEN LINES WITH NO ORDER  ({len(orphans)})")
    print("=" * 74)
    print("Not drift — a line with no order is work not yet started. Listed so the")
    print("backlog of unwritten orders is visible rather than counted by hand.\n")
    for lid, d in orphans:
        print(f"  {d['tag']}  {lid:<34} DoD:{d['line_no']}")

    print()
    print("=" * 74)
    print(f"DRIFT  ({len(drift)})")
    print("=" * 74)
    if not drift:
        print("  none — every completed order's line carries the tag it claims.")
    for d in drift:
        print(f"  ✗ {d}")

    print(f"\norders {len(orders)} · in-gate lines "
          f"{sum(1 for d in dod.values() if d['in_gate'])} · open in-gate "
          f"{sum(1 for d in dod.values() if d['in_gate'] and d['tag'] in ('❌','🟡','🅿️','⬆️'))}")
    return 1 if drift else 0


if __name__ == "__main__":
    sys.exit(main())
