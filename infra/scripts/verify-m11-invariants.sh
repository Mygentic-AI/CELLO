#!/usr/bin/env bash
# M11 invariant checker.
#
# Five of the Tier-I invariants are properties of the SOURCE, not of a running
# system, so they can be verified now and re-verified on every change. The other
# invariants (token single-use, premium bearer, points caps, no-inflation) are
# runtime behaviours and are covered by the Lambda test suites instead.
#
# Every check here is a DENYLIST over things that must not appear. That is
# deliberate: an allowlist of approved domains or approved packages goes stale
# silently the moment someone adds a legitimate new one, and a check that passes
# because it stopped looking is worse than no check.
#
# Usage: ./infra/scripts/verify-m11-invariants.sh
set -uo pipefail

TRUSTLESS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CORP="${CORP_SITE_DIR:-$(cd "$TRUSTLESS/../corp-cello-site" && pwd)}"

FAILED=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=1; }

# Where M11 code actually lives. Scoped deliberately: the rest of both repos
# predates M11 and is not this milestone's to police.
# Globbed, not listed. An explicit list silently stops covering the moment
# somebody adds a Lambda and forgets to append it — which already happened:
# waitlist-waves and waitlist-gate were both outside the scan, and the gate is
# the function that writes waitlist_agent_links, i.e. exactly the code
# DOD-INV-NO-PII-DIRECTORY most needs looked at. The checker printed 9 PASS
# having never opened either file.
M11_LAMBDA=$(echo "$TRUSTLESS"/infra/lambda/waitlist-*)
M11_LAMBDA="$M11_LAMBDA $TRUSTLESS/infra/lambda/_sqlstate.py $TRUSTLESS/infra/lambda/_session.py"
M11_CORP="$CORP/migrations $CORP/src/lib $CORP/app/waitlist $CORP/app/auth"
M11_CORP="$M11_CORP $CORP/app/status $CORP/app/invite $CORP/app/confirm $CORP/scripts"

# A scanned path that does not exist reads as PASS, because grep finding nothing
# is indistinguishable from grep having nothing to look at. A renamed route
# would silently narrow the checker.
for _p in $M11_LAMBDA $M11_CORP; do
  [[ -e "$_p" ]] || { fail "scan target missing: $_p (the checker would narrow silently)"; }
done

scan() { grep -rInE "$1" $2 2>/dev/null | grep -v '/node_modules/' | grep -v '\.next/'; }

echo "M11 invariants"
echo

# ── DOD-INV-NO-SAAS ───────────────────────────────────────────────────────────
# M11-D1: no paid SaaS. Named vendors rather than a vague pattern, because the
# failure this catches is a specific one — reaching for the obvious hosted tool.
SAAS='resend\.com|sendgrid|mailgun|postmark|posthog|mixpanel|segment\.com|amplitude|'
SAAS+='sentry\.io|datadog|newrelic|launchdarkly|auth0|clerk\.com|supabase|planetscale|'
SAAS+='vercel/analytics|stripe|paddle\.com|customer\.io|klaviyo|convertkit|mailchimp'
if hits=$(scan "$SAAS" "$M11_LAMBDA $M11_CORP"); then
  fail "DOD-INV-NO-SAAS — reference to a billable third-party service:"
  echo "$hits" | sed 's/^/        /'
else
  pass "DOD-INV-NO-SAAS — no billable third-party service referenced"
fi

# ── DOD-INV-DOMAIN ────────────────────────────────────────────────────────────
# M11-D2: every CELLO URL is *.cello.mygentic.ai. Catches invented domains —
# cello.dev, cello.so, getcello.com — which an LLM reaches for constantly.
# Invented CELLO domains, plus raw AWS hostnames. The second is the one that
# actually happened: the E1 confirmation button pointed at
# h8dh7rbhb1.execute-api.us-east-1.amazonaws.com — the most-clicked URL in the
# product, on a domain no user recognises, and the denylist did not look for it.
BAD_DOMAIN='https?://(www\.)?(cello\.(dev|so|ai|io|app|com)|getcello|trycello|cello-protocol\.(com|io))'
BAD_DOMAIN+='|[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com'
if hits=$(scan "$BAD_DOMAIN" "$M11_LAMBDA $M11_CORP"); then
  fail "DOD-INV-DOMAIN — a domain other than cello.mygentic.ai:"
  echo "$hits" | sed 's/^/        /'
else
  pass "DOD-INV-DOMAIN — no invented CELLO domain"
fi

# ── DOD-INV-STABLE-PK ─────────────────────────────────────────────────────────
# Every new table keys on a UUID PK; email is never an identity anchor. Looking
# a user up BY email to retrieve their id is correct and must not be flagged, so
# this looks only for email in a structural position: a FOREIGN KEY, a PRIMARY
# KEY, or a JOIN predicate.
STRUCTURAL_EMAIL='(FOREIGN KEY[^;]*email|PRIMARY KEY[^)]*\bemail\b|JOIN[^;]*\bON\b[^;]*\bemail\b)'
if hits=$(grep -rInE "$STRUCTURAL_EMAIL" "$CORP/migrations" 2>/dev/null); then
  fail "DOD-INV-STABLE-PK — email used as an identity anchor:"
  echo "$hits" | sed 's/^/        /'
else
  pass "DOD-INV-STABLE-PK — no FK, PK or JOIN anchored on email"
fi

# Positive half: every M11 table must actually have a UUID primary key. A
# denylist alone would pass a table with no PK at all.
missing_pk=""
tables_seen=0
for file in "$CORP"/migrations/*.sql; do
  # Anchored at the start of the line and requiring the opening paren, so the
  # phrase "CREATE TABLE IF NOT EXISTS skips the table wholesale" in a comment
  # is not read as a table called "skips".
  while read -r table; do
    [[ -z "$table" ]] && continue
    tables_seen=$((tables_seen + 1))
    # The PK may be a UUID column or a named natural key (referral codes,
    # telegram ids). Flag only tables with no PRIMARY KEY whatsoever.
    if ! awk -v t="$table" '$0 ~ "^CREATE TABLE IF NOT EXISTS " t " *\\(" , /^\);/' "$file" \
         | grep -q 'PRIMARY KEY'; then
      missing_pk="$missing_pk $table"
    fi
  done < <(sed -nE 's/^CREATE TABLE IF NOT EXISTS ([a-z_]+) *\(.*/\1/p' "$file")
done

# A checker that finds nothing must fail, not pass. Vacuous success is the
# failure mode this whole script exists to avoid.
if [[ $tables_seen -eq 0 ]]; then
  fail "DOD-INV-STABLE-PK — found no CREATE TABLE statements to check; the parser is broken"
elif [[ -n "$missing_pk" ]]; then
  fail "DOD-INV-STABLE-PK — table(s) with no PRIMARY KEY:$missing_pk"
else
  pass "DOD-INV-STABLE-PK — all $tables_seen M11 tables declare a primary key"
fi

# ── DOD-INV-NO-DIRECTORY-RELAY ────────────────────────────────────────────────
# M11 touches Lambdas and docs only. A change under packages/directory or
# packages/relay is out of scope and would trigger a 25-30 minute 3-region
# deploy nobody asked for.
cd "$TRUSTLESS" || exit 1
BASE="${M11_BASE_REF:-$(git log --format=%H --grep='M11' --reverse -1 2>/dev/null)}"
if [[ -n "$BASE" ]]; then
  touched=$(git diff --name-only "$BASE"..HEAD -- packages/directory packages/relay 2>/dev/null)
  if [[ -n "$touched" ]]; then
    fail "DOD-INV-NO-DIRECTORY-RELAY — directory/relay code changed during M11:"
    echo "$touched" | sed 's/^/        /'
  else
    pass "DOD-INV-NO-DIRECTORY-RELAY — packages/directory and packages/relay untouched"
  fi
else
  fail "DOD-INV-NO-DIRECTORY-RELAY — could not determine an M11 base commit to diff against"
fi

# ── DOD-INV-SINGLE-DB ─────────────────────────────────────────────────────────
# All M11 database work targets the portal RDS. A connection string or import
# pointing at a directory database is a blocking finding.
DIRECTORY_DB='cello-dev\.[a-z0-9]+\.[a-z0-9-]+\.rds\.amazonaws\.com|CELLO_DIRECTORY_DATABASE|directory_db|cello_directory'
if hits=$(scan "$DIRECTORY_DB" "$M11_LAMBDA $M11_CORP"); then
  fail "DOD-INV-SINGLE-DB — reference to a directory database:"
  echo "$hits" | sed 's/^/        /'
else
  pass "DOD-INV-SINGLE-DB — no M11 code references a directory database"
fi

# Every M11 Lambda must read its connection from DATABASE_URL, so there is one
# place the target is decided rather than a hardcoded host somewhere.
hardcoded=$(scan 'rds\.amazonaws\.com' "$M11_LAMBDA")
if [[ -n "$hardcoded" ]]; then
  fail "DOD-INV-SINGLE-DB — hardcoded RDS endpoint in Lambda code:"
  echo "$hardcoded" | sed 's/^/        /'
else
  pass "DOD-INV-SINGLE-DB — no hardcoded RDS endpoint; all connections via DATABASE_URL"
fi

# THE ONE PLACE THE TARGET IS DECIDED — and until now it was outside this scan.
# The check above proves no Lambda hardcodes a host; it says nothing about which
# host deploy.sh puts in DATABASE_URL. That file assembled the connection string
# from the DIRECTORY exports on its first draft and every check here stayed
# green, which is the whole reason a scanner that cannot see the deciding file is
# worth less than it appears.
#
# POSITIVE assertion, not a denylist: the directory export names are legitimate
# elsewhere in deploy.sh (the directory service uses them), so their absence
# proves nothing. What must be true is that the WAITLIST block reads portal-db-*.
WAITLIST_STEP=$(awk '/STEP 15: cello-waitlist/,/DEPLOYMENT COMPLETE/' "$TRUSTLESS/infra/deploy.sh")
if [[ -z "$WAITLIST_STEP" ]]; then
  fail "DOD-INV-SINGLE-DB — could not find the waitlist step in deploy.sh to check it"
elif ! grep -q 'portal-db-endpoint' <<<"$WAITLIST_STEP"; then
  fail "DOD-INV-SINGLE-DB — deploy.sh's waitlist step does not read cello-\${env}-portal-db-endpoint"
elif grep -qE "cello-\\\$\{ENVIRONMENT\}-rds-(endpoint|port|master-secret-arn)" <<<"$WAITLIST_STEP"; then
  fail "DOD-INV-SINGLE-DB — deploy.sh's waitlist step reads a DIRECTORY rds-* export:"
  grep -nE "cello-\\\$\{ENVIRONMENT\}-rds-" <<<"$WAITLIST_STEP" | sed 's/^/        /'
elif grep -qE '/cello_\$\{ENVIRONMENT\}"?$|postgresql://postgres:' <<<"$WAITLIST_STEP"; then
  fail "DOD-INV-SINGLE-DB — deploy.sh builds the waitlist URL with the DIRECTORY user/database"
else
  pass "DOD-INV-SINGLE-DB — deploy.sh's waitlist step targets the portal DB"
fi

# Same question for the stack itself: which security group does it open?
if grep -q 'cello-\${Environment}-rds-sg' "$TRUSTLESS/infra/cloudformation/cello-waitlist.yaml"; then
  fail "DOD-INV-SINGLE-DB — cello-waitlist.yaml opens the DIRECTORY RDS security group"
elif ! grep -q 'cello-\${Environment}-portal-db-sg' "$TRUSTLESS/infra/cloudformation/cello-waitlist.yaml"; then
  fail "DOD-INV-SINGLE-DB — cello-waitlist.yaml does not open the portal DB security group"
else
  pass "DOD-INV-SINGLE-DB — cello-waitlist.yaml opens the portal DB security group only"
fi

# ── DOD-INV-NO-PII-DIRECTORY ──────────────────────────────────────────────────
# Waitlist PII lives in the waitlist tables only. No M11 code may write an email
# address toward the directory.
if hits=$(scan '(directory|agent_profiles|signal_records)[^\n]*\bemail\b' "$M11_LAMBDA"); then
  fail "DOD-INV-NO-PII-DIRECTORY — email referenced alongside a directory table:"
  echo "$hits" | sed 's/^/        /'
else
  pass "DOD-INV-NO-PII-DIRECTORY — no email written toward the directory"
fi

# ── DOD-INV-NO-INFLATION (static half) ────────────────────────────────────────
# The runtime half is covered by tests. This catches the static half: a literal
# queue position or signup count in UI copy.
FAKE_COUNT='(join(ing)? [0-9,]{3,}|[0-9,]{3,}\+? (people|developers|agents|others) (are |have )?(joined|waiting|on the))'
if hits=$(grep -rInE "$FAKE_COUNT" $M11_CORP "$CORP/app" 2>/dev/null | grep -v '/node_modules/'); then
  fail "DOD-INV-NO-INFLATION — hardcoded social-proof count in copy:"
  echo "$hits" | sed 's/^/        /'
else
  pass "DOD-INV-NO-INFLATION — no hardcoded counts in waitlist copy"
fi

echo
if [[ $FAILED -eq 0 ]]; then
  echo "All statically-checkable M11 invariants hold."
else
  echo "One or more invariants are violated." >&2
fi
exit $FAILED
