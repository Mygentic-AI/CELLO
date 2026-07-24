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
        templates.e_alert(job(alert_title="Something"))


def test_e_alert_stays_under_a_hundred_words():
    _, _, text = templates.e_alert(
        job(alert_title="A new post", alert_url="https://cello.mygentic.ai/blog/x",
            alert_summary="Why agent identity needs a fixed address.")
    )
    assert len(text.split()) < 100, f"DOD-E-ALERT-1 caps this at 100 words, got {len(text.split())}"


def test_e_alert_unsubscribe_is_scoped_to_the_alert_list():
    """Unsubscribing from content alerts must not silently drop someone from
    their waitlist mail — DOD-INV-EMAIL-SEGMENTS, from the user's side."""
    _, html, text = templates.e_alert(
        job(alert_title="X", alert_url="https://cello.mygentic.ai/blog/x")
    )

    assert "list=content_alerts" in html
    assert "waitlist emails are unaffected" in text.lower() or "does not affect" in html.lower()


# ── Escaping, across every template that takes user input ─────────────────────


@pytest.mark.parametrize(
    "render",
    [
        lambda: templates.e1_confirm(job(display_name='<a/href="https://evil.test">Verify')),
        lambda: templates.e_magic_link(job(display_name='<a/href="https://evil.test">Verify')),
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
