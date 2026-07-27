"""Mutation sweep over the M11 capture loop.

Four review rounds found blockers, three of them inside the fix for the previous
round, and every one survived because NO TEST FAILED WHEN THE CLAUSE WAS
REMOVED. The comments argued for the behaviour; nothing asserted it.

So this asks the question directly, across the whole loop rather than only the
lines last touched: break one load-bearing clause at a time and see whether the
suite notices. A mutation that SURVIVES marks a clause the tests do not cover —
which is exactly where the last four defects were hiding.

Not a test — a diagnostic, run by hand:

    python3 infra/scripts/mutation-sweep.py

It needs the local Postgres the lambda suites use. Adding a load-bearing clause
to the capture loop? Add a mutation for it here. A SURVIVED line means the
clause is unverified, which is a finding whether or not the clause is correct.

Two things it cannot tell you apart, so read survivors before believing them:
an EQUIVALENT mutant (the change is behaviourally identical, e.g. narrowing a
condition the database already constrains) and a BROKEN mutation (the edit did
not actually change behaviour). Both look like coverage gaps and neither is one.
"""

import pathlib
import shutil
import subprocess
import sys
import tempfile

LAMBDA = pathlib.Path("/Users/andrep/Documents/code/trustless-cello/infra/lambda")

# (file, description, find, replace) — each breaks exactly one stated property.
MUTATIONS = [
    # ── the bug that cost the day ────────────────────────────────────────────
    ("_session.py", "read the cookie from headers, not the payload-2.0 list",
     'for raw in event.get("cookies") or []:', 'for raw in []:'),

    # ── single-use tokens ────────────────────────────────────────────────────
    ("waitlist-auth/handler.py", "verify burns without checking used_at",
     "WHERE token = %s AND used_at IS NULL AND expires_at > now()",
     "WHERE token = %s AND expires_at > now()"),
    ("waitlist-auth/handler.py", "verify accepts an expired token",
     "WHERE token = %s AND used_at IS NULL AND expires_at > now()",
     "WHERE token = %s AND used_at IS NULL"),
    ("waitlist-auth/handler.py", "magic links no longer burn their predecessors",
     "UPDATE auth_tokens SET used_at = now() \"\n                    \"WHERE waitlist_user_id = %s AND kind = 'magic_link' \"\n                    \"AND used_at IS NULL\",",
     "SELECT %s WHERE false\","),

    # ── credentials are not issued without proof of the mailbox ──────────────
    ("waitlist-auth/handler.py", "mint the referral code without checking verification",
     'if row["kind"] in ("email_verify", "magic_link"):',
     "if True:"),
    ("waitlist-signup/handler.py", "signup mints a referral code again",
     "    # NO POINTS HERE.", "    cur.execute(\"SELECT 1\")\n    # NO POINTS HERE."),

    # ── the referrer payout ──────────────────────────────────────────────────
    ("_referral.py", "pay the referrer twice (drop the ledger idempotency)",
     "    if cur.fetchone() is not None:\n        return 0", "    if False:\n        return 0"),
    ("_referral.py", "let the cap violation abort the transaction",
     'cur.execute("SAVEPOINT referral_points")', "pass"),
    ("waitlist-auth/handler.py", "pay the referrer on every sign-in, not just the first",
     "                if just_verified:\n                    award_referrer_for(",
     "                if True:\n                    award_referrer_for("),

    # ── the resend door ──────────────────────────────────────────────────────
    ("_resend.py", "drop the user-row lock",
     "\"SELECT email_verified, email_status FROM waitlist_users \"\n        \"WHERE waitlist_id = %s FOR UPDATE\",",
     "\"SELECT email_verified, email_status FROM waitlist_users \"\n        \"WHERE waitlist_id = %s\","),
    ("_resend.py", "decide from the caller's unlocked read",
     'kind = "signin" if locked["email_verified"] else "confirm"',
     'kind = "signin" if user["email_verified"] else "confirm"'),
    ("_resend.py", "a stranded 'sending' job no longer counts",
     "AND status IN ('pending', 'sending')", "AND status = 'pending'"),
    ("_resend.py", "count a job past MAX_ATTEMPTS as claimable",
     "          AND attempts < %s\n", "          AND attempts >= -1 AND %s IS NOT NULL\n"),
    ("_resend.py", "mail a suppressed address",
     'if locked["email_status"] != "active":', "if False:"),
    ("_resend.py", "record refused requests, so the window extends itself",
     'return "throttled"', 'cur.execute("INSERT INTO auth_link_requests (email_requested) VALUES (%s)", (user["email"],))\n        return "throttled"'),
    ("_resend.py", "spend the rate limit on repeat clicks",
     "    if cur.fetchone() is not None:\n        log(\n            \"waitlist.resend.already_pending\",",
     "    if False:\n        log(\n            \"waitlist.resend.already_pending\","),

    # ── the auth door ────────────────────────────────────────────────────────
    ("waitlist-auth/handler.py", "record refused /auth/request attempts",
     "            throttled = rate_limited(cur, email)\n",
     "            throttled = rate_limited(cur, email)\n            cur.execute(\"INSERT INTO auth_link_requests (email_requested) VALUES (%s)\", (email,))\n"),
    ("waitlist-auth/handler.py", "issue a link to a suppressed address",
     'if user and not throttled and user["email_status"] == "active":',
     "if user:"),
    ("waitlist-auth/handler.py", "drop the enumeration timing floor",
     "    if elapsed_ms < RESPONSE_FLOOR_MS:", "    if False:"),

    # ── sessions ─────────────────────────────────────────────────────────────
    ("_session.py", "accept revoked sessions",
     "AND s.revoked_at IS NULL", "AND (s.revoked_at IS NULL OR true)"),
    ("_session.py", "accept expired sessions",
     "AND s.expires_at > now()", "AND (s.expires_at > now() OR true)"),
    ("waitlist-auth/handler.py", "store the session token in the clear",
     "(user_id, hash_token(raw)),", "(user_id, raw),"),

    # ── the pages a person lands on ──────────────────────────────────────────
    ("waitlist-auth/handler.py", "render dead-link failures as JSON again",
     "        if _is_browser_route(path):\n            return _page(err.status,", "        if False:\n            return _page(err.status,"),
    ("waitlist-auth/handler.py", "stop escaping the page heading",
     "{esc(heading)}</h1>", "{heading}</h1>"),
    ("waitlist-auth/handler.py", "stop escaping the page sentence",
     "{esc(sentence)}</p>", "{sentence}</p>"),
    ("waitlist-auth/handler.py", "welcome every sign-in, not just the first confirmation",
     'f"{SITE}/status?welcome=1" if just_verified else f"{SITE}/status"',
     'f"{SITE}/status?welcome=1"'),

    # ── the confirm credential ───────────────────────────────────────────────
    ("waitlist-email/handler.py", "mint a confirm token without burning predecessors",
     "        \"UPDATE auth_tokens SET used_at = now() \"\n        \"WHERE waitlist_user_id = %s AND kind = 'email_verify' AND used_at IS NULL\",\n        (user_id,),\n    )\n",
     "        \"SELECT %s WHERE false\",\n        (user_id,),\n    )\n"),

    # ── error classification ─────────────────────────────────────────────────
    ("_sqlstate.py", "call a missing database a credential problem",
     'if "database" in detail and "does not exist" in detail:', "if False:"),
    ("_sqlstate.py", "call a connection cap an unreachable server",
     'if "too many clients" in detail:', "if False:"),
]


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True)


def main():
    # MIRROR THE REAL LAYOUT. waitlist_testdb resolves the migrations directory
    # relative to its own file — parents[2].parent / "corp-cello-site" — so a
    # flat copy makes every test skip, and a sweep against a skipped suite
    # reports every mutation as killed. That failure mode is worse than no
    # sweep, so the copy reproduces the tree shape rather than the files alone.
    work = pathlib.Path(tempfile.mkdtemp(prefix="m11-mutate-"))
    root = work / "repo" / "infra" / "lambda"
    root.parent.mkdir(parents=True)
    shutil.copytree(LAMBDA, root, ignore=shutil.ignore_patterns("__pycache__"))
    (work / "corp-cello-site").mkdir()
    (work / "corp-cello-site" / "migrations").symlink_to(
        LAMBDA.parent.parent.parent / "corp-cello-site" / "migrations"
    )

    base = run("PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest . -q --no-header", root)
    # "skipped" in the baseline means the fixtures could not reach Postgres or
    # the migrations. Every mutation would then look killed-or-clean for the
    # same reason, which is a sweep that reports nothing while appearing to run.
    if "passed" not in base.stdout or "skipped" in base.stdout:
        print("baseline is not green; aborting\n", base.stdout[-2000:])
        return 1
    print(f"baseline: {base.stdout.strip().splitlines()[-1]}\n")

    survived, killed = [], 0
    for path, label, find, repl in MUTATIONS:
        target = root / path
        original = target.read_text()
        if find not in original:
            print(f"  \033[33mSKIP\033[0m  {label}\n        (anchor not found in {path} — the code moved)")
            survived.append((label, "ANCHOR MISSING"))
            continue
        target.write_text(original.replace(find, repl, 1))

        result = run(
            "PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 timeout 300 python3 -m pytest . -q --no-header", root
        )
        target.write_text(original)

        if "failed" in result.stdout or "error" in result.stdout.lower():
            killed += 1
            print(f"  \033[32mkilled\033[0m  {label}")
        else:
            survived.append((label, path))
            print(f"  \033[31mSURVIVED\033[0m  {label}  [{path}]")

    print(f"\n{killed}/{len(MUTATIONS)} mutations killed.")
    if survived:
        print("\nUNCOVERED CLAUSES — no test fails when these are removed:")
        for label, where in survived:
            print(f"  · {label}  ({where})")
    shutil.rmtree(work, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
