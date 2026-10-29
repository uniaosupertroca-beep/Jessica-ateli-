import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ErroApp } from '../lib/erros';
import { exigir, pode, textoBusca, zData } from '../lib/util';
import { filtroUnidade } from '../lib/unidades';

/** Pesquisa geral (clientes, OS, peças e materiais) e consulta da auditoria. */
export const rotasBusca = new Hono<AppEnv>();

rotasBusca.get('/busca', async c => {
  const q = textoBusca(c.req.query('q') || '');
  if (q.length < 2) return c.json({ clientes: [], ordens: [], pecas: [], materiais: [] });
  const db = c.env.DB;
  const u = c.get('usuario');
  const dig = q.replace(/\D/g, '');
  const costureira = u.papel === 'costureira';
  const visC = costureira ? 'AND (o.responsavel_id = ? OR EXISTS (SELECT 1 FROM order_items vi WHERE vi.order_id = o.id AND vi.responsavel_id = ?))' : '';
  const un = filtroUnidade(c, 'o.unit_id');
  const vis = `AND ${un.sql} ${visC}`;
  const vb = [...un.binds, ...(costureira ? [u.id, u.id] : [])];
  const [clientes, ordens, pecas, materiais] = await Promise.all([
    pode(c, 'clientes.ver')
      ? db.prepare(`SELECT id, nome, telefone FROM clients WHERE ativo = 1 AND (nome_busca LIKE ? ${dig.length >= 4 ? 'OR telefone LIKE ? OR whatsapp LIKE ?' : ''}) ORDER BY nome_busca LIMIT 8`)
        .bind(`%${q}%`, ...(dig.length >= 4 ? [`%${dig}%`, `%${dig}%`] : [])).all().then(r => r.results)
      : [],
    pode(c, 'os.ver')
      ? db.prepare(`SELECT o.id, o.numero, o.status, o.prazo, c.nome AS cliente FROM orders o JOIN clients c ON c.id = o.client_id
          WHERE (${/^\d+$/.test(q) ? 'o.numero = ? OR ' : ''}c.nome_busca LIKE ?) ${vis} ORDER BY o.numero DESC LIMIT 8`)
        .bind(...(/^\d+$/.test(q) ? [Number(q)] : []), `%${q}%`, ...vb).all().then(r => r.results)
      : [],
    pode(c, 'os.ver')
      ? db.prepare(`SELECT i.codigo, i.peca, i.order_id, o.numero FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE (i.codigo LIKE ? OR i.peca_busca LIKE ?) ${vis} ORDER BY o.numero DESC LIMIT 8`).bind(`${q}%`, `%${q}%`, ...vb).all().then(r => r.results)
      : [],
    pode(c, 'estoque.ver')
      ? db.prepare('SELECT id, codigo, nome, quantidade, unidade FROM materials WHERE ativo = 1 AND (lower(nome) LIKE ? OR lower(codigo) LIKE ?) LIMIT 6')
        .bind(`%${q}%`, `%${q}%`).all().then(r => r.results)
      : [],
  ]);
  return c.json({ clientes, ordens, pecas, materiais });
});

rotasBusca.get('/auditoria', async c => {
  exigir(c, 'auditoria.ver');
  const conds: string[] = [];
  const binds: unknown[] = [];
  for (const [p, sql] of [['entidade', 'a.entidade = ?'], ['usuario', 'a.user_id = ?'], ['acao', 'a.acao = ?']] as const) {
    const v = c.req.query(p);
    if (v) { conds.push(sql); binds.push(v); }
  }
  const de = c.req.query('de');
  const ate = c.req.query('ate');
  if (de) { if (!zData.safeParse(de).success) throw new ErroApp(422, 'dados_invalidos', 'Data inválida.'); conds.push("date(a.em, '-3 hours') >= ?"); binds.push(de); }
  if (ate) { if (!zData.safeParse(ate).success) throw new ErroApp(422, 'dados_invalidos', 'Data inválida.'); conds.push("date(a.em, '-3 hours') <= ?"); binds.push(ate); }
  const { results } = await c.env.DB.prepare(
    `SELECT a.em, a.acao, a.entidade, a.entidade_id, a.dados, a.ip, u.nome AS usuario FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY a.em DESC LIMIT 300`,
  ).bind(...binds).all();
  return c.json({ registros: results });
});
