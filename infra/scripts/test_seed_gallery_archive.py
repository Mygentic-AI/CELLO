"""Extraction fidelity for the gallery archive seeder (DOD-GALLERY-SEED-1).

This script turns markdown into PERMANENT PUBLIC CONTENT via direct SQL, with no
delete path and no API validation in front of it. Everything it infers — turn
boundaries, speaker attribution, counts, seal state — is unfixable once
published, so each property is pinned here rather than eyeballed once.

The table-driven case is the real vault: the exact five receipts, asserted whole.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

MODULE = Path(__file__).resolve().parent / "seed-gallery-archive.py"
spec = importlib.util.spec_from_file_location("seed_gallery_archive", MODULE)
seed = importlib.util.module_from_spec(spec)
sys.modules["seed_gallery_archive"] = seed
spec.loader.exec_module(seed)


# ── the real vault, asserted exactly ──────────────────────────────────────────

EXPECTED = {
    "9e31a4fe94c42544205f30e8cf907ad83058b8b1881505714e601d2a2d79abbb":
        ("Agent A", "Agent B", 25, "sealed", "2026-05-18"),
    "04cba3717980a66a1b4c6e80d14190b8b72d4757f772960f4da6b37cc1ae840d":
        ("Agent A", "Agent B", 10, "sealed", "2026-05-19"),
    "8f9c7efbd39eae91db79c8dd834b4aa9bd66f9f402d34c5df86e21df9b0412ad":
        ("Agent A", "Agent B", 5, "sealed", "2026-05-20"),
    "e18c5bba38cb48451c2daa72e5e2e0809fbc82b948b63e901d22678aac3654c6":
        ("Demo2", "Agent-1", 7, "sealed", "2026-07-01"),
    "1a29969b440bb72f890064d3f415aee252a3e11b46919e78a08b56967202f1d9":
        ("Ms_Chelly", "CELLO_Feedback", 4, "sealed", "2026-07-07"),
}


@pytest.fixture(scope="module")
def rows():
    return list(seed.receipts())


def test_publishes_exactly_the_sessions_that_carry_a_sealed_root(rows):
    assert {r["receipt_hash"] for r in rows} == set(EXPECTED)


def test_every_field_matches_its_source_document(rows):
    for r in rows:
        initiator, counterparty, count, status, date = EXPECTED[r["receipt_hash"]]
        assert r["initiator_moniker"] == initiator
        assert r["counterparty_moniker"] == counterparty
        assert r["message_count"] == count
        assert r["seal_status"] == status
        assert r["sealed_at"].startswith(date)


def test_no_receipt_claims_an_attestation(rows):
    """No write-up records what the directory attested, so no row may say.
    This is the single number the page exists to let a stranger check."""
    for r in rows:
        assert r["verified_by"] is None
        assert r["node_count"] is None


def test_the_count_is_the_transcript(rows):
    for r in rows:
        assert r["message_count"] == len(r["transcript"])


def test_dates_are_stored_at_day_precision(rows):
    """Every write-up gives a day. Printing a clock time would invent precision
    next to a Merkle root."""
    for r in rows:
        assert r["sealed_at_precision"] == "date"


# ── extraction fidelity ───────────────────────────────────────────────────────


def test_the_writeups_narration_is_not_published_as_an_agents_words(rows):
    """A whole line in italics is the AUTHOR's voice:
    "*B sealed first. A received seal_rejected. 12 leaves committed.*"
    Absorbing it into the final turn attributes the document's commentary to an
    agent, permanently."""
    for r in rows:
        for turn in r["transcript"]:
            assert "leaves committed" not in turn["body"]
            assert "sealed first" not in turn["body"]


def test_turns_alternate_between_exactly_two_speakers(rows):
    for r in rows:
        speakers = {t["speaker"] for t in r["transcript"]}
        assert speakers == {r["initiator_moniker"], r["counterparty_moniker"]}


def test_the_initiator_speaks_first(rows):
    for r in rows:
        assert r["transcript"][0]["speaker"] == r["initiator_moniker"]


def test_no_turn_is_empty_or_carries_markup(rows):
    for r in rows:
        for turn in r["transcript"]:
            assert turn["body"].strip()
            assert "<" not in turn["body"] and ">" not in turn["body"]


def test_a_transcript_heading_with_a_qualifier_is_still_a_transcript():
    """"## Conversation Transcript" exists in the vault. An exact-match heading
    reported those files as having no turns — a different fact from the truth,
    and one that would silently drop a future sealed session."""
    turns = seed.transcript("## Conversation Transcript\n\n**Ada:** hello\n")
    assert [t["speaker"] for t in turns] == ["Ada"]


def test_a_multi_line_turn_is_joined_not_split():
    turns = seed.transcript("## Transcript\n\n**Ada:** first part\nsecond part\n")
    assert len(turns) == 1
    assert turns[0]["body"] == "first part second part"


def test_seq_markers_are_not_part_of_the_speaker():
    turns = seed.transcript("## Transcript\n\n**Agent A (seq 3):** hello\n")
    assert turns[0]["speaker"] == "Agent A"


# ── refusals: what must NEVER reach a permanent public page ───────────────────

DOC = """---
name: test
---

# Test session

- **Agent A (initiator)**: {initiator}
- **Session ID**: `abc123`
- **Date**: 2026-07-01
- **Seal status**: `{status}` — {detail}
- **Sealed root**: `{root}`

## Transcript

**{first}:** {body}

**{second}:** and a reply.
"""

ROOT_HEX = "a" * 64


def write_doc(tmp_path, monkeypatch, **kw):
    fields = dict(
        initiator="Ada", status="sealed", detail="ceremony complete",
        root=ROOT_HEX, first="Ada", second="Grace", body="hello there",
    )
    fields.update(kw)
    (tmp_path / "agent-conversation-test.md").write_text(DOC.format(**fields))
    monkeypatch.setattr(seed, "VAULT", tmp_path)


def test_the_baseline_synthetic_document_publishes(tmp_path, monkeypatch):
    # Without this the refusal tests below could pass for the wrong reason.
    write_doc(tmp_path, monkeypatch)
    assert [r["receipt_hash"] for r in seed.receipts()] == [ROOT_HEX]


def test_a_seal_state_this_codebase_does_not_know_is_refused(tmp_path, monkeypatch):
    """It used to coerce to "sealed" — publishing a positive cryptographic claim
    the source document never made, permanently."""
    write_doc(tmp_path, monkeypatch, status="seal_rejected")

    with pytest.raises(SystemExit) as exit_info:
        list(seed.receipts())
    assert "unknown_seal_status" in str(exit_info.value)


def test_markup_in_a_turn_is_refused(tmp_path, monkeypatch):
    """The API refuses markup at the write. This path bypasses the API entirely,
    so without its own check the guard protects nothing that actually shipped."""
    write_doc(tmp_path, monkeypatch, body="<script>alert(1)</script>")

    with pytest.raises(SystemExit) as exit_info:
        list(seed.receipts())
    assert "markup_in_turn" in str(exit_info.value)


def test_a_stated_initiator_that_contradicts_turn_order_is_refused(tmp_path, monkeypatch):
    """Inferring the initiator from who speaks first publishes a reversed,
    permanent attribution when a write-up logged the greeting out of order."""
    write_doc(tmp_path, monkeypatch, initiator="Grace", first="Ada", second="Grace")

    with pytest.raises(SystemExit) as exit_info:
        list(seed.receipts())
    assert "refusing to guess" in str(exit_info.value)
