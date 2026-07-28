"""
Tests for the email templates (DOD-E-INV-1, DOD-E-WIN-1, DOD-E-RE-1, DOD-E-ALERT-1).

Every template that carries a credential REFUSES to render without it. That is
the property worth testing: a mail that arrives without its token or its invites
is worse than one that never arrives, because the recipient cannot tell whether
the fault is theirs and will wait rather than ask.
"""

import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import templates  # noqa: E402


def job(**kwargs):
    return {"user_id": str(uuid.uuid4()), "display_name": "Sam", **kwargs}


# ── DOD-E-INV-1 ───────────────────────────────────────────────────────────────


def test_e_inv_refuses_to_render_without_a_token(database=None):
    """The whole message IS the grant. Sending it without one hands someone an
    admission they cannot claim."""
    with pytest.raises(ValueError, match="no waitlist token"):
        templates.e_inv_admission(job(wave_number=1))


def test_wave_one_gets_a_call_and_later_waves_get_a_quickstart():
    """M11-D10: wave 1 is a different onboarding CONTRACT, not different copy.
    Rendering the wrong variant either drops a mandatory call or invents one."""
    _, _, wave1 = templates.e_inv_admission(job(wave_number=1, waitlist_token="TOK1"))
    _, _, wave2 = templates.e_inv_admission(job(wave_number=2, waitlist_token="TOK2"))

    assert "onboarding-call" in wave1 and "quickstart" not in wave1
    assert "quickstart" in wave2 and "onboarding-call" not in wave2


def test_e_inv_carries_the_token_and_its_expiry(database=None):
    _, html, text = templates.e_inv_admission(job(wave_number=2, waitlist_token="GRANT-123"))

    assert "GRANT-123" in text and "GRANT-123" in html
    assert "14 days" in text or "14 days" in html


def test_e_inv_stays_under_two_hundred_words():
    _, _, text = templates.e_inv_admission(job(wave_number=1, waitlist_token="T"))
    assert len(text.split()) < 200, f"DOD-E-INV-1 caps this at 200 words, got {len(text.split())}"


# ── DOD-E-WIN-1 ───────────────────────────────────────────────────────────────


def test_e_win_refuses_to_render_without_invites():
    with pytest.raises(ValueError, match="no invite codes"):
        templates.e_win_invites(job(invite_codes=[]))


def test_e_win_carries_every_invite_as_a_usable_link():
    _, html, text = templates.e_win_invites(job(invite_codes=["AAA", "BBB", "CCC"]))

    for code in ("AAA", "BBB", "CCC"):
        assert f"/invite/{code}" in text, "an invite the recipient must retype is not an invite"
        assert f"/invite/{code}" in html


def test_e_win_stays_under_three_hundred_words():
    _, _, text = templates.e_win_invites(job(invite_codes=["A", "B", "C"]))
    assert len(text.split()) < 300, f"DOD-E-WIN-1 caps this at 300 words, got {len(text.split())}"


# ── DOD-E-RE-1 ────────────────────────────────────────────────────────────────


def test_e_re_puts_the_unsubscribe_in_the_body_not_the_footer():
    """Someone who has waited two months without moving has earned a clean exit.
    A re-engagement mail that hides the door is why people mark mail as spam
    instead of unsubscribing — which costs the reputation of every other send."""
    _, html, text = templates.e_re_engage(job())

    assert "unsubscribe" in text.lower()
    assert "Unsubscribe →" in html


def test_e_re_shows_a_real_position_or_none_at_all():
    with_pos = templates.e_re_engage(job(queue_position=42, queue_size=100))[2]
    without = templates.e_re_engage(job())[2]

    assert "#42" in with_pos
    assert "#" not in without, "no position is better than a fabricated one"


# ── DOD-E-ALERT-1 ─────────────────────────────────────────────────────────────


def test_e_alert_refuses_to_render_without_a_link():
    """A content alert with no link is an interruption with nothing behind it."""
    with pytest.raises(ValueError, match="no alert_url"):
        templates.e_alert(job(ctx={"alert_title": "Something"}))


def test_e_alert_stays_under_a_hundred_words():
    _, _, text = templates.e_alert(
        job(ctx={"alert_title": "A new post", "alert_url": "https://cello.mygentic.ai/blog/x",
                 "alert_summary": "Why agent identity needs a fixed address."})
    )
    assert len(text.split()) < 100, f"DOD-E-ALERT-1 caps this at 100 words, got {len(text.split())}"


def test_e_alert_unsubscribe_is_scoped_to_the_alert_list():
    """Unsubscribing from content alerts must not silently drop someone from
    their waitlist mail — DOD-INV-EMAIL-SEGMENTS, from the user's side."""
    _, html, text = templates.e_alert(
        job(ctx={"alert_title": "X", "alert_url": "https://cello.mygentic.ai/blog/x"})
    )

    assert "list=content_alerts" in html
    assert "waitlist emails are unaffected" in text.lower() or "does not affect" in html.lower()


# ── Escaping, across every template that takes user input ─────────────────────


@pytest.mark.parametrize(
    "render",
    [
        # auth_token is supplied for the same reason waitlist_token and
        # invite_codes are below: these templates now REQUIRE the thing their
        # link is made of. They used to fall back to the sign-in page when it was
        # missing, which is how a "Confirm email →" button could quietly point at
        # a form asking the reader to start over.
        lambda: templates.e1_confirm(
            job(display_name='<a/href="https://evil.test">Verify', auth_token="T")
        ),
        lambda: templates.e_magic_link(
            job(display_name='<a/href="https://evil.test">Verify', auth_token="T")
        ),
        lambda: templates.e_inv_admission(
            job(display_name='<a/href="https://evil.test">X', wave_number=2, waitlist_token="T")
        ),
        lambda: templates.e_win_invites(
            job(display_name='<a/href="https://evil.test">X', invite_codes=["A"])
        ),
        lambda: templates.e_re_engage(job(display_name='<a/href="https://evil.test">X')),
    ],
)
def test_no_template_lets_a_display_name_open_a_tag(render):
    """HTML5 accepts `/` as an attribute separator, so `<a/href=...>` needs no
    space — an unclosed anchor swallows the rest of a DKIM-signed message,
    including the real call to action, into a link to an attacker's host."""
    _, html, _ = render()
    assert '<a/href="https://evil.test"' not in html
    assert "evil.test" not in html or "&lt;a/href" in html


@pytest.mark.parametrize("render", [templates.e1_confirm, templates.e_magic_link])
def test_a_link_mail_refuses_to_send_without_its_token(render, database=None):
    """A mail whose entire job is one link must not ship without the link.

    Both templates used to fall back to {SITE}/auth when auth_token was absent,
    so a "Confirm email →" button would land the reader on a form asking them to
    start over — indistinguishable, from their side, from the capture-loop outage
    that cost three days. It failed silently in the worst way: SES accepted it,
    the job was marked sent, and no log line anywhere said the link was dead.

    Raising puts it in the batch's failed count and leaves the job to retry.
    """
    with pytest.raises(RuntimeError) as excinfo:
        render(job(display_name="Someone"))

    # The message has to name the template and the user, because the only place
    # this surfaces is a log line somebody reads later.
    assert "auth_token" in str(excinfo.value)


def test_e_inv_carries_the_install_command(database=None):
    """DOD-E-INV-1 and the requirements doc both name it — "install command +
    14-day claim window. Nothing else." An admission email without it is a token
    with no instructions attached."""
    _, html, text = templates.e_inv_admission(job(wave_number=2, waitlist_token="T"))

    assert "npx" in text and "@cello-protocol/connect" in text
    assert "@cello-protocol/connect" in html


def test_e_win_points_at_the_gallery_and_says_it_is_opt_in(database=None):
    """DOD-E-WIN-1 asks for a "share your first session" prompt with a gallery
    link. DOD-GALLERY-PRIVACY-1 makes publishing opt-in, so the prompt has to say
    so — otherwise it reads as though the receipt is already public."""
    _, html, text = templates.e_win_invites(job(invite_codes=["A", "B", "C"]))

    assert "gallery.cello.mygentic.ai" in text
    assert "gallery.cello.mygentic.ai" in html
    assert "private by default" in text.lower()


def test_e_win_is_still_under_three_hundred_words_with_the_gallery_prompt(database=None):
    _, _, text = templates.e_win_invites(job(invite_codes=["A", "B", "C"]))
    assert len(text.split()) < 300, f"got {len(text.split())}"


def test_e_inv_is_still_under_two_hundred_words_with_the_install_command(database=None):
    _, _, text = templates.e_inv_admission(job(wave_number=1, waitlist_token="T"))
    assert len(text.split()) < 200, f"got {len(text.split())}"


def test_every_send_carries_rfc8058_unsubscribe_headers(database=None):
    """Gmail requires one-click unsubscribe from bulk senders. More immediately:
    it gives the mail client a POST path it uses INSTEAD of following the body
    link, which is what takes the bare GET off the prefetch path."""
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).parent))
    import handler

    headers = handler.unsubscribe_headers(
        {"template": "e1_confirm", "user_id": "abc-123"}
    )
    names = {h["Name"] for h in headers}

    assert names == {"List-Unsubscribe", "List-Unsubscribe-Post"}
    assert any(h["Value"] == "List-Unsubscribe=One-Click" for h in headers)
    assert any("u=abc-123" in h["Value"] for h in headers)


def test_a_content_alert_unsubscribe_header_is_scoped_to_that_list(database=None):
    """Sending the base-list URL on an e_alert would let somebody muting blog
    posts drop off their waitlist mail entirely — and this is the one place a
    user is most likely to click."""
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).parent))
    import handler

    alert = handler.unsubscribe_headers({"template": "e_alert", "user_id": "abc-123"})
    base = handler.unsubscribe_headers({"template": "e1_confirm", "user_id": "abc-123"})

    assert any("list=content_alerts" in h["Value"] for h in alert)
    assert not any("list=content_alerts" in h["Value"] for h in base)
