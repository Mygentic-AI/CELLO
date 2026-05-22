"""
github-webhook-receiver Lambda

Validates HMAC-SHA256 signature on GitHub push webhooks, then forwards
the verified payload to the cello-github-events EventBridge bus.

Security contract (SI-002):
  - No payload reaches EventBridge unless HMAC-SHA256 verification passes.
  - Invalid or missing X-Hub-Signature-256 → HTTP 401, no forwarding.
  - HMAC secret fetched from Secrets Manager (name in HMAC_SECRET_ID env var).
  - Secret is cached in module scope after first fetch to avoid per-invocation
    Secrets Manager calls (standard Lambda warm-start optimisation).

Observability:
  - pipeline.webhook.received (INFO) — fields: repository, branch, commitSha,
    changedFileCount
  - pipeline.webhook.rejected (WARN) — fields: reason, sourceIp

Pseudocode:
  handler(event, context):
    1. Extract raw body bytes and X-Hub-Signature-256 header.
    2. If header missing → reject with 401, log pipeline.webhook.rejected.
    3. Fetch HMAC secret from Secrets Manager (cached).
    4. Compute HMAC-SHA256(secret, raw_body) and compare to header value
       using hmac.compare_digest for constant-time comparison.
    5. If digest mismatch → reject with 401, log pipeline.webhook.rejected.
    6. Parse JSON body. Extract repository, branch, commitSha, changedFileCount.
    7. Put event on EventBridge bus (EVENT_BUS_NAME env var).
    8. Log pipeline.webhook.received (INFO).
    9. Return 200.

Error handling:
  - Secrets Manager fetch failure → return 500, log error (do not log the secret).
  - EventBridge put failure → return 500, log error.
"""

import hashlib
import hmac
import json
import os

import boto3

# ── Module-level singletons ────────────────────────────────────────────────
_secrets_client = boto3.client("secretsmanager")
_events_client = boto3.client("events")

# Cached HMAC secret — fetched once on first warm invocation, reused thereafter.
_cached_hmac_secret: bytes | None = None


def _log(level: str, event_name: str, **fields) -> None:
    """Emit a structured JSON log line to stdout (CloudWatch)."""
    record = {"event": event_name, "level": level, **fields}
    print(json.dumps(record), flush=True)


def _get_hmac_secret() -> bytes:
    """
    Fetch the HMAC secret from Secrets Manager.
    Caches the result in module scope for warm invocations.
    Raises RuntimeError on fetch failure.
    """
    global _cached_hmac_secret
    if _cached_hmac_secret is not None:
        return _cached_hmac_secret

    secret_id = os.environ["HMAC_SECRET_ID"]
    response = _secrets_client.get_secret_value(SecretId=secret_id)

    # SecretString for text secrets, SecretBinary for binary.
    # GitHub signs with the secret value as-is (UTF-8 bytes), so we must not
    # hex-decode it — the raw string stored in Secrets Manager is the key.
    if "SecretString" in response:
        secret_bytes = response["SecretString"].encode("utf-8")
    else:
        secret_bytes = response["SecretBinary"]

    _cached_hmac_secret = secret_bytes
    return _cached_hmac_secret


def _source_ip(event: dict) -> str:
    """Extract client IP from Lambda function URL request context."""
    return (
        event.get("requestContext", {})
        .get("http", {})
        .get("sourceIp", "unknown")
    )


def _count_changed_files(body: dict) -> int:
    """Count distinct changed files across all commits in a push payload."""
    seen = set()
    for commit in body.get("commits", []):
        for field in ("modified", "added", "removed"):
            seen.update(commit.get(field, []))
    return len(seen)


def handler(event: dict, context) -> dict:
    """Lambda entry point for github-webhook-receiver."""

    # ── 1. Extract raw body and signature header ───────────────────────────
    # Lambda function URL passes base64 flag; raw body is always in "body".
    raw_body: str | None = event.get("body", "")
    if event.get("isBase64Encoded"):
        import base64
        raw_body_bytes = base64.b64decode(raw_body or "")
    else:
        raw_body_bytes = (raw_body or "").encode("utf-8")

    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    sig_header: str | None = headers.get("x-hub-signature-256")

    source_ip = _source_ip(event)

    # ── 2. Reject if signature header is missing ───────────────────────────
    if not sig_header:
        _log("warn", "pipeline.webhook.rejected", reason="missing_signature", sourceIp=source_ip)
        return {"statusCode": 401, "body": json.dumps({"error": "Missing X-Hub-Signature-256"})}

    # ── 3. Fetch HMAC secret ───────────────────────────────────────────────
    try:
        secret = _get_hmac_secret()
    except Exception as exc:
        _log("error", "pipeline.webhook.secret_fetch_failed", reason=str(exc))
        return {"statusCode": 500, "body": json.dumps({"error": "Internal error"})}

    # ── 4. Verify HMAC-SHA256 ──────────────────────────────────────────────
    # GitHub sends: "sha256=<hex_digest>"
    expected_digest = hmac.new(secret, raw_body_bytes, hashlib.sha256).hexdigest()
    expected_header = f"sha256={expected_digest}"

    if not hmac.compare_digest(expected_header, sig_header):
        _log("warn", "pipeline.webhook.rejected", reason="invalid_signature", sourceIp=source_ip)
        return {"statusCode": 401, "body": json.dumps({"error": "Invalid signature"})}

    # ── 5. Parse payload ───────────────────────────────────────────────────
    # GitHub may send as application/json (raw JSON body) or
    # application/x-www-form-urlencoded (body = "payload=<url-encoded-json>").
    # The HMAC is computed over the raw body bytes in both cases.
    try:
        body_str = raw_body_bytes.decode("utf-8")
        if body_str.startswith("payload="):
            import urllib.parse
            body = json.loads(urllib.parse.unquote_plus(body_str[len("payload="):]))
        else:
            body = json.loads(body_str)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        _log("warn", "pipeline.webhook.rejected", reason="invalid_json", sourceIp=source_ip)
        return {"statusCode": 400, "body": json.dumps({"error": "Invalid JSON body"})}

    # Extract observability fields.
    repository = body.get("repository", {}).get("full_name", "unknown")
    # GitHub push ref format: "refs/heads/<branch>"
    ref = body.get("ref", "")
    branch = ref.removeprefix("refs/heads/") if ref.startswith("refs/heads/") else ref
    commit_sha = body.get("after", body.get("head_commit", {}).get("id", "unknown"))
    changed_file_count = _count_changed_files(body)

    # ── 6. Forward payload to EventBridge ─────────────────────────────────
    event_bus_name = os.environ["EVENT_BUS_NAME"]
    try:
        resp = _events_client.put_events(
            Entries=[
                {
                    "Source": "cello.github",
                    "DetailType": "push",
                    "Detail": json.dumps(body),
                    "EventBusName": event_bus_name,
                }
            ]
        )
    except Exception as exc:
        _log("error", "pipeline.webhook.forward_failed", reason=str(exc))
        return {"statusCode": 500, "body": json.dumps({"error": "Failed to forward event"})}

    # put_events returns HTTP 200 even on partial failure — check explicitly.
    if resp.get("FailedEntryCount", 0) > 0:
        failed_entry = resp.get("Entries", [{}])[0]
        _log(
            "error",
            "pipeline.webhook.forward_failed",
            reason=failed_entry.get("ErrorMessage", "unknown"),
            errorCode=failed_entry.get("ErrorCode"),
        )
        return {"statusCode": 500, "body": json.dumps({"error": "Failed to forward event"})}

    # ── 7. Log success ─────────────────────────────────────────────────────
    _log(
        "info",
        "pipeline.webhook.received",
        repository=repository,
        branch=branch,
        commitSha=commit_sha,
        changedFileCount=changed_file_count,
    )

    return {
        "statusCode": 200,
        "body": json.dumps({"message": "Webhook received", "commitSha": commit_sha}),
    }
