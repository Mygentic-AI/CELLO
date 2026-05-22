"""
Unit tests for github-webhook-receiver Lambda.

AC-005: Invalid HMAC → 401, payload NOT forwarded to EventBridge.
SI-002: Only HMAC-verified payloads reach EventBridge.

Test coverage:
  - AC-005 / SI-002: valid HMAC → 200
  - AC-005 / SI-002: invalid HMAC → 401
  - AC-005 / SI-002: missing signature header → 401
  - Error path: secret fetch failure → 500
  - Observability: pipeline.webhook.received logged on success
  - Observability: pipeline.webhook.rejected logged on rejection
"""

import base64
import hashlib
import hmac
import importlib
import json
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

# ── Lightweight stubs for AWS SDK (boto3 is not available in the test runner
#    unless installed; we replace it with mocks before importing the module) ──

_fake_secrets_client = MagicMock()
_fake_events_client = MagicMock()


def _make_boto3_stub():
    """Return a boto3 module stub that returns pre-configured clients."""
    boto3_stub = types.ModuleType("boto3")

    def client(service_name, **kwargs):
        if service_name == "secretsmanager":
            return _fake_secrets_client
        if service_name == "events":
            return _fake_events_client
        raise ValueError(f"Unexpected service: {service_name}")

    boto3_stub.client = client
    return boto3_stub


def _build_event(
    body: str,
    secret: bytes,
    tamper: bool = False,
    missing_sig: bool = False,
    base64_encoded: bool = False,
) -> dict:
    """Build a Lambda function URL event with optional HMAC signature."""
    if base64_encoded:
        encoded_body = base64.b64encode(body.encode()).decode()
        raw_bytes = base64.b64decode(encoded_body)
    else:
        encoded_body = body
        raw_bytes = body.encode()

    sig = hmac.new(secret, raw_bytes, hashlib.sha256).hexdigest()
    if tamper:
        sig = "0" * len(sig)

    headers = {}
    if not missing_sig:
        headers["x-hub-signature-256"] = f"sha256={sig}"

    return {
        "body": encoded_body,
        "isBase64Encoded": base64_encoded,
        "headers": headers,
        "requestContext": {"http": {"sourceIp": "1.2.3.4"}},
    }


class TestWebhookReceiver(unittest.TestCase):

    def setUp(self):
        """Reset module state and mocks before each test."""
        # Remove cached module so each test gets a fresh import.
        for mod_name in list(sys.modules.keys()):
            if "webhook" in mod_name or mod_name == "index":
                del sys.modules[mod_name]

        # Reset mock call history AND side_effects.
        _fake_secrets_client.reset_mock(side_effect=True, return_value=True)
        _fake_events_client.reset_mock(side_effect=True, return_value=True)

        # Default secret for tests.
        self.secret = b"test-hmac-secret-32bytes-for-test"

        # Default secret fetch response (hex-encoded secret).
        _fake_secrets_client.get_secret_value.return_value = {
            "SecretString": self.secret.hex()
        }
        # Default EventBridge success.
        _fake_events_client.put_events.return_value = {
            "FailedEntryCount": 0,
            "Entries": [{"EventId": "abc-123"}],
        }

    def _call_handler(self, event: dict):
        """Import a fresh module and call handler(event, None)."""
        import importlib.util
        import os
        spec = importlib.util.spec_from_file_location(
            "index",
            os.path.join(os.path.dirname(__file__), "index.py"),
        )
        mod = importlib.util.module_from_spec(spec)
        boto3_stub = _make_boto3_stub()
        mod.boto3 = boto3_stub
        with patch.dict("os.environ", {
            "HMAC_SECRET_ARN": "arn:aws:secretsmanager:us-east-1:123:secret:test",
            "EVENT_BUS_NAME": "cello-github-events-test",
        }):
            # Inject the fake boto3 clients into the module's namespace.
            with patch("boto3.client") as mock_boto3_client:
                def client_factory(service_name, **kw):
                    if service_name == "secretsmanager":
                        return _fake_secrets_client
                    return _fake_events_client
                mock_boto3_client.side_effect = client_factory
                spec.loader.exec_module(mod)
                # Patch the module-level clients directly.
                mod._secrets_client = _fake_secrets_client
                mod._events_client = _fake_events_client
                mod._cached_hmac_secret = None  # ensure fresh fetch each test
                result = mod.handler(event, None)
        return result

    # ── AC-005 / SI-002: Valid HMAC → 200, event forwarded ──────────────────

    def test_valid_hmac_returns_200(self):
        """AC-005: A request with a valid HMAC-SHA256 signature returns 200."""
        body = json.dumps({
            "ref": "refs/heads/main",
            "after": "abc123",
            "repository": {"full_name": "Mygentic-AI/CELLO"},
            "commits": [{"modified": ["packages/directory/src/index.ts"], "added": [], "removed": []}],
        })
        event = _build_event(body, self.secret)
        result = self._call_handler(event)
        self.assertEqual(result["statusCode"], 200)

    def test_valid_hmac_forwards_to_eventbridge(self):
        """SI-002: EventBridge put_events is called for a valid signature."""
        body = json.dumps({
            "ref": "refs/heads/main",
            "after": "abc123",
            "repository": {"full_name": "Mygentic-AI/CELLO"},
            "commits": [],
        })
        event = _build_event(body, self.secret)
        self._call_handler(event)
        _fake_events_client.put_events.assert_called_once()

    def test_valid_hmac_base64_encoded_body(self):
        """Valid HMAC with base64-encoded body (isBase64Encoded=True) returns 200."""
        body = json.dumps({
            "ref": "refs/heads/main",
            "after": "deadbeef",
            "repository": {"full_name": "Mygentic-AI/CELLO"},
            "commits": [],
        })
        event = _build_event(body, self.secret, base64_encoded=True)
        result = self._call_handler(event)
        self.assertEqual(result["statusCode"], 200)

    # ── AC-005 / SI-002: Invalid HMAC → 401, NOT forwarded ──────────────────

    def test_invalid_hmac_returns_401(self):
        """AC-005: A tampered payload returns HTTP 401."""
        body = json.dumps({"ref": "refs/heads/main", "after": "abc123", "commits": []})
        event = _build_event(body, self.secret, tamper=True)
        result = self._call_handler(event)
        self.assertEqual(result["statusCode"], 401)

    def test_invalid_hmac_does_not_forward_to_eventbridge(self):
        """SI-002: EventBridge is NOT called when signature is invalid."""
        body = json.dumps({"ref": "refs/heads/main", "after": "abc123", "commits": []})
        event = _build_event(body, self.secret, tamper=True)
        self._call_handler(event)
        _fake_events_client.put_events.assert_not_called()

    def test_invalid_hmac_logs_rejected_warn(self):
        """pipeline.webhook.rejected is emitted for an invalid signature."""
        body = json.dumps({"ref": "refs/heads/main", "after": "abc123", "commits": []})
        event = _build_event(body, self.secret, tamper=True)
        logged = []
        import io
        from contextlib import redirect_stdout

        buf = io.StringIO()
        with redirect_stdout(buf):
            self._call_handler(event)
        output = buf.getvalue()
        # At least one JSON log line should contain pipeline.webhook.rejected with required fields.
        records = [
            json.loads(line)
            for line in output.strip().splitlines()
            if line.strip()
        ]
        rejected = [r for r in records if r.get("event") == "pipeline.webhook.rejected"]
        self.assertTrue(len(rejected) >= 1, f"Expected pipeline.webhook.rejected in output:\n{output}")
        rec = rejected[0]
        self.assertIn("reason", rec)
        self.assertIn("sourceIp", rec)

    # ── AC-005 / SI-002: Missing header → 401 ───────────────────────────────

    def test_missing_signature_header_returns_401(self):
        """AC-005: A request with no X-Hub-Signature-256 header returns 401."""
        body = json.dumps({"ref": "refs/heads/main", "after": "abc123", "commits": []})
        event = _build_event(body, self.secret, missing_sig=True)
        result = self._call_handler(event)
        self.assertEqual(result["statusCode"], 401)

    def test_missing_header_does_not_forward_to_eventbridge(self):
        """SI-002: EventBridge is NOT called when signature header is absent."""
        body = json.dumps({"ref": "refs/heads/main", "after": "abc123", "commits": []})
        event = _build_event(body, self.secret, missing_sig=True)
        self._call_handler(event)
        _fake_events_client.put_events.assert_not_called()

    def test_missing_header_logs_rejected_warn(self):
        """pipeline.webhook.rejected is emitted for a missing signature."""
        body = json.dumps({"ref": "refs/heads/main", "after": "abc123", "commits": []})
        event = _build_event(body, self.secret, missing_sig=True)
        import io
        from contextlib import redirect_stdout

        buf = io.StringIO()
        with redirect_stdout(buf):
            self._call_handler(event)
        output = buf.getvalue()
        found = any(
            json.loads(line).get("event") == "pipeline.webhook.rejected"
            and json.loads(line).get("reason") == "missing_signature"
            for line in output.strip().splitlines()
            if line.strip()
        )
        self.assertTrue(found, f"Expected pipeline.webhook.rejected(missing_signature) in:\n{output}")

    # ── Error path: Secrets Manager fetch failure → 500 ─────────────────────

    def test_secret_fetch_failure_returns_500(self):
        """A Secrets Manager error returns 500 without forwarding to EventBridge."""
        _fake_secrets_client.get_secret_value.side_effect = RuntimeError("SM unavailable")
        body = json.dumps({"ref": "refs/heads/main", "after": "abc123", "commits": []})
        # We need a valid sig for the header check to pass — but the secret fetch
        # fails anyway, so this still exercises the 500 path.
        # Use any value for the signature since the failure happens at fetch time.
        event = {
            "body": body,
            "isBase64Encoded": False,
            "headers": {"x-hub-signature-256": "sha256=anysig"},
            "requestContext": {"http": {"sourceIp": "5.6.7.8"}},
        }
        result = self._call_handler(event)
        self.assertEqual(result["statusCode"], 500)
        _fake_events_client.put_events.assert_not_called()

    # ── Error path: EventBridge partial failure (FailedEntryCount > 0) → 500 ──

    def test_eventbridge_partial_failure_returns_500(self):
        """put_events FailedEntryCount > 0 returns 500 without marking delivery successful."""
        _fake_events_client.put_events.return_value = {
            "FailedEntryCount": 1,
            "Entries": [{"ErrorCode": "ThrottlingException", "ErrorMessage": "Rate exceeded"}],
        }
        body = json.dumps({
            "ref": "refs/heads/main",
            "after": "abc123",
            "repository": {"full_name": "Mygentic-AI/CELLO"},
            "commits": [],
        })
        event = _build_event(body, self.secret)
        result = self._call_handler(event)
        self.assertEqual(result["statusCode"], 500)

    # ── Observability: pipeline.webhook.received logged on success ───────────

    def test_success_logs_webhook_received(self):
        """pipeline.webhook.received is logged for a verified push payload."""
        body = json.dumps({
            "ref": "refs/heads/main",
            "after": "deadcafe",
            "repository": {"full_name": "Mygentic-AI/CELLO"},
            "commits": [
                {"modified": ["packages/directory/src/index.ts"], "added": [], "removed": []}
            ],
        })
        event = _build_event(body, self.secret)
        import io
        from contextlib import redirect_stdout

        buf = io.StringIO()
        with redirect_stdout(buf):
            self._call_handler(event)
        output = buf.getvalue()
        records = [
            json.loads(line)
            for line in output.strip().splitlines()
            if line.strip()
        ]
        received = [r for r in records if r.get("event") == "pipeline.webhook.received"]
        self.assertTrue(len(received) >= 1, f"Expected pipeline.webhook.received in:\n{output}")
        rec = received[0]
        self.assertEqual(rec.get("repository"), "Mygentic-AI/CELLO")
        self.assertEqual(rec.get("branch"), "main")
        self.assertEqual(rec.get("commitSha"), "deadcafe")
        self.assertEqual(rec.get("changedFileCount"), 1)


if __name__ == "__main__":
    unittest.main()
