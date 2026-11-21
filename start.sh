#!/usr/bin/env bash
# Serve Wildlife Eye locally and open it in the browser.
cd "$(dirname "$0")"
PORT="${PORT:-8642}"
URL="http://localhost:$PORT/"
( sleep 1; xdg-open "$URL" >/dev/null 2>&1 ) &
echo "Wildlife Eye running at $URL  (Ctrl+C to stop)"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
