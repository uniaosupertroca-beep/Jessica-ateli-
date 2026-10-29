import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ErroApp, naoEncontrado } from '../lib/erros';
import { exigir, hoje, textoBusca } from '../lib/util';
import { STATUS_DE_PRODUCAO, somarDias } from '../../public/js/regras.js';

/** Quadro de produção (Kanban), consulta de peça pelo código da etiqueta e eventos. */
export const rotasProducao = new Hono<AppEnv>();

const PROD = STATUS_DE_PRODUCAO.map((s: string) => `'${s}'`).join(',');

rotasProducao.get('/producao', async c => {
  exigir(c, 'producao.ver');
  const u = c.get('usuario');
  const h = hoje();
  const conds = [`o.status IN (${PROD})`];
  const binds: unknown[] = [];
  // Costureira vê as peças dela e as que ainda não têm responsável (para poder assumir).
  if (u.papel === 'costureira') {
    conds.push('(i.responsavel_id = ? OR i.responsavel_id IS NULL)');
    binds.push(u.id);
  }
  const resp = c.req.query('responsavel');
  if (resp === 'sem') conds.push('i.responsavel_id IS NULL');
  else if (resp) {
    conds.push('i.responsavel_id = ?');
    binds.push(resp);
  }
  const prazo = c.req.query('prazo');
  if (prazo === 'atrasadas') { conds.push("COALESCE(i.prazo, o.prazo) < ? AND i.status_producao <> 'finalizado'"); binds.push(h); }
  if (prazo === 'hoje') { conds.push('COALESCE(i.prazo, o.prazo) <= ?'); binds.push(h); }
  if (prazo === 'semana') { conds.push('COALESCE(i.prazo, o.prazo) <= ?'); binds.push(somarDias(h, 7)); }
  if (c.req.query('urgentes') === '1') conds.push('i.urgente = 1');
  const q = textoBusca(c.req.query('q') || '');
  if (q) {
    conds.push('(c.nome_busca LIKE ? OR i.codigo LIKE ? OR i.peca_busca LIKE ? OR CAST(o.numero AS TEXT) = ?)');
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`, q);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.codigo, i.peca, i.descricao, i.status_producao, i.responsavel_id, u.nome AS responsavel_nome, i.urgente, i.obs_interna,
       i.tempo_real_min, i.iniciado_em, i.retrabalhos, COALESCE(i.prazo, o.prazo) AS prazo, o.id AS order_id, o.numero, o.status AS status_os,
       c.nome AS cliente,
       (SELECT COALESCE(SUM(s.tempo_min), 0) FROM order_item_services s WHERE s.item_id = i.id) AS tempo_previsto,
       (SELECT GROUP_CONCAT(s.descricao, ', ') FROM order_item_services s WHERE s.item_id = i.id) AS servicos,
       (SELECT MIN(a.dia || ' ' || COALESCE(a.hora_inicio, '')) FROM appointments a
          WHERE a.order_id = o.id AND a.tipo = 'prova' AND a.status = 'agendado' AND a.dia >= ?) AS proxima_prova
     FROM order_items i JOIN orders o ON o.id = i.order_id JOIN clients c ON c.id = o.client_id LEFT JOIN users u ON u.id = i.responsavel_id
     WHERE ${conds.join(' AND ')}
     ORDER BY i.urgente DESC, COALESCE(i.prazo, o.prazo), o.numero, i.seq LIMIT 500`,
  ).bind(h, ...binds).all();
  // Carga de cada profissional: tempo previsto das peças não finalizadas atribuídas a ela.
  const { results: carga } = await c.env.DB.prepare(
    `SELECT u.id, u.nome, u.capacidade_min_dia,
       COALESCE(SUM(CASE WHEN i.status_producao <> 'finalizado' THEN (SELECT COALESCE(SUM(s.tempo_min),0) FROM order_item_services s WHERE s.item_id = i.id) END), 0) AS carga_min,
       COUNT(CASE WHEN i.status_producao <> 'finalizado' THEN 1 END) AS pecas
     FROM users u LEFT JOIN order_items i ON i.responsavel_id = u.id
       AND EXISTS (SELECT 1 FROM orders o WHERE o.id = i.order_id AND o.status IN (${PROD}))
     WHERE u.ativo = 1 AND (u.capacidade_min_dia > 0 OR u.papel = 'costureira') GROUP BY u.id ORDER BY u.nome`,
  ).all();
  return c.json({ hoje: h, pecas: results, profissionais: carga });
});

rotasProducao.get('/producao/:itemId/eventos', async c => {
  exigir(c, 'producao.ver');
  const u = c.get('usuario');
  if (u.papel === 'costureira') {
    const ok = await c.env.DB.prepare('SELECT 1 FROM order_items WHERE id = ? AND (responsavel_id = ? OR responsavel_id IS NULL)').bind(c.req.param('itemId'), u.id).first();
    if (!ok) throw naoEncontrado('Peça');
  }
  const { results } = await c.env.DB.prepare(
    `SELECT e.tipo, e.minutos, e.texto, e.em, u.nome AS usuario FROM production_events e LEFT JOIN users u ON u.id = e.user_id
     WHERE e.item_id = ? ORDER BY e.em DESC LIMIT 100`,
  ).bind(c.req.param('itemId')).all();
  return c.json({ eventos: results });
});
