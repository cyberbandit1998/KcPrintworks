#!/usr/bin/env bash
# Smoke-test a running storefront container BEFORE it is published.
#
#   scripts/docker-smoke.sh <base-url> <staging|production> [container-name]
#
# Read-only HTTP checks (plus `id` inside the container). It proves the properties that must never regress:
# the app is up, staging is noindex, prices cannot come from the browser, checkout is disabled, and the
# process is not root.
set -euo pipefail

base="${1:?base url, e.g. http://127.0.0.1:3000}"
mode="${2:?staging or production}"
container="${3:-}"
base="${base%/}"

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
pass() { echo "ok  $*"; }

# Wait for the server (the container may still be starting).
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "$base/api/health/" 2>/dev/null && break
  sleep 1
done
curl -fsS "$base/api/health/" | grep -q '"status":"ok"' || fail "health endpoint did not report ok"
pass "health endpoint"

for path in / /shop/ /cart/ /about/; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$base$path")
  [ "$code" = "200" ] || fail "$path returned $code"
done
pass "pages render (/, /shop/, /cart/, /about/)"

headers=$(curl -sI "$base/")
if [ "$mode" = "staging" ]; then
  echo "$headers" | grep -iq '^x-robots-tag:.*noindex' || fail "staging response is missing X-Robots-Tag: noindex"
  curl -fsS "$base/robots.txt" | tr -d '\r' | grep -q '^Disallow: /$' || fail "staging robots.txt does not disallow everything"
  curl -fsS "$base/" | grep -iq '<meta name="robots" content="noindex' || fail "staging HTML is missing the noindex meta tag"
  pass "staging is noindex (header, robots.txt, meta tag)"
else
  echo "$headers" | grep -iq '^x-robots-tag:.*noindex' && fail "production image sends noindex"
  curl -fsS "$base/robots.txt" | grep -q '^Sitemap:' || fail "production robots.txt has no sitemap"
  pass "production is indexable"
fi

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/api/cart/quote/" \
  -H 'content-type: application/json' \
  -d '{"lines":[{"productId":103,"quantity":1,"options":{},"price":1}]}')
[ "$code" = "400" ] || fail "quote endpoint accepted a browser-supplied price (HTTP $code)"
pass "browser-supplied prices are rejected"

# Checkout is a compile-time constant; the cart's disabled-state message must be in the shipped JavaScript.
html=$(curl -fsS "$base/cart/")
found=0
for src in $(echo "$html" | grep -oE '/_next/static/[^"]+\.js' | sort -u); do
  if curl -fsS "$base$src" | grep -q 'Checkout is not connected'; then found=1; break; fi
done
[ "$found" = "1" ] || fail "cart does not ship the 'checkout is not connected' state"
pass "checkout is disabled"

if [ -n "$container" ]; then
  uid=$(docker exec "$container" id -u)
  [ "$uid" != "0" ] || fail "container runs as root"
  pass "runs as non-root (uid $uid)"
fi

echo "SMOKE OK ($mode)"
