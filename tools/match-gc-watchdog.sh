#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
QUEUE="${DOTAMATE_DATA:-$HOME/dotamate-data}/cache/steam/gc-queue"
mkdir -p "$QUEUE"
set -- "$QUEUE"/*.job
if [ ! -e "$1" ]; then
  set -- "$QUEUE"/*.processing
  [ -e "$1" ] || exit 0
fi
if [ -f "$QUEUE/worker.lock" ]; then
  PID="$(cat "$QUEUE/worker.lock")"
  if kill -0 "$PID" 2>/dev/null; then exit 0; fi
  rm -f "$QUEUE/worker.lock"
fi
cd "$ROOT"
nice -n 10 node --max-old-space-size=256 tools/match-gc-worker.js >> "$QUEUE/worker.log" 2>&1 </dev/null &
