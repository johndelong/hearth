#!/usr/bin/env bash
#
# Deploy Hearth on the Mac mini.
#
#   ./scripts/deploy.sh              # deploy the newest release tag
#   ./scripts/deploy.sh v0.3.0       # deploy a specific tag
#   ./scripts/deploy.sh --check      # report what is running vs available
#
# Snapshots the database, builds the new version, waits for it to come up
# healthy, and rolls back to what was running before if it does not.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

PORT="${PORT:-8080}"
HEALTH_URL="http://localhost:${PORT}/api/health"
BACKUP_DIR="${BACKUP_DIR:-$HOME/hearth-backups}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"

info()  { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn()  { printf '\033[33m==>\033[0m %s\n' "$*"; }
fail()  { printf '\033[31m==>\033[0m %s\n' "$*" >&2; exit 1; }

current_version() {
  # What the running container reports; empty if it is not up.
  curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'
}

newest_tag() {
  git tag --list 'v*' --sort=-v:refname | head -n1
}

# --- --check: report and exit -------------------------------------------------

if [[ "${1:-}" == "--check" ]]; then
  git fetch --tags --quiet
  running="$(current_version || true)"
  latest="$(newest_tag)"
  printf 'running:   %s\n' "${running:-not running}"
  printf 'newest:    %s\n' "${latest:-none tagged}"
  if [[ -n "$latest" && "$running" != "$latest" ]]; then
    printf '\nDeploy it with:  ./scripts/deploy.sh\n'
  fi
  exit 0
fi

# --- everything past here needs Docker ---------------------------------------

command -v docker >/dev/null || fail "docker not found. Install Docker Desktop and start it."
docker info >/dev/null 2>&1 || fail "Docker is not running. Start Docker Desktop first."

# --- work out what we are deploying ------------------------------------------

info "Fetching tags"
git fetch --tags --prune --quiet

TARGET="${1:-$(newest_tag)}"
[[ -n "$TARGET" ]] || fail "No release tags found. Cut one with: git tag v0.1.0 && git push --tags"
git rev-parse --verify "refs/tags/${TARGET}" >/dev/null 2>&1 || fail "Unknown tag: ${TARGET}"

# Where to return to if this goes wrong. Detached HEAD is normal here, so fall
# back to the commit itself.
PREVIOUS="$(git describe --tags --exact-match 2>/dev/null || git rev-parse --abbrev-ref HEAD)"
[[ "$PREVIOUS" == "HEAD" ]] && PREVIOUS="$(git rev-parse HEAD)"

RUNNING="$(current_version || true)"
if [[ "$RUNNING" == "$TARGET" ]]; then
  info "${TARGET} is already running. Nothing to do."
  exit 0
fi

# --- snapshot the database ----------------------------------------------------

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
VOLUME="$(docker compose config --format json 2>/dev/null | sed -n 's/.*"source":"\([^"]*dashboard-data\)".*/\1/p' | head -n1 || true)"

info "Backing up the database to ${BACKUP_DIR}/dashboard-${STAMP}.db"
if docker compose ps --status running --quiet hearth >/dev/null 2>&1; then
  # sqlite3 .backup is safe against a live database; plain cp is not.
  docker compose exec -T hearth node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.env.DATABASE_PATH);
    db.exec(`VACUUM INTO '"'"'/data/backup-tmp.db'"'"'`);
  ' 2>/dev/null && docker compose cp "hearth:/data/backup-tmp.db" "${BACKUP_DIR}/dashboard-${STAMP}.db" \
    && docker compose exec -T hearth rm -f /data/backup-tmp.db \
    || warn "Could not snapshot the database (is it the first deploy?) — continuing"
else
  warn "Container is not running — nothing to back up yet"
fi

# Keep the last 20 snapshots; they are small.
ls -1t "$BACKUP_DIR"/dashboard-*.db 2>/dev/null | tail -n +21 | xargs -I{} rm -f {} || true

# --- deploy -------------------------------------------------------------------

deploy_tag() {
  local tag="$1"
  info "Checking out ${tag}"
  git checkout --quiet --detach "refs/tags/${tag}" 2>/dev/null || git checkout --quiet "${tag}"
  info "Building and starting (this takes a minute or two)"
  APP_VERSION="$tag" docker compose up -d --build
}

wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while (( SECONDS < deadline )); do
    if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 3
  done
  return 1
}

deploy_tag "$TARGET"

info "Waiting for it to come up"
if wait_healthy; then
  info "Deployed ${TARGET} — now reporting $(current_version)"
  info "Wall panels will reload themselves once idle; open tablets will offer a Refresh button."
else
  warn "New version did not become healthy within ${HEALTH_TIMEOUT}s. Rolling back to ${PREVIOUS}."
  warn "Logs from the failed deploy:"
  docker compose logs --tail 40 hearth || true
  deploy_tag "$PREVIOUS" 2>/dev/null || {
    git checkout --quiet "$PREVIOUS"
    APP_VERSION="$PREVIOUS" docker compose up -d --build
  }
  if wait_healthy; then
    fail "Rolled back to ${PREVIOUS}. The database snapshot is at ${BACKUP_DIR}/dashboard-${STAMP}.db"
  fi
  fail "Rollback also failed to come up. Check: docker compose logs hearth"
fi
