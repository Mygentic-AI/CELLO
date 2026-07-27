"""Shared SQLSTATE → response mapping for the M11 Lambdas.

Collapsing every psycopg2.Error into "the database could not be reached" is
error substitution: it names the exit point, points the operator at RDS and the
VPC, and returns a RETRYABLE 503 for faults that will never self-heal. A missing
migration and a dead connection call for completely different reactions.

Postgres SQLSTATE classes: 08 = connection, 42 = syntax/undefined object,
23 = integrity constraint, 40 = transaction rollback (serialization/deadlock).
"""


def classify(err):
    """Returns (status, code, message) for a psycopg2 error."""
    sqlstate = getattr(err, "pgcode", None) or ""
    cls = sqlstate[:2]

    if not sqlstate:
        # A failure the SERVER never got to answer has no SQLSTATE — the
        # connection dropped, the handshake failed, a timeout fired. These are
        # the most common transient database faults there are, and falling
        # through to the generic branch called them permanent, so the caller was
        # told not to retry exactly when retrying was the right move.
        #
        # psycopg2.OperationalError is the connection/operational category, so
        # the type carries the information the SQLSTATE does not.
        import psycopg2

        if isinstance(err, (psycopg2.OperationalError, psycopg2.InterfaceError)):
            # A REJECTED CREDENTIAL LOOKS EXACTLY LIKE AN UNREACHABLE SERVER
            # from here, and it is neither. libpq fails the connection before a
            # session exists, so there is no SQLSTATE to switch on — which is
            # why the class-28 branch below cannot catch it, and why a first
            # attempt at this was unreachable code under a comment claiming it
            # handled the case.
            #
            # This is the shape of the 2026-07-26 outage: RDS rotated
            # `portal_admin` while every waitlist function still held the 19
            # July password. Calling that "we could not reach the database"
            # sends an operator to the VPC, the security groups and the subnet
            # routing, none of which are broken.
            detail = str(err).lower()
            if "database" in detail and "does not exist" in detail:
                # PORTAL_DB_NAME is wrong, or the portal database has not been
                # created in this region yet. Nothing to do with credentials, and
                # the two want opposite reactions: create the database, versus
                # rotate or re-read a secret.
                return (
                    503,
                    "database_not_found",
                    "The waitlist database this function is pointed at does not exist. This is a "
                    "configuration problem on our side.",
                )
            if "too many clients" in detail:
                # 53300 by nature, but there is no SQLSTATE at connect time, so
                # the cls == "53" branch below can never see it — and this is the
                # single likeliest transient this stack has: a Lambda fanning out
                # against an RDS connection cap. Reported as "unreachable" it
                # sends the operator to the VPC; reported as capacity it says
                # back off, which is the actual fix.
                return (
                    503,
                    "database_overloaded",
                    "The waitlist is briefly over capacity on our side. Give it a minute — we are alerted either way.",
                )
            if "password authentication failed" in detail or "no password supplied" in detail:
                # A missing ROLE lands here too, not on a "does not exist"
                # message: scram refuses an unknown role with the same
                # "password authentication failed" text, deliberately, so the
                # server does not confirm which usernames are real.
                return (
                    503,
                    "database_credential_rejected",
                    "We could not sign in to the waitlist database. This is a credential on our side, not anything you did.",
                )
            return (
                503,
                "database_unreachable",
                "We could not reach the waitlist just now. This is on our side — nothing you do differently will help, and we are alerted.",
            )

    if cls == "08":
        return (
            503,
            "database_unreachable",
            "We could not reach the waitlist just now. This is on our side — nothing you do differently will help, and we are alerted.",
        )

    if sqlstate == "42501":
        # insufficient_privilege. Class 42 as a whole reads as "the code is ahead
        # of the schema", but this one is a missing GRANT — a live risk every
        # time a migration adds objects the Lambda role was never granted. An
        # operator told to run a migration will re-run Flyway, see it clean, and
        # be stuck.
        return (
            500,
            "database_permission_denied",
            "This function is not permitted to perform that operation on the waitlist database.",
        )

    if sqlstate in ("42P01", "42703", "42P02"):
        # Undefined table / column / parameter: the code IS ahead of the schema.
        # Retrying cannot fix it, and an operator sent to the network will not
        # find it.
        return (
            500,
            "schema_out_of_date",
            "This function requires a database migration that has not been applied.",
        )

    if cls == "42":
        # The rest of class 42 — syntax errors, undefined functions, wrong
        # argument types. A code defect, not a deployment state. Naming it as a
        # migration problem would send the operator somewhere clean.
        return (
            500,
            "database_query_rejected",
            "The waitlist database rejected the query as malformed.",
        )

    if cls == "23":
        return (
            409,
            "constraint_violation",
            "That conflicts with data already stored.",
        )

    if cls == "53":
        # Insufficient resources — 53300 too_many_connections above all. A Lambda
        # scaling out against an RDS connection cap is the single most likely
        # transient failure this stack has, and calling it permanent tells the
        # caller not to back off at exactly the moment backing off is the fix.
        return (
            503,
            "database_overloaded",
            "The waitlist is briefly over capacity on our side. Give it a minute — we are alerted either way.",
        )

    if cls == "57":
        # Operator intervention — 57P03 cannot_connect_now, i.e. the database is
        # still starting. Transient by definition; it resolves without anybody
        # doing anything.
        return (
            503,
            "database_starting",
            "The waitlist is still starting up on our side. Give it a minute — we are alerted either way.",
        )

    if cls == "28":
        # Invalid authorization WITH a SQLSTATE, which means a session already
        # existed — a role altered or revoked under a live connection. The
        # commoner case by far, a rotated password at connect time, carries no
        # SQLSTATE at all and is caught above.
        return (
            503,
            "database_credential_rejected",
            "We could not sign in to the waitlist database. This is a credential on our "
            "side, not anything you did.",
        )

    if cls == "40":
        # Serialization failure or deadlock — genuinely retryable, unlike 42.
        return (
            503,
            "transaction_conflict",
            "That request collided with another one of yours. Send it once more and it will go through.",
        )

    return (500, "database_error", "The waitlist database rejected the request.")
