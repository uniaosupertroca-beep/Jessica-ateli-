#!/usr/bin/env bash
# Volta o banco demo à cópia "base" (antes das gravações criarem a OS do vídeo) e reinicia o servidor demo.
set -uo pipefail
DB="$1"; LOG="$2"; AQUI="$(cd "$(dirname "$0")/.." && pwd)"
pkill -f "wrangler dev --port 8791" 2>/dev/null; sleep 2
rm -rf "$DB" && cp -r "$DB-base" "$DB"
(cd "$AQUI/../../sistema" && nohup npx wrangler dev --port 8791 --ip 127.0.0.1 --persist-to "$DB" > "$LOG" 2>&1 &)
for i in $(seq 1 60); do curl -s 127.0.0.1:8791/api/auth/estado >/dev/null && break; sleep 1; done
echo "demo restaurada"
