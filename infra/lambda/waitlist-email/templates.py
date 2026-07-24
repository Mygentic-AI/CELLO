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

import html
import os

BRAND = "#E0147A"
SITE = "https://cello.mygentic.ai"
GALLERY = "https://gallery.cello.mygentic.ai"

# The one command that gets someone from an invitation to a running node.
INSTALL_COMMAND = "npx --yes @cello-protocol/connect"

# Links that must be RESOLVED by a Lambda point at the API Gateway, not at the
# site. /confirm on the site is served by the pre-M11 form handler and resolves
# tokens against DynamoDB — a Postgres auth_tokens UUID is never in that table,
# so a link there 404s and renders "Invalid link." while email_verified stays
# false forever.
# api.cello.mygentic.ai, not the raw execute-api host — DOD-INV-DOMAIN applies to
# what a user sees, and this URL is the most visible one in the product: it is
# the button in the confirmation email. It is also same-site with the web app,
# which is what keeps the SameSite=Lax session cookie attached when the verify
# redirect lands on /status.
API = os.environ.get("WAITLIST_API_BASE", "https://api.cello.mygentic.ai/waitlist")


def esc(value):
    """Escape anything user-controlled before it reaches an HTML body.

    display_name is attacker-chosen. Splitting on whitespace does not sanitise
    it — HTML5 accepts `/` as an attribute separator, so `<a/href="...">` needs
    no space to become a live anchor that swallows the rest of the message,
    including the real confirm button, inside a DKIM-signed CELLO email.
    """
    return html.escape(str(value or ""), quote=True)


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
    first = name.split()[0] if name else "there"
    return esc(first)


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
    confirm_url = f"{API}/auth/verify?token={token}" if token else f"{SITE}/auth"
    code = job.get("referral_code")
    referral_url = f"{SITE}/?ref={esc(code)}" if code else None
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


def e_magic_link(job):
    """The /auth sign-in link. 15 minutes, single use.

    Deliberately says nothing about queue position or referrals — this mail is
    sent in response to someone typing an address into a box, and an address
    that is not theirs must learn nothing from what arrives.
    """
    name = _greeting(job)
    token = job.get("auth_token")
    url = f"{API}/auth/verify?token={token}" if token else f"{SITE}/auth"

    content = (
        f'<h1 style="margin:0 0 8px;font-size:28px;font-weight:700;color:#111;letter-spacing:-0.5px;">Sign in, {name}.</h1>'
        f'<p style="margin:0 0 28px;font-size:16px;color:#666;line-height:1.6;">'
        f'This link signs you in to your waitlist status page. It works once and expires in 15 minutes.</p>'
        f'<a href="{url}" style="display:inline-block;padding:16px 32px;background:{BRAND};color:#fff;'
        f'text-decoration:none;border-radius:100px;font-size:16px;font-weight:600;">Sign in →</a>'
        f'<p style="margin:28px 0 0;font-size:13px;color:#aaa;line-height:1.6;">'
        f"If you didn't ask for this, you can ignore it — nothing has changed.</p>"
    )

    text = (
        f"Hi {name},\n\n"
        f"Sign in to your CELLO waitlist status page:\n{url}\n\n"
        f"This link works once and expires in 15 minutes.\n"
        f"If you didn't ask for it, ignore this email — nothing has changed.\n\n"
        f"— The CELLO team\n{SITE}"
    )

    return "Your CELLO sign-in link", _shell(content), text


def e_inv_admission(job):
    """E-inv — you're in. Sent within 60s of wave assembly.

    Wave 1 is categorically different (M11-D10): 10-20 hand-picked design
    partners, mandatory 30-minute onboarding call, so the mail carries a calendar
    link. Wave 2+ is self-serve and carries a quickstart link instead. The wave
    number selects the variant — it is not a copy tweak, it is a different
    onboarding contract.

    Under 200 words, and the token is the payload. Everything else is scaffolding
    around it.
    """
    name = _greeting(job)
    token = job.get("waitlist_token")
    wave = job.get("wave_number")

    if not token:
        # The whole message is the grant. Sending it without one hands someone
        # an admission they cannot claim, and they have no way to tell whether
        # the fault is theirs.
        raise ValueError(
            f"e_inv_admission for user {job.get('user_id')} has no waitlist token; "
            "refusing to send an invitation nobody can redeem."
        )

    is_wave_one = wave == 1
    next_step = (
        (
            '<a href="https://cello.mygentic.ai/onboarding-call" '
            f'style="display:inline-block;padding:16px 32px;background:{BRAND};color:#fff;'
            'text-decoration:none;border-radius:100px;font-size:16px;font-weight:600;">'
            "Book your setup call →</a>"
        )
        if is_wave_one
        else (
            '<a href="https://cello.mygentic.ai/quickstart" '
            f'style="display:inline-block;padding:16px 32px;background:{BRAND};color:#fff;'
            'text-decoration:none;border-radius:100px;font-size:16px;font-weight:600;">'
            "Read the quickstart →</a>"
        )
    )

    intro = (
        "You're in. Wave 1 is a small group and we set everyone up personally — "
        "book a 30 minute call and we'll get your first connection working together."
        if is_wave_one
        else "You're in. The quickstart takes about ten minutes end to end."
    )

    content = (
        f'<h1 style="margin:0 0 8px;font-size:28px;font-weight:700;color:#111;letter-spacing:-0.5px;">'
        f"You're in, {name}.</h1>"
        f'<p style="margin:0 0 24px;font-size:16px;color:#666;line-height:1.6;">{intro}</p>'
        f'<p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#111;">Your access token</p>'
        f'<p style="margin:0 0 4px;padding:14px 18px;background:#f7f7f7;border-radius:10px;'
        f'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;color:#111;'
        f'word-break:break-all;">{esc(token)}</p>'
        f'<p style="margin:0 0 24px;font-size:13px;color:#999;">'
        "Single use, and it expires in 14 days. Unclaimed access returns to the pool.</p>"
        # The install command. Required by DOD-E-INV-1 and by the requirements
        # doc ("install command + 14-day claim window. Nothing else") and it was
        # missing — an admission email that does not say how to install is a
        # token with no instructions attached.
        f'<p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#111;">Install</p>'
        f'<p style="margin:0 0 28px;padding:14px 18px;background:#111;border-radius:10px;'
        f'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;color:#f7f7f7;'
        f'word-break:break-all;">{esc(INSTALL_COMMAND)}</p>'
        f"{next_step}"
    )

    text = (
        f"Hi {name},\n\n{intro}\n\n"
        f"Your access token (single use, expires in 14 days):\n{token}\n\n"
        f"Install:\n{INSTALL_COMMAND}\n\n"
        + (
            f"Book your setup call: {SITE}/onboarding-call\n\n"
            if is_wave_one
            else f"Quickstart: {SITE}/quickstart\n\n"
        )
        + f"— The CELLO team\n{SITE}"
    )

    return "You're in — your CELLO access token", _shell(content), text


def e_win_invites(job):
    """E-win — first sealed session. Carries the 3 premium invites.

    Under 300 words. The invites are the point: this is the moment someone has
    proof the thing works, which is the only moment a recommendation from them
    means anything.
    """
    name = _greeting(job)
    codes = job.get("invite_codes") or []

    if not codes:
        raise ValueError(
            f"e_win_invites for user {job.get('user_id')} has no invite codes; "
            "the mail exists to deliver them."
        )

    code_rows = "".join(
        f'<p style="margin:0 0 8px;padding:12px 16px;background:#f7f7f7;border-radius:10px;'
        f'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;color:#111;">'
        f"{SITE}/invite/{esc(code)}</p>"
        for code in codes
    )

    content = (
        f'<h1 style="margin:0 0 8px;font-size:28px;font-weight:700;color:#111;letter-spacing:-0.5px;">'
        f"That was your first sealed session, {name}.</h1>"
        f'<p style="margin:0 0 24px;font-size:16px;color:#666;line-height:1.6;">'
        "Two agents just proved who they were to each other and left a receipt neither of them "
        "can alter. That is the whole idea, and you now have it working.</p>"
        f'<p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#111;">'
        f"{len(codes)} invites to give away</p>"
        f'<p style="margin:0 0 12px;font-size:14px;color:#666;line-height:1.6;">'
        "These skip the queue entirely. Whoever uses one gets in on their next signup — and when they "
        "reach their own first session, the two of you are connected automatically.</p>"
        f"{code_rows}"
        f'<p style="margin:24px 0 8px;font-size:14px;font-weight:600;color:#111;">'
        "Show someone what it looks like</p>"
        f'<p style="margin:0 0 20px;font-size:14px;color:#666;line-height:1.6;">'
        "Your sealed receipt is private by default. If this one is worth showing, you can publish it "
        f'from the portal — it gets a permanent page at <a href="{GALLERY}" '
        f'style="color:{BRAND};text-decoration:none;">{GALLERY.replace("https://", "")}</a> that '
        "anyone can verify without an account.</p>"
        f'<p style="margin:0;font-size:14px;color:#666;line-height:1.6;">'
        "And if it is worth two minutes: what did you build it for? Replies come straight to us.</p>"
    )

    text = (
        f"Hi {name},\n\n"
        "That was your first sealed session — two agents proved who they were to each other and left a "
        "receipt neither can alter.\n\n"
        f"{len(codes)} invites to give away. These skip the queue:\n"
        + "\n".join(f"{SITE}/invite/{c}" for c in codes)
        + "\n\nWhen someone you invite reaches their own first session, the two of you are connected "
        "automatically.\n\n"
        "Your sealed receipt is private by default. If this one is worth showing, publish it from the "
        f"portal and it gets a permanent, verifiable page at {GALLERY}\n\n"
        "And if it is worth two minutes: what did you build it for?\n\n"
        f"— The CELLO team\n{SITE}"
    )

    return "Your first CELLO session — and 3 invites", _shell(content), text


def e_re_engage(job):
    """E-re — 60 days waiting, no activity. Honest, and easy to leave.

    The unsubscribe is deliberately prominent rather than buried in the footer.
    Someone who has waited two months without moving has earned a clean exit,
    and a re-engagement mail that hides the door is the reason people mark mail
    as spam instead of unsubscribing — which costs the sending reputation of
    every other message.
    """
    name = _greeting(job)
    position = _position_line(job)
    unsubscribe = f"{API}/unsubscribe?u={job.get('user_id')}"

    content = (
        f'<h1 style="margin:0 0 8px;font-size:28px;font-weight:700;color:#111;letter-spacing:-0.5px;">'
        f"Still building, {name}.</h1>"
        f'<p style="margin:0 0 20px;font-size:16px;color:#666;line-height:1.6;">'
        "You joined the CELLO waitlist a couple of months ago and we have not opened a wave to you yet. "
        "That is on us, not on you.</p>"
        + (
            f'<p style="margin:0 0 20px;font-size:15px;color:#111;">{position}</p>'
            if position
            else ""
        )
        + f'<p style="margin:0 0 24px;font-size:14px;color:#666;line-height:1.6;">'
        "If it is no longer interesting, no hard feelings — one click below and we will stop.</p>"
        f'<a href="{unsubscribe}" style="display:inline-block;padding:14px 28px;border:1px solid #ddd;'
        'color:#666;text-decoration:none;border-radius:100px;font-size:14px;">Unsubscribe →</a>'
    )

    text = (
        f"Hi {name},\n\n"
        "You joined the CELLO waitlist a couple of months ago and we have not opened a wave to you yet. "
        "That is on us.\n\n"
        + (f"{position}\n\n" if position else "")
        + f"No longer interesting? One click and we stop:\n{unsubscribe}\n\n"
        f"— The CELLO team\n{SITE}"
    )

    return "Still on the CELLO waitlist?", _shell(content), text


def _ctx(job, key, default=None):
    """Operator-supplied context, read from its own namespace.

    Never merged into the job dict: a payload key that collides with a column
    name silently overrides the row the dispatcher already authorised.
    """
    return (job.get("ctx") or {}).get(key, default)


def e_alert(job):
    """E-alert — new content. Opt-in only (DOD-INV-EMAIL-SEGMENTS).

    Under 100 words. One sentence and a link, because this list explicitly
    accepted up to twice a day and the only way that stays tolerable is if each
    one is genuinely small.
    """
    title = _ctx(job, "alert_title") or "Something new"
    url = _ctx(job, "alert_url")
    summary = _ctx(job, "alert_summary") or ""

    if not url:
        raise ValueError(
            "e_alert has no alert_url; a content alert with no link is an "
            "interruption with nothing behind it."
        )

    unsubscribe = f"{API}/unsubscribe?u={job.get('user_id')}&list=content_alerts"

    content = (
        f'<h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111;">{esc(title)}</h1>'
        f'<p style="margin:0 0 20px;font-size:16px;color:#666;line-height:1.6;">{esc(summary)}</p>'
        f'<a href="{esc(url)}" style="display:inline-block;padding:14px 28px;background:{BRAND};'
        'color:#fff;text-decoration:none;border-radius:100px;font-size:15px;font-weight:600;">Read it →</a>'
        f'<p style="margin:24px 0 0;font-size:12px;color:#aaa;">'
        f'<a href="{unsubscribe}" style="color:#aaa;">Stop these alerts</a> '
        "— this does not affect your waitlist emails.</p>"
    )

    text = (
        f"{title}\n\n{summary}\n\n{url}\n\n"
        f"Stop these alerts (waitlist emails are unaffected): {unsubscribe}\n"
    )

    return title, _shell(content), text


def e_feedback_invite(job):
    """The §5c outreach mail. Under 150 words, and it asks for one thing.

    Sent the same day eligibility is detected, because someone who has just got
    value out of something is the one moment they will talk about it in detail.
    A month later they remember that it worked and nothing about why.
    """
    name = _greeting(job)
    calendar = f"{SITE}/feedback-call"

    content = (
        f'<h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:#111;letter-spacing:-0.5px;">'
        f"You've been using it properly, {name}.</h1>"
        f'<p style="margin:0 0 20px;font-size:16px;color:#666;line-height:1.6;">'
        "Which makes you one of a small number of people who can tell us something we cannot work out "
        "from the logs: what you were actually trying to do.</p>"
        f'<p style="margin:0 0 24px;font-size:16px;color:#666;line-height:1.6;">'
        "Twenty minutes, whenever suits. No script.</p>"
        f'<a href="{calendar}" style="display:inline-block;padding:16px 32px;background:{BRAND};'
        'color:#fff;text-decoration:none;border-radius:100px;font-size:16px;font-weight:600;">'
        "Pick a time →</a>"
        f'<p style="margin:24px 0 0;font-size:13px;color:#999;line-height:1.6;">'
        "Not interested? Ignoring this is a complete answer — nothing changes either way.</p>"
    )

    text = (
        f"Hi {name},\n\n"
        "You've been using CELLO properly, which makes you one of a small number of people who can tell "
        "us something we cannot work out from the logs: what you were actually trying to do.\n\n"
        f"Twenty minutes, whenever suits. No script.\n{calendar}\n\n"
        "Not interested? Ignoring this is a complete answer.\n\n"
        f"— The CELLO team\n{SITE}"
    )

    return "Twenty minutes?", _shell(content), text


# Only implemented templates belong here. A missing entry is a loud failure in
# the dispatcher, which is the correct outcome for a job referencing a template
# nobody has written yet.
TEMPLATES = {
    "e1_confirm": e1_confirm,
    "e_magic_link": e_magic_link,
    "e_inv_admission": e_inv_admission,
    "e_win_invites": e_win_invites,
    "e_re_engage": e_re_engage,
    "e_alert": e_alert,
    "e_feedback_invite": e_feedback_invite,
}
