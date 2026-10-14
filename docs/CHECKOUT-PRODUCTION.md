# Checkout in production (owner runbook)

Status: **built and tested against stand-ins only.** The storefront side runs in the sandbox against a mock shop; the WordPress/WooCommerce/Stripe chain
has never been run by me (the sandbox cannot reach any of them), so the steps in section 6 are what prove it on your real shop. Nothing in this document
has been done to your VPS, WordPress, Stripe or DNS: those steps are yours, and each is an approval point.

Decision record: [ADR-018](DECISIONS.md). Staging steps: [CHECKOUT-STAGING-CHECKLIST.md](CHECKOUT-STAGING-CHECKLIST.md). VPS basics: [DEPLOYMENT-VPS.md](DEPLOYMENT-VPS.md).

```
Shopper ─https─> kcprintworks.com  (Next.js, container kcprintworks-production)
                     │  POST /api/cart/handoff/   cart lines only, never a price
                     │  server ──signed (HMAC-SHA256, timestamp, nonce)──> https://shop.kcprintworks.com/wp-json/kcpw/v1/…  (kcpw-core)
                     │            1. GET  /status               who are you? Stripe mode? where do you send shoppers back to?
                     │            2. POST /cart/handoff         validate every line, price it, store it, return a single-use link
                     ▼
Shopper ─https─> https://shop.kcprintworks.com/?kcpw_handoff=<43 characters>    one use, 10 minutes, then gone
                     │  kcpw-core rebuilds the WooCommerce cart and sends the shopper to WooCommerce's checkout (same host)
                     ▼
              WooCommerce checkout + the OFFICIAL Stripe plugin (on shop.kcprintworks.com) ──> WooCommerce's order-received page
```

## 1. What decides whether checkout is on

Checkout is **off by default**. It is on only when **all** of these are true. Anything missing keeps it off, and `/api/checkout-status/` names it
(names only, never a value).

| #   | Rule                                                                                                               | Where it comes from                                  | Staging image | Production image |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------- | ---------------- |
| 1   | `CHECKOUT_ENABLED=true` (exactly that word)                                                                        | container `.env` (run time)                          | yes           | yes              |
| 2   | Shop address: `KCPW_API_URL`, else `KCPW_SHOP_URL`, else `WC_BASE_URL`; https                                      | container `.env`                                     | https (http only for localhost tests) | **https, no exception for localhost** |
| 3   | `KCPW_HANDOFF_SECRET`, 32+ characters, equal to the one in the shop's `wp-config.php`                              | container `.env`                                     | yes           | yes              |
| 4   | The storefront's own address is a plain https origin that is not local, and differs from the shop's host           | `NEXT_PUBLIC_SITE_URL` **written into the image**    | n/a           | **yes**          |
| 5   | `CATALOG_SOURCE=woo`, so the cart is priced from the live catalog, never from sample data                          | container `.env`                                     | n/a           | **yes**          |
| 6   | The shop answers a signed status request                                                                           | checked on **every** checkout press                  | yes           | yes              |
| 7   | The shop reports Stripe in **TEST** mode                                                                           | checked on every press                               | **yes**       | no (live is the point) |
| 8   | The shop reports that it returns shoppers to **this** storefront (`KCPW_STOREFRONT_URL` equals the image's address) | checked on every press                               | n/a           | **yes** (see 4.2) |

Rule 7 is what keeps staging safe after you go live: staging and production share one WooCommerce site, so the day Stripe is switched to live mode a
forgotten `CHECKOUT_ENABLED=true` on `dev.kcprintworks.com` would otherwise charge real cards. It refuses instead (HTTP 403, "Checkout is not available right now"),
unless the shop positively says "test mode". Unknown counts as a refusal.

### Build time versus run time

| Setting                                      | When it is fixed                         | Consequence                                                                                                                                      |
| -------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SITE_ENV` (staging/production)              | **build** (`next.config.ts`)             | A production image is a separate image (tag ends in `-production`). A container's `.env` cannot turn a staging image into one, or the reverse.  |
| `NEXT_PUBLIC_SITE_URL`                       | **build**                                | Production images are built with `https://kcprintworks.com` (the workflow's `site_url` input). Changing it means building again.               |
| `IMAGE_HOSTS`                                | **build**                                | Unchanged.                                                                                                                                       |
| everything else (`CHECKOUT_ENABLED`, `KCPW_*`, `WC_*`, `CATALOG_SOURCE`, free shipping, reviews, nav) | **run time**, from the container's `.env` | Edit `.env`, run `./deploy.sh <same tag>` (recreates the container), no rebuild. |

CI proves it on the real image: the production image is started with `SITE_ENV=staging` and `NEXT_PUBLIC_SITE_URL=http://evil.example` and must still report
`"environment":"production"` and `"storefront":"https://kcprintworks.com"` (and must not send `noindex`). A staging image started with `SITE_ENV=production`
must still be noindex (this check already existed).

## 2. What is preserved (nothing was weakened)

- **Signed requests:** every call to the shop carries `x-kcpw-timestamp`, a fresh `x-kcpw-nonce` and an HMAC-SHA256 signature over method, route, body hash.
  The shop refuses a stale timestamp, a wrong signature, and a nonce it has seen (replay protection, PHP `RequestVerifier` + nonce store).
- **Single-use, short-lived link:** the shop stores the cart (line _intents_ only) behind a random token whose hash is stored, not the token; it works once and
  expires after 10 minutes.
- **The storefront only follows the shop's own link:** the returned address must be the shop's origin, the front page, with exactly one query value of 43
  URL-safe characters. Anything else (another host, another path, extra parameters) is refused.
- **No prices from the browser:** cart and handoff bodies are strict; a `price`, `total`, or `expectedSubtotal` from the browser is a 400. The server re-quotes
  the cart itself, and the shop re-prices it again and compares.
- **No card data:** none is ever seen or stored here. Payment truth is WooCommerce's order and the Stripe plugin's verified events, on the shop.

Added, not removed: rules 4, 5, 7 and 8 above, the per-press shop check, and the instance separation in section 3.

## 3. Two instances on one VPS

| Instance   | Directory                      | Compose file                     | Project / service / container   | Image tag               | Address                          |
| ---------- | ------------------------------ | -------------------------------- | ------------------------------- | ----------------------- | -------------------------------- |
| staging    | `/opt/kcprintworks-nextjs`     | `docker-compose.yml`             | `kcprintworks-nextjs`           | `sha-<7>`               | `https://dev.kcprintworks.com`   |
| production | `/opt/kcprintworks-production` | `docker-compose.production.yml`  | `kcprintworks-production`       | `sha-<7>-production`    | `https://kcprintworks.com`       |

They share only the Docker network `proxy` and the shop. The production file **extends** the staging definition (same hardening, limits, health check, and
setting names, so they cannot drift) and changes the names: Docker adds the _service name_ as a DNS alias on the network, so two services with one name would send some
of staging's traffic to production and the other way round. `deploy.sh` also refuses to mix them up: a directory is `DEPLOY_KIND=staging` (the default, so your existing
staging directory needs no change) or `production`; it refuses an image of the other kind, and a production directory that is not using
`docker-compose.production.yml`.

## 4. The shop side (kcpw-core 0.2.1)

### 4.1 Update the plugin

0.2.1 adds one thing: `GET /wp-json/kcpw/v1/status` also reports `storefrontUrl` (the value of `KCPW_STOREFRONT_URL`, or `null`). Build it with `npm run build:core-plugin`
(`dist/kcpw-core.zip`, also a CI artifact) and upload it as an update in WordPress. Because installing a plugin changes the live site, **do this when you decide to;
nothing here does it for you.** Without 0.2.1 production checkout still works, but the storefront cannot confirm the return address (rule 8): the status page shows
`"returnAddress":"not_reported"` and the log has no error, because it only affects where a shopper lands after an expired or already-used link, never a payment.

### 4.2 Set the storefront address on the shop

One shop has one `KCPW_STOREFRONT_URL`. It is only used to send a shopper back to the cart when something went wrong with the link
(`/cart/?handoff=expired|changed|unavailable`). Today it presumably points at staging. For production it must be:

```php
// wp-config.php on shop.kcprintworks.com  (you edit this file; I never do)
define('KCPW_STOREFRONT_URL', 'https://kcprintworks.com');
```

If it still names another site, a production press is refused (`blocked: return_address_mismatch`), so a shopper is never handed to a shop that would then return them to staging.
After this change, an _expired link_ on staging would return shoppers to production, which is why staging checkout should stop being used at that point (and, once Stripe is live, stops itself: rule 7).
`KCPW_HANDOFF_SECRET` stays the same value on both storefronts.

### 4.3 Return URLs and redirects, step by step

| Step | From → to                                                                                              | Controlled by                                     | Verified how                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1    | Browser → `https://kcprintworks.com/api/cart/handoff/`                                                  | same origin                                       | unit + e2e                                                                                         |
| 2    | Storefront server → `https://shop.kcprintworks.com/wp-json/kcpw/v1/status` then `/cart/handoff`       | `KCPW_API_URL` / `WC_BASE_URL`; redirects refused | unit with a mock shop                                                                              |
| 3    | Browser → `https://shop.kcprintworks.com/?kcpw_handoff=<token>`                                         | pinned to the shop's origin by the storefront     | unit (hostile shops), e2e                                                                          |
| 4    | Shop → `wc_get_checkout_url()` (shop host)                                                              | kcpw-core                                         | PHP tests with WordPress stand-ins; **real shop: section 6**                                       |
| 5    | Payment, Stripe's redirects and webhooks, then WooCommerce's order-received page (shop host)            | WooCommerce + the official Stripe plugin          | **not verifiable here**; section 6                                                                 |
| 6    | A problem with the link → `KCPW_STOREFRONT_URL` + `/cart/?handoff=<reason>`                              | kcpw-core + `wp-config.php`                        | PHP tests (`RedeemerTest`), status check (rule 8)                                                  |

Customers pay and land on WooCommerce's own pages on `shop.kcprintworks.com`; this change does not theme or redirect those. If you want the order-received page
to look like the storefront, that is a separate piece of work.

## 5. Bring up the production instance (nothing runs until you do this)

You need the **production image tag** (the GitHub run summary lists it, ending `-production`). Replace `sha-XXXXXXX-production` below.

```bash
# 1. The directory and the deploy files (they ship inside the image). Staging is not touched.
sudo mkdir -p /opt/kcprintworks-production && sudo chown "$USER" /opt/kcprintworks-production
cd /opt/kcprintworks-production
TAG=sha-XXXXXXX-production
docker pull ghcr.io/cyberbandit1998/kcprintworks-nextjs:$TAG
docker create --name kcpw-extract-prod ghcr.io/cyberbandit1998/kcprintworks-nextjs:$TAG >/dev/null
docker cp kcpw-extract-prod:/opt/kcprintworks-deploy/. /opt/kcprintworks-production/
docker rm kcpw-extract-prod
chmod +x deploy.sh

# 2. Settings: start from the production example. CHECKOUT_ENABLED stays false for now.
cp .env.production.example .env && chmod 600 .env
nano .env        # fill in WC_CONSUMER_KEY, WC_CONSUMER_SECRET, REVALIDATE_SECRET, KCPW_HANDOFF_SECRET (paste with the editor, never into a chat)

# 3. Start it. deploy.sh refuses a staging image here, and the staging container is never touched.
./deploy.sh $TAG
./deploy.sh --status
docker ps --format '{{.Names}}  {{.Image}}'      # both kcprintworks-nextjs and kcprintworks-production should be listed
```

Then, in Nginx Proxy Manager (yours to do, with the DNS for `kcprintworks.com`): a proxy host for `kcprintworks.com`, scheme `http`, forward hostname
**`kcprintworks-production`**, port `3000`, Force SSL. Leave the staging proxy host (`dev.kcprintworks.com` → `kcprintworks-nextjs`) as it is.

Check before checkout is on:

```bash
curl -sI https://kcprintworks.com/ | grep -i x-robots-tag            # nothing (production is indexable)
curl -s  https://kcprintworks.com/api/checkout-status/               # {"enabled":false,"environment":"production","reason":"not turned on"}
```

## 6. Turn production checkout on (your approval; do these in order)

1. **Shop:** kcpw-core 0.2.1 installed (4.1) and `KCPW_STOREFRONT_URL` set to `https://kcprintworks.com` (4.2).
2. **Stripe:** leave the plugin in **test mode** for the first run. (Keys and the live switch are yours; I never touch them.)
3. **Production `.env`:** set `CHECKOUT_ENABLED=true` (and confirm `KCPW_API_URL=https://shop.kcprintworks.com`, `KCPW_HANDOFF_SECRET`, `CATALOG_SOURCE=woo`), then:

   ```bash
   cd /opt/kcprintworks-production && ./deploy.sh "$(grep '^IMAGE_TAG=' .env | cut -d= -f2-)"
   curl -s https://kcprintworks.com/api/checkout-status/
   ```

   Expect `"enabled":true,"environment":"production","storefront":"https://kcprintworks.com","allowed":true,"returnAddress":"matches"` and a `shop` block with
   `"reachable":true`. If `allowed` is false, `blocked` and `reason` say why; if `enabled` is false, `missing` names the setting.
4. **Test purchase with Stripe still in test mode:** add one item, press Checkout, confirm the shop shows the same items and totals, pay with a Stripe **test** card,
   and open the order in WooCommerce. Press the old link again: it must say expired.
5. **Go live (yours):** switch the Stripe plugin to live mode in WooCommerce. From this moment staging checkout refuses by itself. Place one real low-value order
   on `https://kcprintworks.com`, check the payment in Stripe, then refund it there.
6. Send me `/api/checkout-status/` output and anything that looked wrong; do not send secrets.

**Turn it off again:** `CHECKOUT_ENABLED=false` in the production `.env`, then `./deploy.sh "$(grep '^IMAGE_TAG=' .env | cut -d= -f2-)"`. The cart shows
"Online checkout is not open on this site yet." **Roll back an image:** `./deploy.sh --rollback` (production images only).

## 7. Unverified (be honest about this)

- Real WordPress/WooCommerce running `kcpw-core`, the official Stripe plugin, and the hand-off into WooCommerce's checkout, Stripe's redirects and the order-received page: not
  run by me. Step 6 is the proof.
- That your shop's `wp-config.php`, security plugins or firewall allow the VPS to call `/wp-json/kcpw/v1/…` (the staging checklist covers this and, if staging works, production will too: same shop).
- `shop.kcprintworks.com`'s real Stripe mode, plugin version and `KCPW_STOREFRONT_URL`: I cannot see them. The status page tells you.
- The production image's own checks ran in GitHub Actions on the real Docker image ([run 38620526270](https://github.com/cyberbandit1998/KcPrintworks/actions/runs/38620526270): checkout off, incomplete, refused settings, and on with a hostile `SITE_ENV` / `NEXT_PUBLIC_SITE_URL`), and
  locally against a production bundle. They use a throwaway secret and an unreachable shop on purpose, so they prove the rules and the build-time fixing, not a working payment.
- The VPS side (`docker-compose.production.yml`, `deploy.sh`'s production mode) was checked with `docker compose config` and a stubbed `docker`; it has not been run on your VPS.
