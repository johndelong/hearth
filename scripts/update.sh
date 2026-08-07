#!/usr/bin/env bash
#
# Move Hearth to a release.
#
#   ./scripts/update.sh              # the newest release
#   ./scripts/update.sh v0.3.0       # a specific release, i.e. roll back on purpose
#   ./scripts/update.sh --check      # what is running vs what is published
#   ./scripts/update.sh --requested  # whatever the dashboard asked for
#
# Releases are published as container images, so this pulls — there is no
# checkout to update and nothing to build. Docker, curl and this file are the
# whole requirement.
#
# `--requested` is how the launchd agent calls this: the dashboard writes
# .hearth-control/request.json, launchd notices, and this runs. Every other
# invocation is a person at a terminal, and works with no agent installed.
#
# Progress is written to .hearth-control/status.json so the dashboard can show
# it, and the full output to .hearth-control/update.log.

set -euo pipefail

# The install directory: this file lives in scripts/ beside docker-compose.yml.
HEARTH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HEARTH_DIR"

[ -f docker-compose.yml ] || {
  printf 'No docker-compose.yml beside %s\n' "$HEARTH_DIR" >&2
  exit 1
}

# .env is where the agent learns everything: it inherits almost no environment.
# Read only the keys wanted here; compose reads the same file for the rest.
env_value() {
  [ -f "$HEARTH_DIR/.env" ] || return 0
  sed -n "s/^[[:space:]]*$1=//p" "$HEARTH_DIR/.env" | tail -n1 | tr -d '"'"'"'\r'
}

CONTROL_DIR="${HEARTH_CONTROL_DIR:-$HEARTH_DIR/.hearth-control}"
REPO="${UPDATE_REPO:-$(env_value UPDATE_REPO)}"
REPO="${REPO:-johndelong/hearth}"
BASE_URL="${BASE_URL:-$(env_value BASE_URL)}"
BASE_URL="${BASE_URL:-http://localhost:${PORT:-8080}}"
BASE_URL="${BASE_URL%/}"
HEALTH_URL="${BASE_URL}/api/health"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"

info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m==>\033[0m %s\n' "$*"; }

# Records where we are for the dashboard. Failures here are never fatal: no
# control directory just means nobody is watching.
status() {
  local state="$1" message="$2" tag="${3:-}"
  mkdir -p "$CONTROL_DIR" 2>/dev/null || return 0
  cat > "$CONTROL_DIR/status.json" 2>/dev/null <<JSON || true
{
  "state": "${state}",
  "tag": "${tag}",
  "message": "${message//\"/\'}",
  "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
}

fail() {
  printf '\033[31m==>\033[0m %s\n' "$*" >&2
  status failed "$*" "${TARGET:-}"
  exit 1
}

running_version() {
  curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'
}

# The newest published release, straight from GitHub. Same source the dashboard
# reads, so the two never disagree about what "newest" means.
latest_release() {
  curl -fsS --max-time 10 \
    -H 'accept: application/vnd.github+json' \
    "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null |
    sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
}

# --- what are we being asked to do? -------------------------------------------

TARGET=""
case "${1:-}" in
  --check)
    printf 'checking:  %s\n' "$BASE_URL"
    printf 'running:   %s\n' "$(running_version || true)"
    printf 'published: %s\n' "$(latest_release || true)"
    exit 0
    ;;
  --requested)
    # Consume the request first, so a malformed one cannot re-trigger forever.
    REQUEST="$CONTROL_DIR/request.json"
    [ -f "$REQUEST" ] || exit 0
    TARGET="$(sed -n 's/.*"tag"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$REQUEST" | head -n1)"
    rm -f "$REQUEST"
    [ -n "$TARGET" ] || fail "Update request named no release"
    ;;
  '') ;;
  -*) fail "Unknown option: $1" ;;
  *) TARGET="$1" ;;
esac

command -v docker >/dev/null || fail "docker not found — install Docker Desktop"
docker info >/dev/null 2>&1 || fail "Docker is not running — start Docker Desktop"

if [ -z "$TARGET" ]; then
  status running "Looking for the newest release" ""
  TARGET="$(latest_release)"
  [ -n "$TARGET" ] || fail "Could not reach GitHub to find the newest release of ${REPO}"
fi

if [ "$(running_version || true)" = "$TARGET" ]; then
  info "${TARGET} is already running."
  status ok "Already running ${TARGET}" "$TARGET"
  exit 0
fi

# --- do it --------------------------------------------------------------------
#
# A failed pull leaves the container that is already running untouched, which is
# the rollback: the house keeps its dashboard and the failure shows up in
# Settings instead of as a dark screen.

export APP_VERSION="$TARGET"

status running "Downloading ${TARGET}" "$TARGET"
info "Pulling ${TARGET}"
docker compose pull --quiet hearth \
  || fail "Could not pull ${TARGET} — still running the previous version"

status running "Starting ${TARGET}" "$TARGET"
info "Starting ${TARGET}"
docker compose up -d || fail "Could not start ${TARGET} — check: docker compose logs hearth"

status running "Waiting for ${TARGET} to come up" "$TARGET"
info "Waiting for ${BASE_URL}"
deadline=$((SECONDS + HEALTH_TIMEOUT))
while (( SECONDS < deadline )); do
  [ "$(running_version || true)" = "$TARGET" ] && break
  sleep 3
done

if [ "$(running_version || true)" != "$TARGET" ]; then
  warn "Logs from the new container:"
  docker compose logs --tail 40 hearth || true
  fail "${TARGET} did not come up within ${HEALTH_TIMEOUT}s — check: docker compose logs hearth"
fi

info "Now running ${TARGET}"
status ok "Updated to ${TARGET}" "$TARGET"
