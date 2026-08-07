#!/usr/bin/env bash
#
# Set up Hearth on a machine that will run it.
#
#   curl -fsSL https://raw.githubusercontent.com/johndelong/hearth/main/scripts/install.sh | bash
#
# Or, having cloned the repo, ./scripts/install.sh — same result.
#
# Downloads the four files a host needs into ~/hearth and writes a starter .env.
# There is no checkout and nothing to build: releases are published as container
# images, so the host only ever pulls. Docker and curl are the requirements.
#
#   HEARTH_DIR=/opt/hearth ./install.sh   # somewhere else
#   HEARTH_REF=v0.3.0 ./install.sh        # a specific release's copy of the files

set -euo pipefail

HEARTH_DIR="${HEARTH_DIR:-$HOME/hearth}"
REPO="${HEARTH_REPO:-johndelong/hearth}"
REF="${HEARTH_REF:-main}"
RAW="https://raw.githubusercontent.com/${REPO}/${REF}"

info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[31m==>\033[0m %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null || fail "curl not found"
command -v docker >/dev/null || fail "docker not found — install Docker Desktop first"

mkdir -p "$HEARTH_DIR/scripts/updater"

info "Downloading into $HEARTH_DIR"
for file in \
  docker-compose.yml \
  .env.example \
  scripts/update.sh \
  scripts/install-updater.sh \
  scripts/updater/com.hearth.updater.plist
do
  curl -fsSL "${RAW}/${file}" -o "${HEARTH_DIR}/${file}" \
    || fail "Could not download ${file} from ${REPO}@${REF}"
done
chmod +x "$HEARTH_DIR/scripts/update.sh" "$HEARTH_DIR/scripts/install-updater.sh"

# Never clobber a working configuration — this script is safe to re-run.
if [ -f "$HEARTH_DIR/.env" ]; then
  info "Keeping the .env that is already here"
else
  info "Writing $HEARTH_DIR/.env"
  # One less thing to invent by hand, and a bad secret here weakens the parent
  # session cookie for the life of the install.
  secret="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 64)"
  sed "s|^COOKIE_SECRET=.*|COOKIE_SECRET=${secret}|" "$HEARTH_DIR/.env.example" > "$HEARTH_DIR/.env"
fi

cat <<NEXT

Set up in ${HEARTH_DIR}. Two things left:

  1. Edit ${HEARTH_DIR}/.env — set TZ, and the Google credentials if you want
     the calendar. It runs without them; Settings will explain what is missing.

  2. Start it:

       cd ${HEARTH_DIR} && ./scripts/update.sh

Then, to update from the dashboard instead of a terminal:

       ./scripts/install-updater.sh

NEXT
