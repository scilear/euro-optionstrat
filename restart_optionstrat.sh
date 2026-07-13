#!/bin/bash
# Restart script for euro_optionstrat backend
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${EU_OPTIONSTRAT_PORT:-8765}"
HOST="${EU_OPTIONSTRAT_HOST:-0.0.0.0}"
LOG_FILE="$SCRIPT_DIR/optionstrat_server.log"

get_port_pids() {
    if command -v lsof >/dev/null 2>&1; then
        lsof -ti "tcp:$PORT" || true
    else
        :
    fi
}

PIDS="$(get_port_pids)"
if [ -n "$PIDS" ]; then
    echo "Killing existing euro_optionstrat server on port $PORT (PID(s): $PIDS)..."
    kill $PIDS || true
    sleep 1
fi

echo "Starting new euro_optionstrat server..."
nohup python3 -u server.py --host "$HOST" --port "$PORT" > "$LOG_FILE" 2>&1 &

for _ in 1 2 3 4 5; do
    sleep 1
    if curl -fsS "http://$HOST:$PORT/api/indices" >/dev/null 2>&1; then
        echo "Euro OptionStrat running at: http://$HOST:$PORT"
        echo "Log: $LOG_FILE"
        exit 0
    fi
done

echo "Server did not become healthy. Check log: $LOG_FILE"
exit 1
