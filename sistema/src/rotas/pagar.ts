import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditoria } from '../lib/auditoria';
import { ErroApp, naoEncontrado, traduzirErroBanco } from '../lib/erros';
import { agora, chaveIdempotencia, exigir, hoje, lerCorpo, uuid, zCentavos, zData } from '../lib/util';
import { filtroUnidade, unidadeParaGravar } from '../lib/unidades';

/** Contas a pagar: cadastro, pagamento (vira saída no caixa) e cancelamento. */
export const rotasPagar = new Hono<AppEnv>();

rotasPagar.get('/pagar', async c => {
  exigir(c, 'pagar.ver');
  const status = c.req.query('status') || 'abertas';
  const cond = status === 'abertas' ? "p.status = 'aberta'" : status === 'pagas' ? "p.status = 'paga'" : status === 'canceladas' ? "p.status = 'cancelada'" : '1 = 1';
  // Contas da unidade escolhida e as do grupo (sem unidade).
  const un = filtroUnidade(c, 'p.unit_id');
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, fc.nome AS categoria, s.nome AS fornecedor, (p.status = 'aberta' AND p.vencimento < ?) AS vencida,
       COALESCE((SELECT sigla FROM units WHERE id = p.unit_id), 'Grupo') AS unidade_sigla,
       (SELECT m.id FROM cash_movements m WHERE m.payable_id = p.id AND NOT EXISTS (SELECT 1 FROM cash_movements e WHERE e.estorno_de = m.id)) AS movimento_id
     FROM payables p JOIN finance_categories fc ON fc.id = p.categoria_id LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE ${cond} AND (${un.sql} OR p.unit_id IS NULL) ORDER BY CASE p.status WHEN 'aberta' THEN 0 ELSE 1 END, p.vencimento LIMIT 500`,
  ).bind(hoje(), ...un.binds).all<{ status: string; valor_centavos: number; vencida: number }>();
  const abertas = results.filter(r => r.status === 'aberta');
  return c.json({
    contas: results,
    total_aberto: abertas.reduce((s, r) => s + r.valor_centavos, 0),
    total_vencido: abertas.filter(r => r.vencida).reduce((s, r) => s + r.valor_centavos, 0),
  });
});

rotasPagar.post('/pagar', async c => {
  exigir(c, 'pagar.editar');
  const d = await lerCorpo(c, z.object({
    descricao: z.string().trim().min(2, 'Informe a descrição.').max(200),
    categoria_id: z.string().min(1, 'Escolha a categoria.'),
    supplier_id: z.string().max(64).optional().nullable(),
    valor_centavos: zCentavos.refine(v => v > 0, 'Informe um valor maior que zero.'),
    vencimento: zData,
    observacoes: z.string().trim().max(1000).default(''),
    parcelas: z.number().int().min(1).max(36).default(1),
    do_grupo: z.boolean().default(false), // despesa de todas as unidades (ex.: contador)
  }));
  const unitConta = d.do_grupo ? null : unidadeParaGravar(c);
  const cat = await c.env.DB.prepare('SELECT tipo, ativo FROM finance_categories WHERE id = ?').bind(d.categoria_id).first<{ tipo: string; ativo: number }>();
  if (!cat || cat.tipo !== 'saida' || !cat.ativo) throw new ErroApp(422, 'categoria_invalida', 'Escolha uma categoria de saída.');
  // Parcelas: valores divididos em centavos (a última leva a diferença), vencimentos mês a mês.
  const base = Math.floor(d.valor_centavos / d.parcelas);
  const stmts: D1PreparedStatement[] = [];
  const ids: string[] = [];
  for (let i = 0; i < d.parcelas; i++) {
    const [a, m, dia] = d.vencimento.split('-').map(Number);
    const dt = new Date(Date.UTC(a, m - 1 + i, 1));
    const ultimo = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    dt.setUTCDate(Math.min(dia, ultimo));
    const valor = i === d.parcelas - 1 ? d.valor_centavos - base * (d.parcelas - 1) : base;
    const id = uuid();
    ids.push(id);
    stmts.push(c.env.DB.prepare(`INSERT INTO payables (id, descricao, categoria_id, supplier_id, valor_centavos, vencimento, observacoes, criado_em, criado_por, unit_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id, d.parcelas > 1 ? `${d.descricao} (${i + 1}/${d.parcelas})` : d.descricao, d.categoria_id, d.supplier_id ?? null,
      valor, dt.toISOString().slice(0, 10), d.observacoes, agora(), c.get('usuario').id, unitConta));
  }
  stmts.push(auditoria(c, 'criar', 'payables', ids[0], { descricao: d.descricao, valor: d.valor_centavos, parcelas: d.parcelas }));
  await c.env.DB.batch(stmts);
  return c.json({ ids }, 201);
});

rotasPagar.post('/pagar/:id/pagar', async c => {
  exigir(c, 'pagar.editar');
  const chave = chaveIdempotencia(c);
  const db = c.env.DB;
  const id = c.req.param('id');
  if (await db.prepare('SELECT 1 FROM cash_movements WHERE idempotency_key = ?').bind(chave).first()) return c.json({ ok: true, repetido: true });
  const { forma_id } = await lerCorpo(c, z.object({ forma_id: z.string().min(1, 'Escolha a forma de pagamento.') }));
  const p = await db.prepare('SELECT descricao, valor_centavos, categoria_id, status, unit_id FROM payables WHERE id = ?').bind(id)
    .first<{ descricao: string; valor_centavos: number; categoria_id: string; status: string; unit_id: string | null }>();
  if (!p || (p.unit_id && !c.get('unidades').includes(p.unit_id))) throw naoEncontrado('Conta');
  const unit = unidadeParaGravar(c); // sai do caixa da unidade que está pagando
  if (p.status !== 'aberta') throw new ErroApp(409, 'conta_nao_aberta', p.status === 'paga' ? 'Esta conta já foi paga.' : 'Esta conta foi cancelada.');
  const f = await db.prepare('SELECT eh_credito_cliente, ativo FROM payment_methods WHERE id = ?').bind(forma_id).first<{ eh_credito_cliente: number; ativo: number }>();
  if (!f || !f.ativo || f.eh_credito_cliente) throw new ErroApp(422, 'forma_invalida', 'Forma de pagamento inválida.');
  const em = agora();
  try {
    await db.batch([
      db.prepare("INSERT INTO guards (motivo) SELECT 'conta_nao_aberta' FROM payables WHERE id = ? AND status <> 'aberta'").bind(id),
      db.prepare(`INSERT INTO cash_movements (id, data, tipo, natureza, valor_centavos, forma_id, categoria_id, descricao, payable_id, idempotency_key, criado_em, criado_por, unit_id)
        VALUES (?,?, 'saida', 'avulso', ?,?,?,?,?,?,?,?,?)`).bind(uuid(), hoje(), p.valor_centavos, forma_id, p.categoria_id, `Conta paga: ${p.descricao}`, id, chave, em, c.get('usuario').id, unit),
      db.prepare("UPDATE payables SET status = 'paga', paga_em = ? WHERE id = ?").bind(hoje(), id),
      auditoria(c, 'pagar', 'payables', id, { forma_id }),
    ]);
  } catch (e) {
    if (await db.prepare('SELECT 1 FROM cash_movements WHERE idempotency_key = ?').bind(chave).first()) return c.json({ ok: true, repetido: true });
    throw traduzirErroBanco(e) ?? e;
  }
  return c.json({ ok: true }, 201);
});

rotasPagar.post('/pagar/:id/cancelar', async c => {
  exigir(c, 'pagar.editar');
  const id = c.req.param('id');
  const { motivo } = await lerCorpo(c, z.object({ motivo: z.string().trim().min(3, 'Informe o motivo.').max(300) }));
  const p = await c.env.DB.prepare('SELECT unit_id FROM payables WHERE id = ?').bind(id).first<{ unit_id: string | null }>();
  if (!p || (p.unit_id && !c.get('unidades').includes(p.unit_id))) throw naoEncontrado('Conta');
  const [r] = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE payables SET status = 'cancelada', motivo_cancelamento = ? WHERE id = ? AND status = 'aberta'").bind(motivo, id),
    auditoria(c, 'cancelar', 'payables', id, { motivo }),
  ]);
  if (!r.meta.changes) throw new ErroApp(409, 'conta_nao_aberta', 'Só contas em aberto podem ser canceladas.');
  return c.json({ ok: true });
});
