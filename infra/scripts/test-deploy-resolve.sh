#!/usr/bin/env bash
# Extracts resolve() from deploy.sh and proves the FAILED path is reachable.
# This exists because the first version appended to waitlist_failed inside a
# command substitution, so the array was always empty and the branch that
# reports lookup failures was dead code that no test could have noticed.
set -uo pipefail
DEPLOY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/deploy.sh"

eval "$(awk '/^  resolve\(\) \{/,/^  \}/' "$DEPLOY" | sed 's/^  //')"

fail=0
waitlist_failed=()

# 1. A FAILING lookup must be recorded in the PARENT shell.
resolve OUT "portal db endpoint" false
[[ ${#waitlist_failed[@]} -eq 1 ]] || { echo "FAIL: failure not recorded (${#waitlist_failed[@]})"; fail=1; }
[[ "${OUT}" == "" ]] || { echo "FAIL: expected empty value, got '${OUT}'"; fail=1; }
[[ "${waitlist_failed[0]}" == *"the lookup itself failed"* ]] || { echo "FAIL: message does not name the cause"; fail=1; }

# 2. A SUCCEEDING lookup assigns and records nothing.
waitlist_failed=()
resolve OUT2 "portal db port" echo "5432"
[[ "${OUT2}" == "5432" ]] || { echo "FAIL: value not assigned, got '${OUT2}'"; fail=1; }
[[ ${#waitlist_failed[@]} -eq 0 ]] || { echo "FAIL: success recorded a failure"; fail=1; }

# 3. AWS's "None" for an absent export is ABSENT, not a value — and must not be
#    recorded as a lookup failure, because it is not one.
waitlist_failed=()
resolve OUT3 "portal db secret arn" echo "None"
[[ "${OUT3}" == "" ]] || { echo "FAIL: 'None' not normalised, got '${OUT3}'"; fail=1; }
[[ ${#waitlist_failed[@]} -eq 0 ]] || { echo "FAIL: absent must not read as a lookup failure"; fail=1; }

# 4. stderr from the failing command is captured, not discarded — the whole
#    point is to tell AccessDenied apart from a missing resource.
waitlist_failed=()
resolve OUT4 "acm" bash -c 'echo "AccessDeniedException: not authorized" >&2; exit 254'
[[ "${waitlist_failed[0]}" == *"AccessDenied"* ]] || { echo "FAIL: stderr lost — '${waitlist_failed[0]}'"; fail=1; }

[[ $fail -eq 0 ]] && echo "resolve(): all 4 checks pass" || exit 1
