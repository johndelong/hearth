#!/usr/bin/env bash
#
# Let the dashboard update itself.
#
#   ./scripts/install-updater.sh              # install and start the agent
#   ./scripts/install-updater.sh --uninstall  # remove it
#
# Installs a launchd user agent that watches this repo's control directory and
# runs scripts/update.sh when the dashboard drops an update request there. The
# agent is what makes the Update button appear in Settings; without it the
# dashboard still notices new releases, it just links to them.
#
# macOS only — launchd is the mechanism. On Linux the same two files (a request
# in, a status out) work with a systemd path unit; nothing else changes.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTROL_DIR="${HEARTH_CONTROL_DIR:-$REPO_DIR/.hearth-control}"
LABEL="com.hearth.updater"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"

info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[31m==>\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname)" = "Darwin" ] || fail "This installs a launchd agent, which is macOS only."

# --- uninstall ----------------------------------------------------------------

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST" "$CONTROL_DIR/agent.json"
  info "Removed the update agent. The dashboard will stop offering the button."
  exit 0
fi

[[ -z "${1:-}" ]] || fail "Unknown option: $1. Use --uninstall to remove the agent."

# --- install ------------------------------------------------------------------

command -v docker >/dev/null || fail "docker not found — install Docker Desktop first."

mkdir -p "$CONTROL_DIR" "$HOME/Library/LaunchAgents"
# The container writes here as its own user, which is not this one. The
# directory holds a release tag and a status line — nothing worth guarding.
chmod 777 "$CONTROL_DIR"

# A launchd agent inherits almost no environment, so the PATH that finds docker
# and git here is the PATH it has to be told about.
AGENT_PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
DOCKER_DIR="$(dirname "$(command -v docker)")"
case ":$AGENT_PATH:" in *":$DOCKER_DIR:"*) ;; *) AGENT_PATH="$DOCKER_DIR:$AGENT_PATH" ;; esac

info "Writing $PLIST"
sed -e "s|__REPO_DIR__|$REPO_DIR|g" \
    -e "s|__CONTROL_DIR__|$CONTROL_DIR|g" \
    -e "s|__PATH__|$AGENT_PATH|g" \
    "$REPO_DIR/scripts/updater/${LABEL}.plist" > "$PLIST"

# bootout first so re-running this picks up a moved repo or a changed PATH.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST" || fail "launchctl refused to load $PLIST"

# This file is the handshake: the dashboard shows an Update button when it can
# see it, and nothing else in the app knows or cares how the update happens.
cat > "$CONTROL_DIR/agent.json" <<JSON
{
  "label": "${LABEL}",
  "repoDir": "${REPO_DIR}",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

info "Update agent installed."
info "Settings › Display › This dashboard will now offer Update when a release is out."
info "Its log: ${CONTROL_DIR}/update.log"
