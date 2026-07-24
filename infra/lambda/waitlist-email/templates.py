"""
Email templates for the M11 waitlist (DOD-E1-1 and onward).

A template is a callable taking the job row and returning (subject, html, text).
Templates live in this registry ONLY when they are actually implemented — an
unknown template raises in the dispatcher rather than being skipped, because a
silently skipped job is marked done with nothing sent and no signal that a
template was never wired up.

Every message carries a plain-text alternative. HTML-only mail is a
deliverability penalty and unreadable in a text client.
"""

BRAND = "#E0147A"
SITE = "https://cello.mygentic.ai"


def _shell(content):
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="background:{BRAND};padding:32px 40px;">
          <span style="font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">CELLO</span>
          <span style="font-size:13px;color:rgba(255,255,255,0.7);margin-left:8px;">by Mygentic</span>
        </td></tr>
        <tr><td style="padding:40px;">{content}</td></tr>
        <tr><td style="padding:24px 40px;border-top:1px solid #f0f0f0;">
          <p style="margin:0;font-size:12px;color:#999;line-height:1.6;">
            You're receiving this because you joined the waitlist at
            <a href="{SITE}" style="color:{BRAND};text-decoration:none;">cello.mygentic.ai</a>.
            &nbsp;·&nbsp;
            <a href="{SITE}/privacy" style="color:#999;text-decoration:none;">Privacy</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _greeting(job):
    name = (job.get("display_name") or "").strip()
    return name.split()[0] if name else "there"


def _position_line(job):
    """Real position or nothing at all.

    DOD-INV-NO-INFLATION: never invent or pad a number. If the view returned no
    position — the user was admitted before the mail went out, say — the sentence
    is omitted rather than filled with a placeholder.
    """
    position = job.get("queue_position")
    size = job.get("queue_size")
    if not position:
        return None
    if size:
        return f"You're #{position} of {size} on the list."
    return f"You're #{position} on the list."


def e1_confirm(job):
    """E1 — confirm your email. Sent within 60s of signup.

    Carries the three things DOD-E1-1 asks for beyond the verify link: the real
    queue position, the personal referral link, and one sentence on how waves
    work.
    """
    name = _greeting(job)
    token = job.get("auth_token")
    confirm_url = f"{SITE}/confirm?token={token}" if token else f"{SITE}/auth"
    code = job.get("referral_code")
    referral_url = f"{SITE}/?ref={code}" if code else None
    position = _position_line(job)

    waves = (
        "Access opens in waves. Each wave is sized when we open it, based on how "
        "the previous one went — so there's no fixed date, and sharing your link "
        "moves you up."
    )

    parts = [
        f'<h1 style="margin:0 0 8px;font-size:28px;font-weight:700;color:#111;letter-spacing:-0.5px;">Confirm your email, {name}.</h1>',
        f'<p style="margin:0 0 24px;font-size:16px;color:#666;line-height:1.6;">One click and your spot is secured.</p>',
        f'<a href="{confirm_url}" style="display:inline-block;padding:16px 32px;background:{BRAND};color:#fff;text-decoration:none;border-radius:100px;font-size:16px;font-weight:600;">Confirm email →</a>',
    ]
    if position:
        parts.append(
            f'<p style="margin:28px 0 0;font-size:16px;color:#111;font-weight:600;">{position}</p>'
        )
    parts.append(
        f'<p style="margin:12px 0 0;font-size:14px;color:#666;line-height:1.6;">{waves}</p>'
    )
    if referral_url:
        parts.append(
            f'<p style="margin:24px 0 4px;font-size:14px;color:#111;font-weight:600;">Your referral link</p>'
            f'<p style="margin:0;font-size:13px;color:#666;word-break:break-all;">'
            f'<a href="{referral_url}" style="color:{BRAND};text-decoration:none;">{referral_url}</a></p>'
        )
    parts.append(
        f'<p style="margin:28px 0 0;font-size:12px;color:#bbb;word-break:break-all;line-height:1.6;">'
        f"If the button doesn't work, paste this into your browser:<br>{confirm_url}</p>"
    )

    text_lines = [
        f"Hi {name},",
        "",
        "Confirm your email to secure your spot on the CELLO waitlist:",
        confirm_url,
        "",
    ]
    if position:
        text_lines += [position, ""]
    text_lines += [waves, ""]
    if referral_url:
        text_lines += ["Your referral link:", referral_url, ""]
    text_lines += ["— The CELLO team", SITE]

    return (
        "Confirm your spot on the CELLO waitlist",
        _shell("".join(parts)),
        "\n".join(text_lines),
    )


# Only implemented templates belong here. A missing entry is a loud failure in
# the dispatcher, which is the correct outcome for a job referencing a template
# nobody has written yet.
TEMPLATES = {
    "e1_confirm": e1_confirm,
}
