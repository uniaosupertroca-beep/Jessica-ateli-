import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditoria } from '../lib/auditoria';
import { ErroApp, naoEncontrado } from '../lib/erros';
import { agora, exigir, hoje, lerCorpo, uuid, zData } from '../lib/util';

export const rotasMedidas = new Hono<AppEnv>();

type Versao = { id: string; ficha_id: string; medido_em: string; observacoes: string; criado_em: string; medido_por_nome: string | null };

/** Fichas da cliente com todas as versões (mais recente primeiro) e os valores de cada uma. */
export async function fichasDaCliente(db: D1Database, clientId: string) {
  const [fichas, versoes, valores] = await Promise.all([
    db.prepare(`SELECT f.id, f.titulo, f.order_item_id, f.criado_em, i.codigo AS peca_codigo, i.peca
        FROM client_measurements f LEFT JOIN order_items i ON i.id = f.order_item_id
        WHERE f.client_id = ? ORDER BY f.criado_em`).bind(clientId).all(),
    db.prepare(`SELECT v.id, v.ficha_id, v.medido_em, v.observacoes, v.criado_em, u.nome AS medido_por_nome
        FROM measurement_versions v JOIN client_measurements f ON f.id = v.ficha_id LEFT JOIN users u ON u.id = v.medido_por
        WHERE f.client_id = ? ORDER BY v.medido_em DESC, v.criado_em DESC`).bind(clientId).all<Versao>(),
    db.prepare(`SELECT mv.version_id, mv.field_id, mv.valor FROM measurement_values mv
        JOIN measurement_versions v ON v.id = mv.version_id JOIN client_measurements f ON f.id = v.ficha_id
        WHERE f.client_id = ?`).bind(clientId).all<{ version_id: string; field_id: string; valor: number }>(),
  ]);
  const porVersao = new Map<string, Record<string, number>>();
  for (const v of valores.results) {
    if (!porVersao.has(v.version_id)) porVersao.set(v.version_id, {});
    porVersao.get(v.version_id)![v.field_id] = v.valor;
  }
  return fichas.results.map(f => ({
    ...f,
    versoes: versoes.results.filter(v => v.ficha_id === f.id).map(v => ({ ...v, valores: porVersao.get(v.id) ?? {} })),
  }));
}

rotasMedidas.get('/clientes/:id/medidas', async c => {
  exigir(c, 'medidas.ver');
  const id = c.req.param('id');
  const cli = await c.env.DB.prepare('SELECT id, nome FROM clients WHERE id = ?').bind(id).first();
  if (!cli) throw naoEncontrado('Cliente');
  return c.json({ cliente: cli, fichas: await fichasDaCliente(c.env.DB, id) });
});

rotasMedidas.post('/clientes/:id/medidas', async c => {
  exigir(c, 'medidas.editar');
  const clientId = c.req.param('id');
  const d = await lerCorpo(c, z.object({
    titulo: z.string().trim().min(2, 'Dê um nome à ficha (ex.: Medidas corporais).').max(120),
    order_item_id: z.string().optional().nullable(),
  }));
  if (d.order_item_id) {
    const ok = await c.env.DB.prepare('SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = ? AND o.client_id = ?')
      .bind(d.order_item_id, clientId).first();
    if (!ok) throw new ErroApp(422, 'peca_invalida', 'A peça escolhida não é desta cliente.');
  }
  const id = uuid();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO client_measurements (id, client_id, titulo, order_item_id, criado_em, criado_por) VALUES (?,?,?,?,?,?)')
      .bind(id, clientId, d.titulo, d.order_item_id ?? null, agora(), c.get('usuario').id),
    auditoria(c, 'criar', 'client_measurements', id, d),
  ]);
  return c.json({ id }, 201);
});

/** Registra uma nova medição. As anteriores nunca são alteradas nem apagadas. */
rotasMedidas.post('/medidas/:fichaId/versoes', async c => {
  exigir(c, 'medidas.editar');
  const fichaId = c.req.param('fichaId');
  const d = await lerCorpo(c, z.object({
    medido_em: zData,
    observacoes: z.string().trim().max(2000).default(''),
    valores: z.record(z.string(), z.number({ error: 'Medida inválida.' }).positive('Medida deve ser maior que zero.').max(399, 'Medida acima de 399 cm.')),
  }));
  if (d.medido_em > hoje()) throw new ErroApp(422, 'dados_invalidos', 'A data da medição não pode estar no futuro.');
  const campos = Object.entries(d.valores).filter(([, v]) => v > 0);
  if (!campos.length) throw new ErroApp(422, 'dados_invalidos', 'Preencha pelo menos uma medida.');
  const db = c.env.DB;
  const ficha = await db.prepare('SELECT id FROM client_measurements WHERE id = ?').bind(fichaId).first();
  if (!ficha) throw naoEncontrado('Ficha de medidas');
  const ids = new Set((await db.prepare('SELECT id FROM measurement_fields').all<{ id: string }>()).results.map(r => r.id));
  for (const [f] of campos) if (!ids.has(f)) throw new ErroApp(422, 'campo_invalido', 'Campo de medida desconhecido.');
  const vid = uuid();
  await db.batch([
    db.prepare('INSERT INTO measurement_versions (id, ficha_id, medido_em, medido_por, observacoes, criado_em) VALUES (?,?,?,?,?,?)')
      .bind(vid, fichaId, d.medido_em, c.get('usuario').id, d.observacoes, agora()),
    ...campos.map(([f, v]) => db.prepare('INSERT INTO measurement_values (version_id, field_id, valor) VALUES (?,?,?)')
      .bind(vid, f, Math.round(v * 10) / 10)),
    auditoria(c, 'medir', 'client_measurements', fichaId, { versao: vid, campos: campos.length }),
  ]);
  return c.json({ id: vid }, 201);
});
