# Implantação na Cloudflare

> Nada foi publicado. Os passos abaixo devem ser feitos por quem administra a conta, primeiro em **homologação**. Produção só com autorização.

O sistema usa nomes próprios (`jessica-ateli-sistema`, `atelie-jessica-db`, `atelie-jessica-fotos`, `atelie-jessica-backups`). Ele não altera o protótipo `jessica-ateli` nem nenhum outro projeto da conta.

## Situação em 29/10/2026 (homologação)
- Recursos **criados**: D1 `atelie-jessica-db-homologacao` (id `6e366e1e-…`, já com a migration 0001 aplicada e registrada), R2 `atelie-jessica-fotos-homologacao` e `atelie-jessica-backups-homologacao`.
- A conta da administradora foi criada direto no banco, porque o segredo `SETUP_TOKEN` não pôde ser definido. Troque a senha temporária no primeiro acesso, em **Ajustes → Minha conta**.
- **Falta:** conectar o Worker `jessica-ateli-homologacao` ao GitHub no painel (Workers & Pages → Create → Import a repository):
  - Root directory: `sistema`
  - Deploy command: `npx wrangler deploy --env homologacao`
  - Branch: `claude/atelie-fase1`
- Produção ainda não foi criada.

## 1. Pré-requisitos
- Node.js 20 ou superior.
- `cd sistema && npm install` (se der erro de dependências, use `npm install --legacy-peer-deps`).
- `npx wrangler login`.

## 2. Criar os recursos (uma vez por ambiente)

```bash
# Homologação
npx wrangler d1 create atelie-jessica-db-homologacao
npx wrangler r2 bucket create atelie-jessica-fotos-homologacao
npx wrangler r2 bucket create atelie-jessica-backups-homologacao

# Produção (somente com autorização)
npx wrangler d1 create atelie-jessica-db
npx wrangler r2 bucket create atelie-jessica-fotos
npx wrangler r2 bucket create atelie-jessica-backups
```

Copie o `database_id` que cada `d1 create` mostrar para o lugar certo no `wrangler.jsonc`: o bloco `env.homologacao` para homologação e o bloco principal para produção.

Os buckets R2 são privados por padrão. **Não** ative "Public access" em nenhum deles.

## 3. Segredo do primeiro acesso

```bash
npx wrangler secret put SETUP_TOKEN --env homologacao   # um código longo e aleatório (16 ou mais caracteres)
npx wrangler secret put SETUP_TOKEN                     # produção
```

Depois que a conta da administradora for criada, a rota de configuração inicial para de funcionar sozinha. O segredo pode ser apagado com `wrangler secret delete SETUP_TOKEN`.

## 4. Banco e publicação

```bash
npm run check                                             # tipos + 45 testes
npx wrangler d1 migrations apply atelie-jessica-db-homologacao --remote --env homologacao
npx wrangler deploy --env homologacao
```

Abra `https://jessica-ateli-homologacao.<subdominio>.workers.dev`, informe o `SETUP_TOKEN` e crie a conta da administradora. Depois siga o roteiro de homologação em `FASE-1-ENTREGA.md`.

Produção, após autorização:

```bash
npx wrangler d1 migrations apply atelie-jessica-db --remote
npx wrangler deploy
```

## 5. Variáveis e bindings

| Nome | Tipo | Uso |
|---|---|---|
| `DB` | D1 | banco |
| `FOTOS` | R2 | fotos das peças (privado) |
| `BACKUPS` | R2 | backups diários (privado) |
| `LIMITE_API` | Rate Limiting | 600 requisições por minuto por IP |
| `AMBIENTE` | var | `producao` / `homologacao` |
| `BACKUP_RETENCAO_DIAS` | var | 30 (produção) / 7 (homologação) |
| `SETUP_TOKEN` | secret | só para criar a primeira administradora |

## 6. Desenvolvimento local

```bash
echo 'SETUP_TOKEN="token-local-de-desenvolvimento"' > .dev.vars
npm run db:migrate:local
npm run dev        # http://localhost:8787
```

Os dados locais ficam em `.wrangler/`, separados de produção.

## 7. Trocar o protótipo pelo sistema (quando aprovado)

Opção recomendada: manter o protótipo em `jessica-ateli` como demonstração e divulgar o novo endereço. Para usar o mesmo endereço `jessica-ateli.<subdominio>.workers.dev`, troque `"name"` em `sistema/wrangler.jsonc` para `jessica-ateli` e desligue o build automático do protótipo no painel. Faça isso só com autorização.
