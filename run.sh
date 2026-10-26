#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -d node_modules ]]; then
  echo "Installing npm dependencies (one-time)..."
  npm install
fi

# node-pty ships a spawn-helper that needs the exec bit; npm's postinstall
# usually sets it (see package.json), but restore it defensively so spawns
# never fail with "posix_spawnp failed".
for h in node_modules/node-pty/prebuilds/*/spawn-helper; do
  [[ -f "$h" ]] && chmod +x "$h"
done

if [[ ! -d ./vendir/demo-magic ]]; then
  echo "Fetching demo-magic via vendir..."
  vendir sync
fi

PORT="${PORT:-4173}"

echo "Starting the executive deck on http://localhost:${PORT}"
node server.js &

SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

sleep 1
# Open the deck cross-platform: DEMO_OPEN_CMD wins (also used by the server's
# /api/open), then macOS open, then Linux xdg-open.
if [[ -n "${DEMO_OPEN_CMD:-}" ]]; then
  "$DEMO_OPEN_CMD" "http://localhost:${PORT}" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then
  open "http://localhost:${PORT}"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:${PORT}" >/dev/null 2>&1 || true
fi

wait $SERVER_PID
