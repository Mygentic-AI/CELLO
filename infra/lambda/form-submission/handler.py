import json
import uuid
import boto3
from datetime import datetime, timezone, timedelta

PENDING_TABLE   = "cello-form-pending"
CONFIRMED_TABLE = "cello-form-submissions"
FROM_EMAIL      = "noreply@mygentic.ai"
NOTIFY_EMAIL    = "form-submission@mygentic.ai"
BRAND_COLOR     = "#E0147A"
CONFIRM_BASE    = "https://cello.mygentic.ai/confirm"
ALLOWED_ORIGINS = ["https://cello.mygentic.ai", "http://localhost:3000", "http://localhost:3001"]
TOKEN_TTL_HOURS = 24

dynamodb        = boto3.resource("dynamodb", region_name="us-east-1")
ses             = boto3.client("ses", region_name="us-east-1")
pending_table   = dynamodb.Table(PENDING_TABLE)
confirmed_table = dynamodb.Table(CONFIRMED_TABLE)


# ── Helpers ────────────────────────────────────────────────────────────────────

def cors_headers(origin=None):
    allowed = origin if origin in ALLOWED_ORIGINS else ALLOWED_ORIGINS[0]
    return {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Content-Type": "application/json",
    }


def resp(status, body, origin=None):
    return {
        "statusCode": status,
        "headers": cors_headers(origin),
        "body": json.dumps(body),
    }


def display_name(item):
    if item.get("firstName"):
        return item["firstName"]
    if item.get("name"):
        return item["name"].split()[0]
    return "there"


# ── Router ─────────────────────────────────────────────────────────────────────

def lambda_handler(event, context):
    origin      = event.get("headers", {}).get("origin", "")
    http        = event.get("requestContext", {}).get("http", {})
    method      = http.get("method", "")
    path        = http.get("path", "")

    if method == "OPTIONS":
        return {"statusCode": 200, "headers": cors_headers(origin), "body": ""}

    if method == "POST" and path == "/submit":
        try:
            body = json.loads(event.get("body") or "{}")
        except (json.JSONDecodeError, TypeError):
            return resp(400, {"error": "Invalid JSON"}, origin)
        return handle_submit(body, origin)

    if method == "GET" and path == "/confirm":
        token = (event.get("queryStringParameters") or {}).get("token", "")
        return handle_confirm(token, origin)

    return resp(404, {"error": "Not found"}, origin)


# ── Step 1: submit → create pending record + send verification email ───────────

def handle_submit(body, origin):
    form_type = (body.get("formType") or "").strip()
    email     = (body.get("email") or "").strip().lower()

    if not email or not form_type:
        return resp(400, {"error": "Missing required fields"}, origin)

    if form_type not in ("waitlist", "agent-interest", "beta-application"):
        return resp(400, {"error": "Unknown form type"}, origin)

    # Reject if already confirmed
    existing = confirmed_table.get_item(
        Key={"email": email, "formType": form_type}
    ).get("Item")
    if existing:
        return resp(409, {"already_registered": True}, origin)

    now        = datetime.now(timezone.utc)
    token      = str(uuid.uuid4())
    expires_at = int((now + timedelta(hours=TOKEN_TTL_HOURS)).timestamp())

    item = {
        "token":     token,
        "email":     email,
        "formType":  form_type,
        "createdAt": now.isoformat(),
        "expiresAt": expires_at,
        "source":    (body.get("source") or "").strip(),
    }
    if body.get("name"):      item["name"]      = body["name"].strip()
    if body.get("firstName"): item["firstName"] = body["firstName"].strip()
    if body.get("lastName"):  item["lastName"]  = body["lastName"].strip()
    if body.get("goals"):     item["goals"]     = body["goals"].strip()

    pending_table.put_item(Item=item)
    send_verification_email(email, item, token)

    return resp(200, {"pending": True}, origin)


# ── Step 2: confirm → verify token, write to confirmed, send welcome email ─────

def handle_confirm(token, origin):
    if not token:
        return resp(400, {"error": "Missing token"}, origin)

    result = pending_table.get_item(Key={"token": token})
    item   = result.get("Item")

    if not item:
        return resp(404, {"error": "invalid_token"}, origin)

    # DynamoDB TTL deletion isn't instant — check manually
    if int(item.get("expiresAt", 0)) < int(datetime.now(timezone.utc).timestamp()):
        return resp(410, {"error": "token_expired"}, origin)

    email     = item["email"]
    form_type = item["formType"]

    confirmed_item = {k: v for k, v in item.items() if k not in ("token", "expiresAt")}
    confirmed_item["confirmedAt"] = datetime.now(timezone.utc).isoformat()

    try:
        confirmed_table.put_item(
            Item=confirmed_item,
            ConditionExpression="attribute_not_exists(email)",
        )
    except confirmed_table.meta.client.exceptions.ConditionalCheckFailedException:
        # Already confirmed — idempotent success, just clean up the token
        pending_table.delete_item(Key={"token": token})
        return resp(200, {"success": True, "already_confirmed": True, "formType": form_type}, origin)

    pending_table.delete_item(Key={"token": token})
    send_confirmation(email, confirmed_item)
    send_notification(confirmed_item)

    return resp(200, {"success": True, "formType": form_type}, origin)


# ── Email: verification ────────────────────────────────────────────────────────

def send_verification_email(email, item, token):
    name        = display_name(item)
    form_type   = item["formType"]
    confirm_url = f"{CONFIRM_BASE}?token={token}"

    subjects = {
        "waitlist":           "Confirm your spot on the CELLO waitlist",
        "agent-interest":     "Confirm your interest in CELLO Agent",
        "beta-application":   "Confirm your CELLO beta application",
    }

    content = f"""
      <h1 style="margin:0 0 8px;font-size:28px;font-weight:700;color:#111;letter-spacing:-0.5px;">Hi {name} — confirm your email.</h1>
      <p style="margin:0 0 28px;font-size:16px;color:#666;line-height:1.6;">
        Click below to verify your email address and complete your registration. This link expires in 24 hours.
      </p>

      <a href="{confirm_url}" style="display:inline-block;padding:16px 32px;background:{BRAND_COLOR};color:#fff;text-decoration:none;border-radius:100px;font-size:16px;font-weight:600;letter-spacing:-0.2px;">
        Confirm email →
      </a>

      <p style="margin:28px 0 8px;font-size:13px;color:#aaa;line-height:1.6;">
        If the button doesn't work, copy and paste this link into your browser:
      </p>
      <p style="margin:0;font-size:12px;color:#bbb;word-break:break-all;line-height:1.6;">
        {confirm_url}
      </p>
      <p style="margin:24px 0 0;font-size:13px;color:#ccc;line-height:1.6;">
        If you didn't submit this form, you can safely ignore this email.
      </p>
    """

    plain = (
        f"Hi {name},\n\n"
        f"Confirm your email address by visiting the link below.\n"
        f"This link expires in 24 hours.\n\n"
        f"{confirm_url}\n\n"
        f"If you didn't submit this form, ignore this email.\n\n"
        f"— The CELLO team\nhttps://cello.mygentic.ai"
    )

    ses.send_email(
        Source=f"CELLO <{FROM_EMAIL}>",
        Destination={"ToAddresses": [email]},
        Message={
            "Subject": {"Data": subjects[form_type], "Charset": "UTF-8"},
            "Body": {
                "Html": {"Data": _wrap_html(content), "Charset": "UTF-8"},
                "Text": {"Data": plain, "Charset": "UTF-8"},
            },
        },
    )


# ── Email: welcome (sent after confirmation) ───────────────────────────────────

def send_confirmation(email, item):
    form_type = item["formType"]
    name      = display_name(item)

    subjects = {
        "waitlist":           "You're on the CELLO waitlist",
        "agent-interest":     "Thanks for your interest in CELLO Agent",
        "beta-application":   "Your CELLO beta application is received",
    }

    bodies = {
        "waitlist":           _waitlist_html(name),
        "agent-interest":     _agent_interest_html(name),
        "beta-application":   _beta_application_html(name),
    }

    ses.send_email(
        Source=f"CELLO <{FROM_EMAIL}>",
        Destination={"ToAddresses": [email]},
        Message={
            "Subject": {"Data": subjects[form_type], "Charset": "UTF-8"},
            "Body": {
                "Html": {"Data": bodies[form_type], "Charset": "UTF-8"},
                "Text": {"Data": _plain_confirmation(name, form_type), "Charset": "UTF-8"},
            },
        },
    )


def send_notification(item):
    form_type = item["formType"]
    email     = item["email"]

    lines = [f"Form type: {form_type}", f"Email: {email}"]
    if item.get("name"):
        lines.append(f"Name: {item['name']}")
    if item.get("firstName") or item.get("lastName"):
        lines.append(f"Name: {item.get('firstName','')} {item.get('lastName','')}".strip())
    if item.get("goals"):
        lines.append(f"\nGoals:\n{item['goals']}")
    if item.get("source"):
        lines.append(f"\nSource: {item['source']}")
    lines.append(f"\nConfirmed: {item.get('confirmedAt','')}")

    ses.send_email(
        Source=f"CELLO Forms <{FROM_EMAIL}>",
        Destination={"ToAddresses": [NOTIFY_EMAIL]},
        Message={
            "Subject": {"Data": f"[{form_type}] Confirmed — {email}", "Charset": "UTF-8"},
            "Body": {"Text": {"Data": "\n".join(lines), "Charset": "UTF-8"}},
        },
    )


# ── HTML templates ─────────────────────────────────────────────────────────────

def _wrap_html(content):
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:{BRAND_COLOR};padding:32px 40px;">
              <span style="font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">CELLO</span>
              <span style="font-size:13px;color:rgba(255,255,255,0.7);margin-left:8px;">by Mygentic</span>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              {content}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #f0f0f0;">
              <p style="margin:0;font-size:12px;color:#999;line-height:1.6;">
                You're receiving this because you submitted a form on
                <a href="https://cello.mygentic.ai" style="color:{BRAND_COLOR};text-decoration:none;">cello.mygentic.ai</a>.
                &nbsp;·&nbsp;
                <a href="https://cello.mygentic.ai/privacy" style="color:#999;text-decoration:none;">Privacy Policy</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _waitlist_html(name):
    content = f"""
      <h1 style="margin:0 0 8px;font-size:28px;font-weight:700;color:#111;letter-spacing:-0.5px;">You're on the list, {name}.</h1>
      <p style="margin:0 0 24px;font-size:16px;color:#666;line-height:1.6;">
        Thanks for joining the CELLO waitlist. We'll reach out as soon as spots open for our invite-only beta launch.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf4f8;border-radius:12px;padding:24px;margin-bottom:28px;">
        <tr><td>
          <p style="margin:0 0 16px;font-size:14px;font-weight:600;color:#111;">What happens next</p>
          <table cellpadding="0" cellspacing="0">
            <tr><td style="padding:6px 0;"><span style="display:inline-block;width:20px;height:20px;background:{BRAND_COLOR};border-radius:50%;text-align:center;line-height:20px;font-size:11px;font-weight:700;color:#fff;margin-right:12px;">1</span><span style="font-size:14px;color:#444;">We review the waitlist as launch approaches</span></td></tr>
            <tr><td style="padding:6px 0;"><span style="display:inline-block;width:20px;height:20px;background:{BRAND_COLOR};border-radius:50%;text-align:center;line-height:20px;font-size:11px;font-weight:700;color:#fff;margin-right:12px;">2</span><span style="font-size:14px;color:#444;">You'll get an email with early access details</span></td></tr>
            <tr><td style="padding:6px 0;"><span style="display:inline-block;width:20px;height:20px;background:{BRAND_COLOR};border-radius:50%;text-align:center;line-height:20px;font-size:11px;font-weight:700;color:#fff;margin-right:12px;">3</span><span style="font-size:14px;color:#444;">Priority access when we open the doors</span></td></tr>
          </table>
        </td></tr>
      </table>
      <a href="https://cello.mygentic.ai/how-it-works" style="display:inline-block;margin-top:4px;padding:14px 28px;background:{BRAND_COLOR};color:#fff;text-decoration:none;border-radius:100px;font-size:14px;font-weight:600;">
        How CELLO works →
      </a>
    """
    return _wrap_html(content)


def _agent_interest_html(name):
    content = f"""
      <h1 style="margin:0 0 8px;font-size:28px;font-weight:700;color:#111;letter-spacing:-0.5px;">Thanks, {name} — we'll be in touch.</h1>
      <p style="margin:0 0 24px;font-size:16px;color:#666;line-height:1.6;">
        We've received your expression of interest in CELLO Agent. We're working with a small group of early partners and will reach out shortly to explore the fit.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf4f8;border-radius:12px;padding:24px;margin-bottom:28px;">
        <tr><td>
          <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#111;">What CELLO Agent gives your team</p>
          <p style="margin:0 0 10px;font-size:14px;color:#444;line-height:1.6;">✦ &nbsp;A pre-built agent that runs on the CELLO trust protocol</p>
          <p style="margin:0 0 10px;font-size:14px;color:#444;line-height:1.6;">✦ &nbsp;Verifiable identity for every agent interaction</p>
          <p style="margin:0;font-size:14px;color:#444;line-height:1.6;">✦ &nbsp;A starting point your team can deploy and extend</p>
        </td></tr>
      </table>
      <a href="https://cello.mygentic.ai/agent" style="display:inline-block;padding:14px 28px;background:{BRAND_COLOR};color:#fff;text-decoration:none;border-radius:100px;font-size:14px;font-weight:600;">
        Learn more about CELLO Agent →
      </a>
    """
    return _wrap_html(content)


def _beta_application_html(name):
    content = f"""
      <h1 style="margin:0 0 8px;font-size:28px;font-weight:700;color:#111;letter-spacing:-0.5px;">Application received, {name}.</h1>
      <p style="margin:0 0 24px;font-size:16px;color:#666;line-height:1.6;">
        Thanks for applying to the CELLO beta program. We review every application carefully and will be in touch if there's a good fit.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf4f8;border-radius:12px;padding:24px;margin-bottom:28px;">
        <tr><td>
          <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#111;">What we're looking for in beta testers</p>
          <p style="margin:0 0 10px;font-size:14px;color:#444;line-height:1.6;">✦ &nbsp;Developers building agent-to-agent workflows</p>
          <p style="margin:0 0 10px;font-size:14px;color:#444;line-height:1.6;">✦ &nbsp;Teams who want to shape the protocol as it's being built</p>
          <p style="margin:0;font-size:14px;color:#444;line-height:1.6;">✦ &nbsp;People willing to give detailed, honest feedback</p>
        </td></tr>
      </table>
      <a href="https://cello.mygentic.ai/how-it-works" style="display:inline-block;margin-top:4px;padding:14px 28px;background:{BRAND_COLOR};color:#fff;text-decoration:none;border-radius:100px;font-size:14px;font-weight:600;">
        Explore the protocol →
      </a>
    """
    return _wrap_html(content)


def _plain_confirmation(name, form_type):
    msgs = {
        "waitlist":           f"Hi {name},\n\nYou're on the CELLO waitlist. We'll be in touch as soon as spots open for our invite-only beta launch.\n\n— The CELLO team\nhttps://cello.mygentic.ai",
        "agent-interest":     f"Hi {name},\n\nThanks for your interest in CELLO Agent. We'll reach out shortly to explore the fit.\n\n— The CELLO team\nhttps://cello.mygentic.ai",
        "beta-application":   f"Hi {name},\n\nYour CELLO beta application is received. We review every application carefully and will be in touch if there's a good fit.\n\n— The CELLO team\nhttps://cello.mygentic.ai",
    }
    return msgs[form_type]
