import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditoria } from '../lib/auditoria';
import { ErroApp, naoEncontrado, traduzirErroBanco } from '../lib/erros';
import { agora, chaveIdempotencia, exigir, hoje, lerCorpo, pode, textoBusca, uuid, zCentavos, zData } from '../lib/util';
import { osVisivel } from './ordens';
import { filtroUnidade, unidadeParaGravar } from '../lib/unidades';
import { CATEGORIAS_MATERIAL, UNIDADES_ESTOQUE } from '../../public/js/regras.js';

export const rotasEstoque = new Hono<AppEnv>();

const zQtd = z.number({ error: 'Quantidade inválida.' }).positive('A quantidade deve ser maior que zero.').max(1_000_000)
  .refine(q => Math.round(q * 1000) === q * 1000 || Math.abs(Math.round(q * 1000) - q * 1000) < 1e-6, 'Use no máximo 3 casas decimais.');

type Material = { id: string; nome: string; unidade: string; quantidade: number; custo_medio_centavos: number; ativo: number };

async function lerMaterial(db: D1Database, id: string) {
  const m = await db.prepare('SELECT id, nome, unidade, quantidade, custo_medio_centavos, ativo FROM materials WHERE id = ?').bind(id).first<Material>();
  if (!m) throw naoEncontrado('Material');
  return m;
}

async function jaFeito(db: D1Database, chave: string) {
  return !!(await db.prepare('SELECT 1 FROM stock_movements WHERE idempotency_key = ? OR idempotency_key LIKE ?').bind(chave, `${chave}:%`).first());
}

const insertMov = (db: D1Database, m: { id?: string; material: string; tipo: string; qtd: number; custo: number; order?: string | null; item?: string | null;
  purchase?: string | null; reverte?: string | null; motivo: string; negativo?: boolean; chave?: string | null; user: string; em: string; unit: string;
  transferencia?: string | null }) =>
  db.prepare(`INSERT INTO stock_movements (id, material_id, tipo, quantidade, custo_unitario_centavos, order_id, item_id, purchase_id, reverte_de, motivo,
      autorizado_negativo, idempotency_key, criado_em, criado_por, unit_id, transferencia_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(m.id ?? uuid(), m.material, m.tipo, m.qtd, m.custo, m.order ?? null, m.item ?? null, m.purchase ?? null, m.reverte ?? null, m.motivo,
      m.negativo ? 1 : 0, m.chave ?? null, m.em, m.user, m.unit, m.transferencia ?? null);

/** Saldo do material numa unidade. */
async function saldoNaUnidade(db: D1Database, materialId: string, unitId: string) {
  const r = await db.prepare('SELECT COALESCE(SUM(quantidade), 0) AS q FROM stock_movements WHERE material_id = ? AND unit_id = ?').bind(materialId, unitId)
    .first<{ q: number }>();
  return Math.round((r?.q ?? 0) * 1000) / 1000;
}

async function executar(c: Context<AppEnv>, chave: string, stmts: D1PreparedStatement[]) {
  try {
    await c.env.DB.batch(stmts);
    return false;
  } catch (e) {
    if (await jaFeito(c.env.DB, chave)) return true;
    throw traduzirErroBanco(e) ?? e;
  }
}

/* ---------------------------------------------------------------- materiais */
rotasEstoque.get('/estoque/materiais', async c => {
  exigir(c, 'estoque.ver');
  const q = textoBusca(c.req.query('q') || '');
  const conds = [c.req.query('inativos') === '1' ? '1 = 1' : 'm.ativo = 1'];
  const binds: unknown[] = [];
  if (q) { conds.push('(lower(m.nome) LIKE ? OR lower(m.codigo) LIKE ?)'); binds.push(`%${q}%`, `%${q}%`); }
  const cat = c.req.query('categoria');
  if (cat) { conds.push('m.categoria = ?'); binds.push(cat); }
  // Saldo da unidade escolhida no topo; na visão "todas", a soma das unidades permitidas.
  const un = filtroUnidade(c, 'sm.unit_id');
  const saldo = `ROUND(COALESCE((SELECT SUM(sm.quantidade) FROM stock_movements sm WHERE sm.material_id = m.id AND ${un.sql}), 0), 3)`;
  if (c.req.query('baixo') === '1') { conds.push(`${saldo} <= m.estoque_minimo`); binds.push(...un.binds); }
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.codigo, m.nome, m.categoria, m.unidade, ${saldo} AS quantidade, m.quantidade AS quantidade_total, m.estoque_minimo,
       m.custo_medio_centavos, m.localizacao, m.ativo, m.supplier_id, s.nome AS fornecedor, (${saldo} <= m.estoque_minimo) AS abaixo_minimo
     FROM materials m LEFT JOIN suppliers s ON s.id = m.supplier_id WHERE ${conds.join(' AND ')} ORDER BY m.categoria, m.nome LIMIT 1000`,
  ).bind(...un.binds, ...un.binds, ...binds).all();
  const verCusto = pode(c, 'os.financeiro.ver');
  return c.json({ materiais: verCusto ? results : results.map(r => ({ ...r, custo_medio_centavos: undefined })) });
});

const zMaterial = z.object({
  codigo: z.string().trim().min(1, 'Informe o código.').max(30),
  nome: z.string().trim().min(2, 'Informe o nome.').max(120),
  categoria: z.enum(Object.keys(CATEGORIAS_MATERIAL) as [string, ...string[]]),
  unidade: z.enum(Object.keys(UNIDADES_ESTOQUE) as [string, ...string[]]),
  estoque_minimo: z.number().min(0).max(1_000_000).default(0),
  supplier_id: z.string().max(64).optional().nullable(),
  localizacao: z.string().trim().max(80).default(''),
  ativo: z.boolean().default(true),
});

rotasEstoque.post('/estoque/materiais', async c => {
  exigir(c, 'estoque.movimentar');
  const d = await lerCorpo(c, zMaterial);
  const id = uuid();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO materials (id, codigo, nome, categoria, unidade, estoque_minimo, supplier_id, localizacao, ativo, criado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id, d.codigo, d.nome, d.categoria, d.unidade, d.estoque_minimo, d.supplier_id ?? null, d.localizacao, d.ativo ? 1 : 0, agora()),
      auditoria(c, 'criar', 'materials', id, d),
    ]);
  } catch (e) {
    if (/UNIQUE constraint failed: materials\.codigo/.test(String(e))) throw new ErroApp(409, 'codigo_em_uso', 'Já existe material com este código.');
    throw e;
  }
  return c.json({ id }, 201);
});

rotasEstoque.put('/estoque/materiais/:id', async c => {
  exigir(c, 'estoque.movimentar');
  const id = c.req.param('id');
  const d = await lerCorpo(c, zMaterial);
  const atual = await c.env.DB.prepare('SELECT unidade, (SELECT COUNT(*) FROM stock_movements WHERE material_id = materials.id) AS movs FROM materials WHERE id = ?')
    .bind(id).first<{ unidade: string; movs: number }>();
  if (!atual) throw naoEncontrado('Material');
  if (atual.unidade !== d.unidade && atual.movs > 0)
    throw new ErroApp(409, 'unidade_fixa', 'A unidade não pode mudar depois que o material teve movimentações. Cadastre um material novo.');
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE materials SET codigo=?, nome=?, categoria=?, unidade=?, estoque_minimo=?, supplier_id=?, localizacao=?, ativo=? WHERE id = ?`)
        .bind(d.codigo, d.nome, d.categoria, d.unidade, d.estoque_minimo, d.supplier_id ?? null, d.localizacao, d.ativo ? 1 : 0, id),
      auditoria(c, 'editar', 'materials', id, d),
    ]);
  } catch (e) {
    if (/UNIQUE constraint failed: materials\.codigo/.test(String(e))) throw new ErroApp(409, 'codigo_em_uso', 'Já existe material com este código.');
    throw e;
  }
  return c.json({ ok: true });
});

rotasEstoque.get('/estoque/materiais/:id/movimentos', async c => {
  exigir(c, 'estoque.ver');
  const id = c.req.param('id');
  const verCusto = pode(c, 'os.financeiro.ver');
  const { results } = await c.env.DB.prepare(
    `SELECT sm.id, sm.tipo, sm.quantidade, sm.custo_unitario_centavos, sm.motivo, sm.criado_em, sm.reverte_de, sm.autorizado_negativo,
       o.numero AS os_numero, sm.order_id, i.codigo AS peca_codigo, u.nome AS usuario, p.documento, sm.transferencia_id,
       (SELECT sigla FROM units WHERE id = sm.unit_id) AS unidade_sigla,
       (SELECT r.id FROM stock_movements r WHERE r.reverte_de = sm.id) AS revertido_por
     FROM stock_movements sm LEFT JOIN orders o ON o.id = sm.order_id LEFT JOIN order_items i ON i.id = sm.item_id
     LEFT JOIN users u ON u.id = sm.criado_por LEFT JOIN purchases p ON p.id = sm.purchase_id
     WHERE sm.material_id = ? AND ${filtroUnidade(c, 'sm.unit_id').sql} ORDER BY sm.criado_em DESC LIMIT 500`,
  ).bind(id, ...filtroUnidade(c, 'sm.unit_id').binds).all();
  return c.json({ movimentos: verCusto ? results : results.map(r => ({ ...r, custo_unitario_centavos: undefined })) });
});

/* ---------------------------------------------------------------- movimentações */
rotasEstoque.post('/estoque/movimentos', async c => {
  exigir(c, 'estoque.movimentar');
  const chave = chaveIdempotencia(c);
  const db = c.env.DB;
  if (await jaFeito(db, chave)) return c.json({ ok: true, repetido: true });
  const d = await lerCorpo(c, z.object({
    material_id: z.string().min(1),
    tipo: z.enum(['compra', 'devolucao', 'perda', 'ajuste']),
    quantidade: zQtd.optional(),               // compra, devolução, perda
    contado: z.number().min(0).max(1_000_000).optional(), // ajuste: saldo contado no inventário
    custo_unitario_centavos: z.number().min(0).max(100_000_000).default(0),
    motivo: z.string().trim().max(300).default(''),
    supplier_id: z.string().max(64).optional().nullable(),
    documento: z.string().trim().max(60).default(''),
    pagamento: z.enum(['nenhum', 'conta', 'pago']).default('nenhum'),
    forma_id: z.string().max(64).optional(),
    vencimento: zData.optional(),
    autorizar_negativo: z.boolean().optional(),
  }));
  if (d.autorizar_negativo) exigir(c, 'estoque.negativo');
  const m = await lerMaterial(db, d.material_id);
  const unit = unidadeParaGravar(c);
  const u = c.get('usuario').id;
  const em = agora();
  const stmts: D1PreparedStatement[] = [];
  let qtd: number;
  if (d.tipo === 'ajuste') {
    if (d.contado === undefined) throw new ErroApp(422, 'dados_invalidos', 'Informe a quantidade contada.');
    const atual = await saldoNaUnidade(db, m.id, unit);
    qtd = Math.round((d.contado - atual) * 1000) / 1000;
    if (qtd === 0) return c.json({ ok: true, sem_diferenca: true });
    if (!d.motivo) throw new ErroApp(422, 'motivo', 'Informe o motivo do ajuste.');
    // O saldo da unidade não pode ter mudado entre a contagem e o registro.
    stmts.push(db.prepare(`INSERT INTO guards (motivo) SELECT 'saldo_mudou' WHERE ROUND(COALESCE((SELECT SUM(quantidade) FROM stock_movements
      WHERE material_id = ? AND unit_id = ?), 0), 3) <> ?`).bind(m.id, unit, atual));
  } else {
    if (!d.quantidade) throw new ErroApp(422, 'dados_invalidos', 'Informe a quantidade.');
    qtd = d.tipo === 'perda' ? -d.quantidade : d.quantidade;
    if (d.tipo === 'perda' && !d.motivo) throw new ErroApp(422, 'motivo', 'Informe o motivo da perda.');
  }
  let purchaseId: string | null = null;
  if (d.tipo === 'compra') {
    const total = Math.round(d.quantidade! * d.custo_unitario_centavos);
    purchaseId = uuid();
    stmts.push(db.prepare('INSERT INTO purchases (id, supplier_id, data, documento, total_centavos, criado_em, criado_por, unit_id) VALUES (?,?,?,?,?,?,?,?)')
      .bind(purchaseId, d.supplier_id ?? null, hoje(), d.documento, total, em, u, unit));
    const descricao = `Compra: ${m.nome}${d.documento ? ' · ' + d.documento : ''}`;
    if (d.pagamento !== 'nenhum' && total <= 0) throw new ErroApp(422, 'dados_invalidos', 'Informe o custo unitário para gerar o pagamento.');
    if (d.pagamento === 'conta') {
      exigir(c, 'pagar.editar');
      stmts.push(db.prepare(`INSERT INTO payables (id, descricao, categoria_id, supplier_id, purchase_id, valor_centavos, vencimento, criado_em, criado_por, unit_id)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(uuid(), descricao, 'fc-material', d.supplier_id ?? null, purchaseId, total, d.vencimento ?? hoje(), em, u, unit));
    }
    if (d.pagamento === 'pago') {
      exigir(c, 'financeiro.lancar');
      if (!d.forma_id) throw new ErroApp(422, 'forma_invalida', 'Escolha a forma de pagamento.');
      const f = await db.prepare('SELECT eh_credito_cliente, ativo FROM payment_methods WHERE id = ?').bind(d.forma_id).first<{ eh_credito_cliente: number; ativo: number }>();
      if (!f || !f.ativo || f.eh_credito_cliente) throw new ErroApp(422, 'forma_invalida', 'Forma de pagamento inválida.');
      stmts.push(db.prepare(`INSERT INTO cash_movements (id, data, tipo, natureza, valor_centavos, forma_id, categoria_id, descricao, idempotency_key, criado_em, criado_por, unit_id)
        VALUES (?,?, 'saida', 'avulso', ?,?, 'fc-material', ?,?,?,?,?)`).bind(uuid(), hoje(), total, d.forma_id, descricao, `${chave}:caixa`, em, u, unit));
    }
  }
  stmts.push(insertMov(db, {
    material: m.id, tipo: d.tipo, qtd, custo: d.tipo === 'perda' ? m.custo_medio_centavos : d.custo_unitario_centavos,
    purchase: purchaseId, motivo: d.motivo, negativo: d.autorizar_negativo, chave, user: u, em, unit,
  }), auditoria(c, 'estoque_' + d.tipo, 'materials', m.id, { quantidade: qtd, motivo: d.motivo, unidade: unit }));
  const repetido = await executar(c, chave, stmts);
  return c.json({ ok: true, repetido, quantidade: qtd }, repetido ? 200 : 201);
});

/** Baixa de material usado numa OS (o custo entra na margem real da OS). */
rotasEstoque.post('/estoque/consumos', async c => {
  exigir(c, 'estoque.consumir');
  const chave = chaveIdempotencia(c);
  const db = c.env.DB;
  if (await jaFeito(db, chave)) return c.json({ ok: true, repetido: true });
  const d = await lerCorpo(c, z.object({
    order_id: z.string().min(1, 'Informe a OS.'),
    item_id: z.string().max(64).optional().nullable(),
    material_id: z.string().min(1, 'Escolha o material.'),
    quantidade: zQtd,
    motivo: z.string().trim().max(300).default(''),
    autorizar_negativo: z.boolean().optional(),
  }));
  if (d.autorizar_negativo) exigir(c, 'estoque.negativo');
  await osVisivel(c, d.order_id);
  const os = await db.prepare('SELECT status, unit_id FROM orders WHERE id = ?').bind(d.order_id).first<{ status: string; unit_id: string }>();
  if (os?.status === 'cancelada') throw new ErroApp(409, 'os_cancelada', 'Não se lança material em OS cancelada.');
  if (d.item_id) {
    const ok = await db.prepare('SELECT 1 FROM order_items WHERE id = ? AND order_id = ?').bind(d.item_id, d.order_id).first();
    if (!ok) throw new ErroApp(422, 'peca_invalida', 'A peça não pertence a esta OS.');
  }
  const m = await lerMaterial(db, d.material_id);
  if (!m.ativo) throw new ErroApp(422, 'material_inativo', 'Material desativado.');
  const repetido = await executar(c, chave, [
    insertMov(db, { material: m.id, tipo: 'consumo', qtd: -d.quantidade, custo: m.custo_medio_centavos, order: d.order_id, item: d.item_id ?? null,
      motivo: d.motivo, negativo: d.autorizar_negativo, chave, user: c.get('usuario').id, em: agora(), unit: os!.unit_id }),
    auditoria(c, 'estoque_consumo', 'orders', d.order_id, { material: m.id, quantidade: d.quantidade }),
  ]);
  return c.json({ ok: true, repetido }, repetido ? 200 : 201);
});

/** Desfaz uma movimentação (registro novo em sentido contrário; o original fica no histórico). */
rotasEstoque.post('/estoque/movimentos/:id/reverter', async c => {
  exigir(c, 'estoque.movimentar');
  const chave = chaveIdempotencia(c);
  const db = c.env.DB;
  if (await jaFeito(db, chave)) return c.json({ ok: true, repetido: true });
  const { motivo, autorizar_negativo } = await lerCorpo(c, z.object({
    motivo: z.string().trim().min(3, 'Informe o motivo.').max(300), autorizar_negativo: z.boolean().optional(),
  }));
  if (autorizar_negativo) exigir(c, 'estoque.negativo');
  const o = await db.prepare('SELECT * FROM stock_movements WHERE id = ?').bind(c.req.param('id'))
    .first<{ id: string; material_id: string; tipo: string; quantidade: number; custo_unitario_centavos: number; order_id: string | null; item_id: string | null; unit_id: string }>();
  if (!o || !c.get('unidades').includes(o.unit_id)) throw naoEncontrado('Movimentação');
  if (o.tipo === 'reversao') throw new ErroApp(409, 'reversao_invalida', 'Uma reversão não pode ser revertida.');
  if (o.tipo === 'transferencia') throw new ErroApp(409, 'reversao_invalida', 'Para desfazer uma transferência, transfira de volta.');
  const repetido = await executar(c, chave, [
    insertMov(db, { material: o.material_id, tipo: 'reversao', qtd: -o.quantidade, custo: o.custo_unitario_centavos, order: o.order_id, item: o.item_id,
      reverte: o.id, motivo, negativo: autorizar_negativo, chave, user: c.get('usuario').id, em: agora(), unit: o.unit_id }),
    auditoria(c, 'estoque_reverter', 'stock_movements', o.id, { motivo }),
  ]);
  return c.json({ ok: true, repetido }, repetido ? 200 : 201);
});

/** Transferência de material entre unidades: sai da unidade escolhida e entra na de destino, num lote só. */
rotasEstoque.post('/estoque/transferencias', async c => {
  exigir(c, 'estoque.movimentar');
  const chave = chaveIdempotencia(c);
  const db = c.env.DB;
  if (await jaFeito(db, chave)) return c.json({ ok: true, repetido: true });
  const d = await lerCorpo(c, z.object({
    material_id: z.string().min(1),
    para_unit_id: z.string().min(1, 'Escolha a unidade de destino.'),
    quantidade: zQtd,
    motivo: z.string().trim().max(300).default(''),
  }));
  const origem = unidadeParaGravar(c);
  if (d.para_unit_id === origem) throw new ErroApp(422, 'dados_invalidos', 'Escolha uma unidade de destino diferente.');
  const destino = await db.prepare('SELECT nome, ativo FROM units WHERE id = ?').bind(d.para_unit_id).first<{ nome: string; ativo: number }>();
  if (!destino?.ativo) throw new ErroApp(422, 'unidade_invalida', 'Unidade de destino inválida.');
  const m = await lerMaterial(db, d.material_id);
  if (m.unidade === 'un' && !Number.isInteger(d.quantidade)) throw new ErroApp(422, 'dados_invalidos', 'Material em unidades: use número inteiro.');
  const t = uuid();
  const u = c.get('usuario').id;
  const em = agora();
  const repetido = await executar(c, chave, [
    insertMov(db, { material: m.id, tipo: 'transferencia', qtd: -d.quantidade, custo: m.custo_medio_centavos, motivo: d.motivo || `Para ${destino.nome}`,
      chave, user: u, em, unit: origem, transferencia: t }),
    insertMov(db, { material: m.id, tipo: 'transferencia', qtd: d.quantidade, custo: m.custo_medio_centavos, motivo: d.motivo || 'Recebido por transferência',
      chave: `${chave}:destino`, user: u, em, unit: d.para_unit_id, transferencia: t }),
    auditoria(c, 'estoque_transferir', 'materials', m.id, { de: origem, para: d.para_unit_id, quantidade: d.quantidade }),
  ]);
  return c.json({ ok: true, repetido }, repetido ? 200 : 201);
});

/* ---------------------------------------------------------------- fornecedores */
const zFornecedor = z.object({
  nome: z.string().trim().min(2, 'Informe o nome.').max(120),
  telefone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  documento: z.string().trim().max(30).optional().nullable(),
  observacoes: z.string().trim().max(1000).default(''),
  ativo: z.boolean().default(true),
});

rotasEstoque.get('/estoque/fornecedores', async c => {
  exigir(c, 'estoque.ver');
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM materials m WHERE m.supplier_id = s.id) AS materiais FROM suppliers s ORDER BY s.ativo DESC, s.nome`,
  ).all();
  return c.json({ fornecedores: results });
});

rotasEstoque.post('/estoque/fornecedores', async c => {
  exigir(c, 'estoque.movimentar');
  const d = await lerCorpo(c, zFornecedor);
  const id = uuid();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO suppliers (id, nome, telefone, email, documento, observacoes, ativo, criado_em) VALUES (?,?,?,?,?,?,?,?)')
        .bind(id, d.nome, d.telefone || null, d.email || null, d.documento || null, d.observacoes, d.ativo ? 1 : 0, agora()),
      auditoria(c, 'criar', 'suppliers', id, { nome: d.nome }),
    ]);
  } catch (e) {
    if (/UNIQUE constraint failed: suppliers/.test(String(e))) throw new ErroApp(409, 'nome_em_uso', 'Já existe fornecedor com este nome.');
    throw e;
  }
  return c.json({ id }, 201);
});

rotasEstoque.put('/estoque/fornecedores/:id', async c => {
  exigir(c, 'estoque.movimentar');
  const id = c.req.param('id');
  const d = await lerCorpo(c, zFornecedor);
  const [r] = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE suppliers SET nome=?, telefone=?, email=?, documento=?, observacoes=?, ativo=? WHERE id = ?')
      .bind(d.nome, d.telefone || null, d.email || null, d.documento || null, d.observacoes, d.ativo ? 1 : 0, id),
    auditoria(c, 'editar', 'suppliers', id, { nome: d.nome }),
  ]);
  if (!r.meta.changes) throw naoEncontrado('Fornecedor');
  return c.json({ ok: true });
});
