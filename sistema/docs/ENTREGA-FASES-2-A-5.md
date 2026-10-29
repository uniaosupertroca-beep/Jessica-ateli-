# Fases 2 a 5 — relatório de entrega

Data: 29/10/2026. Situação: **em homologação**, publicado em `jessica-ateli-homologacao.uniaosupertroca.workers.dev`. Produção ainda não foi criada e depende de autorização. A Fase 1 está em `FASE-1-ENTREGA.md`.

## Fase 2 — Operação e produção

| Item | Entregue |
|---|---|
| **Catálogo de serviços** | Tela **Serviços** com preço, unidade, tempo, mão de obra e **calculadora de preço sugerido**: tempo × custo da hora + materiais, + despesas indiretas %, + margem %, arredondado para cima em R$ 0,50. O preço final é sempre definido pela administradora. |
| **Fluxo da OS** | Recebida → Aguardando aprovação → Aprovada → Em produção → Aguardando prova → Ajustes finais → Pronta → Entregue, além de Pausada e Cancelada. As transições são validadas e auditadas, e a situação é calculada pelas peças. |
| **Kanban de produção** | Tela **Produção** com 5 colunas. Os cartões mudam de coluna arrastando (computador) ou por botões (celular). Mostra urgência, prazo, atraso, prova marcada, tempo previsto × tempo feito e retrabalhos. Filtros: profissional, prazo, urgentes e busca. |
| **Controle das profissionais** | Atribuir ou reatribuir peças; costureira pode **assumir** peça sem responsável. O tempo efetivo é cronometrado sozinho (no máximo 10 h por período, para um cronômetro esquecido não distorcer). Há tempo manual, observação interna e contagem de retrabalho, além de um painel de carga por profissional. |
| **Agenda inteligente** | Visões **dia, semana e mês**, com compromissos dos tipos prova, entrega, retirada, recebimento, atendimento, prazo de produção e **ausência**. Cada compromisso pode ser ligado à cliente, à OS e à peça. |
| **Capacidade por horas** | Cada profissional tem horas/dia e dias de trabalho; ausências zeram a capacidade dela no dia. A carga do dia soma o tempo previsto das peças não finalizadas, e a OS avisa quando passa da capacidade (encaixe só com confirmação). Provas têm limite próprio por dia e horário de funcionamento. |
| **Conflitos** | Mesma profissional no mesmo horário, prova no mesmo horário, limite de provas e ausência. **Só a administradora encaixa, com justificativa registrada.** |
| **Documentos** | Comprovante de recebimento, **orçamento**, **ordem de produção interna** (sem valores, com medidas e observações), **comprovante de pagamento** e **comprovante de retirada**. Todos em A4 ou PDF. |
| **Etiquetas e QR Code** | Uma etiqueta por peça: ateliê, OS, código, descrição curta, prazo e QR. Formatos A4 com 3 ou 2 por linha e etiqueta térmica 60 × 40 mm. O QR leva **só o código da peça** (sem nome nem telefone). Abrir exige login e a peça aparece destacada na OS. Há leitor pela câmera no próprio sistema (quando o navegador permite) ou digitando o código. |
| **Alertas** | Lembretes no Início: prova amanhã e peça pronta há 3+ dias, com botão de WhatsApp e mensagem pronta. Também aparecem peças urgentes e atrasadas. |

## Fase 3 — Financeiro e estoque

| Item | Entregue |
|---|---|
| **Estoque** | Materiais com código, categoria, unidade (un, m, cm, pacote, rolo, kg, g, caixa), mínimo, local e fornecedor. O **saldo só muda por movimentação**, e uma trava no banco confere que o saldo é a soma das movimentações. |
| **Movimentações** | Compra (com custo, nota, fornecedor e opção de gerar conta a pagar ou já pagar), consumo em OS, devolução, perda (com motivo), ajuste de inventário pela contagem e reversão. Movimentações são imutáveis e não há baixa dupla (cada clique tem identificador único). **Saldo negativo só com autorização da administradora.** |
| **Custo médio** | Média ponderada nas entradas. Exemplo testado: 10 un a R$ 20,00 + 10 un a R$ 30,00 = custo médio de R$ 25,00. |
| **Baixa por OS** | Painel "Materiais usados" na OS. O custo entra na margem da OS e nos relatórios. Costureira lança material só nas OS dela e não vê custos. |
| **Contas a pagar** | Cadastro com **parcelas mês a mês** (a última leva a diferença de centavos), fornecedor e categoria. Pagar vira saída no caixa; **estornar o pagamento reabre a conta**; pagar duas vezes é bloqueado. |
| **Relatórios** | Ver tabela abaixo. |

## Fase 4 — Experiência

| Item | Entregue |
|---|---|
| **Dashboard (Início)** | Ações rápidas (Nova OS, Nova cliente, Registrar pagamento, Agendar prova, Registrar entrega, Consultar ordem). Indicadores do dia e do mês: faturamento, recebido, despesas, lucro estimado, caixa e a receber. **Gráfico dos recebimentos dos últimos 30 dias.** Também mostra provas da semana, urgentes, atrasadas, lembretes com WhatsApp, atividade recente e avisos de estoque mínimo e contas vencendo. |
| **Relatórios** | Faturamento, recebido, despesas, a receber, ticket médio, custo de materiais, **lucro estimado × resultado de caixa (realizado)**, comparação com o período anterior, **evolução mensal em gráfico**, recebido por forma, despesas por categoria, serviços mais realizados com margem estimada, produtividade da equipe, tempo médio, clientes recorrentes, entregas no prazo e consumo de materiais. **Exporta CSV** (abre no Excel) e imprime. |
| **Menu completo** | Início, Ordens, Produção, Agenda, Clientes, Medidas, Serviços, Estoque, Financeiro, Relatórios e Configurações. Cada perfil vê só o que pode usar. No celular há 4 atalhos e o botão "Mais". |
| **Pesquisa geral** | Busca clientes, OS, peças (pelo código da etiqueta) e materiais, em uma barra no topo de todas as telas. |
| **App instalável (PWA)** | Manifesto, ícones (incluindo os que se adaptam ao formato do celular), atalhos para Nova OS, Produção e Agenda, e abre em tela cheia. O service worker guarda **só a interface**, **nunca dados da API** (clientes, fotos e valores). **Atualização controlada**: aparece o aviso "Nova versão disponível — Atualizar". |
| **Auditoria** | Aba em Configurações com filtros por área e período. O registro é imutável. |
| **Configurações** | Custo da hora, despesas indiretas e margem; limite de provas por dia; horário de funcionamento; horas e dias de trabalho por profissional. |

**Gráficos:** feitos sem biblioteca externa, seguindo o guia de visualização de dados.
- A paleta das séries foi **validada por script** para daltonismo nos modos claro e escuro. No claro, a 3ª cor fica abaixo de 3:1 de contraste, por isso há rótulos diretos e tabela.
- Eixo único, legenda e rótulo no fim de cada linha.
- Dica ao passar o mouse, o dedo ou as setas do teclado.
- Tabela "ver em tabela".

## Fase 5 — Homologação e estabilização

| Verificação | Resultado |
|---|---|
| Testes automáticos (Vitest + Miniflare, banco e R2 reais em memória) | **62 de 62 passaram** |
| Fluxo no navegador (Playwright) | Fluxo completo sem erros de JavaScript, de ponta a ponta: configuração, equipe, calculadora, OS com 2 peças, Kanban, prova com conflito e encaixe justificado, estoque (10 m → consumo de 1,5 m → **8,5 m**), 5 documentos, etiquetas com QR, leitura `#p/1-2`, conta a pagar, relatórios com CSV e gráfico com dica, agenda dia, pesquisa geral e manifesto. |
| Celular (390 px) | Costureira entra pelo usuário, troca a senha inicial e usa o Kanban **sem ver valores** e sem rolagem lateral. |
| Restauração de backup (com estoque, agenda e contas) | Contagens, saldos (8,5 m), status de contas e **35 travas** idênticos ao original. |
| Revisão de segurança | Corrigidos: (1) costureira lia o histórico de produção de peças alheias pelo identificador; agora vê só as dela e as sem responsável; (2) **injeção de fórmula no CSV**, em que um nome como `=HYPERLINK(...)` virava fórmula no Excel e agora é neutralizado; (3) a trava de saldo do estoque podia ser contornada por UPDATE direto e foi reforçada para conferir a soma das movimentações. |
| Concorrência | Pagamentos simultâneos, OS com o mesmo clique, números de OS, consumo de estoque simultâneo (10 − 4 − 4 − 4 → só 2 passam) e mudança de etapa da peça (o tempo não é somado em dobro). |

### Roteiro de testes do pedido (seção 22)

| # | Teste | Situação |
|---|---|---|
| 1 | Persistência | ✅ automático |
| 2 | Pagamento excedente | ✅ automático + navegador |
| 3 | Quantidade inválida | ✅ automático + navegador |
| 4 | WhatsApp | ✅ automático + navegador |
| 5 | Múltiplas peças | ✅ automático + navegador |
| 6 | Medidas | ✅ automático + navegador |
| 7 | Fotografias | ✅ automático + navegador |
| 8 | Agenda (conflitos e capacidade) | ✅ automático + navegador |
| 9 | Estoque 10 m − 1,5 m = 8,5 m | ✅ automático + navegador |
| 10 | Financeiro R$ 300 em duas vezes | ✅ automático |
| 11 | Estornos | ✅ automático |
| 12 | Permissões | ✅ automático + navegador (costureira) |
| 13 | QR Code | ✅ automático + navegador |
| 14 | PWA | ✅ manifesto, ícones e service worker. ⚠️ A instalação em si precisa ser testada no seu celular (iPhone: Compartilhar → Adicionar à Tela de Início; Android: menu → Instalar app) |
| 15 | Mobile | ✅ 375 e 390 px. ⚠️ Testar em iPhone/Safari na homologação |
| 16 | Concorrência | ✅ automático |
| 17 | Backup | ✅ restauração em ambiente isolado |

## Critérios de aceitação (seção 24)

Todos os 20 critérios estão atendidos no ambiente de homologação. Exceções que dependem de você:
- **Produção:** criar o banco e os buckets de produção e publicar exige sua autorização. O passo a passo está em `IMPLANTACAO.md`.
- **iPhone/Safari:** a instalação do app e a câmera para QR e fotos precisam ser conferidas no aparelho de verdade.

## Limitações conhecidas (decisões tomadas)

- **WhatsApp:** abre o aplicativo com a mensagem pronta e não envia sozinho, como pedido na primeira etapa. A integração com a API oficial do WhatsApp Business é um próximo passo e depende de conta Meta.
- **Uso sem internet:** o app abre sem internet, mas **não salva operações offline**. Isso exigiria sincronização com tratamento de conflitos, o que o pedido condiciona a testes adequados. Sem internet, aparece "Sem conexão".
- **Lucro estimado:** depende do custo da hora informado em Configurações. Sem ele, desconta só os materiais, e a tela avisa.
- **Gráfico de pizza:** "recebido por forma de pagamento" e "despesas por categoria" são **barras horizontais**, que permitem comparar valores com mais precisão.

## Documentos personalizados (pedido posterior)

Em **Configurações → Documentos e logo**:
- **Logo:** PNG, JPG ou WebP, até 2 MB. Fica guardado no próprio sistema (armazenamento privado do R2) e é servido só para quem está logado. Não há link público nem serviço externo. Arquivos SVG são recusados por segurança.
- **Aparência:** cor dos documentos (títulos, linhas e cabeçalho das tabelas), logo nas etiquetas (sim/não) e telefone da cliente nos documentos (sim/não).
- **Textos:** linha extra no cabeçalho (Instagram, horário), rodapé, validade e condições do orçamento, texto do comprovante de retirada e nome na assinatura.
- **Prévia ao vivo** enquanto edita.

Tudo vale para OS, orçamento, ordem de produção, comprovantes de pagamento e retirada, ficha de medidas e etiquetas. Na impressão as cores saem como na tela.

## QR Code removido (pedido posterior)

A pedido da Jessica, a OS não é mais aberta por QR Code. Saíram o botão de leitura, o código nas etiquetas, a rota da API e a biblioteca de QR.
- **Busca da OS:** pelo nome da cliente e da peça, sem diferenciar acentos. Dá para combinar as duas (ex.: "mariana calca"), e o número da OS continua valendo.
- A busca funciona igual na lista de OS, na pesquisa geral do topo e no Kanban.
- **Etiquetas:** trazem logo, **nome da cliente**, **peça**, número da OS, código e prazo.

## Migrations

| Arquivo | O que faz |
|---|---|
| `0001_fundacao.sql` | Base (Fase 1) |
| `0002_login_por_usuario.sql` | Login por usuário e troca de senha obrigatória |
| `0003_producao_agenda_estoque.sql` | Produção, agenda, estoque, fornecedores, compras e contas a pagar |
| `0004_documentos_personalizados.sql` | Logo, cor e textos dos documentos |
| `0005_busca_por_peca.sql` | Nome da peça normalizado para a busca sem acento |

Todas já estão aplicadas na homologação.

## Filiais (várias unidades no mesmo sistema)

Migration `0006_unidades.sql` (não destrutiva: tudo o que já existia passa a ser da unidade **Matriz**, sigla MAT).

**Compartilhado entre as unidades:** clientes e medidas, catálogo e preços de serviços, cadastro de materiais, configurações, logo e textos dos documentos.
**Separado por unidade:** OS, produção, agenda e capacidade, caixa do dia, lançamentos, saldo de estoque, equipe e contas a pagar (ou "do grupo").

- **Topo da tela:** quem trabalha em mais de uma unidade escolhe a unidade (ou "Todas as unidades"). Quem tem uma só unidade não vê o seletor.
  Na visão "todas", as telas somam/listam tudo, mas para registrar (OS, caixa, estoque) é preciso escolher uma unidade.
- **Configurações → Unidades:** cadastro de cada filial (nome, sigla, endereço/telefone/CNPJ impressos na OS, entregas e provas por dia, horário).
- **Equipe:** cada pessoa é ligada às unidades em que trabalha; o administrador vê todas.
- **Numeração das OS:** única para o ateliê todo; a sigla da unidade aparece ao lado do número.
- **Caixa:** um por unidade por dia; na visão "todas" aparece o resumo de cada caixa.
- **Estoque:** saldo por unidade (e total do grupo); botão "Transferir para outra unidade" (sai de uma e entra na outra, sem mudar o total; não deixa negativo).
- **Contas a pagar:** da unidade ou "do grupo" (ex.: contador); o pagamento sai do caixa da unidade que pagou.
- **Relatórios:** filtrados pela unidade escolhida; em "todas" aparece o comparativo entre unidades.
- **Segurança:** atendente/costureira de uma unidade não vê nem altera OS, caixa ou estoque de outra (testado em `test/unidades.test.ts`).
- **Backup/restauração:** incluem `units` e `user_units`; o script de restauração usa a versão mais recente de cada trava.

Premissas adotadas (podem ser mudadas): filiais próprias (não franquias), cada filial costura as próprias peças, mesmos preços em todas, numeração de OS única.
