# Backup e restauração

## Camadas de proteção

1. **Time Travel do D1** (recurso nativo da Cloudflare). Restaura o banco para qualquer minuto dos últimos 30 dias (7 no plano gratuito):
   ```bash
   npx wrangler d1 time-travel info atelie-jessica-db
   npx wrangler d1 time-travel restore atelie-jessica-db --timestamp=2026-11-05T10:00:00-03:00
   ```
   ⚠️ Isso sobrescreve o banco de produção. Use só com autorização e depois de conferir num ambiente isolado.
2. **Backup diário próprio**: todo dia às 03:17 de Brasília, o Worker grava `backups/AAAA-MM-DD/atelie-*.json.gz` no bucket privado `atelie-jessica-backups`. Backups mais antigos que `BACKUP_RETENCAO_DIAS` são apagados, mas o último nunca é. O administrador também pode gerar um backup em **Configurações → Backup**.
3. **Fotos**: ficam no R2, que tem durabilidade de 11 noves. O backup diário guarda os registros das fotos, não os arquivos de imagem.

## Restauração de teste (ambiente isolado)

Procedimento executado e conferido em 29/10/2026: as contagens de clientes, OS, peças e lançamentos, a soma paga, os créditos, as medidas e as 26 travas ficaram iguais às do banco original.

```bash
cd sistema
# 1. baixar o backup
npx wrangler r2 object get "atelie-jessica-backups/backups/AAAA-MM-DD/atelie-....json.gz" --remote --file /tmp/backup.json.gz
# 2. gerar o SQL de restauração
node scripts/restaurar-backup.mjs /tmp/backup.json.gz /tmp/restaurar.sql
# 3. banco isolado e vazio, só na sua máquina
npx wrangler d1 migrations apply atelie-jessica-db --local --persist-to /tmp/restauracao
npx wrangler d1 execute atelie-jessica-db --local --persist-to /tmp/restauracao --file /tmp/restaurar.sql
# 4. conferir
npx wrangler d1 execute atelie-jessica-db --local --persist-to /tmp/restauracao \
  --command "SELECT (SELECT COUNT(*) FROM clients), (SELECT COUNT(*) FROM orders), (SELECT SUM(pago) FROM vw_order_totals)"
```

Para restaurar de verdade num banco novo da Cloudflare, troque `--local --persist-to ...` por `--remote` apontando para um banco **recém-criado e vazio**. Nunca rode o script num banco que já tem dados.

O script remove temporariamente as travas que dependem da ordem dos acontecimentos (caixa aberto, saldo, estorno) e as recria no final, iguais às das migrations. Caixas fechados são carregados abertos e fechados de novo no fim.

O que **não** entra no backup: sessões de login e tentativas de login. São temporárias, e cada pessoa entra de novo.
