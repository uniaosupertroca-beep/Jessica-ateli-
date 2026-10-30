#!/usr/bin/env bash
# Recria o banco demo, sobe o servidor demo (porta 8791) em segundo plano e carrega os dados. Uso: scripts/demo-do-zero.sh <pasta-banco> <log>
set -uo pipefail
DB="$1"; LOG="$2"; AQUI="$(cd "$(dirname "$0")/.." && pwd)"
pkill -f "wrangler dev --port 8791" 2>/dev/null; sleep 2
"$AQUI/scripts/preparar-demo.sh" "$DB" >/dev/null
(cd "$AQUI/../../sistema" && nohup npx wrangler dev --port 8791 --ip 127.0.0.1 --persist-to "$DB" > "$LOG" 2>&1 &)
for i in $(seq 1 60); do curl -s 127.0.0.1:8791/api/auth/estado >/dev/null && break; sleep 1; done
"$AQUI/scripts/carregar-demo.sh" "$DB"
