# Arquitetura — Ateliê Jessica

## Auditoria do repositório (antes da Fase 1)

| Item | Situação encontrada |
|---|---|
| `prototipo/index.html` | Protótipo clicável em um único arquivo HTML. Dados fixos na memória, data fixa em 29/10/2026 e nada salvo. Publicado como Worker `jessica-ateli`. |
| `docs/superpowers/specs/2026-10-29-atelie-fase1-design.md` | Especificação anterior: React + Supabase + Cloudflare Pages. |
| Backend, banco, login | Não existiam. |

O que foi reaproveitado do protótipo:
- o visual inteiro (cores, tipografia, painéis, agenda, folha A4), em `public/css/app.css`;
- o fluxo da OS, a capacidade diária com aviso de dia lotado, o caixa diário com conferência da gaveta e os estornos;
- a estrutura de navegação.

As regras foram reescritas para funcionar com dados reais. O protótipo continua intacto e publicado. O sistema novo fica em `sistema/` e é publicado em outro Worker (`jessica-ateli-sistema`), sem afetar o que já está no ar.

## Decisão: Cloudflare (Workers + D1 + R2) em vez de Supabase

| Critério | Cloudflare D1/R2 (escolhido) | Supabase |
|---|---|---|
| Infraestrutura | Já usada pelo ateliê: uma conta e um painel só | Segunda conta e segundo painel |
| Custo no volume de um ateliê | Dentro do plano gratuito ou do Workers Paid (US$ 5/mês). D1 e R2 cobram por uso, sem taxa por egresso no R2 | Plano gratuito pausa o projeto após 7 dias sem uso; plano Pro custa US$ 25/mês |
| Fotos | R2 privado, entregue só pelo Worker após login | Storage com políticas próprias |
| Regras financeiras | Travas (triggers) no SQLite, lotes atômicos (`batch`) e idempotência | Postgres, com transações completas |
| Backup | Time Travel do D1 (recuperação até um ponto no tempo) + backup diário próprio em R2 | Backup diário só no plano pago |
| Riscos | D1 não tem transação interativa, por isso as regras foram feitas com lotes atômicos, travas e "guardas" (ver abaixo). Limite de 10 GB por banco, muito acima do necessário | Dependência e custo de mais um fornecedor |

**Frontend:** JavaScript puro em módulos, sem etapa de build, reaproveitando o protótipo. React não traria ganho claro para seis telas, e manter o código próximo do protótipo reduz risco. As regras puras (`public/js/regras.js`) são o mesmo arquivo usado pelo navegador e pelo servidor, por isso cálculos e mensagens não divergem.

## Como a integridade é garantida

| Regra | Onde |
|---|---|
| Pagamento nunca acima do saldo | Trigger `cm_sem_excesso` (banco) + validação na API + aviso na tela |
| Excedente só como crédito formal | Rota de pagamento: lote atômico com o recebimento na OS, o crédito no razão `customer_credits` e uma guarda de "saldo não mudou" |
| Lançamentos imutáveis | Triggers `cm_sem_delete`/`cm_sem_update`. Correção só por estorno (`estorno_de` UNIQUE, por isso estorna uma vez só) |
| Caixa fechado não aceita lançamento | Trigger `cm_caixa_aberto` |
| Crédito nunca negativo | Trigger `cc_sem_negativo` |
| Quantidade ≥ 1 inteira (un) ou > 0 (m/cm/h) | CHECK na tabela + validação Zod + tela |
| Total da OS ≥ valor pago | "Guarda" no mesmo lote da edição |
| Edição simultânea | Coluna `versao` (concorrência otimista) |
| Clique repetido / rede repetindo | Cabeçalho `Idempotency-Key` com coluna UNIQUE em `orders` e `cash_movements` |
| Número de OS único | `MAX(numero)+1` no próprio INSERT (o D1 executa escritas em série) + UNIQUE |
| Medidas | Versões imutáveis (triggers): nova medição nunca apaga a anterior |
| Situação da OS calculada pelas peças | SQL em `src/lib/status.ts`, espelhando `derivarStatusProducao()` |

**Guardas:** a tabela `guards` tem triggers que abortam o lote inteiro quando recebe uma linha. Um `INSERT INTO guards SELECT 'motivo' WHERE <condição ruim>` dentro do `batch` funciona como um "ROLLBACK se". É assim que se valida uma condição entre tabelas no D1, que não tem transação interativa.

## Segurança

- **Login:** senha com PBKDF2-SHA256, 100 mil iterações e sal aleatório. A sessão fica num cookie `__Host-sid` HttpOnly, Secure e SameSite=Strict; o banco guarda só o hash do token.
- **Tentativas de login:** bloqueio de 15 minutos após 5 erros por e-mail ou 30 por IP. Há também limite geral de requisições por IP (binding de Rate Limiting).
- **Permissões:** verificadas no servidor em cada rota (`src/lib/permissoes.ts`). A costureira só vê as OS em que é responsável e nunca recebe valores, telefones ou pagamentos na resposta.
- **CSRF:** a origem da requisição é conferida e só se aceita JSON ou multipart.
- **Cabeçalhos:** CSP restritiva e `X-Frame-Options: DENY` (arquivo `public/_headers`).
- **Fotos:** o tipo real do arquivo é conferido pela assinatura binária; a foto é recomprimida no navegador, o que remove a localização do GPS; o bucket é privado e o acesso exige login com `Cache-Control: private`.
- **Auditoria:** `audit_logs` registra cada operação relevante, e esses registros não podem ser apagados nem alterados.
- **LGPD:** há exportação completa dos dados de uma cliente e anonimização, que apaga contato, observações e fotos e mantém os registros financeiros.
- **Segredos:** só `SETUP_TOKEN`, guardado como secret do Worker. Nenhuma credencial fica no código.

## Estrutura

```
sistema/
  migrations/0001_fundacao.sql   banco: tabelas, views, travas, dados iniciais
  src/index.ts                   Worker: rotas /api, segurança, cron de backup
  src/lib/                       login, permissões, erros, auditoria, status
  src/rotas/                     auth, usuarios, config, clientes, medidas, ordens, financeiro, fotos, painel
  src/backup.ts                  backup diário em R2 + retenção
  public/                        telas (HTML/CSS/JS), servidas como arquivos estáticos
  public/js/regras.js            regras puras usadas pelo navegador e pelo servidor
  scripts/restaurar-backup.mjs   gera o SQL de restauração a partir de um backup
  test/                          testes unitários e de integração (Vitest + Miniflare)
```
