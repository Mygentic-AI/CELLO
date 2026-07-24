"""Structured logging shared by the M11 waitlist Lambdas.

The sibling rds-rotation Lambda uses logging.getLogger(); these used bare
print() with a "level" key in the payload. CloudWatch ingests both, but with
print() the level is a string inside the body — no metric filter, subscription
or alarm can route on it, so an ERROR is indistinguishable from an INFO to
anything downstream.
"""

import json
import logging
from datetime import datetime, timezone

_logger = logging.getLogger()
_logger.setLevel(logging.INFO)

_LEVELS = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARN": logging.WARNING,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
}


def emit(event, correlation_id, level="INFO", **fields):
    """One JSON line per event, at a real log level.

    Event names follow domain.noun.verb; correlationId threads through every
    event in one flow so a request can be reconstructed from the log alone.
    """
    _logger.log(
        _LEVELS.get(level, logging.INFO),
        json.dumps(
            {
                "event": event,
                "level": level,
                "correlationId": correlation_id,
                "ts": datetime.now(timezone.utc).isoformat(),
                **fields,
            }
        ),
    )
