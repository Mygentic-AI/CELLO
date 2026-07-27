#!/usr/bin/env bash
#
# Trace one real sign-in link through the deployed API and say which hop drops
# the session.
#
# WHY THIS EXISTS. On 2026-07-27 the capture loop was broken for a full day and
# three fixes shipped against it without moving it, because each one was a
# hypothesis about where the session was lost that was never traced to ground.
# The cause turned out to be one hop: API Gateway payload format 2.0 delivers
# request cookies in a top-level `cookies` list, not in `headers`, so the
# endpoint that CHECKS the session looked in a place the gateway never fills.
#
# Every hop below is printed with its real headers. Nothing is inferred.
#
#   ./infra/scripts/verify-capture-loop.sh <token>
#
# The token is the `?token=` value from a confirm or sign-in email. Get one by
# signing up a real address you can read, or by reading `auth_tokens` directly
# (see the cello-db-query skill; the waitlist tables live in the PORTAL
# database, not the directory one).
#
# Exit status is 0 only if the session survives the redirect.

set -uo pipefail

TOKEN="${1:-}"
API="${WAITLIST_API_BASE:-https://api.cello.mygentic.ai/waitlist}"
SITE="${WAITLIST_SITE:-https://cello.mygentic.ai}"
COOKIE_NAME="cello_wl_session"

if [[ -z "${TOKEN}" ]]; then
  echo "usage: $0 <token-from-a-confirm-or-signin-email>" >&2
  echo "       WAITLIST_API_BASE / WAITLIST_SITE override the endpoints." >&2
  exit 2
fi

pass=0
step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; pass=1; }

step "1. GET ${API}/auth/verify?token=…"
verify_headers="$(curl -sS -D - -o /dev/null \
  "${API}/auth/verify?token=${TOKEN}" 2>&1)" || {
  bad "the request itself failed — the API host did not answer"
  echo "${verify_headers}" | sed 's/^/      /'
  exit 1
}
echo "${verify_headers}" | sed 's/^/      /'

status="$(printf '%s' "${verify_headers}" | awk 'NR==1{print $2}')"
location="$(printf '%s' "${verify_headers}" | tr -d '\r' | awk -F': ' 'tolower($1)=="location"{print $2}')"
set_cookie="$(printf '%s' "${verify_headers}" | tr -d '\r' | awk -F': ' 'tolower($1)=="set-cookie"{print $2}')"

[[ "${status}" == "302" ]] \
  && ok "302 — the token was accepted and burned" \
  || bad "expected 302, got ${status:-nothing}. A 4xx here means the token is spent, expired or unknown — read the page body, it is HTML on purpose."

if [[ -n "${set_cookie}" ]]; then
  ok "Set-Cookie present"
else
  bad "NO Set-Cookie. The session was never handed to the browser — nothing downstream can work."
fi

# The whole 2026-07-27 outage lived in these two attributes plus the hop below.
case "${set_cookie}" in
  *"Domain="*) ok "Domain is set — the cookie can cross to ${SITE}" ;;
  *)           bad "no Domain attribute: the cookie is HOST-ONLY to the API host and will never reach the site" ;;
esac
case "${set_cookie}" in
  *HttpOnly*) ok "HttpOnly" ;;
  *)          bad "not HttpOnly — script on the page can read the session token" ;;
esac
case "${set_cookie}" in
  *"SameSite=Lax"*|*"SameSite=None"*) ok "SameSite set" ;;
  *) bad "no SameSite — browser defaults vary and a Lax default would drop this on the redirect" ;;
esac

[[ "${location}" == "${SITE}/status"* ]] \
  && ok "redirects to ${location}" \
  || bad "redirects to '${location:-nothing}', expected ${SITE}/status"

step "2. GET ${API}/auth/session — the hop that was broken"
# Exactly what the browser sends back: name=value, attributes stripped. They are
# instructions TO the browser, not part of the cookie.
returned="${set_cookie%%;*}"
if [[ -z "${returned}" || "${returned}" != "${COOKIE_NAME}="* ]]; then
  bad "no ${COOKIE_NAME} cookie to send — stopping, the rest cannot be tested"
  exit 1
fi

session_headers="$(curl -sS -D - -o /tmp/cello-session-body.json \
  -H "Cookie: ${returned}" \
  -H "Origin: ${SITE}" \
  "${API}/auth/session")"
echo "${session_headers}" | sed 's/^/      /'

session_status="$(printf '%s' "${session_headers}" | awk 'NR==1{print $2}')"
acao="$(printf '%s' "${session_headers}" | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')"
acac="$(printf '%s' "${session_headers}" | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-credentials"{print $2}')"

if [[ "${session_status}" == "200" ]]; then
  ok "200 — THE SESSION SURVIVED THE REDIRECT"
elif [[ "${session_status}" == "401" ]]; then
  bad "401 no_active_session — this is the death loop. The cookie was set and sent, and the server did not recognise it."
  echo "      Look at how the handler READS the cookie before looking anywhere else:"
  echo "      payload format 2.0 puts it in event['cookies'], never in event['headers']."
else
  bad "expected 200, got ${session_status:-nothing}"
fi

[[ "${acac}" == "true" ]] \
  && ok "Access-Control-Allow-Credentials: true" \
  || bad "Access-Control-Allow-Credentials is '${acac:-absent}' — the browser discards the response even when the server is happy"

[[ "${acao}" == "${SITE}" ]] \
  && ok "Access-Control-Allow-Origin: ${acao}" \
  || bad "Access-Control-Allow-Origin is '${acao:-absent}' — must be the exact origin; a wildcard is ignored when credentials are included"

if [[ "${session_status}" == "200" ]]; then
  step "3. What /status will render"
  python3 - <<'PY' 2>/dev/null || sed 's/^/      /' /tmp/cello-session-body.json
import json
d = json.load(open("/tmp/cello-session-body.json"))
for k in ("email", "email_verified", "status", "queue_position", "queue_size", "referral_code"):
    print(f"      {k:16s} {d.get(k)!r}")
if d.get("queue_position") is None:
    print("      NOTE: no queue position — expected for an admitted user, wrong for a waiting one.")
if not d.get("referral_code"):
    print("      NOTE: no referral code. It is minted at verification; absent means that did not run.")
PY
fi

rm -f /tmp/cello-session-body.json
printf '\n'
[[ "${pass}" -eq 0 ]] \
  && printf '\033[32mThe capture loop works end to end.\033[0m\n' \
  || printf '\033[31mThe loop is broken. The first FAIL above is the hop to investigate — not the last.\033[0m\n'
exit "${pass}"
