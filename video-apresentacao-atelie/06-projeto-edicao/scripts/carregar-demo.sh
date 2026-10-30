#!/usr/bin/env bash
# Carrega os dados fictícios no servidor demo já iniciado e espalha as datas do histórico.
set -euo pipefail
DB="$1"; AQUI="$(cd "$(dirname "$0")/.." && pwd)"; SISTEMA="$AQUI/../../sistema"
TOKEN=$(grep '^SETUP_TOKEN=' "$SISTEMA/.dev.vars" | cut -d= -f2- | tr -d '"')
node "$AQUI/scripts/seed-demo.mjs" http://127.0.0.1:8791 "$TOKEN"
node "$AQUI/scripts/datar-historico.mjs" "$DB/../datar.sql"
(cd "$SISTEMA" && npx wrangler d1 execute DB --local --persist-to "$DB" --file "$DB/../datar.sql" >/dev/null)
node "$AQUI/scripts/marca-demo.mjs" http://127.0.0.1:8791
echo "Histórico datado."
