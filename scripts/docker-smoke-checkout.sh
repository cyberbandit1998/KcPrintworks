#!/usr/bin/env bash
# Prove, against a RUNNING storefront, that checkout availability follows the container's environment alone.
#
#   scripts/docker-smoke-checkout.sh <base-url> <off|incomplete|on>
#
# The publish workflow starts the same image three times (no settings; CHECKOUT_ENABLED without a secret; everything set) and
# runs this against each, so a change to .env + `docker compose up -d` is known to work without rebuilding. It never needs a
# reachable shop: with "on" the shop address is deliberately unreachable and the check is only that checkout is switched on.
set -euo pipefail

base="${1:?base url, e.g. http://127.0.0.1:3000}"
expect="${2:?off, incomplete or on}"
base="${base%/}"

fail() { echo "CHECKOUT SMOKE FAIL ($expect): $*" >&2; exit 1; }
pass() { echo "ok  $*"; }

for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "$base/api/health/" 2>/dev/null && break
  sleep 1
done
curl -fsS "$base/api/health/" | grep -q '"status":"ok"' || fail "health endpoint did not report ok"

status=$(curl -fsS "$base/api/checkout-status/")
# The cart page is rendered per request; the server tells the cart whether checkout is on as a prop in the page payload.
prop=$(curl -fsS "$base/cart/" | grep -Eo 'checkoutEnabled[\\]*":(true|false)' | head -n1 | grep -Eo '(true|false)$' || true)
handoff=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/api/cart/handoff/" \
  -H 'content-type: application/json' -d '{"lines":[]}')

case "$expect" in
  off)
    echo "$status" | grep -q '"enabled":false' || fail "status says checkout is on: $status"
    [ "$prop" = "false" ] || fail "the cart page was told checkoutEnabled=$prop"
    [ "$handoff" = "403" ] || fail "handoff endpoint answered $handoff, expected 403"
    pass "checkout is off by default"
    ;;
  incomplete)
    echo "$status" | grep -q '"enabled":false' || fail "status says checkout is on: $status"
    echo "$status" | grep -q 'KCPW_HANDOFF_SECRET' || fail "status does not name the missing secret: $status"
    [ "$prop" = "false" ] || fail "the cart page was told checkoutEnabled=$prop"
    [ "$handoff" = "403" ] || fail "handoff endpoint answered $handoff, expected 403"
    pass "switched on but incomplete: stays off and names what is missing"
    ;;
  on)
    echo "$status" | grep -q '"enabled":true' || fail "status says checkout is off: $status"
    [ "$prop" = "true" ] || fail "the cart page was told checkoutEnabled=$prop"
    # The strict body check runs before anything else once checkout is on: an empty cart is a 400, not a 403.
    [ "$handoff" = "400" ] || fail "handoff endpoint answered $handoff, expected 400"
    pass "everything set: checkout is on, with no rebuild"
    ;;
  *)
    fail "unknown expectation '$expect'"
    ;;
esac
