# Deploying the storefront to the InterServer VPS (Docker)

Status: ready to use. The image builds and is smoke-tested in GitHub Actions and published to GHCR; the compose file pulls it.
This is a **staging** deployment: noindex, checkout disabled, and either the placeholder catalog (default) or, once you add a read-only key
(section 9), your real WooCommerce products. Nothing here touches WordPress, MariaDB, Nginx Proxy Manager's configuration, DNS, or Stripe.

```
git push ──> GitHub Actions ──build + smoke test──> ghcr.io/cyberbandit1998/kcprintworks-nextjs:sha-1a2b3c4
                                                              │ docker compose pull
Browser ──https──> Nginx Proxy Manager ──http (proxy network)──> kcprintworks-nextjs:3000   (no published port)
```

## What is deployed, and what is deliberately not

| Property                  | Behavior                                                                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container                 | `kcprintworks-nextjs`, image `ghcr.io/<owner>/kcprintworks-nextjs:<tag>`, Next.js 16 standalone server, non-root, read-only root filesystem, all capabilities dropped                          |
| Network                   | Joins the existing external Docker network `proxy`. Port 3000 is `expose`d to that network only; **nothing is published on the VPS** (`ports:` is absent)                                      |
| Staging behavior          | `X-Robots-Tag: noindex, nofollow`, `robots.txt` disallows everything, `<meta name="robots" content="noindex">`. Fixed **when the image is built** (default `staging`), so it cannot drift       |
| Checkout                  | **Off by default.** It is switched on only by `CHECKOUT_ENABLED=true` plus the shop address and a handoff secret in the VPS `.env` (section 10), and it can never be on in a production image (that is decided when the image is built). Turning it on for a production image is a code change that needs the owner's approval |
| Prices                    | Never accepted from the browser (the quote endpoint rejects them; checked on every build)                                                                                                       |
| Data                      | Default: placeholder catalog baked into the image (no outbound calls). With `CATALOG_SOURCE=woo` (section 9): the published WooCommerce products, **read with GET requests only** using a Read-only key kept in the VPS `.env`. No database, no Stripe or Etsy credentials, no secrets in the image |
| Health check              | `GET /api/health/` inside the container (30 s interval, 5 s timeout, 20 s start period, 3 retries). It never calls an upstream, so a WooCommerce outage cannot make the container look dead    |
| Resource limits           | 0.75 CPU, 512 MB RAM (128 MB reserved), 200 processes, Node heap capped at 320 MB. Sized for a 1 CPU / 4 GB host that also runs WordPress and MariaDB                                          |
| Restart policy            | `unless-stopped` (survives reboots and crashes; stays stopped if you stop it on purpose)                                                                                                       |
| Logs                      | `json-file`, 10 MB x 3 files, so logs cannot fill the disk                                                                                                                                      |

`SITE_ENV`, `NEXT_PUBLIC_SITE_URL`, and `IMAGE_HOSTS` are **build-time** settings: `next.config.ts` writes them into the build. Pages themselves are rendered per request (the catalog
is read at run time), but the compose values for these three only label the environment. A staging image can never be made indexable by editing `.env`; CI proves it by starting a staging
image with `SITE_ENV=production` and checking it is still noindex. Going live needs a separate, deliberate production build.

## 1. One-time GitHub setup

1. **Actions permissions.** The workflow [`docker-publish.yml`](../.github/workflows/docker-publish.yml) asks for exactly
   `contents: read` and, for the publish job only, `packages: write`. It uses the built-in `GITHUB_TOKEN`; no personal token is stored in GitHub.
   Nothing to change in Settings unless your organization blocks it. If a run fails with `denied: permission_denied: write_package`:
   _Settings > Actions > General > Workflow permissions_ must not be restricted by an organization policy, and, after the first
   publish, _github.com/users/&lt;owner&gt;/packages/container/kcprintworks-nextjs > Package settings > Manage Actions access_
   must list this repository with **Write** (it is added automatically for images that carry the repository label, which ours do).
2. **Optional repository variable `SITE_URL`** (_Settings > Secrets and variables > Actions > Variables_): the public URL you will give
   the staging site in Nginx Proxy Manager, for example `https://staging.example.com`. It is baked into canonical URLs and the sitemap.
   Without it the image uses `http://localhost:3000`, which is harmless on a noindex site but looks odd in page source.
3. **Run it.** Pushing to `main`, to `claude/hopeful-hamilton-lq8pw6`, or a `v*` tag publishes automatically.
   You can also start it by hand: _Actions > Publish Docker image > Run workflow_ (leave `site_env` on **staging**).
4. **Image visibility.** New GHCR packages are **private**. Choose one:
   - **Keep private (recommended):** the VPS logs in once with a token (section 2, step 2).
   - **Make public:** _Package settings > Danger Zone > Change visibility_. The image holds only placeholder content and no secrets, so this is safe, and then the VPS needs no login.

### Tags published

| Tag                         | Meaning                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `sha-1a2b3c4`               | One per commit. **This is what you deploy and what you roll back to.**                   |
| `<branch>`                  | Moves with each push to that branch. Convenient, not for production pinning.             |
| `latest`                    | Latest build of the default branch only (staging builds).                                |
| `1.2.3`                     | When a `v1.2.3` git tag is pushed.                                                       |
| `...-production` suffix     | Only from a manual run with `site_env = production`. Never tagged `latest`. Not used yet. |

Today the repository's only branch is `claude/hopeful-hamilton-lq8pw6`, and it is also the default branch, so every push to it publishes
`sha-<7>`, the branch tag, **and** `latest`. Once a `main` branch exists and becomes the default, `latest` follows `main` instead.

First verified build: **`sha-fe36462`** (digest `sha256:2a0959c0a5e76429bd6d4ba13ab447b00a7fcafc418cbd76de4c2d2500a39265`), built, smoke-tested, and pushed by
[run 38485962263](https://github.com/cyberbandit1998/KcPrintworks/actions/runs/38485962263).

Step 2 build (WooCommerce source, Etsy-master docs): **`sha-196a701`** (digest `sha256:028a2be5887c7bb9ab7de8161838c1f1652e205c26fe2f2dbb5430db015db805`), built, smoke-tested twice (normal, and
with a hostile `SITE_ENV=production` run-time environment on a read-only, capability-free container), and pushed by
[run 38493443156](https://github.com/cyberbandit1998/KcPrintworks/actions/runs/38493443156); CI
[run 38493443121](https://github.com/cyberbandit1998/KcPrintworks/actions/runs/38493443121) passed (including the PHP plugin tests and the WooCommerce e2e suite).
Later documentation-only commits publish new tags with identical code; `sha-196a701` is the one that was verified and handed over.

Find the tag for a build in the run's **Summary** page (it lists every tag and the digest), or on the repository's **Packages** page.

## 2. One-time VPS setup (`/opt/kcprintworks-nextjs`)

Run as your normal sudo user. Nothing below changes any existing container.

```bash
# 0. Check the assumptions (read-only)
uname -m                                   # expect x86_64 (the image is linux/amd64)
docker --version && docker compose version
docker network inspect proxy >/dev/null && echo "proxy network: OK"
docker ps --filter name=nginx-proxy-manager --format '{{.Names}}  {{.Status}}'

# 1. Create the directory
sudo mkdir -p /opt/kcprintworks-nextjs
sudo chown "$USER":"$USER" /opt/kcprintworks-nextjs
cd /opt/kcprintworks-nextjs

# 2. Log in to GHCR (skip if you made the package public).
#    Create a CLASSIC personal access token at https://github.com/settings/tokens with ONLY the "read:packages" scope.
#    Type it at the prompt; never paste it into a chat or commit it.
read -rsp 'GitHub token (read:packages): ' GHCR_TOKEN; echo
echo "$GHCR_TOKEN" | docker login ghcr.io -u cyberbandit1998 --password-stdin
unset GHCR_TOKEN

# 3. Get the deploy files (they ship inside the image, so no git access is needed).
#    Replace sha-1a2b3c4 with a tag from the workflow summary.
TAG=sha-1a2b3c4
docker pull ghcr.io/cyberbandit1998/kcprintworks-nextjs:$TAG
docker create --name kcpw-extract ghcr.io/cyberbandit1998/kcprintworks-nextjs:$TAG >/dev/null
docker cp kcpw-extract:/opt/kcprintworks-deploy/. /opt/kcprintworks-nextjs/
docker rm kcpw-extract
chmod +x deploy.sh
ls -la                                     # docker-compose.yml  deploy.sh  .env.example

# 4. Configure (staging; the file holds no secrets)
cp .env.example .env
nano .env                                  # set NEXT_PUBLIC_SITE_URL to your staging URL; keep SITE_ENV=staging

# 5. Start it
./deploy.sh $TAG
```

`deploy.sh` writes `IMAGE_TAG` into `.env`, pulls the image, starts the container, and waits up to two minutes for it to report
**healthy**. If it does not, it puts the previous version back (on a first install there is nothing to go back to, so it stops
and prints the logs).

**Equivalent manual commands** (what the script does, in case you prefer them):

```bash
cd /opt/kcprintworks-nextjs
sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=$TAG|" .env
docker compose pull
docker compose up -d
docker inspect --format '{{.State.Health.Status}}' kcprintworks-nextjs     # wait for: healthy
```

### Verify

```bash
cd /opt/kcprintworks-nextjs
./deploy.sh --status
docker compose ps
docker port kcprintworks-nextjs            # prints nothing: no published ports
sudo ss -tlnp | grep ':3000 ' || echo "port 3000 is not listening on the host (correct)"
docker network inspect proxy --format '{{range .Containers}}{{.Name}} {{end}}'   # should include kcprintworks-nextjs
docker inspect --format '{{.HostConfig.Memory}} bytes, {{.HostConfig.NanoCpus}} nanoCPUs, restart={{.HostConfig.RestartPolicy.Name}}' kcprintworks-nextjs
docker exec kcprintworks-nextjs node -e "fetch('http://127.0.0.1:3000/api/health/').then(r=>r.text()).then(console.log)"
```

## 3. Point Nginx Proxy Manager at it (you do this in the NPM web UI)

I have not changed Nginx Proxy Manager or DNS. These steps are yours, and each is an approval point:

1. **DNS** (at your DNS provider): create an `A` record for a **new staging hostname** (for example `staging.<your-domain>`) pointing at the VPS IP.
   Do **not** reuse `kcprintworks.com`; it still serves the live WordPress store.
2. **NPM > Hosts > Proxy Hosts > Add Proxy Host**
   - Domain Names: your staging hostname
   - Scheme: `http`
   - Forward Hostname / IP: `kcprintworks-nextjs`
   - Forward Port: `3000`
   - Turn on **Block Common Exploits**. Leave Websockets off (not needed).
   - **SSL** tab: request a new Let's Encrypt certificate, turn on **Force SSL** and **HTTP/2**.
   - **Optional extra safety for staging**, in the **Advanced** tab: `add_header X-Robots-Tag "noindex, nofollow" always;`
3. Browse to the staging URL. You should see the home page with the "Design preview" banner.

Check noindex from anywhere:

```bash
curl -sI https://YOUR-STAGING-HOST/ | grep -i x-robots-tag     # x-robots-tag: noindex, nofollow
curl -s  https://YOUR-STAGING-HOST/robots.txt                  # Disallow: /
```

## 4. Update to a new version

1. Push to the branch (or merge to `main`). Wait for **Publish Docker image** to finish green.
2. Open the run summary and copy the tag, e.g. `sha-9f8e7d6`.
3. On the VPS:

```bash
cd /opt/kcprintworks-nextjs
./deploy.sh sha-9f8e7d6
```

If the new container does not turn healthy within two minutes, the script restores the previous image automatically and exits with an error.
The compose file itself rarely changes; when it does (it did for Step 2), refresh `docker-compose.yml` and `deploy.sh` from the new image **before** deploying it:

```bash
cd /opt/kcprintworks-nextjs
TAG=sha-9f8e7d6                                  # the new tag
docker pull ghcr.io/cyberbandit1998/kcprintworks-nextjs:$TAG
docker create --name kcpw-extract ghcr.io/cyberbandit1998/kcprintworks-nextjs:$TAG >/dev/null
cp docker-compose.yml docker-compose.yml.bak     # keeps the old file in case you want it back
docker cp kcpw-extract:/opt/kcprintworks-deploy/. /opt/kcprintworks-nextjs/     # copies compose, deploy.sh, .env.example; your .env is not in the image, so it is untouched
docker rm kcpw-extract
chmod +x deploy.sh
./deploy.sh $TAG
```

Your `.env` keeps every setting. New variables (Step 2 added `CATALOG_SOURCE`, `WC_*`, `CATALOG_REVALIDATE_SECONDS`, `REVALIDATE_SECRET`) have safe defaults in the compose file, so deploying the new image with
your old `.env` behaves exactly as before (placeholder catalog). Switching to WooCommerce is a separate, deliberate step (section 9).

## 5. Roll back

Every published tag stays in GHCR, and the images you have deployed stay on the VPS, so a rollback needs no rebuild and works even if GitHub is down.

```bash
cd /opt/kcprintworks-nextjs
./deploy.sh --list              # recent deploys, newest last
./deploy.sh --rollback          # back to the previous version
./deploy.sh sha-1a2b3c4         # or any specific earlier tag (from --list, the Packages page, or `docker images`)
./deploy.sh --status
```

Without the script, the same thing by hand:

```bash
cd /opt/kcprintworks-nextjs
sed -i 's|^IMAGE_TAG=.*|IMAGE_TAG=sha-1a2b3c4|' .env
docker compose up -d
docker inspect --format '{{.State.Health.Status}}' kcprintworks-nextjs
```

`--rollback` alternates between the two most recent versions; to go further back, deploy the tag you want by name.
To stop the storefront entirely (nothing else is affected): `cd /opt/kcprintworks-nextjs && docker compose stop`; start it again with `docker compose up -d`.

## 6. Housekeeping and troubleshooting

| Symptom                                        | Likely cause and fix                                                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `denied` or `unauthorized` on `docker pull`    | Not logged in, or the token lacks `read:packages`. Repeat step 2, or make the package public.                                                                         |
| `manifest unknown`                             | The tag does not exist. Copy it exactly from the workflow summary (`sha-` plus 7 characters).                                                                         |
| `required variable IMAGE_TAG is missing`       | `.env` has no `IMAGE_TAG`. Use `./deploy.sh <tag>`.                                                                                                                   |
| NPM shows **502 Bad Gateway**                  | The container is not healthy yet, or NPM and the app are not on the same network. `docker network inspect proxy` must list both; `./deploy.sh --status` for health.   |
| `/api/catalog-status/` says `lastError: WooCommerce returned HTTP 401` | The key or secret in `.env` is wrong or was revoked, or `WC_BASE_URL` points at a different site. Re-check section 9; the shop keeps showing the last good catalog meanwhile. |
| `... HTTP 403` or `request failed`             | Something in front of WooCommerce is blocking the VPS (a security plugin, WAF/bot challenge, host firewall, HTTP basic auth). Allow this server's IP for `/wp-json/wc/v3/`. |
| Pages show "Something went wrong" right after switching to `woo` | The very first load failed, so there is no copy to show. `docker logs --tail 50 kcprintworks-nextjs` and `/api/catalog-status/` name the reason; switch back with `CATALOG_SOURCE=fixtures` while you fix it. |
| A product edit does not appear                 | Wait `CATALOG_REVALIDATE_SECONDS` (default 2 minutes) or run the refresh command in [WOOCOMMERCE-CATALOG.md](WOOCOMMERCE-CATALOG.md) section 3. Check the product is **Published** and visible in the catalog. |
| Container restarts in a loop                   | `docker logs --tail 100 kcprintworks-nextjs`. Out of memory shows as exit code 137; do not raise the limit without checking `free -h` for the other services first.    |
| `exec format error`                            | The VPS is not x86_64 (`uname -m`). Tell me and I will add an arm64 build.                                                                                            |
| Disk filling with old images                   | List only this project's images: `docker images ghcr.io/cyberbandit1998/kcprintworks-nextjs`. Remove specific old tags with `docker rmi <image>:<tag>`. Keep the last few for rollback. **Do not run `docker system prune`** on a host shared with other stacks. |

## 7. Going live later (not part of this; each step needs your approval)

Staging stays noindex until you decide otherwise. Going live is a separate change: a production image (_Run workflow > site_env = production_,
with `SITE_URL` set to the real address), checkout and Stripe in test mode (Step 3), and the DNS and
Nginx Proxy Manager switch described in [MIGRATION-SHOP-DOMAIN.md](MIGRATION-SHOP-DOMAIN.md). None of it happens by deploying this image.

## 8. How it is tested

- Every publish builds the image, starts it, and runs [`scripts/docker-smoke.sh`](../scripts/docker-smoke.sh) against the container
  **before anything is pushed**: health, pages, noindex header/robots.txt/meta tag (staging), the image optimizer resizing a photo, the catalog endpoints, browser prices rejected,
  checkout disabled, non-root user, and the Docker health check turning healthy. A second start of the same image with `SITE_ENV=production` in its environment, read-only filesystem and
  no capabilities (as compose runs it) must still be noindex. The image that passes is the image that is published.
- The WooCommerce path is tested without the real store: unit tests run the real client and converter against a mock WooCommerce server (GET only, credentials required), and a
  Playwright suite starts a second storefront against it to prove products, variations, "Any" options, photos, 404s, cache behavior, the signed refresh, the failure fallback, and that no
  credential reaches the browser. What is **not** tested here is the real kcprintworks.com (this environment cannot reach it).
- `deploy.sh` has [tests](../scripts/deploy/deploy.test.mjs) that run it against a fake `docker`: first install, update, automatic rollback on an unhealthy
  release, failed pull, `--rollback` without network, bad tag input, and a check that it only ever issues `docker compose` for this project and talks to the
  `kcprintworks-nextjs` container (never to WordPress, MariaDB, or Nginx Proxy Manager, and never `down`, `rm`, `stop`, `prune`, or network/volume commands).
- The compose file is validated with `docker compose config`; `ports:` is absent.

## 9. Show your real WooCommerce products (Step 2)

This makes the staging container **read** your WooCommerce catalog. It writes nothing to WooCommerce. Do the steps in order; each is reversible.

**A. Create a Read-only key (you do this in WordPress; it adds one API-key row to the live site's settings, which is why I do not do it).**

1. WordPress admin > WooCommerce > Settings > Advanced > **REST API** > **Add key**.
2. Description `KCPrintWorks storefront (read-only)`. User: a dedicated administrator-or-shop-manager account if you have one (a key can do no more than its user), **Permissions: Read**. Generate.
3. Copy the **Consumer key** (`ck_...`) and **Consumer secret** (`cs_...`) into a text editor for the next step. They are shown once. Never paste them into a chat, an issue, or the repository.
   To remove access later: delete the key on the same screen.

**B. Put them on the VPS (the file holds secrets, so lock it down).**

```bash
cd /opt/kcprintworks-nextjs
chmod 600 .env
nano .env        # set these lines (keep everything else):
#   CATALOG_SOURCE=woo
#   WC_BASE_URL=https://kcprintworks.com
#   WC_CONSUMER_KEY=ck_...        (paste with the editor, not on the command line)
#   WC_CONSUMER_SECRET=cs_...
#   REVALIDATE_SECRET=<output of: openssl rand -hex 24>
```

**C. Test the key without the storefront (read-only request; the secret is read from the file, never printed or put on a command line):**

```bash
cd /opt/kcprintworks-nextjs
set -a; . ./.env; set +a
printf 'user = "%s:%s"\n' "$WC_CONSUMER_KEY" "$WC_CONSUMER_SECRET" \
  | curl -sS -K - -o /dev/null -w 'HTTP %{http_code}, %{size_download} bytes\n' "$WC_BASE_URL/wp-json/wc/v3/products?per_page=1&status=publish"
unset WC_CONSUMER_KEY WC_CONSUMER_SECRET REVALIDATE_SECRET
# expect: HTTP 200. 401 = wrong key/secret. 403 or a challenge page = something blocks this server. 404 = WC_BASE_URL is not the WooCommerce site.
```

**D. Switch the container to the WooCommerce catalog.**

```bash
cd /opt/kcprintworks-nextjs
./deploy.sh "$(grep '^IMAGE_TAG=' .env | cut -d= -f2-)"     # same image, new environment; waits for "healthy"
curl -s https://YOUR-STAGING-HOST/api/catalog-status/ | head -c 800; echo
```

Expected: `"source":"woo"`, `counts.products` equal to the number of published products you expect (66), `status.lastError` null. `counts.skipped` lists any product that is not shown, with the reason.
Then open `https://YOUR-STAGING-HOST/shop/`: the banner says it is a staging preview with your WooCommerce products, checkout is not connected, and the page is still noindex.

**E. Back out at any time:** set `CATALOG_SOURCE=fixtures` in `.env` and run the same `./deploy.sh` line. Delete the REST key in WordPress to cut access completely.

**F. Prove changes appear without a rebuild:** [WOOCOMMERCE-CATALOG.md](WOOCOMMERCE-CATALOG.md) section 3.

## 10. Checkout on staging (off by default)

Checkout hands the cart to the WooCommerce shop that runs the `kcpw-core` plugin, which uses the official Stripe plugin in **test mode**. Nothing in this section
is needed to browse the shop. Do the shop-side setup first ([CHECKOUT-STAGING-CHECKLIST.md](CHECKOUT-STAGING-CHECKLIST.md) sections 1 to 3: install the plugin on a **staging**
WordPress, set `KCPW_HANDOFF_SECRET`, Stripe test keys). Then, on the VPS:

```bash
cd /opt/kcprintworks-nextjs
nano .env      # set:  CHECKOUT_ENABLED=true   KCPW_HANDOFF_SECRET=<same value as wp-config.php>   (and KCPW_API_URL=https://YOUR-STAGING-WORDPRESS if it is not the WC_BASE_URL site)
./deploy.sh "$(grep '^IMAGE_TAG=' .env | cut -d= -f2-)"
curl -s https://YOUR-STAGING-STOREFRONT/api/checkout-status/     # expect "enabled":true and "shop":{"reachable":true,... "stripeTestMode":true}
```

The page banner then says checkout is for testing with Stripe test cards. To switch it off again: `CHECKOUT_ENABLED=false` and the same `deploy.sh` line.
If `reachable` is false the answer names the reason (secret mismatch, plugin not active, secret not set on the shop).
If the cart still shows a disabled Checkout button, `"enabled":false` in the same answer names the missing setting; see the troubleshooting list in [CHECKOUT-STAGING-CHECKLIST.md](CHECKOUT-STAGING-CHECKLIST.md) section 4.

Deploying a new image keeps all of this: it lives in `.env`, not in the image.
