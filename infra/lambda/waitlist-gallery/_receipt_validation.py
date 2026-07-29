"""Receipt content rules, shared by the API and the archive seeder.

ONE VALIDATOR, TWO CALLERS. These rules used to live inside the gallery Lambda,
which meant the seed script — the path that wrote every row currently in the
table — enforced none of them. A guard that only runs on the route nobody used
is not a guard, and the page it was protecting is irrevocable.

Deliberately free of psycopg2, _dburl and _logging so a plain script can import
it without a Lambda package around it.
"""

import json
import re

MONIKER_RE = re.compile(r"^[\w .\'-]{1,64}$", re.UNICODE)

# What the seal ACTUALLY was. Closed set: an unrecognised state must fail the
# write rather than reach a public page that asserts something about a ceremony
# nobody can name.
SEAL_STATES = ("sealed", "seal_deferred")
DATE_PRECISIONS = ("date", "timestamp")

# Transcript bounds. Generous against the real archive (max 25 turns, 854 chars
# in a turn, 10KB total) and finite, because an unbounded caller-supplied array
# on an irrevocable public page is a row nobody can delete.
MAX_TURNS = 500
MAX_TURN_CHARS = 8000
MAX_TRANSCRIPT_BYTES = 256 * 1024


class ReceiptContentError(ValueError):
    """A receipt that must not be published. `code` is the machine reason."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def clean_transcript(raw):
    """The turns as published, or None.

    Every string here is caller-supplied and lands on a public, bot-indexed,
    irrevocable page. Markup is refused at the WRITE, on the same terms as
    monikers and for the same reason — escaping correctly at every future read
    is a promise about code not yet written.
    """
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise ReceiptContentError(
            "invalid_transcript", "A transcript must be an array of turns."
        )
    if len(raw) > MAX_TURNS:
        raise ReceiptContentError(
            "transcript_too_long",
            f"A transcript may carry at most {MAX_TURNS} turns; this one has {len(raw)}.",
        )

    turns = []
    for index, turn in enumerate(raw):
        if not isinstance(turn, dict):
            raise ReceiptContentError(
                "invalid_turn", f"Turn {index} is not an object."
            )
        speaker = (turn.get("speaker") or "").strip()
        text = (turn.get("body") or "").strip()
        if not MONIKER_RE.match(speaker or ""):
            raise ReceiptContentError(
                "invalid_turn_speaker",
                f"Turn {index} has no usable speaker, or one containing markup.",
            )
        if not text:
            raise ReceiptContentError(
                "empty_turn", f"Turn {index} has no body."
            )
        if len(text) > MAX_TURN_CHARS:
            raise ReceiptContentError(
                "turn_too_long",
                f"Turn {index} is {len(text)} characters; the limit is {MAX_TURN_CHARS}.",
            )
        if "<" in text or ">" in text:
            raise ReceiptContentError(
                "markup_in_turn",
                f"Turn {index} contains markup, which is refused rather than escaped at read time.",
            )
        turns.append({"speaker": speaker, "body": text})

    if not turns:
        # An empty array is a THIRD state that renders as "no transcript" but
        # escapes `WHERE transcript IS NULL`. Normalised so absent has one
        # storage form.
        return None

    encoded = json.dumps(turns)
    if len(encoded.encode("utf-8")) > MAX_TRANSCRIPT_BYTES:
        raise ReceiptContentError(
            "transcript_too_large",
            f"A transcript may be at most {MAX_TRANSCRIPT_BYTES} bytes.",
        )
    return turns


def validate_seal_status(status):
    """A seal state this codebase does not know is REFUSED, never coerced.

    The seeder used to fall back to "sealed" when a write-up's seal line was
    absent or worded differently. That publishes a positive cryptographic claim
    the source document never made, permanently, on the page whose only purpose
    is that a stranger can check it.
    """
    if status not in SEAL_STATES:
        raise ReceiptContentError(
            "unknown_seal_status",
            f"seal_status must be one of {', '.join(SEAL_STATES)}; got {status!r}.",
        )
    return status


def validate_moniker(value, field):
    if not MONIKER_RE.match((value or "").strip()):
        raise ReceiptContentError(
            f"invalid_{field}", f"{field} is empty or contains markup: {value!r}"
        )
    return value.strip()


def check_message_count(message_count, turns):
    """The count and the transcript must agree.

    A page printing "12 messages" above two turns contradicts itself in front of
    the reader, which is the worst shape a fabricated number can take.
    """
    if turns is None:
        return message_count
    if message_count != len(turns):
        raise ReceiptContentError(
            "message_count_mismatch",
            f"message_count is {message_count} but the transcript carries {len(turns)} turns.",
        )
    return message_count
