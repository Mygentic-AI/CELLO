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

    if cls == "40":
        # Serialization failure or deadlock — genuinely retryable, unlike 42.
        return (
            503,
            "transaction_conflict",
            "That request collided with another one of yours. Send it once more and it will go through.",
        )

    return (500, "database_error", "The waitlist database rejected the request.")
