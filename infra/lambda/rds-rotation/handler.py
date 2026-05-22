"""
CELLO RDS credential rotation Lambda.

Implements the AWS Secrets Manager multi-user rotation protocol for PostgreSQL.
AWS calls this Lambda four times per rotation, once per step:
  createSecret → setSecret → testSecret → finishSecret

Multi-user strategy:
  - Admin credential: cello/{env}/directory/rds-admin-credentials
    username: cello_admin (has CREATEROLE + can ALTER ROLE ... PASSWORD)
  - App credential:   cello/{env}/directory/rds-credentials  (the secret being rotated)
    username: cello_service

Protocol (per step):
  createSecret:  Generate a new random password. Store it in the AWSPENDING version
                 of the secret. Does NOT touch RDS yet.
  setSecret:     Using the admin credential, ALTER ROLE cello_service PASSWORD '<new>';
                 The new password is now live in RDS.
  testSecret:    Attempt a real psycopg2 connection using AWSPENDING credentials.
                 If it fails, raise an exception — Secrets Manager will roll back.
  finishSecret:  Promote AWSPENDING to AWSCURRENT. Log secrets.rotation.completed.

Observability (per SECOPS-004 story):
  - secrets.rotation.completed  INFO   { secretId, rotationDuration }
  - secrets.rotation.failed     ERROR  { secretId, reason }

References:
  AWS Secrets Manager rotation: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html
  Multi-user rotation strategy:  https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets-two-users.html
"""

import json
import logging
import os
import time
from typing import Any

import boto3
import psycopg2

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# ── AWS clients (initialised at module scope for Lambda warm-start reuse) ───

_secretsmanager = None


class _RotationAlreadyDone(Exception):
    """Raised by _validate_rotation_state when the token is already AWSCURRENT.
    Caught in lambda_handler to exit cleanly without triggering the error path."""


def _get_secretsmanager():
    global _secretsmanager
    if _secretsmanager is None:
        _secretsmanager = boto3.client("secretsmanager")
    return _secretsmanager


def _get_rds_endpoint() -> str:
    """
    Read the RDS endpoint from the environment.
    The CloudFormation template injects RDS_ENDPOINT as an env var.
    We never hardcode the endpoint — it is a runtime value from the stack.
    """
    endpoint = os.environ.get("RDS_ENDPOINT")
    if not endpoint:
        raise ValueError("RDS_ENDPOINT environment variable is required")
    return endpoint


# ── Entry point ──────────────────────────────────────────────────────────────


def lambda_handler(event: dict, context: Any) -> None:
    """
    AWS Secrets Manager calls this handler with:
      event = {
        "SecretId":            "<secret ARN being rotated>",
        "ClientRequestToken":  "<rotation token — identifies this rotation attempt>",
        "Step":                "createSecret" | "setSecret" | "testSecret" | "finishSecret"
      }

    Pseudocode (overall):
      1. Extract SecretId, ClientRequestToken, Step from event
      2. Validate the secret is in a rotation state (AWSPENDING exists or not yet)
      3. Dispatch to the step handler
      4. On any exception: log secrets.rotation.failed, re-raise so Secrets Manager rolls back
    """
    secret_id = event["SecretId"]
    token = event["ClientRequestToken"]
    step = event["Step"]

    rotation_start_ms = int(time.time() * 1000)

    sm = _get_secretsmanager()

    try:
        # Validate the secret version state before acting.
        # Raises _RotationAlreadyDone if already AWSCURRENT (idempotent exit).
        _validate_rotation_state(sm, secret_id, token, step)

        if step == "createSecret":
            _create_secret(sm, secret_id, token)

        elif step == "setSecret":
            _set_secret(sm, secret_id, token)

        elif step == "testSecret":
            _test_secret(sm, secret_id, token)

        elif step == "finishSecret":
            _finish_secret(sm, secret_id, token, rotation_start_ms)

        else:
            raise ValueError(f"Unsupported step: {step!r}")

    except _RotationAlreadyDone:
        # Idempotent: this token is already AWSCURRENT — nothing to do.
        # Do NOT route through the error path; this is not a failure.
        return

    except Exception as exc:
        _emit_event("ERROR", "secrets.rotation.failed", {
            "secretId": secret_id,
            "reason": str(exc),
            "step": step,
        })
        raise


# ── Step handlers ─────────────────────────────────────────────────────────────


def _validate_rotation_state(sm, secret_id: str, token: str, step: str) -> None:
    """
    Ensure the secret is in the expected state before acting.

    Pseudocode:
      - Call describe_secret to get version IDs and their staging labels
      - If the token is already AWSCURRENT (already rotated), skip this rotation
      - For createSecret: if AWSPENDING already has our token, skip (already created)
      - For other steps: AWSPENDING must exist with our token
    """
    metadata = sm.describe_secret(SecretId=secret_id)

    if not metadata.get("RotationEnabled"):
        raise ValueError(
            f"Secret {secret_id} is not configured for rotation. "
            "Enable rotation before calling the rotation Lambda."
        )

    versions = metadata.get("VersionIdsToStages", {})

    if token not in versions:
        raise ValueError(
            f"Secret {secret_id} has no version matching token {token}. "
            "The rotation may have already completed or been cancelled."
        )

    current_version_stages = versions.get(token, [])

    if "AWSCURRENT" in current_version_stages:
        # Already rotated — raise sentinel so lambda_handler exits cleanly
        # without dispatching to the step handler or firing the error path.
        raise _RotationAlreadyDone(f"Token {token} is already AWSCURRENT for {secret_id}")

    if step == "createSecret":
        # AWSPENDING with our token already exists — idempotent, skip create
        if "AWSPENDING" in current_version_stages:
            logger.info(
                "createSecret: AWSPENDING already exists — skipping create",
                extra={"secretId": secret_id},
            )
        return

    # For setSecret, testSecret, finishSecret: AWSPENDING must exist
    if "AWSPENDING" not in current_version_stages:
        raise ValueError(
            f"Secret {secret_id}: expected AWSPENDING for step {step!r} "
            f"but token {token} has stages: {current_version_stages}"
        )


def _create_secret(sm, secret_id: str, token: str) -> None:
    """
    Step 1: createSecret.
    Generate a new random password and store it in the AWSPENDING version.
    Does NOT modify RDS yet.

    Pseudocode:
      1. Get the current secret value (AWSCURRENT) to read the username
      2. Generate a new 32-character random alphanumeric password
         via secretsmanager get_random_password
      3. Put the new credential as AWSPENDING with our ClientRequestToken
    """
    # Check if AWSPENDING already has our token (idempotent)
    try:
        sm.get_secret_value(SecretId=secret_id, VersionStage="AWSPENDING")
        logger.info(
            "createSecret: AWSPENDING already exists — skipping",
            extra={"secretId": secret_id},
        )
        return
    except sm.exceptions.ResourceNotFoundException:
        pass  # Expected — AWSPENDING does not exist yet

    # Read current secret to get the username
    current = sm.get_secret_value(SecretId=secret_id, VersionStage="AWSCURRENT")
    current_dict = json.loads(current["SecretString"])
    username = current_dict["username"]

    # Generate a new strong random password (no special characters that break psycopg2 DSN)
    new_password_resp = sm.get_random_password(
        PasswordLength=32,
        ExcludeCharacters="/@\"'\\",
        ExcludePunctuation=False,
        IncludeSpace=False,
        RequireEachIncludedType=True,
    )
    new_password = new_password_resp["RandomPassword"]

    new_secret = json.dumps({"username": username, "password": new_password})

    sm.put_secret_value(
        SecretId=secret_id,
        ClientRequestToken=token,
        SecretString=new_secret,
        VersionStages=["AWSPENDING"],
    )

    logger.info("createSecret: stored new password as AWSPENDING", extra={"secretId": secret_id})


def _set_secret(sm, secret_id: str, token: str) -> None:
    """
    Step 2: setSecret.
    Apply the new password to RDS using the admin credential.
    The admin credential is in cello/{env}/directory/rds-admin-credentials.

    Pseudocode:
      1. Read admin credential from rds-admin-credentials secret (AWSCURRENT)
      2. Read new (pending) credential from the rotated secret (AWSPENDING)
      3. Connect to RDS as admin
      4. ALTER ROLE <username> PASSWORD '<new_password>'
      5. Close admin connection
    """
    admin_secret_id = _get_admin_secret_id(secret_id)

    # Read admin credential
    admin_raw = sm.get_secret_value(SecretId=admin_secret_id, VersionStage="AWSCURRENT")
    admin_dict = json.loads(admin_raw["SecretString"])
    admin_user = admin_dict["username"]
    admin_password = admin_dict["password"]

    # Read pending (new) credential
    pending_raw = sm.get_secret_value(SecretId=secret_id, VersionStage="AWSPENDING")
    pending_dict = json.loads(pending_raw["SecretString"])
    app_user = pending_dict["username"]
    new_password = pending_dict["password"]

    rds_endpoint = _get_rds_endpoint()
    rds_port = int(os.environ.get("RDS_PORT", "5432"))
    db_name = os.environ.get("RDS_DB_NAME", "postgres")

    # Connect as admin and update the app user's password
    conn = None
    try:
        conn = psycopg2.connect(
            host=rds_endpoint,
            port=rds_port,
            dbname=db_name,
            user=admin_user,
            password=admin_password,
            connect_timeout=10,
            sslmode="require",
        )
        conn.autocommit = True
        with conn.cursor() as cur:
            # Use parameterized password to prevent SQL injection.
            # psycopg2 does not support parameters for ALTER ROLE — we use
            # mogrify-style quoting via the Identifier/Literal adapters.
            # The password is a random alphanumeric string (chars restricted above)
            # so string interpolation here is safe, but we double-quote the username.
            cur.execute(
                "ALTER ROLE %s PASSWORD %s",
                (psycopg2.extensions.AsIs(f'"{app_user}"'), new_password),
            )
    finally:
        if conn:
            conn.close()

    logger.info("setSecret: applied new password to RDS", extra={"secretId": secret_id})


def _test_secret(sm, secret_id: str, token: str) -> None:
    """
    Step 3: testSecret.
    Verify the new credential authenticates successfully against RDS.
    If this step raises, Secrets Manager rolls back the rotation.

    Pseudocode:
      1. Read the AWSPENDING credential
      2. Attempt a real psycopg2 connection using those credentials
      3. Execute SELECT 1 to confirm the connection works
      4. Close the connection
      5. If any step fails, raise — Secrets Manager will roll back
    """
    pending_raw = sm.get_secret_value(SecretId=secret_id, VersionStage="AWSPENDING")
    pending_dict = json.loads(pending_raw["SecretString"])
    app_user = pending_dict["username"]
    new_password = pending_dict["password"]

    rds_endpoint = _get_rds_endpoint()
    rds_port = int(os.environ.get("RDS_PORT", "5432"))
    db_name = os.environ.get("RDS_DB_NAME", "postgres")

    conn = None
    try:
        conn = psycopg2.connect(
            host=rds_endpoint,
            port=rds_port,
            dbname=db_name,
            user=app_user,
            password=new_password,
            connect_timeout=10,
            sslmode="require",
        )
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            result = cur.fetchone()
            if result[0] != 1:
                raise ValueError("testSecret: SELECT 1 returned unexpected value")
    except psycopg2.OperationalError as exc:
        raise ValueError(
            f"testSecret: new credential failed to authenticate against RDS: {exc}"
        ) from exc
    finally:
        if conn:
            conn.close()

    logger.info("testSecret: new credential verified against RDS", extra={"secretId": secret_id})


def _finish_secret(sm, secret_id: str, token: str, rotation_start_ms: int) -> None:
    """
    Step 4: finishSecret.
    Promote AWSPENDING to AWSCURRENT and log completion.

    Pseudocode:
      1. Find the current AWSCURRENT version (to demote it to no stage after promotion)
      2. Call put_secret_value to move AWSPENDING → AWSCURRENT
         (this atomically demotes the old AWSCURRENT)
      3. Log secrets.rotation.completed with { secretId, rotationDuration }
    """
    # Find the current AWSCURRENT version ID
    metadata = sm.describe_secret(SecretId=secret_id)
    versions = metadata.get("VersionIdsToStages", {})
    current_version = None
    for version_id, stages in versions.items():
        if "AWSCURRENT" in stages:
            current_version = version_id
            break

    # Promote AWSPENDING to AWSCURRENT
    sm.update_secret_version_stage(
        SecretId=secret_id,
        VersionStage="AWSCURRENT",
        MoveToVersionId=token,
        RemoveFromVersionId=current_version,
    )

    rotation_end_ms = int(time.time() * 1000)
    rotation_duration_ms = rotation_end_ms - rotation_start_ms

    _emit_event("INFO", "secrets.rotation.completed", {
        "secretId": secret_id,
        "rotationDuration": rotation_duration_ms,
    })


# ── Helpers ───────────────────────────────────────────────────────────────────


def _get_admin_secret_id(app_secret_id: str) -> str:
    """
    Derive the admin credential secret ID from the app credential secret ID.
    Pattern: cello/{env}/directory/rds-credentials
          →  cello/{env}/directory/rds-admin-credentials

    The admin secret ID can also be overridden via the ADMIN_SECRET_ID env var
    (set in the Lambda environment by the CloudFormation template).
    """
    override = os.environ.get("ADMIN_SECRET_ID")
    if override:
        return override

    # Fallback: derive from the app secret ID
    if app_secret_id.endswith("/rds-credentials"):
        return app_secret_id.replace("/rds-credentials", "/rds-admin-credentials")

    raise ValueError(
        f"Cannot derive admin secret ID from {app_secret_id!r}. "
        "Set ADMIN_SECRET_ID environment variable."
    )


def _emit_event(level: str, event_name: str, context: dict) -> None:
    """
    Emit a structured JSON log event using the domain.noun.verb taxonomy.
    This produces a CloudWatch Logs line that can be queried via Logs Insights.
    """
    payload = {"event": event_name, "level": level, **context}
    if level == "INFO":
        logger.info(json.dumps(payload))
    elif level == "ERROR":
        logger.error(json.dumps(payload))
    elif level == "WARN":
        logger.warning(json.dumps(payload))
