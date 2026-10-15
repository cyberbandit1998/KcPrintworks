#!/usr/bin/env bash
# Prove, against a RUNNING storefront, that custom quotes follow the container's environment alone.
#
#   scripts/docker-smoke-quotes.sh <base-url> <off|incomplete|on>
#
# The publish workflow starts the same image three times (no settings; QUOTES_ENABLED without the shared secret; everything set) and runs
# this against each, so a change to .env + `docker compose up -d` is known to work without rebuilding. The shop address is deliberately
# unreachable and the secret is a throwaway: only whether the request form is offered is checked. Approving and paying stay off in every
# case here because CHECKOUT_ENABLED is never set (quotes alone must never turn payments on).
set -euo pipefail

base="${1:?base url, e.g. http://127.0.0.1:3000}"
expect="${2:?off, incomplete or on}"
base="${base%/}"

fail() { echo "QUOTES SMOKE FAIL ($expect): $*" >&2; exit 1; }
pass() { echo "ok  $*"; }

for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "$base/api/health/" 2>/dev/null && break
  sleep 1
done
curl -fsS "$base/api/health/" | grep -q '"status":"ok"' || fail "health endpoint did not report ok"

status=$(curl -fsS "$base/api/quotes-status/")
page=$(curl -fsS "$base/custom-orders/")
send=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/api/quotes/" -H 'content-type: multipart/form-data; boundary=x' --data-binary $'--x--\r\n')
approve=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/api/quotes/approve/" -H 'content-type: application/json' -d '{}')

echo "$status" | grep -q '"payments":{"enabled":false' || fail "payments must stay off without CHECKOUT_ENABLED: $status"
[ "$approve" = "403" ] || fail "the approval endpoint answered $approve, expected 403"

case "$expect" in
  off)
    echo "$status" | grep -q '"requests":{"enabled":false' || fail "status says requests are on: $status"
    echo "$page" | grep -q 'The request form is not open yet' || fail "the page does not show the email fallback"
    echo "$page" | grep -q 'Send my request' && fail "the page offers a form"
    [ "$send" = "404" ] || fail "the request endpoint answered $send, expected 404"
    pass "custom quotes are off by default"
    ;;
  incomplete)
    echo "$status" | grep -q '"requests":{"enabled":false' || fail "status says requests are on: $status"
    echo "$status" | grep -q 'KCPW_HANDOFF_SECRET' || fail "status does not name the missing secret: $status"
    echo "$page" | grep -q 'Send my request' && fail "the page offers a form"
    [ "$send" = "404" ] || fail "the request endpoint answered $send, expected 404"
    pass "switched on but incomplete: stays off and names what is missing"
    ;;
  on)
    echo "$status" | grep -q '"requests":{"enabled":true' || fail "status says requests are off: $status"
    echo "$page" | grep -q 'Send my request' || fail "the page does not offer the form"
    # Once on, a body that is not a form is refused for its content (400), not because the feature is off (404).
    [ "$send" != "404" ] || fail "the request endpoint still answers as if quotes were off"
    pass "everything set: the request form is offered, with no rebuild"
    ;;
  *)
    fail "unknown expectation '$expect'"
    ;;
esac
