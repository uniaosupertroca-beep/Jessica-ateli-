import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditoria } from '../lib/auditoria';
import { ErroApp, naoEncontrado } from '../lib/erros';
import { agora, exigir, hoje, lerCorpo, pode, textoBusca, uuid, zData } from '../lib/util';
import { normalizarTelefone } from '../../public/js/regras.js';

export const rotasClientes = new Hono<AppEnv>();

const zTelefone = z.string().trim().max(40).optional().nullable().transform((v, ctx) => {
  if (!v) return null;
  const n = normalizarTelefone(v);
  if (!n.valido) {
    ctx.addIssue({ code: 'custom', message: n.motivo });
    return z.NEVER;
  }
  return n.digitos as string;
});

const zCliente = z.object({
  nome: z.string().trim().min(2, 'Informe o nome completo.').max(120),
  telefone: zTelefone,
  whatsapp: zTelefone,
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('E-mail inválido.').max(200)]).optional().nullable(),
  nascimento: z.union([z.literal(''), zData]).optional().nullable(),
  endereco: z.string().trim().max(300).optional().nullable(),
  observacoes: z.string().trim().max(2000).default(''),
  preferencias: z.string().trim().max(2000).default(''),
  origem: z.union([z.literal(''), z.enum(['indicacao', 'instagram', 'facebook', 'google', 'whatsapp', 'passou_na_frente', 'cliente_antiga', 'outro'])]).optional().nullable(),
  confirmar_duplicado: z.boolean().optional(),
});

/** Possíveis duplicidades: mesmo telefone/WhatsApp ou mesmo nome (sem acentos). */
async function buscarDuplicados(db: D1Database, nomeBusca: string, fones: string[], ignorarId?: string) {
  const conds = ['nome_busca = ?'];
  const binds: unknown[] = [nomeBusca];
  for (const f of fones) {
    conds.push('telefone = ?', 'whatsapp = ?');
    binds.push(f, f);
  }
  const { results } = await db.prepare(
    `SELECT id, nome, telefone, whatsapp, criado_em FROM clients WHERE (${conds.join(' OR ')}) ${ignorarId ? 'AND id <> ?' : ''} LIMIT 5`,
  ).bind(...binds, ...(ignorarId ? [ignorarId] : [])).all();
  return results;
}

rotasClientes.get('/', async c => {
  exigir(c, 'clientes.ver');
  const q = textoBusca(c.req.query('q') || '');
  const digitos = q.replace(/\D/g, '');
  const conds: string[] = [];
  const binds: unknown[] = [];
  if (c.req.query('inativos') !== '1') conds.push('c.ativo = 1');
  if (q) {
    if (digitos.length >= 3) {
      conds.push('(c.nome_busca LIKE ? OR c.telefone LIKE ? OR c.whatsapp LIKE ?)');
      binds.push(`%${q}%`, `%${digitos}%`, `%${digitos}%`);
    } else {
      conds.push('c.nome_busca LIKE ?');
      binds.push(`%${q}%`);
    }
  }
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.nome, c.telefone, c.whatsapp, c.observacoes, c.criado_em, c.ativo,
       (SELECT COUNT(*) FROM orders o WHERE o.client_id = c.id AND o.status <> 'cancelada') AS qtd_os,
       (SELECT COALESCE(SUM(MAX(t.total - t.pago, 0)), 0) FROM orders o JOIN vw_order_totals t ON t.order_id = o.id
          WHERE o.client_id = c.id AND o.status <> 'cancelada') AS em_aberto,
       COALESCE((SELECT SUM(valor_centavos) FROM customer_credits cc WHERE cc.client_id = c.id), 0) AS credito
     FROM clients c ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
     ORDER BY c.nome_busca LIMIT 200`,
  ).bind(...binds).all();
  const verValores = pode(c, 'os.financeiro.ver');
  return c.json({ clientes: verValores ? results : results.map(r => ({ ...r, em_aberto: undefined, credito: undefined })) });
});

rotasClientes.post('/', async c => {
  exigir(c, 'clientes.editar');
  const d = await lerCorpo(c, zCliente);
  if (d.nascimento && d.nascimento > hoje()) throw new ErroApp(422, 'dados_invalidos', 'Data de nascimento no futuro.');
  const nomeBusca = textoBusca(d.nome);
  if (!d.confirmar_duplicado) {
    const dup = await buscarDuplicados(c.env.DB, nomeBusca, [d.telefone, d.whatsapp].filter(Boolean) as string[]);
    if (dup.length)
      throw new ErroApp(409, 'possivel_duplicado', 'Já existe cliente com este nome ou telefone. Confira antes de cadastrar outra.', { candidatos: dup });
  }
  const id = uuid();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO clients (id, nome, nome_busca, telefone, whatsapp, email, nascimento, endereco, observacoes, preferencias,
        criado_em, criado_por, origem) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, d.nome, nomeBusca, d.telefone, d.whatsapp, d.email || null, d.nascimento || null, d.endereco || null,
        d.observacoes, d.preferencias, agora(), c.get('usuario').id, d.origem || null),
    auditoria(c, 'criar', 'clients', id, { nome: d.nome }),
  ]);
  return c.json({ id }, 201);
});

rotasClientes.put('/:id', async c => {
  exigir(c, 'clientes.editar');
  const id = c.req.param('id');
  const d = await lerCorpo(c, zCliente.extend({ ativo: z.boolean().default(true) }));
  const nomeBusca = textoBusca(d.nome);
  if (!d.confirmar_duplicado) {
    const dup = await buscarDuplicados(c.env.DB, nomeBusca, [d.telefone, d.whatsapp].filter(Boolean) as string[], id);
    if (dup.length)
      throw new ErroApp(409, 'possivel_duplicado', 'Já existe outra cliente com este nome ou telefone.', { candidatos: dup });
  }
  const [r] = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE clients SET nome=?, nome_busca=?, telefone=?, whatsapp=?, email=?, nascimento=?, endereco=?, observacoes=?,
        preferencias=?, ativo=?, atualizado_em=?, origem=? WHERE id = ?`)
      .bind(d.nome, nomeBusca, d.telefone, d.whatsapp, d.email || null, d.nascimento || null, d.endereco || null, d.observacoes,
        d.preferencias, d.ativo ? 1 : 0, agora(), d.origem || null, id),
    auditoria(c, 'editar', 'clients', id, { nome: d.nome }),
  ]);
  if (!r.meta.changes) throw naoEncontrado('Cliente');
  return c.json({ ok: true });
});

rotasClientes.get('/:id', async c => {
  exigir(c, 'clientes.ver');
  const id = c.req.param('id');
  const db = c.env.DB;
  const cliente = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!cliente) throw naoEncontrado('Cliente');
  delete cliente.nome_busca;
  const verValores = pode(c, 'os.financeiro.ver');
  const [ordens, pagamentos, credito, creditos, fotos, mensagens] = await Promise.all([
    db.prepare(`SELECT o.id, o.numero, o.aberta_em, o.prazo, o.status, t.total, t.pago, (t.total - t.pago) AS saldo,
          un.sigla AS unidade_sigla,
          (SELECT GROUP_CONCAT(peca, ', ') FROM (SELECT peca FROM order_items WHERE order_id = o.id ORDER BY posicao)) AS pecas,
          (SELECT GROUP_CONCAT(descricao, ', ') FROM (SELECT s.descricao FROM order_item_services s JOIN order_items i ON i.id = s.item_id
              WHERE i.order_id = o.id ORDER BY i.posicao, s.posicao)) AS servicos
        FROM orders o JOIN vw_order_totals t ON t.order_id = o.id LEFT JOIN units un ON un.id = o.unit_id WHERE o.client_id = ? ORDER BY o.numero DESC`).bind(id).all(),
    verValores
      ? db.prepare(`SELECT m.id, m.data, m.tipo, m.natureza, m.valor_centavos, m.descricao, m.estorno_de, p.nome AS forma, o.numero AS os_numero, m.order_id,
            (SELECT 1 FROM cash_movements e WHERE e.estorno_de = m.id) AS estornado
          FROM cash_movements m JOIN payment_methods p ON p.id = m.forma_id LEFT JOIN orders o ON o.id = m.order_id
          WHERE m.client_id = ? OR m.order_id IN (SELECT id FROM orders WHERE client_id = ?) ORDER BY m.criado_em DESC`).bind(id, id).all()
      : Promise.resolve({ results: [] }),
    db.prepare('SELECT COALESCE(SUM(valor_centavos), 0) AS saldo FROM customer_credits WHERE client_id = ?').bind(id).first<{ saldo: number }>(),
    verValores
      ? db.prepare('SELECT id, valor_centavos, descricao, criado_em, order_id FROM customer_credits WHERE client_id = ? ORDER BY criado_em DESC').bind(id).all()
      : Promise.resolve({ results: [] }),
    db.prepare(`SELECT f.id, f.order_id, f.item_id, f.categoria, f.criado_em, o.numero FROM order_photos f JOIN orders o ON o.id = f.order_id
        WHERE o.client_id = ? AND f.excluida_em IS NULL ORDER BY f.criado_em DESC LIMIT 60`).bind(id).all(),
    db.prepare(`SELECT ml.modelo, ml.situacao, ml.criado_em, o.numero FROM message_logs ml LEFT JOIN orders o ON o.id = ml.order_id
        WHERE ml.client_id = ? ORDER BY ml.criado_em DESC LIMIT 30`).bind(id).all(),
  ]);
  const os = verValores ? ordens.results : ordens.results.map(o => ({ ...o, total: undefined, pago: undefined, saldo: undefined }));
  return c.json({
    cliente, ordens: os, pagamentos: pagamentos.results,
    credito: verValores ? credito?.saldo ?? 0 : undefined, creditos: creditos.results, fotos: fotos.results, mensagens: mensagens.results,
  });
});

/** Exportação completa dos dados da cliente (atendimento a pedidos LGPD). */
rotasClientes.get('/:id/exportar', async c => {
  exigir(c, 'clientes.exportar');
  const id = c.req.param('id');
  const db = c.env.DB;
  const cliente = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
  if (!cliente) throw naoEncontrado('Cliente');
  const q = (sql: string) => db.prepare(sql).bind(id).all().then(r => r.results);
  const dados = {
    exportado_em: agora(),
    cliente,
    ordens: await q('SELECT * FROM orders WHERE client_id = ?'),
    pecas: await q('SELECT i.* FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.client_id = ?'),
    servicos: await q('SELECT s.* FROM order_item_services s JOIN order_items i ON i.id = s.item_id JOIN orders o ON o.id = i.order_id WHERE o.client_id = ?'),
    pagamentos: await q('SELECT * FROM cash_movements WHERE client_id = ? OR order_id IN (SELECT id FROM orders WHERE client_id = ?1)'),
    creditos: await q('SELECT * FROM customer_credits WHERE client_id = ?'),
    fichas_medidas: await q('SELECT * FROM client_measurements WHERE client_id = ?'),
    medicoes: await q('SELECT v.* FROM measurement_versions v JOIN client_measurements f ON f.id = v.ficha_id WHERE f.client_id = ?'),
    valores_medidas: await q(`SELECT mv.*, mf.nome AS campo FROM measurement_values mv JOIN measurement_versions v ON v.id = mv.version_id
       JOIN client_measurements f ON f.id = v.ficha_id JOIN measurement_fields mf ON mf.id = mv.field_id WHERE f.client_id = ?`),
    fotos: await q('SELECT f.id, f.order_id, f.item_id, f.categoria, f.criado_em, f.excluida_em FROM order_photos f JOIN orders o ON o.id = f.order_id WHERE o.client_id = ?'),
    mensagens: await q('SELECT * FROM message_logs WHERE client_id = ?'),
  };
  await auditoria(c, 'exportar', 'clients', id).run();
  return c.json(dados, 200, { 'Content-Disposition': `attachment; filename="cliente-${id}.json"` });
});

/**
 * Exclusão controlada de dados pessoais: apaga contato, observações e fotos, mantendo
 * os registros financeiros e de OS (obrigação legal/contábil) sem identificar a pessoa.
 */
rotasClientes.post('/:id/anonimizar', async c => {
  exigir(c, 'clientes.anonimizar');
  const id = c.req.param('id');
  await lerCorpo(c, z.object({ confirmacao: z.literal('ANONIMIZAR', { error: 'Digite ANONIMIZAR para confirmar.' }) }));
  const db = c.env.DB;
  const existe = await db.prepare('SELECT id FROM clients WHERE id = ?').bind(id).first();
  if (!existe) throw naoEncontrado('Cliente');
  const { results: fotos } = await db.prepare(
    'SELECT f.id, f.r2_key FROM order_photos f JOIN orders o ON o.id = f.order_id WHERE o.client_id = ? AND f.excluida_em IS NULL',
  ).bind(id).all<{ id: string; r2_key: string }>();
  if (fotos.length) await c.env.FOTOS.delete(fotos.map(f => f.r2_key));
  const u = c.get('usuario').id;
  const nome = `Cliente removida ${id.slice(0, 8)}`;
  await db.batch([
    db.prepare(`UPDATE clients SET nome=?, nome_busca=?, telefone=NULL, whatsapp=NULL, email=NULL, nascimento=NULL, endereco=NULL,
        observacoes='', preferencias='', ativo=0, atualizado_em=? WHERE id = ?`).bind(nome, textoBusca(nome), agora(), id),
    db.prepare(`UPDATE order_photos SET excluida_em=?, excluida_por=? WHERE excluida_em IS NULL AND order_id IN (SELECT id FROM orders WHERE client_id = ?)`)
      .bind(agora(), u, id),
    db.prepare("UPDATE message_logs SET texto = '[removido]' WHERE client_id = ?").bind(id),
    auditoria(c, 'anonimizar', 'clients', id, { fotos_apagadas: fotos.length }),
  ]);
  return c.json({ ok: true });
});
