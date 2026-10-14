# syntax=docker/dockerfile:1.7
#
# KCPrintWorks storefront image (Next.js 16, npm workspaces, standalone output).
#
#   docker build -t kcprintworks-nextjs .                                       # staging image (default)
#   docker build --build-arg SITE_ENV=production \
#                --build-arg NEXT_PUBLIC_SITE_URL=https://kcprintworks.com -t ... .   # production image
#
# SITE_ENV, NEXT_PUBLIC_SITE_URL and IMAGE_HOSTS are BUILD-time settings: next.config.ts writes them into the build, so
# robots/noindex, canonical URLs and the image optimizer's host list cannot be changed from the container's environment.
# The default is staging (noindex), so an image built without arguments can never be indexed by accident. Pages are
# rendered per request (the catalog is read from WooCommerce at run time, never frozen into the image). Checkout is a
# compile-time constant (apps/storefront/src/lib/checkout.ts) and stays off.
# Secrets are never baked in: the WooCommerce read-only key and the revalidation secret are RUNTIME variables from the
# VPS .env (see deploy/.env.example); this image contains none.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo

# ---- dependencies: only the manifests, so this layer is reused until a dependency changes ----
FROM base AS deps
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY apps/storefront/package.json apps/storefront/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---- build ----
FROM base AS builder
COPY --from=deps /repo/ ./
COPY . .
ARG SITE_ENV=staging
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
# Hosts whose product photos Next may resize; empty = kcprintworks.com and its subdomains. See src/lib/image-hosts.ts.
ARG IMAGE_HOSTS=
ENV SITE_ENV=${SITE_ENV} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    IMAGE_HOSTS=${IMAGE_HOSTS} \
    NEXT_OUTPUT=standalone
RUN npm run build -w @kcpw/storefront

# ---- runtime: the standalone server only, as an unprivileged user ----
FROM node:${NODE_VERSION}-bookworm-slim AS runner
ARG GIT_SHA=unknown
ARG SITE_ENV=staging
# The runtime value only labels the environment; the behavior itself was fixed at build time (next.config.ts `env`).
ENV SITE_ENV=${SITE_ENV} \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_VERSION=${GIT_SHA}
WORKDIR /app
COPY --from=builder --chown=node:node /repo/apps/storefront/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/storefront/.next/static ./apps/storefront/.next/static
COPY --from=builder --chown=node:node /repo/apps/storefront/public ./apps/storefront/public
# The VPS files (compose, deploy.sh) travel inside the image, so an image tag always comes with the compose file it was
# tested with and the server needs no git access: see docs/DEPLOYMENT-VPS.md ("Get the deploy files").
COPY --from=builder /repo/deploy /opt/kcprintworks-deploy
# Next writes its optimizer/ISR cache here; compose mounts a tmpfs over it so the root filesystem can be read-only.
RUN mkdir -p apps/storefront/.next/cache && chown node:node apps/storefront/.next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/storefront/server.js"]
