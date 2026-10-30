// Cria um ateliê de DEMONSTRAÇÃO com dados fictícios num banco local isolado (nunca na homologação/produção).
// Uso: node seed-demo.mjs http://127.0.0.1:8791 <SETUP_TOKEN>  → grava a senha da conta demo em ./.demo-senha (não versionado)
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const [BASE = 'http://127.0.0.1:8791', TOKEN] = process.argv.slice(2);
const SENHA = 'demo-' + randomUUID().slice(0, 12);
let cookie = '';
let unidade = '';

async function api(caminho, corpo, metodo, extra = {}, tentativa = 0) {
  const headers = { Origin: BASE, ...(cookie && { Cookie: cookie }), ...(unidade && { 'X-Unidade': unidade }), ...extra };
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  if (metodo !== 'GET' && corpo !== undefined) headers['Idempotency-Key'] = extra['Idempotency-Key'] || randomUUID();
  const r = await fetch(BASE + '/api' + caminho, { method: metodo || (corpo !== undefined ? 'POST' : 'GET'), headers, body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc && sc.includes('__Host-sid=')) cookie = sc.match(/__Host-sid=[^;]+/)[0];
  const d = await r.json().catch(() => null);
  // o sistema limita requisições por minuto (proteção real): espera e tenta de novo
  if (r.status === 429 && tentativa < 30) { await new Promise(ok => setTimeout(ok, 3000 + Math.random() * 2000)); return api(caminho, corpo, metodo, { ...extra, ...(headers['Idempotency-Key'] && { 'Idempotency-Key': headers['Idempotency-Key'] }) }, tentativa + 1); }
  if (!r.ok) throw new Error(`${metodo || 'POST'} ${caminho} → ${r.status} ${JSON.stringify(d)}`);
  return d;
}

const est = await api('/auth/estado');
const H = est.hoje;
const dia = n => { const [a, m, d] = H.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10); };

// 1) Conta da demonstração
await api('/auth/configurar', { token: TOKEN, nome: 'Jessica', email: 'demo@atelie-jessica.demo', senha: SENHA });
writeFileSync(new URL('../.demo-senha', import.meta.url), SENHA);
unidade = 'u-matriz';

// 2) Ateliê e preços ilustrativos da demonstração
await api('/config/atelie', { nome: 'Ateliê Jessica', telefone: '(11) 91234-5678', endereco: 'Rua das Costureiras, 120 — Centro', documento: '', rodape_os: 'Peças não retiradas em até 90 dias poderão ser doadas. Confira a peça na retirada.',
  capacidade_diaria: 8, limite_quase_cheio: 6, capacidade_provas_dia: 8, horario_inicio: '09:00', horario_fim: '18:00', custo_hora_centavos: 2500, despesas_indiretas_pct: 20, margem_pct: 30 }, 'PATCH');
await api('/config/unidades/u-matriz', { nome: 'Matriz', sigla: 'MAT', endereco: 'Rua das Costureiras, 120 — Centro', telefone: '(11) 91234-5678', capacidade_diaria: 8, limite_quase_cheio: 6, capacidade_provas_dia: 8, horario_inicio: '09:00', horario_fim: '18:00', ativo: true }, 'PUT');
const PRECOS = [['sv-barra-calca', 'sc-ajustes', 'Barra de calça', 3500, 30], ['sv-barra-vestido', 'sc-ajustes', 'Barra de vestido', 5500, 45], ['sv-barra-saia', 'sc-ajustes', 'Barra de saia', 4500, 40],
  ['sv-ajuste-cintura', 'sc-ajustes', 'Ajuste de cintura', 5000, 40], ['sv-ajuste-lateral', 'sc-ajustes', 'Ajuste de lateral', 4500, 35], ['sv-troca-ziper', 'sc-consertos', 'Troca de zíper', 4000, 30],
  ['sv-troca-botao', 'sc-consertos', 'Troca de botão', 1000, 10], ['sv-reparo', 'sc-consertos', 'Reparo / remendo', 3000, 25], ['sv-reforma', 'sc-reformas', 'Reforma de peça', 12000, 120],
  ['sv-ajuste-festa', 'sc-festa', 'Ajuste de vestido de festa', 18000, 180], ['sv-sob-medida', 'sc-medida', 'Confecção sob medida', 45000, 600], ['sv-uniforme', 'sc-uniformes', 'Uniforme', 12000, 120],
  ['sv-cortina', 'sc-cortinas', 'Cortina', 9000, 90]];
for (const [id, cat, nome, preco, tempo] of PRECOS)
  await api('/config/servicos/' + id, { categoria_id: cat, nome, preco_centavos: preco, tempo_min: tempo, custo_mao_obra_centavos: Math.round(tempo / 60 * 2500) }, 'PUT');
const preco = Object.fromEntries(PRECOS.map(p => [p[0], p]));

// 3) Equipe fictícia
const ana = (await api('/usuarios', { nome: 'Ana Paula', email: 'ana@atelie-jessica.demo', login: 'ana', papel: 'costureira', senha: SENHA, capacidade_min_dia: 360, dias_trabalho: '12345' })).id;
const rosa = (await api('/usuarios', { nome: 'Rosa Maria', email: 'rosa@atelie-jessica.demo', login: 'rosa', papel: 'costureira', senha: SENHA, capacidade_min_dia: 360, dias_trabalho: '123456' })).id;
await api('/usuarios', { nome: 'Carla Dias', email: 'carla@atelie-jessica.demo', login: 'carla', papel: 'atendente', senha: SENHA });
const costureiras = [ana, rosa];

// 4) Clientes fictícias
const NOMES = [['Mariana Souza', 'indicacao'], ['Fernanda Lima', 'instagram'], ['Beatriz Alves', 'instagram'], ['Juliana Costa', 'passou_na_frente'], ['Camila Rocha', 'indicacao'],
  ['Patrícia Mendes', 'google'], ['Renata Oliveira', 'instagram'], ['Larissa Martins', 'whatsapp'], ['Aline Ferreira', 'indicacao'], ['Gabriela Nunes', 'instagram'],
  ['Sônia Ribeiro', 'cliente_antiga'], ['Tatiane Gomes', 'facebook'], ['Vanessa Pires', 'indicacao'], ['Débora Castro', 'instagram']];
const cli = {};
for (const [i, [nome, origem]] of NOMES.entries()) {
  const fone = `119876543${String(10 + i).padStart(2, '0')}`;
  cli[nome] = (await api('/clientes', { nome, telefone: fone, whatsapp: fone, origem, confirmar_duplicado: true,
    preferencias: i === 0 ? 'Prefere barra italiana. Avisar pelo WhatsApp.' : '', observacoes: i === 0 ? 'Cliente desde 2024.' : '' })).id;
}

// 5) Medidas (Mariana com duas medições para mostrar o histórico)
const ficha = (await api(`/clientes/${cli['Mariana Souza']}/medidas`, { titulo: 'Medidas corporais' })).id;
await api(`/medidas/${ficha}/versoes`, { medido_em: dia(-120), observacoes: 'Primeira medição.', valores: { 'mf-busto': 92, 'mf-cintura': 74, 'mf-quadril': 100, 'mf-ombros': 38, 'mf-manga': 58, 'mf-comp-calca': 101, 'mf-entrepernas': 76, 'mf-altura': 165 } });
await api(`/medidas/${ficha}/versoes`, { medido_em: dia(-6), observacoes: 'Prefere caimento mais solto na cintura.', valores: { 'mf-busto': 93, 'mf-cintura': 72, 'mf-quadril': 101, 'mf-ombros': 38, 'mf-manga': 58, 'mf-comp-calca': 100, 'mf-entrepernas': 76, 'mf-altura': 165 } });
const f2 = (await api(`/clientes/${cli['Fernanda Lima']}/medidas`, { titulo: 'Medidas corporais' })).id;
await api(`/medidas/${f2}/versoes`, { medido_em: dia(-20), valores: { 'mf-busto': 88, 'mf-cintura': 68, 'mf-quadril': 96, 'mf-ombros': 36, 'mf-comp-vestido': 112, 'mf-altura': 160 } });

// 6) Caixa de hoje e estoque
await api('/caixa/abrir', { saldo_inicial_centavos: 15000 });
const MATS = [['TEC-001', 'Tricoline branca', 'tecido', 'm', 3, 2200, 12], ['TEC-002', 'Linho cru', 'tecido', 'm', 2, 4800, 6], ['LIN-001', 'Linha poliéster preta', 'linha', 'un', 10, 450, 40],
  ['LIN-002', 'Linha poliéster branca', 'linha', 'un', 10, 450, 35], ['ZIP-001', 'Zíper invisível 20 cm', 'ziper', 'un', 5, 350, 4], ['BOT-001', 'Botão perolado 12 mm', 'botao', 'un', 30, 60, 120],
  ['ENT-001', 'Entretela termocolante', 'entretela', 'm', 2, 1200, 8], ['ELA-001', 'Elástico 3 cm', 'elastico', 'm', 5, 300, 15]];
const mat = {};
for (const [codigo, nome, categoria, un, minimo, custo, qtd] of MATS) {
  mat[codigo] = (await api('/estoque/materiais', { codigo, nome, categoria, unidade: un, estoque_minimo: minimo, localizacao: 'Armário ' + (1 + (codigo.charCodeAt(0) % 3)) })).id;
  await api('/estoque/movimentos', { material_id: mat[codigo], tipo: 'compra', quantidade: qtd, custo_unitario_centavos: custo, documento: 'NF ' + (1000 + Object.keys(mat).length) });
}

// 7) Ordens de serviço
const PECAS = [['Vestido de noiva', 'sv-sob-medida'], ['Vestido de formatura', 'sv-ajuste-festa'], ['Calça jeans', 'sv-barra-calca'], ['Vestido midi', 'sv-ajuste-cintura'], ['Saia plissada', 'sv-barra-saia'], ['Blazer', 'sv-ajuste-lateral'], ['Calça social', 'sv-barra-calca'],
  ['Vestido de festa', 'sv-ajuste-festa'], ['Jaqueta', 'sv-troca-ziper'], ['Camisa', 'sv-troca-botao'], ['Vestido longo', 'sv-barra-vestido'], ['Bermuda', 'sv-reparo'], ['Casaco', 'sv-reforma'], ['Cortina da sala', 'sv-cortina']];
let k = 0;
const nomes = Object.keys(cli).slice(1);
// mais clientes no histórico (nomes fictícios)
const EXTRAS = ['Adriana Moraes', 'Bruna Teixeira', 'Carolina Freitas', 'Daniela Barros', 'Eduarda Pinto', 'Flávia Cardoso', 'Giovana Lopes', 'Helena Duarte', 'Isabela Rezende', 'Joana Vieira', 'Kátia Moura', 'Letícia Araújo', 'Mônica Prado', 'Natália Campos', 'Olívia Batista', 'Paula Siqueira', 'Raquel Fontes', 'Simone Tavares', 'Tânia Correia', 'Vera Lúcia Santos'];
for (const [i, nome] of EXTRAS.entries()) { const f = `119876542${String(10 + i).padStart(2, '0')}`; cli[nome] = (await api('/clientes', { nome, telefone: f, whatsapp: f, origem: ['indicacao', 'instagram', 'google', 'passou_na_frente'][i % 4], confirmar_duplicado: true })).id; nomes.push(nome); } // Mariana fica para a OS gravada no vídeo (mais uma antiga)
async function novaOS(cliente, pecas, prazo, extra = {}) {
  const os = await api('/ordens', { client_id: cli[cliente], prazo, confirmar_lotado: true,
    itens: pecas.map(([peca, sv]) => ({ peca, servicos: [{ service_id: sv, descricao: preco[sv][2], quantidade: 1, unidade: 'un', valor_unitario_centavos: preco[sv][3] }] })), ...extra });
  return api(`/ordens/${os.id}`, undefined, 'GET');
}
const status = (id, corpo) => api(`/ordens/${id}/status`, corpo);
const item = (os, it, corpo) => api(`/ordens/${os.id}/itens/${it.id}?resposta=curta`, corpo, 'PATCH');
const pagar = (os, v, forma = 'pm-pix') => api(`/ordens/${os.id}/pagamentos`, { valor_centavos: v, forma_id: forma });
const FORMAS = ['pm-pix', 'pm-pix', 'pm-dinheiro', 'pm-debito', 'pm-credito'];

// 7a) Histórico: OS já entregues (as datas vão para os meses anteriores no passo 8)
const historico = [];
const POR_MES = [22, 26, 24, 30, 33, 24];
const tarefas = [];
for (const [m, qtd] of POR_MES.entries())
  for (let j = 0; j < qtd; j++) {
    const kk = k++;
    const cliente = nomes[kk % nomes.length];
    const pecas = [PECAS[(kk * 7) % PECAS.length], ...(kk % 2 === 0 ? [PECAS[(kk * 5 + 1) % PECAS.length]] : []), ...(kk % 5 === 0 ? [PECAS[(kk * 11 + 3) % PECAS.length]] : [])];
    tarefas.push(async () => {
      let os = await novaOS(cliente, pecas, H);
      os = await status(os.id, { para: 'aprovada', aprovacao_meio: kk % 2 ? 'whatsapp' : 'presencial' });
      for (const it of os.itens) await item(os, it, { responsavel_id: costureiras[kk % 2], status_producao: 'finalizado', tempo_manual_min: 20 + (kk % 5) * 10 });
      os = await api(`/ordens/${os.id}`, undefined, 'GET');
      await pagar(os, os.total, FORMAS[kk % FORMAS.length]);
      await status(os.id, { para: 'entregue' });
      historico.push({ id: os.id, mes: 5 - m });
    });
  }
// várias de cada vez (o servidor local é lento por requisição)
for (let i = 0; i < tarefas.length; i += 4) {
  await Promise.all(tarefas.slice(i, i + 4).map(f => f()));
  if (i % 20 === 0) console.log('histórico', i, '/', tarefas.length);
}
// Mariana: uma OS antiga entregue (histórico na ficha)
{ let os = await novaOS('Mariana Souza', [['Vestido de festa', 'sv-ajuste-festa']], H);
  os = await status(os.id, { para: 'aprovada', aprovacao_meio: 'presencial' });
  await item(os, os.itens[0], { responsavel_id: ana, status_producao: 'finalizado', tempo_manual_min: 170 });
  os = await api(`/ordens/${os.id}`, undefined, 'GET'); await pagar(os, os.total); await status(os.id, { para: 'entregue' }); historico.push({ id: os.id, mes: 2 }); }

// 7b) Situação de hoje
const vivos = {};
// aguardando aprovação
vivos.orc1 = await novaOS('Fernanda Lima', [['Vestido de festa', 'sv-ajuste-festa'], ['Bolero', 'sv-ajuste-lateral']], dia(9));
await status(vivos.orc1.id, { para: 'aguardando_aprovacao' });
vivos.rec = await novaOS('Débora Castro', [['Cortina da sala', 'sv-cortina']], dia(12));
// em produção (uma urgente, uma atrasada)
for (const [nome, pecas, prazo, urg] of [['Beatriz Alves', [['Calça social', 'sv-barra-calca'], ['Blazer', 'sv-ajuste-lateral']], dia(2), true],
  ['Juliana Costa', [['Jaqueta', 'sv-troca-ziper']], dia(0), false], ['Camila Rocha', [['Casaco', 'sv-reforma']], dia(5), false], ['Patrícia Mendes', [['Vestido longo', 'sv-barra-vestido'], ['Saia plissada', 'sv-barra-saia']], dia(3), false]]) {
  let os = await novaOS(nome, pecas, prazo);
  os = await status(os.id, { para: 'aprovada', aprovacao_meio: 'whatsapp' });
  await pagar(os, Math.round(os.total / 2), 'pm-pix');
  for (const [i, it] of os.itens.entries()) await item(os, it, { responsavel_id: costureiras[(k++) % 2], status_producao: i === 0 ? 'em_execucao' : 'aguardando', ...(urg && i === 0 ? { urgente: true } : {}) });
  vivos[nome] = os;
}
// aguardando prova (com prova marcada)
for (const [nome, pecas, prazo, provaDia, hora] of [['Renata Oliveira', [['Vestido de festa', 'sv-ajuste-festa']], dia(6), dia(1), '10:00'], ['Larissa Martins', [['Vestido midi', 'sv-ajuste-cintura']], dia(4), dia(1), '14:30']]) {
  let os = await novaOS(nome, pecas, prazo);
  os = await status(os.id, { para: 'aprovada', aprovacao_meio: 'presencial' });
  await pagar(os, Math.round(os.total / 2), 'pm-dinheiro');
  await item(os, os.itens[0], { responsavel_id: rosa, status_producao: 'em_execucao' });
  await item(os, os.itens[0], { status_producao: 'aguardando_prova' });
  await api('/agenda/compromissos', { tipo: 'prova', dia: provaDia, hora_inicio: hora, hora_fim: hora.replace(':00', ':30').replace(':30', hora.endsWith(':30') ? ':59' : ':30'), order_id: os.id, client_id: cli[nome], profissional_id: rosa });
  vivos[nome] = os;
}
// prontas para retirada (uma com saldo)
for (const [nome, pecas, pago] of [['Aline Ferreira', [['Calça jeans', 'sv-barra-calca'], ['Calça social', 'sv-barra-calca']], true], ['Gabriela Nunes', [['Vestido longo', 'sv-barra-vestido']], false]]) {
  let os = await novaOS(nome, pecas, dia(0));
  os = await status(os.id, { para: 'aprovada' });
  for (const it of os.itens) await item(os, it, { responsavel_id: ana, status_producao: 'finalizado', tempo_manual_min: 25 });
  os = await api(`/ordens/${os.id}`, undefined, 'GET');
  await pagar(os, pago ? os.total : Math.round(os.total / 2), 'pm-pix');
  await api('/agenda/compromissos', { tipo: 'retirada', dia: dia(0), hora_inicio: pago ? '16:00' : '17:00', order_id: os.id, client_id: cli[nome] });
  vivos[nome] = os;
}
// consumo de materiais nas OS em produção
await api('/estoque/consumos', { order_id: vivos['Camila Rocha'].id, item_id: vivos['Camila Rocha'].itens[0].id, material_id: mat['TEC-002'], quantidade: 1.5 });
await api('/estoque/consumos', { order_id: vivos['Juliana Costa'].id, item_id: vivos['Juliana Costa'].itens[0].id, material_id: mat['ZIP-001'], quantidade: 1 });
await api('/estoque/consumos', { order_id: vivos['Beatriz Alves'].id, item_id: vivos['Beatriz Alves'].itens[0].id, material_id: mat['LIN-001'], quantidade: 2 });
// agenda: entregas e atendimento
await api('/agenda/compromissos', { tipo: 'entrega', dia: dia(2), hora_inicio: '11:00', order_id: vivos['Beatriz Alves'].id, client_id: cli['Beatriz Alves'] });
await api('/agenda/compromissos', { tipo: 'prova', dia: dia(2), hora_inicio: '15:00', hora_fim: '15:30', order_id: vivos['Patrícia Mendes'].id, client_id: cli['Patrícia Mendes'], profissional_id: ana });
await api('/agenda/compromissos', { tipo: 'atendimento', titulo: 'Orçamento de vestido de noiva', dia: dia(1), hora_inicio: '16:00', hora_fim: '17:00', client_id: cli['Vanessa Pires'] });

// 8) Despesas e contas a pagar
await api('/financeiro/lancamentos', { natureza: 'avulso', tipo: 'saida', valor_centavos: 8900, forma_id: 'pm-pix', categoria_id: 'fc-material', descricao: 'Linhas e agulhas' });
await api('/pagar', { descricao: 'Aluguel de novembro', categoria_id: 'fc-aluguel', valor_centavos: 120000, vencimento: dia(7) });
await api('/pagar', { descricao: 'Energia elétrica', categoria_id: 'fc-contas', valor_centavos: 24300, vencimento: dia(3) });
await api('/pagar', { descricao: 'Revisão da máquina reta', categoria_id: 'fc-manutencao', valor_centavos: 45000, vencimento: dia(15), parcelas: 2 });

writeFileSync(new URL('../.demo-historico.json', import.meta.url), JSON.stringify({ H, historico, vivos: Object.fromEntries(Object.entries(vivos).map(([k, v]) => [k, v.id])) }));
console.log('Demo pronta:', Object.keys(cli).length, 'clientes,', historico.length, 'OS no histórico, hoje', H);
