#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PORT="${PORT:-8100}"
if [ ! -x "$CHROME" ]; then echo "未找到 Chrome" >&2; exit 1; fi

rm -rf .chrome-profile
PORT="$PORT" node server.js >/tmp/caizhi-cloud-server.log 2>&1 &
SERVER_PID=$!
"$CHROME" --headless=new --no-sandbox --disable-gpu --no-first-run --no-default-browser-check \
  --remote-debugging-port=9333 --user-data-dir="$PWD/.chrome-profile" about:blank \
  >/tmp/caizhi-cloud-chrome.log 2>&1 &
CHROME_PID=$!
trap 'kill "$CHROME_PID" "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  sleep 0.25
  if curl -s --max-time 1 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 &&
     curl -s --max-time 1 http://127.0.0.1:9333/json/version >/dev/null 2>&1; then break; fi
done

APP_URL="http://127.0.0.1:${PORT}/" node tools/screenshot.js
