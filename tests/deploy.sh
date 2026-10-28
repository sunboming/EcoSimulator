#!/usr/bin/env bash
# Isolated deployment control-flow checks; no real service/root/system directories used.
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../deploy" && pwd)/wildhaven.sh"
TEST_DIR=$(mktemp -d)
trap 'rm -rf -- "$TEST_DIR"' EXIT
BASE="$TEST_DIR/wildhaven"
DEPLOY_CONFIG="$TEST_DIR/target.conf"
mkdir -p "$BASE/releases/old" "$BASE/releases/new"
REPO_URL=https://github.com/example/eco.git
REF='release/demo'
validate_target
save_target
REPO_URL=''; REF=''; source "$DEPLOY_CONFIG"
[[ $REPO_URL == https://github.com/example/eco.git && $REF == release/demo ]]
if (REPO_URL=https://user:secret@example.com/eco.git; validate_target) 2>/dev/null; then exit 1; fi
if (REF=--upload-pack=bad; validate_target) 2>/dev/null; then exit 1; fi
if [[ ${1:-} == --portable ]]; then
  printf '%s\n' 'Portable deployment checks passed: config round trip and unsafe repository/ref rejection. Symlink/systemd checks require Linux.'
  exit 0
fi
ln -s "$BASE/releases/old" "$BASE/app"

CALLS="$TEST_DIR/calls"
systemctl() { printf '%s\n' "$*" >> "$CALLS"; }
backup() { printf 'backup %s\n' "$1" >> "$CALLS"; }
health() { return 0; }
activate "$BASE/releases/new"
[[ $(readlink -f "$BASE/app") == "$(readlink -f "$BASE/releases/new")" ]]
[[ $(readlink -f "$BASE/previous") == "$(readlink -f "$BASE/releases/old")" ]]
[[ $(sed -n '1p' "$CALLS") == 'stop wildhaven' ]]
[[ $(sed -n '2p' "$CALLS") == "backup $BASE/releases/old" ]]

# Failure restores the current good app, and keeps the earlier rollback target intact.
mkdir -p "$BASE/releases/bad"
health() { return 1; }
if (activate "$BASE/releases/bad") 2>/dev/null; then exit 1; fi
[[ $(readlink -f "$BASE/app") == "$(readlink -f "$BASE/releases/new")" ]]
[[ $(readlink -f "$BASE/previous") == "$(readlink -f "$BASE/releases/old")" ]]

# A failed backup cancels activation and restarts the old service.
backup() { return 1; }
if (activate "$BASE/releases/bad") 2>/dev/null; then exit 1; fi
[[ $(readlink -f "$BASE/app") == "$(readlink -f "$BASE/releases/new")" ]]
[[ $(tail -n 1 "$CALLS") == 'start wildhaven' ]]
printf '%s\n' 'Deployment checks passed: config round trip, unsafe targets rejected, backup-before-switch, successful activation, failed health and backup recovery.'
