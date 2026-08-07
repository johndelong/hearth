#!/usr/bin/env bash
#
# Move Hearth to a release.
#
#   ./scripts/update.sh              # the newest release tag
#   ./scripts/update.sh v0.3.0       # a specific tag, i.e. roll back on purpose
#   ./scripts/update.sh --check      # what is running vs what is available
#   ./scripts/update.sh --requested  # whatever the dashboard asked for
#
# `--requested` is how the launchd agent calls this: the dashboard writes
# .hearth-control/request.json, launchd notices, and this runs. Every other
# invocation is a person at a terminal, and works with no agent installed.
#
# Progress is written to .hearth-control/status.json so the dashboard can show
# it, and the full output to .hearth-control/update.log.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

CONTROL_DIR="${HEARTH_CONTROL_DIR:-$REPO_DIR/.hearth-control}"

# The launchd agent has almost no environment, so .env is where it learns where
# the app answers. Same file compose reads; only this one key is wanted here.
if [ -z "${BASE_URL:-}" ] && [ -f "$REPO_DIR/.env" ]; then
  BASE_URL="$(sed -n 's/^[[:space:]]*BASE_URL=//p' "$REPO_DIR/.env" | tail -n1 | tr -d '"'"'"'\r')"
fi
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

newest_tag() {
  git tag --list 'v*' --sort=-v:refname | head -n1
}

# --- what are we being asked to do? -------------------------------------------

TARGET=""
case "${1:-}" in
  --check)
    git fetch --tags --quiet
    printf 'checking:  %s\n' "$BASE_URL"
    printf 'running:   %s\n' "$(running_version || true)"
    printf 'newest:    %s\n' "$(newest_tag || true)"
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

status running "Fetching releases" "$TARGET"
info "Fetching tags"
git fetch --tags --prune --quiet || fail "Could not reach GitHub to fetch tags"

[ -n "$TARGET" ] || TARGET="$(newest_tag)"
[ -n "$TARGET" ] || fail "No release tags found. Cut one with: git tag v0.1.0 && git push --tags"
git rev-parse --verify "refs/tags/${TARGET}" >/dev/null 2>&1 || fail "Unknown release: ${TARGET}"

if [ "$(running_version || true)" = "$TARGET" ]; then
  info "${TARGET} is already running."
  status ok "Already running ${TARGET}" "$TARGET"
  exit 0
fi

# --- do it --------------------------------------------------------------------
#
# A failed build leaves the container that is already running untouched, which
# is the rollback: the house keeps its dashboard and the failure shows up in
# Settings instead of as a dark screen.

status running "Building ${TARGET}" "$TARGET"
info "Checking out ${TARGET}"
git checkout --quiet --detach "refs/tags/${TARGET}"

info "Building and starting — this takes a minute or two"
APP_VERSION="$TARGET" docker compose up -d --build \
  || fail "Build failed — still running the previous version"

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
