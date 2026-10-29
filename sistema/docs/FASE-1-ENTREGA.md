# Fase 1 — Correções e fundação: relatório de entrega

Data: 29/10/2026. Situação: **pronta para homologação**. Nada foi publicado e nenhum commit ou push foi feito.

## 1. Os 6 erros do protótipo

| # | Erro | Correção | Prova |
|---|---|---|---|
| 1 | Pagamento acima do saldo | Bloqueado na tela, na API e no banco (trigger). O excedente só entra se a pessoa marcar "guardar como crédito da cliente": vira crédito formal (`customer_credits`), aparece no caixa, na ficha e em "A receber → Créditos", pode pagar outra OS e pode ser devolvido. Estornos atualizam todos os saldos | Teste 2 (API + banco) e teste no navegador |
| 2 | Quantidade zero | Vazio, zero, negativo e fração em "unidade" são recusados na tela, na API (Zod) e no banco (CHECK). Metro, cm e hora aceitam decimal positivo | Teste 3 + unitários |
| 3 | Data fixa | Sem data fixa no código. "Hoje" vem do fuso America/Sao_Paulo no servidor e no navegador, e a tela se atualiza na virada do dia | Unitários (23h30 em São Paulo = mesmo dia) |
| 4 | WhatsApp sem telefone | Telefone validado e normalizado (DDD, 9º dígito, +55, 0). Sem número válido o botão fica desativado com explicação, e o link nunca é gerado | Unitários + teste no navegador |
| 5 | Cadastro sem ano | "Cliente desde DD/MM/AAAA", calculado pela data real de cadastro | Telas de lista e ficha |
| 6 | Menu do celular | 4 atalhos + "Mais" (folha com o restante e Sair). Botões com 54 px de altura, texto de 12,5 px e sem rolagem lateral em 375 px | Medido com Playwright em 375×812 |

## 2. Funcionalidades entregues (todas gravadas no banco)

- **Login e equipe:** primeiro acesso protegido por código, perfis administrador, atendente e costureira, troca de senha, desativação de acesso e bloqueio por tentativas.
- **Clientes:** cadastro completo (telefone, WhatsApp, e-mail, nascimento, endereço, preferências, observações) e busca sem acento por nome ou telefone. Possíveis duplicidades são avisadas, com opção de usar a cliente existente. A ficha reúne histórico de OS, pagamentos, crédito, fotos e mensagens. Há exportação JSON e exclusão de dados pessoais (LGPD).
- **Medidas:** fichas gerais ou por encomenda, com 14 campos padrão em cm e campos personalizados. Cada medição é uma versão nova (as antigas nunca mudam), com data, quem mediu e observações de caimento. A comparação entre medições destaca as diferenças, e a ficha pode ser impressa.
- **Catálogo de serviços:** começa **sem preços**, e o administrador define preço, unidade, tempo estimado e custo de mão de obra.
- **Ordens de serviço:**
  - várias peças por OS, cada uma com código próprio (ex.: 142-2), vários serviços, prazo e costureira responsável;
  - totais em tempo real e desconto;
  - fluxo Recebida → Aguardando aprovação → Aprovada → Em produção → Aguardando prova → Ajustes finais → Pronta → Entregue, além de Pausada e Cancelada;
  - a partir da aprovação, a situação é **calculada pelas peças**; há histórico e auditoria de cada mudança;
  - edição simultânea é detectada;
  - a impressão em A4/PDF serve de comprovante de recebimento.
- **Pagamentos:** sinal, parciais e quitação, com crédito da cliente como forma de pagamento. O estorno é auditável e não se repete. Uma OS com pagamento não pode ser cancelada, e a entrega com saldo pede confirmação.
- **Caixa:** abertura com troco, entradas e saídas avulsas, sangria, fechamento com conferência da gaveta (diferença) e reabertura só pelo administrador, com motivo registrado. Há lista de lançamentos por período e "A receber".
- **WhatsApp:** botão "Avisar que está pronta" e outros 6 modelos, sempre com os dados reais da OS (exemplo: *"Olá, Mariana! Sua calça referente à OS nº 0142 está pronta para retirada no Ateliê Jessica. O saldo pendente é de R$ 25,00. Aguardamos você!"*). O texto pode ser revisado antes de abrir o aplicativo. O sistema registra "WhatsApp aberto", nunca "enviada".
- **Fotos:** tiradas pelo celular ou escolhidas da galeria, nas categorias entrada, defeito, referência, durante e concluída, por peça ou para a OS inteira. São reduzidas para até 2000 px sem perder detalhe de costura, sem localização do GPS, guardadas no R2 privado e exibidas só com login. A exclusão é restrita ao administrador.
- **Início e agenda:** números reais do dia (entregas, prontas, em produção, aguardando prova, atrasadas, caixa, a receber, recebido no mês). Agenda mensal e semanal com ocupação por dia e aviso de dia lotado.
- **Backup:** automático todo dia, com retenção definida. A restauração foi **testada** num ambiente isolado.

## 3. Arquivos

Tudo está em `sistema/`; o protótipo e a pasta `docs/` da raiz não foram alterados. Migration: `migrations/0001_fundacao.sql` (26 travas, 2 views e dados iniciais). Detalhes em `docs/ARQUITETURA.md`.

## 4. Testes executados

| Conjunto | Resultado |
|---|---|
| `npm run check` (tipos + Vitest/Miniflare, banco D1 e R2 reais em memória) | **45 de 45 passaram** |
| Navegador (Playwright, Chromium): primeiro acesso → preço → OS com 2 peças e cliente nova → quantidade 0 recusada → WhatsApp → R$ 250 numa OS de R$ 65 bloqueado → crédito → abrir caixa → aprovar → produção → pronta → foto → entrega → impressão → medidas com comparação → caixa → cliente sem telefone | **11 de 11 fluxos ok**, sem erros de JavaScript |
| Celular 375×812 | Sem rolagem lateral; menu com botões de 54 px |
| Restauração de backup | Contagens e somas idênticas ao original |

Testes do roteiro (seção 22) cobertos nesta fase: 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 15 (parcial: uma largura) e 16. O 17 (backup) foi feito manualmente.
Ficam para as próximas fases: 8 (provas na agenda), 9 (estoque), 13 (QR Code) e 14 (PWA).

## 5. Critérios de aceitação (seção 24)

| # | Critério | Situação |
|---|---|---|
| 1 | Dados salvos no banco | ✅ |
| 2 | Telas principais funcionais | ✅ (Início, OS, Agenda, Clientes, Financeiro, Configurações) |
| 3 | Cliente com várias OS | ✅ |
| 4 | OS com várias peças | ✅ |
| 5 | Fotos e medidas persistentes | ✅ |
| 6 | Fluxo de produção | ⚠️ Parcial: status por peça e cálculo da OS funcionam. Falta o quadro Kanban (Fase 2) |
| 7 | Agenda com provas e capacidade por horas | ⏳ Fase 2. Hoje a capacidade é por quantidade de entregas |
| 8 | Pagamentos e estornos consistentes | ✅ |
| 9 | Estoque integrado | ⏳ Fase 3 |
| 10 | Etiquetas por peça | ⚠️ Parcial: o código único por peça já existe. Etiqueta impressa e QR Code são da Fase 2 |
| 11 | WhatsApp com mensagens corretas | ✅ |
| 12 | Dashboard com dados reais | ⚠️ Parcial: números reais. Gráficos ficam para a Fase 4 |
| 13 | Relatórios | ⏳ Fase 3/4 |
| 14 | Login e permissões | ✅ (testado no servidor) |
| 15 | Uso no celular | ✅ |
| 16 | PWA instalável | ⏳ Fase 4 |
| 17 | Backup restaurável | ✅ |
| 18 | Testes essenciais | ✅ para o escopo da Fase 1 |
| 19 | Nenhum botão principal sem função | ✅. Telas ainda não construídas não aparecem como botões; há aviso de "fase 3" no Financeiro |
| 20 | Pronto para homologação | ✅ Fase 1 |

## 6. Pendências e observações

- **Publicação:** não foi feita. É preciso criar o D1 e os buckets R2, preencher os ids no `wrangler.jsonc` e definir o `SETUP_TOKEN`. O passo a passo está em `docs/IMPLANTACAO.md`.
- **Fora da Fase 1 (próximas fases):**
  - contas a pagar e resumo por categoria, que existiam no protótipo (Fase 3);
  - a tabela de preço "Urgente" do protótipo foi substituída pelo preço do catálogo mais ajuste do administrador. Se fizer falta, volta na Fase 2 junto com a calculadora de preço sugerido;
  - documentos separados (orçamento, ordem interna, comprovantes de pagamento e de retirada): hoje há um único documento A4 da OS (Fase 2).
- **Preços:** a atendente só lança serviços com preço do catálogo. Enquanto o administrador não cadastrar os preços, apenas o administrador consegue lançar valores.
- **Navegadores:** testado em Chromium. Safari e iPhone devem ser verificados na homologação (câmera e impressão para PDF).

## 7. Roteiro de homologação (sugestão)

1. Criar a conta da administradora pelo código de configuração.
2. Em Configurações: dados do ateliê, preços dos serviços e a equipe (uma atendente e uma costureira).
3. Como atendente: cadastrar uma cliente, abrir uma OS com 3 peças, tirar fotos pelo celular, receber o sinal e tentar receber a mais.
4. Como administradora: aprovar e atribuir as peças às costureiras.
5. Como costureira: ver só as próprias peças, sem valores, e avançar a produção até "Finalizado".
6. Como atendente: "Avisar que está pronta", receber o restante, entregar e imprimir.
7. Fechar o caixa contando a gaveta, reabrir como administradora e estornar um pagamento.
8. Registrar duas medições da mesma cliente, comparar e imprimir.
9. Gerar um backup em Configurações → Backup.
