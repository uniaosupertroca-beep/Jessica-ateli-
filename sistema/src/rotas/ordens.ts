import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditoria } from '../lib/auditoria';
import { ErroApp, naoEncontrado, semPermissao, traduzirErroBanco } from '../lib/erros';
import { recalcularStatus } from '../lib/status';
import { agora, chaveIdempotencia, exigir, hoje, lerCorpo, pode, textoBusca, uuid, zCentavos, zData } from '../lib/util';
import { lerConfigAtelie } from './config';
import { MODELOS_MENSAGEM, STATUS_DE_PRODUCAO, STATUS_OS, subtotal, transicoesManuais } from '../../public/js/regras.js';

export const rotasOrdens = new Hono<AppEnv>();

/* ---------------------------------------------------------------------------
 * Visibilidade: costureira só enxerga OS em que é responsável por alguma peça.
 * ------------------------------------------------------------------------- */
function filtroVisibilidade(c: Context<AppEnv>, alias = 'o') {
  const u = c.get('usuario');
  if (u.papel !== 'costureira') return { sql: '1 = 1', binds: [] as unknown[] };
  return {
    sql: `(${alias}.responsavel_id = ? OR EXISTS (SELECT 1 FROM order_items vi WHERE vi.order_id = ${alias}.id AND vi.responsavel_id = ?))`,
    binds: [u.id, u.id] as unknown[],
  };
}

export async function osVisivel(c: Context<AppEnv>, orderId: string) {
  const f = filtroVisibilidade(c);
  const r = await c.env.DB.prepare(`SELECT o.id FROM orders o WHERE o.id = ? AND ${f.sql}`).bind(orderId, ...f.binds).first();
  if (!r) throw naoEncontrado('Ordem de serviço');
}

/* ---------------------------------------------------------------------------
 * Lista
 * ------------------------------------------------------------------------- */
rotasOrdens.get('/', async c => {
  exigir(c, 'os.ver');
  const q = textoBusca(c.req.query('q') || '').replace(/^(os|n[º°o]?)\s*/, '');
  const status = c.req.query('status') || 'ativas';
  const conds: string[] = [];
  const binds: unknown[] = [];
  const vis = filtroVisibilidade(c);
  conds.push(vis.sql);
  binds.push(...vis.binds);
  if (status === 'ativas') conds.push("o.status NOT IN ('entregue','cancelada')");
  else if (status === 'atrasadas') {
    conds.push("o.status NOT IN ('entregue','cancelada') AND o.prazo < ?");
    binds.push(hoje());
  } else if (status !== 'todas') {
    if (!(status in STATUS_OS)) throw new ErroApp(422, 'dados_invalidos', 'Filtro de status inválido.');
    conds.push('o.status = ?');
    binds.push(status);
  }
  if (q) {
    if (/^\d+$/.test(q)) {
      conds.push('(o.numero = ? OR c.nome_busca LIKE ?)');
      binds.push(Number(q), `%${q}%`);
    } else {
      conds.push('c.nome_busca LIKE ?');
      binds.push(`%${q}%`);
    }
  }
  for (const [p, op] of [['de', '>='], ['ate', '<=']] as const) {
    const v = c.req.query(p);
    if (v) {
      if (!zData.safeParse(v).success) throw new ErroApp(422, 'dados_invalidos', 'Data de filtro inválida.');
      conds.push(`o.prazo ${op} ?`);
      binds.push(v);
    }
  }
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.numero, o.aberta_em, o.prazo, o.status, c.id AS client_id, c.nome AS cliente,
       t.total, t.pago, (t.total - t.pago) AS saldo,
       (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS qtd_pecas,
       (SELECT GROUP_CONCAT(peca, ', ') FROM (SELECT peca FROM order_items WHERE order_id = o.id ORDER BY posicao)) AS pecas
     FROM orders o JOIN clients c ON c.id = o.client_id JOIN vw_order_totals t ON t.order_id = o.id
     WHERE ${conds.join(' AND ')} ORDER BY o.prazo, o.numero LIMIT 500`,
  ).bind(...binds).all();
  const verValores = pode(c, 'os.financeiro.ver');
  return c.json({ ordens: verValores ? results : results.map(r => ({ ...r, total: undefined, pago: undefined, saldo: undefined })) });
});

/* ---------------------------------------------------------------------------
 * Detalhe
 * ------------------------------------------------------------------------- */
export async function carregarOS(c: Context<AppEnv>, id: string) {
  const db = c.env.DB;
  const vis = filtroVisibilidade(c);
  const os = await db.prepare(
    `SELECT o.*, t.soma_itens, t.total, t.pago, (t.total - t.pago) AS saldo, r.nome AS responsavel_nome
     FROM orders o JOIN vw_order_totals t ON t.order_id = o.id LEFT JOIN users r ON r.id = o.responsavel_id
     WHERE o.id = ? AND ${vis.sql}`,
  ).bind(id, ...vis.binds).first<Record<string, unknown>>();
  if (!os) throw naoEncontrado('Ordem de serviço');
  delete os.idempotency_key;
  const verValores = pode(c, 'os.financeiro.ver');
  const verContato = pode(c, 'clientes.ver');
  const [cliente, itens, servicos, historico, fotos, pagamentos, mensagens, credito] = await Promise.all([
    db.prepare(`SELECT id, nome ${verContato ? ', telefone, whatsapp, observacoes, preferencias' : ''} FROM clients WHERE id = ?`).bind(os.client_id).first(),
    db.prepare(`SELECT i.id, i.seq, i.codigo, i.posicao, i.peca, i.descricao, i.prazo, i.responsavel_id, i.status_producao, u.nome AS responsavel_nome
        FROM order_items i LEFT JOIN users u ON u.id = i.responsavel_id WHERE i.order_id = ? ORDER BY i.posicao, i.seq`).bind(id).all(),
    db.prepare(`SELECT s.id, s.item_id, s.service_id, s.descricao, s.unidade, s.quantidade, s.valor_unitario_centavos, s.subtotal_centavos,
          s.tempo_min, s.posicao FROM order_item_services s JOIN order_items i ON i.id = s.item_id WHERE i.order_id = ?
        ORDER BY s.posicao`).bind(id).all(),
    db.prepare(`SELECT h.de, h.para, h.motivo, h.em, h.item_id, u.nome AS usuario FROM order_status_history h LEFT JOIN users u ON u.id = h.user_id
        WHERE h.order_id = ? ORDER BY h.em DESC`).bind(id).all(),
    db.prepare(`SELECT id, item_id, categoria, legenda, criado_em, tamanho FROM order_photos WHERE order_id = ? AND excluida_em IS NULL
        ORDER BY criado_em`).bind(id).all(),
    verValores
      ? db.prepare(`SELECT m.id, m.data, m.tipo, m.natureza, m.valor_centavos, m.descricao, m.estorno_de, m.criado_em, p.nome AS forma,
            p.eh_credito_cliente, u.nome AS usuario, (SELECT e.id FROM cash_movements e WHERE e.estorno_de = m.id) AS estornado_por
          FROM cash_movements m JOIN payment_methods p ON p.id = m.forma_id LEFT JOIN users u ON u.id = m.criado_por
          WHERE m.order_id = ? ORDER BY m.criado_em`).bind(id).all()
      : Promise.resolve({ results: [] }),
    db.prepare(`SELECT ml.modelo, ml.situacao, ml.criado_em, u.nome AS usuario FROM message_logs ml LEFT JOIN users u ON u.id = ml.criado_por
        WHERE ml.order_id = ? ORDER BY ml.criado_em DESC`).bind(id).all(),
    verValores ? db.prepare('SELECT COALESCE(SUM(valor_centavos),0) AS saldo FROM customer_credits WHERE client_id = ?').bind(os.client_id).first<{ saldo: number }>() : null,
  ]);
  const itensComServicos = itens.results.map(i => ({
    ...i,
    servicos: servicos.results.filter(s => s.item_id === i.id).map(s =>
      verValores ? s : { ...s, valor_unitario_centavos: undefined, subtotal_centavos: undefined }),
  }));
  if (!verValores) for (const k of ['soma_itens', 'total', 'pago', 'saldo', 'desconto_centavos']) delete os[k];
  return {
    ...os, cliente, itens: itensComServicos, historico: historico.results, fotos: fotos.results,
    pagamentos: pagamentos.results, mensagens: mensagens.results, credito_cliente: credito?.saldo,
  };
}

rotasOrdens.get('/:id', async c => {
  exigir(c, 'os.ver');
  return c.json(await carregarOS(c, c.req.param('id')));
});

/* ---------------------------------------------------------------------------
 * Criar / editar
 * ------------------------------------------------------------------------- */
const zServicoOS = z.object({
  id: z.string().max(64).optional(),
  service_id: z.string().max(64).optional().nullable(),
  descricao: z.string().trim().min(1, 'Descreva o serviço.').max(200),
  unidade: z.enum(['un', 'm', 'cm', 'h']).default('un'),
  quantidade: z.number({ error: 'Quantidade inválida.' }).positive('A quantidade deve ser maior que zero.').max(100000, 'Quantidade muito alta.'),
  valor_unitario_centavos: zCentavos,
  tempo_min: z.number().int().min(0).max(100000).optional(),
}).refine(s => s.unidade !== 'un' || Number.isInteger(s.quantidade), {
  message: 'Serviço contado em unidades precisa de quantidade inteira (mínimo 1).', path: ['quantidade'],
});

const zItemOS = z.object({
  id: z.string().max(64).optional(),
  peca: z.string().trim().min(1, 'Informe a peça (ex.: Calça jeans).').max(120),
  descricao: z.string().trim().max(1000).default(''),
  prazo: zData.optional().nullable(),
  responsavel_id: z.string().max(64).optional().nullable(),
  servicos: z.array(zServicoOS).min(1, 'Cada peça precisa de pelo menos um serviço.').max(30),
});

const zOS = z.object({
  client_id: z.string().min(1, 'Escolha a cliente.'),
  aberta_em: zData.optional(),
  prazo: zData,
  responsavel_id: z.string().max(64).optional().nullable(),
  desconto_centavos: zCentavos.default(0),
  observacoes: z.string().trim().max(3000).default(''),
  itens: z.array(zItemOS).min(1, 'Adicione pelo menos uma peça.').max(60, 'Máximo de 60 peças por OS.'),
  versao: z.number().int().optional(),
  confirmar_lotado: z.boolean().optional(),
});
type DadosOS = z.infer<typeof zOS>;

/** Ocupação do dia (OS não canceladas com esse prazo) e confirmação quando lotado. */
async function conferirCapacidade(c: Context<AppEnv>, prazo: string, ignorarId: string | null, confirmado?: boolean) {
  const cfg = await lerConfigAtelie(c.env.DB);
  const r = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE prazo = ? AND status <> 'cancelada' AND id IS NOT ?")
    .bind(prazo, ignorarId).first<{ n: number }>();
  const n = r?.n ?? 0;
  if (n >= cfg.capacidade_diaria && !confirmado)
    throw new ErroApp(409, 'dia_lotado', `O dia escolhido já tem ${n} de ${cfg.capacidade_diaria} entregas. Confirme para encaixar mesmo assim.`,
      { ocupacao: n, capacidade: cfg.capacidade_diaria });
}

async function validarReferencias(c: Context<AppEnv>, d: DadosOS) {
  const db = c.env.DB;
  const cli = await db.prepare('SELECT ativo FROM clients WHERE id = ?').bind(d.client_id).first<{ ativo: number }>();
  if (!cli) throw new ErroApp(422, 'cliente_invalida', 'Cliente não encontrada.');
  const usuarios = new Set((await db.prepare('SELECT id FROM users WHERE ativo = 1').all<{ id: string }>()).results.map(u => u.id));
  const resp = [d.responsavel_id, ...d.itens.map(i => i.responsavel_id)].filter(Boolean) as string[];
  if (resp.some(r => !usuarios.has(r))) throw new ErroApp(422, 'responsavel_invalido', 'Profissional responsável inválido ou inativo.');
  const catalogo = new Map((await db.prepare('SELECT id, preco_centavos, tempo_min, ativo, unidade FROM service_catalog').all<{
    id: string; preco_centavos: number; tempo_min: number; ativo: number; unidade: string;
  }>()).results.map(s => [s.id, s]));
  for (const it of d.itens) {
    if (it.prazo && d.aberta_em && it.prazo < d.aberta_em) throw new ErroApp(422, 'dados_invalidos', `O prazo da peça "${it.peca}" é anterior à abertura.`);
    for (const s of it.servicos) if (s.service_id && !catalogo.has(s.service_id)) throw new ErroApp(422, 'servico_invalido', 'Serviço do catálogo não encontrado.');
  }
  return catalogo;
}

type LinhaAtual = { id: string; item_id: string; service_id: string | null; valor_unitario_centavos: number };

/** Sem a permissão de alterar preço: só vale o preço do catálogo (ou o já gravado por quem tinha permissão). */
function conferirPrecos(c: Context<AppEnv>, d: DadosOS, catalogo: Map<string, { preco_centavos: number }>, atuais: LinhaAtual[], descontoAtual: number) {
  if (pode(c, 'os.alterar_preco')) return;
  const porId = new Map(atuais.map(a => [a.id, a]));
  for (const it of d.itens) for (const s of it.servicos) {
    const atual = s.id ? porId.get(s.id) : undefined;
    const inalterado = atual && atual.valor_unitario_centavos === s.valor_unitario_centavos && atual.service_id === (s.service_id ?? null);
    const doCatalogo = s.service_id && catalogo.get(s.service_id)?.preco_centavos === s.valor_unitario_centavos;
    if (!inalterado && !doCatalogo)
      throw new ErroApp(403, 'preco_restrito', 'Somente o administrador pode alterar preços ou lançar item fora do catálogo.');
  }
  if (d.desconto_centavos !== descontoAtual) throw new ErroApp(403, 'preco_restrito', 'Somente o administrador pode dar desconto.');
}

function comandosItens(db: D1Database, orderId: string, d: DadosOS, catalogo: Map<string, { tempo_min: number }>, seqInicial: number,
  existentes: Set<string>, em: string) {
  const stmts: D1PreparedStatement[] = [];
  let seq = seqInicial;
  d.itens.forEach((it, pos) => {
    let itemId = it.id && existentes.has(it.id) ? it.id : null;
    if (itemId) {
      stmts.push(db.prepare('UPDATE order_items SET posicao=?, peca=?, descricao=?, prazo=?, responsavel_id=? WHERE id = ? AND order_id = ?')
        .bind(pos, it.peca, it.descricao, it.prazo ?? null, it.responsavel_id ?? null, itemId, orderId));
    } else {
      itemId = uuid();
      seq += 1;
      stmts.push(db.prepare(
        `INSERT INTO order_items (id, order_id, seq, codigo, posicao, peca, descricao, prazo, responsavel_id, criado_em)
         SELECT ?, ?, ?, numero || '-' || ?, ?, ?, ?, ?, ?, ? FROM orders WHERE id = ?`,
      ).bind(itemId, orderId, seq, String(seq), pos, it.peca, it.descricao, it.prazo ?? null, it.responsavel_id ?? null, em, orderId));
    }
    it.servicos.forEach((s, sp) => {
      const tempo = s.tempo_min ?? (s.service_id ? catalogo.get(s.service_id)?.tempo_min ?? 0 : 0);
      stmts.push(db.prepare(
        `INSERT INTO order_item_services (id, item_id, service_id, descricao, unidade, quantidade, valor_unitario_centavos, subtotal_centavos, tempo_min, posicao)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).bind(uuid(), itemId, s.service_id ?? null, s.descricao, s.unidade, s.quantidade, s.valor_unitario_centavos,
        subtotal(s.quantidade, s.valor_unitario_centavos), tempo, sp));
    });
  });
  return stmts;
}

/** Garante, dentro do lote, que o total não ficou negativo nem menor que o já pago. */
const guardaTotal = (db: D1Database, orderId: string) => db.prepare(
  "INSERT INTO guards (motivo) SELECT 'total_menor_que_pago' FROM vw_order_totals WHERE order_id = ? AND (total < 0 OR total < pago)",
).bind(orderId);

rotasOrdens.post('/', async c => {
  exigir(c, 'os.editar');
  const chave = chaveIdempotencia(c);
  const db = c.env.DB;
  const ja = await db.prepare('SELECT id, numero FROM orders WHERE idempotency_key = ?').bind(chave).first<{ id: string; numero: number }>();
  if (ja) return c.json({ ...ja, repetida: true });
  const d = await lerCorpo(c, zOS);
  d.aberta_em ??= hoje();
  if (d.aberta_em > hoje()) throw new ErroApp(422, 'dados_invalidos', 'A data de abertura não pode estar no futuro.');
  if (d.prazo < d.aberta_em) throw new ErroApp(422, 'dados_invalidos', 'O prazo não pode ser antes da abertura.');
  const catalogo = await validarReferencias(c, d);
  conferirPrecos(c, d, catalogo, [], 0);
  await conferirCapacidade(c, d.prazo, null, d.confirmar_lotado);
  const id = uuid();
  const em = agora();
  const u = c.get('usuario').id;
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO orders (id, numero, client_id, aberta_em, prazo, responsavel_id, desconto_centavos, observacoes, idempotency_key, criado_em, criado_por)
         SELECT ?, COALESCE(MAX(numero), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM orders`,
      ).bind(id, d.client_id, d.aberta_em, d.prazo, d.responsavel_id ?? null, d.desconto_centavos, d.observacoes, chave, em, u),
      ...comandosItens(db, id, d, catalogo, 0, new Set(), em),
      guardaTotal(db, id),
      db.prepare("INSERT INTO order_status_history (id, order_id, de, para, user_id, em) VALUES (?, ?, NULL, 'recebida', ?, ?)").bind(uuid(), id, u, em),
      auditoria(c, 'criar', 'orders', id, { client_id: d.client_id, itens: d.itens.length }),
    ]);
  } catch (e) {
    const rep = await db.prepare('SELECT id, numero FROM orders WHERE idempotency_key = ?').bind(chave).first<{ id: string; numero: number }>();
    if (rep) return c.json({ ...rep, repetida: true });
    throw traduzirErroBanco(e) ?? e;
  }
  const criada = await db.prepare('SELECT numero FROM orders WHERE id = ?').bind(id).first<{ numero: number }>();
  return c.json({ id, numero: criada!.numero }, 201);
});

rotasOrdens.put('/:id', async c => {
  exigir(c, 'os.editar');
  const id = c.req.param('id');
  const db = c.env.DB;
  const d = await lerCorpo(c, zOS);
  if (d.versao === undefined) throw new ErroApp(422, 'dados_invalidos', 'Versão da OS não informada.');
  const atual = await db.prepare('SELECT status, aberta_em, prazo, desconto_centavos, client_id FROM orders WHERE id = ?')
    .bind(id).first<{ status: string; aberta_em: string; prazo: string; desconto_centavos: number; client_id: string }>();
  if (!atual) throw naoEncontrado('Ordem de serviço');
  if (atual.status === 'entregue' || atual.status === 'cancelada') throw new ErroApp(409, 'os_bloqueada', 'OS entregue ou cancelada não pode ser alterada.');
  if (d.client_id !== atual.client_id) {
    const pago = await db.prepare('SELECT pago FROM vw_order_totals WHERE order_id = ?').bind(id).first<{ pago: number }>();
    if (pago?.pago) throw new ErroApp(409, 'troca_cliente', 'Não é possível trocar a cliente de uma OS que já tem pagamentos.');
  }
  d.aberta_em ??= atual.aberta_em;
  if (d.aberta_em > hoje()) throw new ErroApp(422, 'dados_invalidos', 'A data de abertura não pode estar no futuro.');
  if (d.prazo < d.aberta_em) throw new ErroApp(422, 'dados_invalidos', 'O prazo não pode ser antes da abertura.');
  const catalogo = await validarReferencias(c, d);
  const { results: linhas } = await db.prepare(
    'SELECT s.id, s.item_id, s.service_id, s.valor_unitario_centavos FROM order_item_services s JOIN order_items i ON i.id = s.item_id WHERE i.order_id = ?',
  ).bind(id).all<LinhaAtual>();
  conferirPrecos(c, d, catalogo, linhas, atual.desconto_centavos);
  if (d.prazo !== atual.prazo) await conferirCapacidade(c, d.prazo, id, d.confirmar_lotado);
  const { results: itensAtuais } = await db.prepare('SELECT id, seq, peca, status_producao FROM order_items WHERE order_id = ?')
    .bind(id).all<{ id: string; seq: number; peca: string; status_producao: string }>();
  const existentes = new Set(itensAtuais.map(i => i.id));
  const mantidos = new Set(d.itens.map(i => i.id).filter((x): x is string => !!x && existentes.has(x)));
  const removidos = [...existentes].filter(x => !mantidos.has(x));
  const emProducao = itensAtuais.find(i => removidos.includes(i.id) && i.status_producao !== 'aguardando');
  if (emProducao) throw new ErroApp(409, 'peca_em_producao', `A peça "${emProducao.peca}" já entrou em produção e não pode ser removida.`);
  const seqMax = Math.max(0, ...itensAtuais.map(i => i.seq));
  const em = agora();
  const u = c.get('usuario').id;
  try {
    await db.batch([
      db.prepare("INSERT INTO guards (motivo) SELECT 'versao_desatualizada' WHERE NOT EXISTS (SELECT 1 FROM orders WHERE id = ? AND versao = ?)").bind(id, d.versao),
      db.prepare("INSERT INTO guards (motivo) SELECT 'os_bloqueada' FROM orders WHERE id = ? AND status IN ('entregue','cancelada')").bind(id),
      db.prepare(`UPDATE orders SET client_id=?, aberta_em=?, prazo=?, responsavel_id=?, desconto_centavos=?, observacoes=?,
          versao = versao + 1, atualizado_em=? WHERE id = ?`)
        .bind(d.client_id, d.aberta_em, d.prazo, d.responsavel_id ?? null, d.desconto_centavos, d.observacoes, em, id),
      db.prepare('DELETE FROM order_item_services WHERE item_id IN (SELECT id FROM order_items WHERE order_id = ?)').bind(id),
      ...removidos.flatMap(r => [
        db.prepare('UPDATE order_status_history SET item_id = NULL WHERE item_id = ?').bind(r),
        db.prepare('UPDATE client_measurements SET order_item_id = NULL WHERE order_item_id = ?').bind(r),
        db.prepare('DELETE FROM order_items WHERE id = ? AND order_id = ?').bind(r, id),
      ]),
      ...comandosItens(db, id, d, catalogo, seqMax, existentes, em),
      guardaTotal(db, id),
      ...recalcularStatus(db, id, u, em),
      auditoria(c, 'editar', 'orders', id, { itens: d.itens.length, removidos: removidos.length, desconto: d.desconto_centavos }),
    ]);
  } catch (e) {
    throw traduzirErroBanco(e) ?? e;
  }
  return c.json(await carregarOS(c, id));
});

/* ---------------------------------------------------------------------------
 * Mudança manual de status
 * ------------------------------------------------------------------------- */
rotasOrdens.post('/:id/status', async c => {
  exigir(c, 'os.status');
  const id = c.req.param('id');
  const db = c.env.DB;
  const d = await lerCorpo(c, z.object({
    para: z.string(),
    motivo: z.string().trim().max(500).optional(),
    confirmar_saldo_pendente: z.boolean().optional(),
  }));
  const os = await db.prepare(
    `SELECT o.status, o.status_antes_pausa, t.total, t.pago FROM orders o JOIN vw_order_totals t ON t.order_id = o.id WHERE o.id = ?`,
  ).bind(id).first<{ status: string; status_antes_pausa: string | null; total: number; pago: number }>();
  if (!os) throw naoEncontrado('Ordem de serviço');
  if (!transicoesManuais(os.status).includes(d.para))
    throw new ErroApp(409, 'transicao_invalida', `Não é possível ir de "${STATUS_OS[os.status as keyof typeof STATUS_OS]}" para essa situação.`);
  let para = d.para;
  const em = agora();
  const u = c.get('usuario').id;
  const extra: D1PreparedStatement[] = [];
  let sets = '';
  const binds: unknown[] = [];
  if (para === 'cancelada') {
    exigir(c, 'os.cancelar');
    if (!d.motivo) throw new ErroApp(422, 'motivo', 'Informe o motivo do cancelamento.');
    extra.push(db.prepare("INSERT INTO guards (motivo) SELECT 'os_com_pagamento' FROM vw_order_totals WHERE order_id = ? AND pago <> 0").bind(id));
    sets = ', motivo = ?, cancelada_em = ?';
    binds.push(d.motivo, em);
  } else if (para === 'pausada') {
    if (!d.motivo) throw new ErroApp(422, 'motivo', 'Informe o motivo da pausa.');
    sets = ', motivo = ?, status_antes_pausa = ?';
    binds.push(d.motivo, os.status);
  } else if (para === 'retomar') {
    para = os.status_antes_pausa || 'recebida';
    sets = ', status_antes_pausa = NULL';
  } else if (para === 'entregue') {
    const saldo = os.total - os.pago;
    if (saldo > 0 && !d.confirmar_saldo_pendente)
      throw new ErroApp(409, 'saldo_pendente', 'Esta OS ainda tem saldo a receber. Confirme para entregar mesmo assim.', { saldo });
    sets = ', entregue_em = ?';
    binds.push(em);
  } else if (para === 'aguardando_aprovacao' && os.status === 'aprovada') {
    const iniciou = await db.prepare("SELECT 1 FROM order_items WHERE order_id = ? AND status_producao <> 'aguardando'").bind(id).first();
    if (iniciou) throw new ErroApp(409, 'producao_iniciada', 'A produção já começou; não é possível voltar para aprovação.');
  }
  try {
    await db.batch([
      db.prepare("INSERT INTO guards (motivo) SELECT 'versao_desatualizada' WHERE NOT EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = ?)").bind(id, os.status),
      ...extra,
      db.prepare(`UPDATE orders SET status = ?, versao = versao + 1, atualizado_em = ? ${sets} WHERE id = ?`).bind(para, em, ...binds, id),
      db.prepare('INSERT INTO order_status_history (id, order_id, de, para, motivo, user_id, em) VALUES (?,?,?,?,?,?,?)')
        .bind(uuid(), id, os.status, para, d.motivo ?? null, u, em),
      ...(STATUS_DE_PRODUCAO.includes(para) ? recalcularStatus(db, id, u, em) : []),
      auditoria(c, 'status', 'orders', id, { de: os.status, para, motivo: d.motivo }),
    ]);
  } catch (e) {
    throw traduzirErroBanco(e) ?? e;
  }
  return c.json(await carregarOS(c, id));
});

/* ---------------------------------------------------------------------------
 * Produção de cada peça
 * ------------------------------------------------------------------------- */
rotasOrdens.patch('/:id/itens/:itemId', async c => {
  exigir(c, 'producao.atualizar');
  const { id, itemId } = c.req.param();
  const db = c.env.DB;
  const d = await lerCorpo(c, z.object({
    status_producao: z.enum(['aguardando', 'em_execucao', 'aguardando_prova', 'ajustes_finais', 'finalizado']).optional(),
    responsavel_id: z.string().max(64).nullable().optional(),
  }));
  const item = await db.prepare(
    `SELECT i.status_producao, i.responsavel_id, o.status FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = ? AND o.id = ?`,
  ).bind(itemId, id).first<{ status_producao: string; responsavel_id: string | null; status: string }>();
  if (!item) throw naoEncontrado('Peça');
  const u = c.get('usuario');
  if (u.papel === 'costureira' && item.responsavel_id !== u.id) throw semPermissao();
  if (d.responsavel_id !== undefined) {
    exigir(c, 'producao.atribuir');
    if (d.responsavel_id) {
      const ok = await db.prepare('SELECT 1 FROM users WHERE id = ? AND ativo = 1').bind(d.responsavel_id).first();
      if (!ok) throw new ErroApp(422, 'responsavel_invalido', 'Profissional inválido ou inativo.');
    }
  }
  if (d.status_producao && !STATUS_DE_PRODUCAO.includes(item.status))
    throw new ErroApp(409, 'os_nao_aprovada', item.status === 'pausada' ? 'A OS está pausada.' : 'A OS precisa estar aprovada para a produção andar.');
  const em = agora();
  const stmts: D1PreparedStatement[] = [
    db.prepare("INSERT INTO guards (motivo) SELECT 'os_bloqueada' FROM orders WHERE id = ? AND status IN ('entregue','cancelada','pausada')").bind(id),
    db.prepare('UPDATE order_items SET status_producao = COALESCE(?, status_producao), responsavel_id = CASE WHEN ? THEN ? ELSE responsavel_id END WHERE id = ?')
      .bind(d.status_producao ?? null, d.responsavel_id !== undefined ? 1 : 0, d.responsavel_id ?? null, itemId),
  ];
  if (d.status_producao && d.status_producao !== item.status_producao)
    stmts.push(db.prepare('INSERT INTO order_status_history (id, order_id, item_id, de, para, user_id, em) VALUES (?,?,?,?,?,?,?)')
      .bind(uuid(), id, itemId, item.status_producao, d.status_producao, u.id, em));
  stmts.push(...recalcularStatus(db, id, u.id, em), auditoria(c, 'producao', 'order_items', itemId, d));
  try {
    await db.batch(stmts);
  } catch (e) {
    throw traduzirErroBanco(e) ?? e;
  }
  return c.json(await carregarOS(c, id));
});

/* ---------------------------------------------------------------------------
 * WhatsApp: registra que o link foi aberto (não confirma envio)
 * ------------------------------------------------------------------------- */
rotasOrdens.post('/:id/mensagens', async c => {
  exigir(c, 'whatsapp.usar');
  const id = c.req.param('id');
  const d = await lerCorpo(c, z.object({ modelo: z.string(), texto: z.string().max(2000) }));
  if (!(d.modelo in MODELOS_MENSAGEM)) throw new ErroApp(422, 'dados_invalidos', 'Modelo de mensagem inválido.');
  const os = await c.env.DB.prepare('SELECT client_id FROM orders WHERE id = ?').bind(id).first<{ client_id: string }>();
  if (!os) throw naoEncontrado('Ordem de serviço');
  await c.env.DB.prepare('INSERT INTO message_logs (id, client_id, order_id, modelo, texto, criado_em, criado_por) VALUES (?,?,?,?,?,?,?)')
    .bind(uuid(), os.client_id, id, d.modelo, d.texto, agora(), c.get('usuario').id).run();
  return c.json({ ok: true, situacao: 'link_aberto' });
});

/** Dados do ateliê usados na impressão e nas mensagens. */
rotasOrdens.get('/:id/impressao', async c => {
  exigir(c, 'os.ver');
  const os = await carregarOS(c, c.req.param('id'));
  return c.json({ os, atelie: await lerConfigAtelie(c.env.DB) });
});
