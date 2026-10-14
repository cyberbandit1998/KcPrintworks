#!/usr/bin/env bash
# Deploy, update, or roll back a KCPrintWorks storefront container: staging (kcprintworks-nextjs) or, from its own directory,
# production (kcprintworks-production).
#
#   ./deploy.sh sha-1a2b3c4     deploy exactly this published image (first install and every update)
#   ./deploy.sh --rollback      return to the previously deployed image
#   ./deploy.sh --status        what is running and whether it is healthy
#   ./deploy.sh --list          deploy history
#
# Safe by construction:
#   * It only runs `docker compose` for THIS directory's project and inspects/execs that project's one container
#     (CONTAINER_NAME in .env, default kcprintworks-nextjs; kcprintworks-production when DEPLOY_KIND=production).
#     It never stops, removes, or restarts any other container, network, volume, or image (no `prune`, no `down`),
#     so WordPress, MariaDB, Nginx Proxy Manager, and the OTHER storefront instance are never touched.
#   * A directory is either staging or production (DEPLOY_KIND in .env, default staging). It refuses an image of the other kind
#     (production tags end in -production), and a production directory that is not using docker-compose.production.yml, so a
#     production image can never replace the staging container or the other way round.
#   * It pulls the new image BEFORE replacing anything; if the pull fails, the running container is left alone.
#   * If the new container does not become healthy, it puts the previous image back automatically.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

ENV_FILE=.env
HISTORY=.deploy-history
WAIT_SECONDS="${DEPLOY_WAIT_SECONDS:-120}"
POLL_SECONDS="${DEPLOY_POLL_SECONDS:-3}"

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

valid_tag() { [[ "$1" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; }

env_value() {
  [ -f "$ENV_FILE" ] || return 0
  { grep -E "^$1=" "$ENV_FILE" || true; } | tail -n1 | cut -d= -f2-
}

current_tag() { env_value IMAGE_TAG; }

# Which instance this directory is, from .env (read again after a first install creates it).
KIND=staging
CONTAINER=kcprintworks-nextjs
load_instance() {
  KIND=$(env_value DEPLOY_KIND)
  KIND=${KIND:-staging}
  case "$KIND" in
    staging) CONTAINER=$(env_value CONTAINER_NAME); CONTAINER=${CONTAINER:-kcprintworks-nextjs} ;;
    production) CONTAINER=$(env_value CONTAINER_NAME); CONTAINER=${CONTAINER:-kcprintworks-production} ;;
    *) die "DEPLOY_KIND in $ENV_FILE must be staging or production, not '$KIND'." ;;
  esac
  [[ "$CONTAINER" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$ ]] || die "CONTAINER_NAME in $ENV_FILE is not a valid container name."
}

# An image of the wrong kind in this directory would put a production build on the staging container, or the other way round.
check_instance() {
  local tag="$1"
  if [ "$KIND" = production ]; then
    [[ "$tag" == *-production ]] || die "This is a PRODUCTION directory (DEPLOY_KIND=production) and '$tag' is not a production image. Production tags end in -production."
    [ "$(env_value COMPOSE_FILE)" = docker-compose.production.yml ] || die "A production directory must set COMPOSE_FILE=docker-compose.production.yml in $ENV_FILE (otherwise 'docker compose' would use the staging definition and replace the staging container)."
    [ "$CONTAINER" != kcprintworks-nextjs ] || die "The production container must not be named kcprintworks-nextjs (that is the staging container)."
  else
    [[ "$tag" != *-production ]] || die "This is a STAGING directory and '$tag' is a production image. Deploy production images from the production directory (docs/CHECKOUT-PRODUCTION.md)."
  fi
}

set_tag() {
  if grep -qE '^IMAGE_TAG=' "$ENV_FILE"; then
    sed -i.bak -E "s|^IMAGE_TAG=.*|IMAGE_TAG=$1|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    printf 'IMAGE_TAG=%s\n' "$1" >> "$ENV_FILE"
  fi
}

record() { printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$HISTORY"; }

health() {
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo missing
}

wait_healthy() {
  local waited=0 status
  while [ "$waited" -lt "$WAIT_SECONDS" ]; do
    status=$(health)
    case "$status" in
      healthy) return 0 ;;
      unhealthy) return 1 ;;
    esac
    sleep "$POLL_SECONDS"
    waited=$((waited + POLL_SECONDS))
  done
  return 1
}

deploy() {
  local tag="$1" previous
  valid_tag "$tag" || die "'$tag' is not a valid image tag."
  if [ ! -f "$ENV_FILE" ]; then
    [ -f .env.example ] || die ".env and .env.example are both missing in $(pwd)."
    cp .env.example "$ENV_FILE"
    say "Created $ENV_FILE from .env.example. Edit NEXT_PUBLIC_SITE_URL later if needed."
    load_instance
  fi
  check_instance "$tag"

  previous=$(current_tag)
  set_tag "$tag"
  say "Pulling image tag $tag ..."
  if ! docker compose pull; then
    # A rollback must still work when the registry is unreachable, if the old image is already on this server.
    if docker image inspect "$(docker compose config --images)" >/dev/null 2>&1; then
      say "WARNING: pull failed, using the copy of $tag already on this server." >&2
    else
      [ -z "$previous" ] || set_tag "$previous"
      die "Could not pull tag '$tag'. Nothing was changed; the running container is untouched. Check the tag and 'docker login ghcr.io'."
    fi
  fi

  say "Starting $CONTAINER with $tag ..."
  docker compose up -d

  if wait_healthy; then
    record "$tag" deployed
    say "OK: $CONTAINER is healthy on $tag."
    return 0
  fi

  say "The new container did not become healthy. Recent logs:" >&2
  docker logs --tail 40 "$CONTAINER" >&2 || true
  if [ -n "$previous" ] && [ "$previous" != "$tag" ]; then
    say "Rolling back to $previous ..." >&2
    set_tag "$previous"
    docker compose up -d
    if wait_healthy; then
      record "$previous" rolled-back
      die "Deploy of $tag failed and was rolled back to $previous (healthy)."
    fi
    die "Deploy of $tag failed AND $previous is not healthy either. Inspect: docker logs $CONTAINER"
  fi
  die "Deploy of $tag failed and there is no earlier version to return to. Inspect: docker logs $CONTAINER"
}

previous_good_tag() {
  # The most recent successfully deployed tag that differs from the one running now.
  [ -f "$HISTORY" ] || return 0
  local now
  now=$(current_tag)
  awk -v now="$now" '$3 != "failed" && $2 != now { tag = $2 } END { print tag }' "$HISTORY"
}

load_instance

case "${1:-}" in
  ''|-h|--help)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  --status)
    say "Configured image tag : $(current_tag)"
    say "Container health     : $(health)"
    docker inspect --format 'Image               : {{.Config.Image}}{{"\n"}}Started at          : {{.State.StartedAt}}' "$CONTAINER" 2>/dev/null || say "Container not found."
    docker exec "$CONTAINER" node -e "fetch('http://127.0.0.1:3000/api/health/').then(r=>r.text()).then(t=>console.log('Health endpoint      : '+t))" 2>/dev/null || true
    ;;
  --list)
    if [ -f "$HISTORY" ]; then tail -n 20 "$HISTORY"; else say "No deploys recorded yet."; fi
    ;;
  --rollback)
    target=$(previous_good_tag)
    [ -n "$target" ] || die "No earlier successful deploy is recorded in $HISTORY. Deploy a known tag explicitly: ./deploy.sh sha-xxxxxxx"
    say "Rolling back from $(current_tag) to $target ..."
    deploy "$target"
    ;;
  -*)
    die "Unknown option '$1'. Try --help."
    ;;
  *)
    deploy "$1"
    ;;
esac
