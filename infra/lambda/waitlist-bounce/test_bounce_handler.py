"""
Tests for the SES bounce/complaint handler (DOD-SES-PROD-1).

The transient-vs-permanent distinction is the one worth guarding: suppressing on
a transient bounce silently and irreversibly removes a real user, and the user
has no way to notice it happened.
"""

import json
import uuid
from pathlib import Path

import psycopg2
import pytest

from waitlist_testdb import PGURL, query, load_lambda


@pytest.fixture()
def bouncer(database):
    return load_lambda(Path(__file__).parent, "bounce_handler")


def make_user(email, email_status="active"):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_users (email, anon_id, email_status) VALUES (%s, %s, %s)",
            (email, str(uuid.uuid4()), email_status),
        )
    conn.close()


def sns(notification):
    return {"Records": [{"Sns": {"Message": json.dumps(notification)}}]}


def bounce(email, bounce_type="Permanent"):
    return sns(
        {
            "notificationType": "Bounce",
            "bounce": {
                "bounceType": bounce_type,
                "bouncedRecipients": [{"emailAddress": email}],
            },
        }
    )


def complaint(email):
    return sns(
        {
            "notificationType": "Complaint",
            "complaint": {"complainedRecipients": [{"emailAddress": email}]},
        }
    )


def status_of(email):
    return query("SELECT email_status FROM waitlist_users WHERE email = %s", (email,))[0][0]


def test_a_permanent_bounce_suppresses(bouncer):
    make_user("dead@example.test")
    counts = bouncer.lambda_handler(bounce("dead@example.test"), None)

    assert status_of("dead@example.test") == "bounced"
    assert counts["suppressed"] == 1


@pytest.mark.parametrize("bounce_type", ["Transient", "Undetermined"])
def test_a_transient_bounce_does_not_suppress(bouncer, bounce_type):
    """A full mailbox is not a dead address. Suppressing here removes a real
    user permanently, and they have no way to find out."""
    make_user("full@example.test")

    counts = bouncer.lambda_handler(bounce("full@example.test", bounce_type), None)

    assert status_of("full@example.test") == "active", (
        f"a {bounce_type} bounce must not suppress"
    )
    assert counts["suppressed"] == 0


def test_a_complaint_suppresses(bouncer):
    make_user("angry@example.test")
    bouncer.lambda_handler(complaint("angry@example.test"), None)

    assert status_of("angry@example.test") == "complained"


def test_a_delivery_notification_changes_nothing(bouncer):
    make_user("fine@example.test")
    counts = bouncer.lambda_handler(
        sns({"notificationType": "Delivery", "delivery": {}}), None
    )

    assert status_of("fine@example.test") == "active"
    assert counts == {"suppressed": 0, "ignored": 0, "unrecognised": 0}


def test_an_unrecognised_notification_type_suppresses_nobody(bouncer):
    """If SES changes its payload shape, the safe failure is to do nothing and
    shout — not to start suppressing live users."""
    make_user("safe@example.test")

    counts = bouncer.lambda_handler(
        sns({"notificationType": "SomethingNew", "bounce": {"bounceType": "Permanent"}}), None
    )

    assert status_of("safe@example.test") == "active"
    assert counts["unrecognised"] == 1


def test_suppression_is_one_way(bouncer):
    """Nothing here may walk a suppressed address back to active. Un-suppressing
    is a deliberate operator action, not a side effect of a later event."""
    make_user("complained@example.test", email_status="complained")

    bouncer.lambda_handler(bounce("complained@example.test"), None)

    assert status_of("complained@example.test") == "complained", (
        "a later bounce must not downgrade a complaint, nor reactivate anything"
    )


def test_an_unknown_address_is_not_an_error(bouncer):
    counts = bouncer.lambda_handler(bounce("nobody@example.test"), None)

    assert counts["unrecognised"] == 0
    assert counts["suppressed"] == 0


def test_email_matching_is_case_insensitive(bouncer):
    """SES echoes back whatever the remote server used, which need not match the
    case we stored."""
    make_user("mixed@example.test")

    bouncer.lambda_handler(bounce("MiXeD@Example.TEST"), None)

    assert status_of("mixed@example.test") == "bounced"


def test_every_recipient_in_one_notification_is_processed(bouncer):
    make_user("one@example.test")
    make_user("two@example.test")

    bouncer.lambda_handler(
        sns(
            {
                "notificationType": "Bounce",
                "bounce": {
                    "bounceType": "Permanent",
                    "bouncedRecipients": [
                        {"emailAddress": "one@example.test"},
                        {"emailAddress": "two@example.test"},
                    ],
                },
            }
        ),
        None,
    )

    assert status_of("one@example.test") == "bounced"
    assert status_of("two@example.test") == "bounced"


def test_an_unparseable_sns_message_does_not_sink_the_batch(bouncer):
    make_user("good@example.test")
    event = {
        "Records": [
            {"Sns": {"Message": "{not json"}},
            {
                "Sns": {
                    "Message": json.dumps(
                        {
                            "notificationType": "Bounce",
                            "bounce": {
                                "bounceType": "Permanent",
                                "bouncedRecipients": [{"emailAddress": "good@example.test"}],
                            },
                        }
                    )
                }
            },
        ]
    }

    counts = bouncer.lambda_handler(event, None)

    assert counts["unrecognised"] == 1
    assert status_of("good@example.test") == "bounced"


def test_a_suppressed_user_then_receives_no_email(bouncer, database):
    """The end-to-end point of this Lambda: it is the producer for the
    dispatcher's suppression check, which until now had none."""
    make_user("loop@example.test")
    bouncer.lambda_handler(bounce("loop@example.test"), None)

    mailer = load_lambda(Path(__file__).resolve().parents[1] / "waitlist-email", "email_handler_2")
    sent = []
    mailer.ses = lambda: type("S", (), {"send_email": lambda _s, **kw: sent.append(kw)})()

    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO email_jobs (user_id, template, scheduled_at) "
            "SELECT waitlist_id, 'e1_confirm', now() FROM waitlist_users WHERE email='loop@example.test'"
        )
    conn.close()

    counts = mailer.lambda_handler({}, None)

    assert sent == [], "a bounced address must receive nothing"
    assert counts["skipped"] == 1
