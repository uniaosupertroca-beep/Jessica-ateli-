# Sistema de Gestão do Ateliê — Fase 1 (Especificação)

**Data:** 2026-10-29
**Status:** Aguardando revisão

## 1. Objetivo

Sistema web para gestão de um ateliê de costura, acessado pelo navegador no celular e no computador. A Fase 1 entrega o núcleo de uso diário: Ordens de Serviço com impressão, Clientes, Agenda de Produção com capacidade diária, Financeiro completo e Configurações.

### Critérios de sucesso

- Criar uma OS com N itens em menos de 1 minuto, com totais calculados automaticamente.
- Imprimir ou salvar em PDF a OS em A4.
- Ver, ao escolher a data de entrega, quantas vagas restam no dia.
- Fechar o caixa do dia e ver a diferença entre o esperado e o contado.
- Saber a qualquer momento quem deve quanto (a receber) e o que vence (a pagar).

### Fora do escopo da Fase 1 (Fase 2)

Dashboard com gráficos, relatórios exportáveis, integração com WhatsApp (envio automático de mensagens) e múltiplos usuários com permissões. O modelo de dados já fica preparado para esses itens.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Acesso | Web, responsivo (celular e computador) |
| Usuários | Uma conta só (login e senha); cadastro público desligado |
| Frontend | React + TypeScript + Vite + Tailwind CSS |
| Backend/Banco | Supabase (PostgreSQL, Auth, RLS) |
| Hospedagem | Cloudflare Pages, deploy automático a partir do GitHub |
| Código | GitHub, repositório `Jessica-ateli-` |
| Idioma e moeda | Português (pt-BR), R$ |
| Capacidade da agenda | Conta OS não canceladas por **data de entrega**; padrão 6/dia, configurável |
| Dia lotado | **Avisa e pede confirmação**, não bloqueia |
| Preço do item | Vem da tabela de preço escolhida na OS; editável no item |
| Pagamento | Uma OS aceita vários pagamentos (sinal + restante) |
| Valores monetários | Armazenados como inteiros em **centavos** |
| Lançamentos financeiros | Nunca apagados; correção por **estorno** |

## 3. Modelo de dados

Todas as tabelas têm `id uuid` (PK), `created_at timestamptz` e `created_by uuid` (referência a `auth.users`, preparação para multiusuário). Valores monetários são `bigint` em centavos.

### 3.1 Configurações

- **`atelie_config`** (linha única): `nome`, `telefone`, `endereco`, `documento` (CPF/CNPJ, opcional), `logo_url`, `capacidade_diaria int default 6`, `limite_quase_cheio int default 5`, `texto_rodape_os` (termos impressos na OS).
- **`categorias`**: `nome` (único), `ativo bool`.
- **`servicos`**: `categoria_id` → categorias, `nome`, `ativo bool`. Único por (categoria, nome).
- **`tabelas_preco`**: `nome` (único), `padrao bool` (exatamente uma marcada como padrão), `ativo bool`.
- **`precos`**: `tabela_preco_id`, `servico_id`, `valor_centavos`. Único por (tabela, serviço).
- **`formas_pagamento`**: `nome` (único), `ativo bool`, `eh_dinheiro bool` (usada no fechamento de caixa). Inicial: Dinheiro (eh_dinheiro), Pix, Débito, Crédito.
- **`categorias_financeiras`**: `nome`, `tipo` (`entrada` | `saida`), `ativo bool`. Iniciais — entrada: Serviços, Venda de produtos, Outras entradas; saída: Material/Aviamentos, Aluguel, Contas (luz/água/internet), Manutenção, Pró-labore, Impostos, Outras saídas.

Itens de configuração são **desativados**, nunca apagados, quando já usados em registros.

### 3.2 Clientes

- **`clientes`**: `nome` (obrigatório), `telefone` (só dígitos, opcional), `observacoes`, `ativo bool`.
- Histórico da cliente = consulta às `ordens_servico` por `cliente_id`.

### 3.3 Ordens de Serviço

- **`ordens_servico`**:
  - `numero int` único, gerado por sequence do banco.
  - `cliente_id` (obrigatório).
  - `data_entrada date` (padrão hoje), `data_entrega date` (obrigatória, ≥ data_entrada).
  - `tabela_preco_id`.
  - `status`: `aberta` | `em_producao` | `pronta` | `entregue` | `cancelada`.
  - `desconto_centavos bigint default 0` (≥ 0 e ≤ soma dos itens).
  - `observacoes`.
  - `entregue_em timestamptz`, `cancelada_em timestamptz`, `motivo_cancelamento`.
- **`itens_os`**: `os_id`, `ordem int` (posição na lista), `peca text` (ex.: "Vestido azul"), `servico_id` (opcional; permite item livre), `descricao`, `quantidade int ≥ 1`, `valor_unitario_centavos bigint ≥ 0`, `subtotal_centavos` (coluna gerada = quantidade × valor_unitario).
- **View `vw_os_totais`**: por OS — `soma_itens`, `total = soma_itens − desconto`, `pago = soma(lançamentos de entrada ligados à OS, líquidos de estornos)`, `saldo = total − pago`.

**Regras de status:**
- Transições permitidas: aberta → em_producao → pronta → entregue; qualquer status exceto entregue → cancelada; retroceder um passo é permitido (correção de engano).
- Cancelar exige motivo e só é permitido com `pago = 0`; se houver pagamentos, a tela orienta estorná-los antes (o sistema não estorna sozinho).
- OS entregue com saldo > 0 é permitida, mas exige confirmação e continua em "A receber".

### 3.4 Agenda (sem tabela própria)

- **View `vw_ocupacao_dia`**: `data_entrega`, `qtd_os` (OS com status ≠ cancelada), `capacidade` (de `atelie_config`), `situacao` = `livre` (< limite_quase_cheio), `quase_cheio` (≥ limite_quase_cheio e < capacidade), `lotado` (≥ capacidade).
- Ao salvar uma OS em dia lotado, o frontend pede confirmação explícita.

### 3.5 Financeiro

- **`caixas`** (um por dia): `data date` única, `saldo_inicial_centavos` (troco em dinheiro), `aberto_em`, `fechado_em`, `reaberto_em`, `valor_contado_centavos` (dinheiro contado no fechamento), `observacoes`.
- **`lancamentos`**:
  - `tipo`: `entrada` | `saida`.
  - `data date`, `valor_centavos bigint > 0`.
  - `forma_pagamento_id`, `categoria_financeira_id` (tipo compatível).
  - `descricao`.
  - `os_id` (opcional; entrada de pagamento de OS), `conta_pagar_id` (opcional; saída de pagamento de conta).
  - `estorno_de_id` (opcional; lançamento que este estorna). Um lançamento só pode ser estornado uma vez; o estorno tem tipo oposto e o mesmo valor.
- **`contas_pagar`**: `descricao`, `categoria_financeira_id` (saída), `valor_centavos`, `vencimento date`, `status` (`aberta` | `paga` | `cancelada`), `paga_em date`. Pagar uma conta cria um lançamento de saída no caixa do dia.
- **View `vw_caixa_dia`**: por data — saldo inicial, entradas e saídas totais e por forma de pagamento, `dinheiro_esperado = saldo_inicial + entradas_dinheiro − saidas_dinheiro`, `diferenca = valor_contado − dinheiro_esperado`.
- **View `vw_contas_receber`**: OS não canceladas com saldo > 0, com cliente, total, pago, saldo, data_entrega, status.

**Regras do caixa:**
- Lançamentos só podem ser criados em data com caixa **aberto**. Se não houver caixa aberto hoje, a tela oferece abrir (pedindo o troco inicial).
- Caixa **fechado** não aceita novos lançamentos nem alterações (garantido por trigger). Reabrir exige confirmação e fica registrado (`reaberto_em`).
- Lançamentos não podem ser apagados nem editados em valor/tipo (trigger); correção é por estorno. Descrição pode ser editada.

## 4. Telas

Navegação: barra lateral (desktop) / menu inferior (celular). Itens: Início, OS, Agenda, Clientes, Financeiro, Configurações.

1. **Login** — e-mail e senha. Rotas internas exigem sessão.
2. **Início** — entregas de hoje e amanhã; OS prontas aguardando retirada; OS atrasadas (data_entrega < hoje e status não entregue/cancelada); caixa do dia (aberto/fechado e saldo); contas a pagar vencidas ou a vencer em 7 dias.
3. **OS — lista** — busca por número ou nome da cliente; filtros por status e período; colunas: número, cliente, entrega, status, total, saldo.
4. **OS — formulário** — cliente (busca + cadastro rápido em modal); datas, com mini-calendário de ocupação na data de entrega; tabela de preço; itens ilimitados (adicionar, remover, reordenar), preço preenchido pela tabela e editável; desconto; observações; totais em tempo real; botão "Registrar pagamento" (valor sugerido = saldo; forma de pagamento); botões de status; botão Imprimir.
5. **OS — impressão** — rota dedicada com CSS de impressão A4: cabeçalho do ateliê (logo, nome, telefone, endereço, documento), número e datas, dados da cliente, tabela de itens, totais, pagamentos realizados, saldo, observações, texto de rodapé e linha de assinatura.
6. **Agenda** — calendário mensal com ocupação por dia (ex.: 5/6) em verde/amarelo/vermelho; clique no dia abre a lista de OS daquele dia; visão semanal com as OS por dia.
7. **Clientes** — lista com busca por nome/telefone; ficha com dados, observações, histórico de OS, total gasto, saldo em aberto e link `wa.me` no telefone.
8. **Financeiro** — abas: Caixa do dia (abrir, lançar entrada/saída, fechar com valor contado e diferença); Lançamentos (filtros por período, tipo, categoria, forma; estornar); A receber; A pagar (cadastrar, pagar, cancelar; destaque para vencidas); Resumo do período (dia/semana/mês: entradas, saídas, saldo e totais por categoria).
9. **Configurações** — dados do ateliê e capacidade; categorias e serviços; tabelas de preço (grade serviço × preço); categorias financeiras; formas de pagamento.

## 5. Arquitetura

```
src/
  app/              rotas, layout, proteção de rota
  lib/              cliente Supabase, formatação (R$, datas), utilitários
  modules/
    os/             telas, api.ts (acesso ao banco), regras.ts (cálculos puros)
    clientes/
    agenda/
    financeiro/
    configuracoes/
  components/       componentes visuais compartilhados
supabase/
  migrations/       SQL versionado (tabelas, views, triggers, RLS, seeds)
```

- **Regras críticas no banco:** sequence do número da OS, coluna gerada do subtotal, views de totais/ocupação/caixa, triggers de imutabilidade dos lançamentos e de caixa fechado, constraints de valores.
- **Regras puras no frontend** (`regras.ts`): cálculo de totais em tempo real e situação do dia, espelhando o banco, cobertas por testes.
- **Acesso a dados:** cada módulo expõe funções em `api.ts`; telas não chamam o Supabase diretamente.
- **Estado de servidor:** TanStack Query (cache, recarregamento, estados de carregando/erro).
- **Formulários:** React Hook Form + Zod para validação.

## 6. Segurança

- RLS habilitado em **todas** as tabelas; políticas permitem acesso apenas a `authenticated`.
- Cadastro público desabilitado no Supabase Auth; a conta do ateliê é criada manualmente.
- Apenas a chave pública (anon) vai para o frontend, via variáveis de ambiente da Cloudflare; a chave `service_role` nunca entra no código.
- Logo armazenado no Supabase Storage em bucket `publico` de leitura pública e escrita apenas autenticada; nenhum outro arquivo vai para esse bucket.

## 7. Tratamento de erros e UX

- Mensagens em português e acionáveis ("Sem conexão. Tente novamente.", "Este caixa está fechado.").
- Erros de constraint/trigger do banco traduzidos para mensagens amigáveis.
- Confirmação antes de: cancelar OS, entregar OS com saldo, fechar/reabrir caixa, estornar lançamento, salvar OS em dia lotado.
- Estados de carregando e vazio em todas as listas.

## 8. Testes

- **Unitários (Vitest):** `regras.ts` de OS (totais, desconto, saldo), agenda (situação do dia) e financeiro (dinheiro esperado, diferença).
- **Banco:** testes SQL (pgTAP ou script de verificação) para triggers de imutabilidade, caixa fechado, transições de status e views.
- **CI (GitHub Actions):** lint, typecheck e testes a cada push; a Cloudflare só publica a partir do branch principal.

## 9. Publicação

- Cloudflare Pages conectado ao GitHub; build `npm run build`, saída `dist/`, com fallback de SPA.
- Migrações aplicadas ao projeto Supabase via Supabase CLI/MCP; todas versionadas em `supabase/migrations/`.

## 10. Preparação para a Fase 2

- `created_by` em todas as tabelas permite multiusuário e auditoria.
- Views financeiras e de OS servem de base para dashboard e relatórios.
- Telefone normalizado (só dígitos) permite integração com WhatsApp; Edge Functions do Supabase serão o ponto de integração.
