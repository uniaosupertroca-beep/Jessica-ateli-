import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditoria } from '../lib/auditoria';
import { ErroApp, naoEncontrado, traduzirErroBanco } from '../lib/erros';
import { agora, chaveIdempotencia, exigir, hoje, lerCorpo, uuid, zCentavos, zData } from '../lib/util';
import { brl } from '../../public/js/regras.js';

export const rotasFinanceiro = new Hono<AppEnv>();

type Forma = { id: string; nome: string; eh_dinheiro: number; eh_credito_cliente: number; ativo: number };

async function lerForma(db: D1Database, id: string) {
  const f = await db.prepare('SELECT id, nome, eh_dinheiro, eh_credito_cliente, ativo FROM payment_methods WHERE id = ?').bind(id).first<Forma>();
  if (!f || !f.ativo) throw new ErroApp(422, 'forma_invalida', 'Forma de pagamento inválida ou desativada.');
  return f;
}

/** Movimentos já gravados com esta chave (repetição de clique ou de requisição). */
async function jaRegistrado(db: D1Database, chave: string) {
  const { results } = await db.prepare('SELECT id FROM cash_movements WHERE idempotency_key = ? OR idempotency_key = ?')
    .bind(chave, `${chave}:credito`).all<{ id: string }>();
  return results.map(r => r.id);
}

async function executarIdempotente(c: Context<AppEnv>, chave: string, stmts: D1PreparedStatement[]) {
  try {
    await c.env.DB.batch(stmts);
    return false;
  } catch (e) {
    if ((await jaRegistrado(c.env.DB, chave)).length) return true; // outra requisição igual já gravou
    throw traduzirErroBanco(e) ?? e;
  }
}

const insertMov = (db: D1Database, m: {
  id: string; tipo: 'entrada' | 'saida'; natureza: string; valor: number; forma: string; categoria: string; descricao: string;
  order?: string | null; client?: string | null; estornoDe?: string | null; chave?: string | null; user: string; data: string; em: string;
}) => db.prepare(
  `INSERT INTO cash_movements (id, data, tipo, natureza, valor_centavos, forma_id, categoria_id, descricao, order_id, client_id, estorno_de,
     idempotency_key, criado_em, criado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
).bind(m.id, m.data, m.tipo, m.natureza, m.valor, m.forma, m.categoria, m.descricao, m.order ?? null, m.client ?? null, m.estornoDe ?? null,
  m.chave ?? null, m.em, m.user);

const insertCredito = (db: D1Database, client: string, valor: number, descricao: string, movId: string, order: string | null, user: string, em: string) =>
  db.prepare('INSERT INTO customer_credits (id, client_id, valor_centavos, descricao, cash_movement_id, order_id, criado_em, criado_por) VALUES (?,?,?,?,?,?,?,?)')
    .bind(uuid(), client, valor, descricao, movId, order, em, user);

/* ---------------------------------------------------------------------------
 * Recebimento de OS
 *  - nunca aceita valor acima do saldo (trava também no banco);
 *  - excedente só entra se a pessoa escolher "guardar como crédito da cliente";
 *  - "Crédito da cliente" como forma usa o crédito existente (não é dinheiro novo).
 * ------------------------------------------------------------------------- */
rotasFinanceiro.post('/ordens/:id/pagamentos', async c => {
  exigir(c, 'pagamentos.receber');
  const chave = chaveIdempotencia(c);
  const db = c.env.DB;
  const orderId = c.req.param('id');
  if ((await jaRegistrado(db, chave)).length) return c.json({ ok: true, repetido: true });
  const d = await lerCorpo(c, z.object({
    valor_centavos: zCentavos.refine(v => v > 0, 'Informe um valor maior que zero.'),
    forma_id: z.string().min(1, 'Escolha a forma de pagamento.'),
    excedente: z.enum(['bloquear', 'credito']).default('bloquear'),
  }));
  const os = await db.prepare(
    `SELECT o.numero, o.client_id, o.status, t.total, t.pago FROM orders o JOIN vw_order_totals t ON t.order_id = o.id WHERE o.id = ?`,
  ).bind(orderId).first<{ numero: number; client_id: string; status: string; total: number; pago: number }>();
  if (!os) throw naoEncontrado('Ordem de serviço');
  if (os.status === 'cancelada') throw new ErroApp(409, 'os_cancelada', 'Esta OS está cancelada e não recebe pagamentos.');
  const forma = await lerForma(db, d.forma_id);
  const saldo = os.total - os.pago;
  const u = c.get('usuario').id;
  const em = agora();
  const data = hoje();
  const nOS = `OS nº ${String(os.numero).padStart(4, '0')}`;
  const stmts: D1PreparedStatement[] = [];

  if (d.valor_centavos > saldo) {
    if (forma.eh_credito_cliente || d.excedente !== 'credito')
      throw new ErroApp(422, 'pagamento_excede_saldo',
        saldo > 0 ? `O valor é maior que o saldo devido (${brl(saldo)}).` : 'Esta OS não tem saldo a receber.',
        { saldo, permite_credito: !forma.eh_credito_cliente });
    exigir(c, 'financeiro.lancar');
    // O saldo não pode ter mudado desde a leitura (senão a divisão OS/crédito ficaria errada).
    stmts.push(db.prepare("INSERT INTO guards (motivo) SELECT 'saldo_mudou' FROM vw_order_totals WHERE order_id = ? AND total - pago <> ?").bind(orderId, saldo));
    if (saldo > 0)
      stmts.push(insertMov(db, { id: uuid(), tipo: 'entrada', natureza: 'recebimento_os', valor: saldo, forma: forma.id, categoria: 'fc-servicos',
        descricao: `Pagamento ${nOS}`, order: orderId, client: os.client_id, chave, user: u, data, em }));
    const excesso = d.valor_centavos - Math.max(saldo, 0);
    const movCred = uuid();
    stmts.push(
      insertMov(db, { id: movCred, tipo: 'entrada', natureza: 'credito_cliente', valor: excesso, forma: forma.id, categoria: 'fc-credito',
        descricao: `Crédito da cliente (excedente ${nOS})`, client: os.client_id, chave: `${chave}:credito`, user: u, data, em }),
      insertCredito(db, os.client_id, excesso, `Excedente do pagamento da ${nOS}`, movCred, orderId, u, em),
    );
  } else {
    const mov = uuid();
    stmts.push(insertMov(db, { id: mov, tipo: 'entrada', natureza: 'recebimento_os', valor: d.valor_centavos, forma: forma.id,
      categoria: 'fc-servicos', descricao: `${forma.eh_credito_cliente ? 'Uso de crédito' : 'Pagamento'} ${nOS}`, order: orderId,
      client: os.client_id, chave, user: u, data, em }));
    if (forma.eh_credito_cliente) stmts.push(insertCredito(db, os.client_id, -d.valor_centavos, `Usado na ${nOS}`, mov, orderId, u, em));
  }
  stmts.push(auditoria(c, 'receber', 'orders', orderId, { valor: d.valor_centavos, forma: forma.id, excedente: d.excedente }));
  const repetido = await executarIdempotente(c, chave, stmts);
  return c.json({ ok: true, repetido }, repetido ? 200 : 201);
});

/* ---------------------------------------------------------------------------
 * Estorno (correção auditável — o lançamento original nunca é apagado)
 * ------------------------------------------------------------------------- */
rotasFinanceiro.post('/financeiro/lancamentos/:id/estorno', async c => {
  exigir(c, 'financeiro.estornar');
  const chave = chaveIdempotencia(c);
  const db = c.env.DB;
  if ((await jaRegistrado(db, chave)).length) return c.json({ ok: true, repetido: true });
  const { motivo } = await lerCorpo(c, z.object({ motivo: z.string().trim().min(3, 'Informe o motivo do estorno.').max(300) }));
  const o = await db.prepare(
    `SELECT m.*, p.eh_credito_cliente FROM cash_movements m JOIN payment_methods p ON p.id = m.forma_id WHERE m.id = ?`,
  ).bind(c.req.param('id')).first<{
    id: string; tipo: 'entrada' | 'saida'; natureza: string; valor_centavos: number; forma_id: string; categoria_id: string; descricao: string;
    order_id: string | null; client_id: string | null; eh_credito_cliente: number; payable_id: string | null;
  }>();
  if (!o) throw naoEncontrado('Lançamento');
  if (o.natureza === 'estorno') throw new ErroApp(409, 'estorno_invalido', 'Um estorno não pode ser estornado.');
  const u = c.get('usuario').id;
  const em = agora();
  const id = uuid();
  const stmts = [insertMov(db, {
    id, tipo: o.tipo === 'entrada' ? 'saida' : 'entrada', natureza: 'estorno', valor: o.valor_centavos, forma: o.forma_id, categoria: o.categoria_id,
    descricao: `Estorno: ${o.descricao} — ${motivo}`, order: o.order_id, client: o.client_id, estornoDe: o.id, chave, user: u, data: hoje(), em,
  })];
  // Crédito usado volta para a cliente; crédito recebido sai da cliente.
  if (o.eh_credito_cliente && o.client_id) stmts.push(insertCredito(db, o.client_id, o.valor_centavos, `Estorno: ${o.descricao}`, id, o.order_id, u, em));
  if (o.natureza === 'credito_cliente' && o.client_id) stmts.push(insertCredito(db, o.client_id, -o.valor_centavos, `Estorno: ${o.descricao}`, id, null, u, em));
  // Estornar o pagamento de uma conta reabre a conta.
  if (o.payable_id) stmts.push(db.prepare("UPDATE payables SET status = 'aberta', paga_em = NULL WHERE id = ? AND status = 'paga'").bind(o.payable_id));
  stmts.push(auditoria(c, 'estornar', 'cash_movements', o.id, { motivo, estorno: id }));
  const repetido = await executarIdempotente(c, chave, stmts);
  return c.json({ ok: true, id, repetido }, repetido ? 200 : 201);
});

/** Devolve à cliente (em dinheiro, Pix etc.) um crédito que ela tem guardado. */
rotasFinanceiro.post('/clientes/:id/credito/devolucao', async c => {
  exigir(c, 'financeiro.estornar');
  const chave = chaveIdempotencia(c);
  const db = c.env.DB;
  if ((await jaRegistrado(db, chave)).length) return c.json({ ok: true, repetido: true });
  const clientId = c.req.param('id');
  const d = await lerCorpo(c, z.object({
    valor_centavos: zCentavos.refine(v => v > 0, 'Informe um valor maior que zero.'),
    forma_id: z.string().min(1),
  }));
  const forma = await lerForma(db, d.forma_id);
  if (forma.eh_credito_cliente) throw new ErroApp(422, 'forma_invalida', 'Escolha como o dinheiro será devolvido.');
  const cli = await db.prepare('SELECT nome FROM clients WHERE id = ?').bind(clientId).first<{ nome: string }>();
  if (!cli) throw naoEncontrado('Cliente');
  const u = c.get('usuario').id;
  const em = agora();
  const mov = uuid();
  const repetido = await executarIdempotente(c, chave, [
    insertMov(db, { id: mov, tipo: 'saida', natureza: 'avulso', valor: d.valor_centavos, forma: forma.id, categoria: 'fc-devolucao',
      descricao: `Devolução de crédito — ${cli.nome}`, client: clientId, chave, user: u, data: hoje(), em }),
    insertCredito(db, clientId, -d.valor_centavos, 'Crédito devolvido à cliente', mov, null, u, em),
    auditoria(c, 'devolver_credito', 'clients', clientId, { valor: d.valor_centavos }),
  ]);
  return c.json({ ok: true, repetido }, repetido ? 200 : 201);
});

/* ---------------------------------------------------------------------------
 * Entradas e saídas avulsas, sangria e suprimento
 * ------------------------------------------------------------------------- */
rotasFinanceiro.post('/financeiro/lancamentos', async c => {
  exigir(c, 'financeiro.lancar');
  const chave = chaveIdempotencia(c);
  const db = c.env.DB;
  if ((await jaRegistrado(db, chave)).length) return c.json({ ok: true, repetido: true });
  const d = await lerCorpo(c, z.object({
    natureza: z.enum(['avulso', 'sangria', 'suprimento']),
    tipo: z.enum(['entrada', 'saida']).optional(),
    valor_centavos: zCentavos.refine(v => v > 0, 'Informe um valor maior que zero.'),
    forma_id: z.string().optional(),
    categoria_id: z.string().optional(),
    descricao: z.string().trim().min(2, 'Informe a descrição.').max(200),
  }));
  let tipo = d.tipo;
  let forma = d.forma_id;
  let categoria = d.categoria_id;
  if (d.natureza === 'sangria') [tipo, forma, categoria] = ['saida', 'pm-dinheiro', 'fc-sangria'];
  if (d.natureza === 'suprimento') [tipo, forma, categoria] = ['entrada', 'pm-dinheiro', 'fc-suprimento'];
  if (!tipo || !forma || !categoria) throw new ErroApp(422, 'dados_invalidos', 'Informe tipo, forma de pagamento e categoria.');
  const f = await lerForma(db, forma);
  if (f.eh_credito_cliente) throw new ErroApp(422, 'forma_invalida', 'Crédito da cliente só é usado para pagar OS.');
  const cat = await db.prepare('SELECT tipo, sistema, ativo FROM finance_categories WHERE id = ?').bind(categoria).first<{ tipo: string; sistema: number; ativo: number }>();
  if (!cat || !cat.ativo || cat.tipo !== tipo) throw new ErroApp(422, 'categoria_invalida', 'Categoria inválida para este tipo de lançamento.');
  if (d.natureza === 'avulso' && cat.sistema) throw new ErroApp(422, 'categoria_invalida', 'Esta categoria é reservada ao sistema.');
  const id = uuid();
  const repetido = await executarIdempotente(c, chave, [
    insertMov(db, { id, tipo, natureza: d.natureza, valor: d.valor_centavos, forma, categoria, descricao: d.descricao, chave,
      user: c.get('usuario').id, data: hoje(), em: agora() }),
    auditoria(c, 'lancar', 'cash_movements', id, d),
  ]);
  return c.json({ ok: true, id, repetido }, repetido ? 200 : 201);
});

rotasFinanceiro.patch('/financeiro/lancamentos/:id', async c => {
  exigir(c, 'financeiro.lancar');
  const id = c.req.param('id');
  const { descricao } = await lerCorpo(c, z.object({ descricao: z.string().trim().min(2).max(200) }));
  const [r] = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE cash_movements SET descricao = ? WHERE id = ?').bind(descricao, id),
    auditoria(c, 'editar_descricao', 'cash_movements', id, { descricao }),
  ]);
  if (!r.meta.changes) throw naoEncontrado('Lançamento');
  return c.json({ ok: true });
});

rotasFinanceiro.get('/financeiro/lancamentos', async c => {
  exigir(c, 'financeiro.ver');
  const de = c.req.query('de') || hoje();
  const ate = c.req.query('ate') || hoje();
  if (!zData.safeParse(de).success || !zData.safeParse(ate).success) throw new ErroApp(422, 'dados_invalidos', 'Período inválido.');
  const tipo = c.req.query('tipo');
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.data, m.tipo, m.natureza, m.valor_centavos, m.descricao, m.estorno_de, m.order_id, m.criado_em,
       p.nome AS forma, p.eh_credito_cliente, fc.nome AS categoria, o.numero AS os_numero, cl.nome AS cliente, u.nome AS usuario,
       (SELECT e.id FROM cash_movements e WHERE e.estorno_de = m.id) AS estornado_por
     FROM cash_movements m JOIN payment_methods p ON p.id = m.forma_id JOIN finance_categories fc ON fc.id = m.categoria_id
     LEFT JOIN orders o ON o.id = m.order_id LEFT JOIN clients cl ON cl.id = m.client_id LEFT JOIN users u ON u.id = m.criado_por
     WHERE m.data BETWEEN ? AND ? ${tipo === 'entrada' || tipo === 'saida' ? 'AND m.tipo = ?' : ''}
     ORDER BY m.criado_em DESC LIMIT 1000`,
  ).bind(de, ate, ...(tipo === 'entrada' || tipo === 'saida' ? [tipo] : [])).all();
  return c.json({ lancamentos: results });
});

/* ---------------------------------------------------------------------------
 * Caixa do dia
 * ------------------------------------------------------------------------- */
export async function resumoCaixa(db: D1Database, data: string) {
  const sessao = await db.prepare(
    `SELECT s.*, ua.nome AS aberto_por_nome, uf.nome AS fechado_por_nome FROM cash_sessions s
     LEFT JOIN users ua ON ua.id = s.aberto_por LEFT JOIN users uf ON uf.id = s.fechado_por WHERE s.data = ?`,
  ).bind(data).first<Record<string, unknown> & { saldo_inicial_centavos: number; contado_centavos: number | null; fechado_em: string | null }>();
  const { results: porForma } = await db.prepare(
    `SELECT p.id, p.nome, p.eh_dinheiro, p.eh_credito_cliente,
       COALESCE(SUM(CASE WHEN m.tipo = 'entrada' THEN m.valor_centavos END), 0) AS entradas,
       COALESCE(SUM(CASE WHEN m.tipo = 'saida' THEN m.valor_centavos END), 0) AS saidas
     FROM payment_methods p LEFT JOIN cash_movements m ON m.forma_id = p.id AND m.data = ?
     GROUP BY p.id HAVING entradas > 0 OR saidas > 0 OR p.eh_dinheiro = 1 ORDER BY p.ordem`,
  ).bind(data).all<{ id: string; nome: string; eh_dinheiro: number; eh_credito_cliente: number; entradas: number; saidas: number }>();
  const dinheiroNovo = porForma.filter(f => !f.eh_credito_cliente);
  const entradas = dinheiroNovo.reduce((s, f) => s + f.entradas, 0);
  const saidas = dinheiroNovo.reduce((s, f) => s + f.saidas, 0);
  const din = porForma.filter(f => f.eh_dinheiro).reduce((s, f) => s + f.entradas - f.saidas, 0);
  const esperado = sessao ? sessao.saldo_inicial_centavos + din : null;
  return {
    data, sessao, por_forma: porForma, entradas, saidas, resultado: entradas - saidas,
    dinheiro_esperado: esperado,
    diferenca: sessao?.fechado_em && esperado !== null ? (sessao.contado_centavos ?? 0) - esperado : null,
  };
}

rotasFinanceiro.get('/caixa', async c => {
  exigir(c, 'financeiro.ver');
  const data = c.req.query('data') || hoje();
  if (!zData.safeParse(data).success) throw new ErroApp(422, 'dados_invalidos', 'Data inválida.');
  const resumo = await resumoCaixa(c.env.DB, data);
  const { results: lancamentos } = await c.env.DB.prepare(
    `SELECT m.id, m.tipo, m.natureza, m.valor_centavos, m.descricao, m.criado_em, m.order_id, m.estorno_de, p.nome AS forma,
       fc.nome AS categoria, o.numero AS os_numero, u.nome AS usuario, (SELECT e.id FROM cash_movements e WHERE e.estorno_de = m.id) AS estornado_por
     FROM cash_movements m JOIN payment_methods p ON p.id = m.forma_id JOIN finance_categories fc ON fc.id = m.categoria_id
     LEFT JOIN orders o ON o.id = m.order_id LEFT JOIN users u ON u.id = m.criado_por WHERE m.data = ? ORDER BY m.criado_em DESC`,
  ).bind(data).all();
  return c.json({ ...resumo, lancamentos, hoje: hoje() });
});

rotasFinanceiro.post('/caixa/abrir', async c => {
  exigir(c, 'caixa.operar');
  const d = await lerCorpo(c, z.object({ saldo_inicial_centavos: zCentavos }));
  const id = uuid();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO cash_sessions (id, data, saldo_inicial_centavos, aberto_em, aberto_por) VALUES (?,?,?,?,?)')
        .bind(id, hoje(), d.saldo_inicial_centavos, agora(), c.get('usuario').id),
      auditoria(c, 'abrir', 'cash_sessions', id, d),
    ]);
  } catch (e) {
    const fechado = await c.env.DB.prepare('SELECT fechado_em FROM cash_sessions WHERE data = ?').bind(hoje()).first<{ fechado_em: string | null }>();
    if (fechado?.fechado_em) throw new ErroApp(409, 'caixa_fechado', 'O caixa de hoje já foi fechado. Peça ao administrador para reabrir.');
    if (fechado) return c.json({ ok: true, ja_aberto: true });
    throw traduzirErroBanco(e) ?? e;
  }
  return c.json({ ok: true }, 201);
});

rotasFinanceiro.post('/caixa/fechar', async c => {
  exigir(c, 'caixa.operar');
  const d = await lerCorpo(c, z.object({ contado_centavos: zCentavos, observacoes: z.string().trim().max(500).default('') }));
  const [r] = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE cash_sessions SET fechado_em = ?, fechado_por = ?, contado_centavos = ?, observacoes = ? WHERE data = ? AND fechado_em IS NULL')
      .bind(agora(), c.get('usuario').id, d.contado_centavos, d.observacoes, hoje()),
    auditoria(c, 'fechar', 'cash_sessions', hoje(), d),
  ]);
  if (!r.meta.changes) throw new ErroApp(409, 'caixa_nao_aberto', 'Não há caixa aberto hoje.');
  return c.json(await resumoCaixa(c.env.DB, hoje()));
});

rotasFinanceiro.post('/caixa/reabrir', async c => {
  exigir(c, 'caixa.reabrir');
  const { motivo } = await lerCorpo(c, z.object({ motivo: z.string().trim().min(3, 'Informe o motivo da reabertura.').max(300) }));
  const ant = await c.env.DB.prepare('SELECT contado_centavos FROM cash_sessions WHERE data = ? AND fechado_em IS NOT NULL').bind(hoje()).first();
  if (!ant) throw new ErroApp(409, 'caixa_nao_fechado', 'O caixa de hoje não está fechado.');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE cash_sessions SET fechado_em = NULL, fechado_por = NULL, contado_centavos = NULL, reaberto_em = ?, reaberto_por = ? WHERE data = ?')
      .bind(agora(), c.get('usuario').id, hoje()),
    auditoria(c, 'reabrir', 'cash_sessions', hoje(), { motivo, contado_anterior: ant.contado_centavos }),
  ]);
  return c.json({ ok: true });
});

/* ---------------------------------------------------------------------------
 * A receber
 * ------------------------------------------------------------------------- */
rotasFinanceiro.get('/financeiro/receber', async c => {
  exigir(c, 'financeiro.ver');
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.numero, o.prazo, o.status, c.id AS client_id, c.nome AS cliente, c.telefone, c.whatsapp, t.total, t.pago, (t.total - t.pago) AS saldo
     FROM orders o JOIN vw_order_totals t ON t.order_id = o.id JOIN clients c ON c.id = o.client_id
     WHERE o.status <> 'cancelada' AND t.total - t.pago > 0 ORDER BY (o.status = 'pronta' OR o.status = 'entregue') DESC, o.prazo`,
  ).all<{ saldo: number }>();
  const { results: creditos } = await c.env.DB.prepare(
    `SELECT c.id, c.nome, SUM(cc.valor_centavos) AS saldo FROM customer_credits cc JOIN clients c ON c.id = cc.client_id
     GROUP BY c.id HAVING saldo > 0 ORDER BY c.nome`,
  ).all();
  return c.json({ ordens: results, total: results.reduce((s, r) => s + r.saldo, 0), creditos });
});
