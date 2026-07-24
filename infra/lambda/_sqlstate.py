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

    if cls == "08":
        return (
            503,
            "database_unreachable",
            "The waitlist database could not be reached. Please try again.",
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

    if cls == "40":
        # Serialization failure or deadlock — genuinely retryable, unlike 42.
        return (
            503,
            "transaction_conflict",
            "That request collided with another. Please try again.",
        )

    return (500, "database_error", "The waitlist database rejected the request.")
