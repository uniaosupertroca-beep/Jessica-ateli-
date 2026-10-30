#!/usr/bin/env bash
# Recria do zero o banco LOCAL de demonstração (isolado) e carrega os dados fictícios.
# Uso: scripts/preparar-demo.sh <pasta-do-banco-demo>   (o servidor demo deve ser (re)iniciado depois de apagar o banco)
set -euo pipefail
DB="$1"; AQUI="$(cd "$(dirname "$0")/.." && pwd)"; SISTEMA="$AQUI/../../sistema"
rm -rf "$DB" && mkdir -p "$DB"
(cd "$SISTEMA" && npx wrangler d1 migrations apply DB --local --persist-to "$DB" >/dev/null)
echo "Banco criado. Inicie o servidor demo:  (cd sistema && npx wrangler dev --port 8791 --persist-to $DB)"
