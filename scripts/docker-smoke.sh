#!/usr/bin/env bash
# Smoke-test a running storefront container BEFORE it is published.
#
#   scripts/docker-smoke.sh <base-url> <staging|production> [container-name]
#
# Read-only HTTP checks (plus `id` inside the container). It proves the properties that must never regress:
# the app is up, staging is noindex, prices cannot come from the browser, checkout is off by default, and the
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

for path in / /shop/ /new-arrivals/ /cart/ /blog/ /our-story/ /contact/ /sitemap.xml; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$base$path")
  [ "$code" = "200" ] || fail "$path returned $code"
done
pass "pages render (/, /shop/, /new-arrivals/, /cart/, /blog/, /our-story/, /contact/, sitemap)"
# The old Our Story address moves permanently to the new one.
code=$(curl -s -o /dev/null -w '%{http_code}' "$base/about/")
[ "$code" = "308" ] || fail "/about/ returned $code (expected a permanent redirect)"
# The header has the five links, in order, and the placeholder blog/reviews show up in the default (sample) deployment.
header=$(curl -fsS "$base/" | tr -d '\n')
echo "$header" | grep -Eq 'href="/shop/".*href="/product-category/game-cases/".*href="/product-category/personalized-gifts/".*href="/new-arrivals/".*href="/blog/"' || fail "header links are missing or out of order"
curl -fsS "$base/blog/" | grep -q 'Sample post' || fail "the blog did not render the sample posts"
pass "header links and sample blog"

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

# The image optimizer (sharp) must work inside the image: resize the home-page photo. A broken optimizer would show as
# missing photos only after WooCommerce products are connected.
optimized=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$base/_next/image/?url=%2Fimages%2Fkcprintworks-hero.webp&w=640&q=75")
case "$optimized" in "200 image/"*) ;; *) fail "image optimizer did not resize a photo (got: $optimized)" ;; esac
pass "image optimizer works"

# Catalog endpoints exist and behave for the placeholder catalog: status reports the source, refresh is not an endpoint.
curl -fsS "$base/api/catalog-status/" | grep -q '"source":"fixtures"' || fail "catalog-status did not report the placeholder source"
# Checkout is off in the default deployment: the status says so and the handoff endpoint refuses, whatever the browser sends.
curl -fsS "$base/api/checkout-status/" | grep -q '"enabled":false' || fail "checkout-status did not report checkout as off"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/api/cart/handoff/" -H 'content-type: application/json' -d '{"lines":[{"productId":1,"quantity":1}]}')
[ "$code" = "403" ] || fail "handoff endpoint answered $code with checkout off (expected 403)"
# Writing a review is off in the default deployment, whatever the browser sends.
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/api/reviews/" -H "origin: $base" -H 'content-type: application/json' -d '{}')
[ "$code" = "404" ] || fail "reviews endpoint answered $code with review submission off (expected 404)"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/api/revalidate/" -d '{}')
[ "$code" = "404" ] || fail "revalidate endpoint answered $code without a WooCommerce source (expected 404)"
pass "catalog endpoints"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/api/cart/quote/" \
  -H 'content-type: application/json' \
  -d '{"lines":[{"productId":103,"quantity":1,"options":{},"price":1}]}')
[ "$code" = "400" ] || fail "quote endpoint accepted a browser-supplied price (HTTP $code)"
pass "browser-supplied prices are rejected"

# With checkout off the cart's disabled-state message must be in the shipped JavaScript.
html=$(curl -fsS "$base/cart/")
found=0
for src in $(echo "$html" | grep -oE '/_next/static/[^"]+\.js' | sort -u); do
  if curl -fsS "$base$src" | grep -q 'Online checkout is not open on this site yet'; then found=1; break; fi
done
[ "$found" = "1" ] || fail "cart does not ship the 'online checkout is not open' state"
pass "checkout is disabled"

if [ -n "$container" ]; then
  uid=$(docker exec "$container" id -u)
  [ "$uid" != "0" ] || fail "container runs as root"
  pass "runs as non-root (uid $uid)"
fi

echo "SMOKE OK ($mode)"
