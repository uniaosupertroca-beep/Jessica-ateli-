import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ErroApp } from '../lib/erros';
import { exigir, hoje, pode, zData } from '../lib/util';
import { lerConfigAtelie } from './config';
import { resumoCaixa } from './financeiro';
import { somarDias } from '../../public/js/regras.js';

/** Início (painel do dia) e agenda de entregas. */
export const rotasPainel = new Hono<AppEnv>();

rotasPainel.get('/inicio', async c => {
  const db = c.env.DB;
  const h = hoje();
  const amanha = somarDias(h, 1);
  const u = c.get('usuario');
  const verValores = pode(c, 'os.financeiro.ver');
  const costureira = u.papel === 'costureira';
  const vis = costureira
    ? { sql: 'AND (o.responsavel_id = ? OR EXISTS (SELECT 1 FROM order_items vi WHERE vi.order_id = o.id AND vi.responsavel_id = ?))', b: [u.id, u.id] }
    : { sql: '', b: [] as unknown[] };
  const lista = (cond: string, ...b: unknown[]) => db.prepare(
    `SELECT o.id, o.numero, o.prazo, o.status, c.nome AS cliente, t.total - t.pago AS saldo,
       (SELECT GROUP_CONCAT(peca, ', ') FROM (SELECT peca FROM order_items WHERE order_id = o.id ORDER BY posicao)) AS pecas
     FROM orders o JOIN clients c ON c.id = o.client_id JOIN vw_order_totals t ON t.order_id = o.id
     WHERE ${cond} ${vis.sql} ORDER BY o.prazo, o.numero LIMIT 50`,
  ).bind(...b, ...vis.b).all();
  const [cfg, contagens, hojeL, amanhaL, prontas, atrasadas] = await Promise.all([
    lerConfigAtelie(db),
    db.prepare(
      `SELECT
         SUM(o.status NOT IN ('entregue','cancelada')) AS abertas,
         SUM(o.status IN ('em_producao','ajustes_finais')) AS em_producao,
         SUM(o.status = 'aguardando_prova') AS aguardando_prova,
         SUM(o.status = 'pronta') AS prontas,
         SUM(o.prazo = ?1 AND o.status <> 'cancelada') AS entregas_hoje,
         SUM(o.prazo < ?1 AND o.status NOT IN ('entregue','cancelada')) AS atrasadas
       FROM orders o WHERE 1 = 1 ${vis.sql}`,
    ).bind(h, ...vis.b).first(),
    lista("o.prazo = ? AND o.status <> 'cancelada'", h),
    lista("o.prazo = ? AND o.status <> 'cancelada'", amanha),
    lista("o.status = 'pronta'"),
    lista("o.prazo < ? AND o.status NOT IN ('entregue','cancelada')", h),
  ]);
  let financeiro = null;
  if (verValores) {
    const mes = h.slice(0, 7);
    const [caixa, receber, recebidoMes] = await Promise.all([
      resumoCaixa(db, h),
      db.prepare("SELECT COALESCE(SUM(t.total - t.pago), 0) AS v FROM orders o JOIN vw_order_totals t ON t.order_id = o.id WHERE o.status <> 'cancelada' AND t.total > t.pago").first<{ v: number }>(),
      db.prepare(
        `SELECT COALESCE(SUM(CASE WHEN m.tipo = 'entrada' THEN m.valor_centavos ELSE -m.valor_centavos END), 0) AS v
         FROM cash_movements m JOIN payment_methods p ON p.id = m.forma_id
         WHERE substr(m.data, 1, 7) = ? AND p.eh_credito_cliente = 0
           AND m.categoria_id IN ('fc-servicos', 'fc-credito', 'fc-devolucao')`,
      ).bind(mes).first<{ v: number }>(),
    ]);
    financeiro = {
      caixa_aberto: !!caixa.sessao && !caixa.sessao.fechado_em, caixa_existe: !!caixa.sessao,
      entradas_hoje: caixa.entradas, saidas_hoje: caixa.saidas, a_receber: receber?.v ?? 0, recebido_mes: recebidoMes?.v ?? 0,
    };
  }
  const tirarValores = (r: { results: Record<string, unknown>[] }) => (verValores ? r.results : r.results.map(x => ({ ...x, saldo: undefined })));
  return c.json({
    hoje: h, capacidade: cfg.capacidade_diaria, contagens, financeiro,
    entregas_hoje: tirarValores(hojeL), entregas_amanha: tirarValores(amanhaL), prontas: tirarValores(prontas), atrasadas: tirarValores(atrasadas),
  });
});

rotasPainel.get('/agenda', async c => {
  exigir(c, 'agenda.ver');
  const de = c.req.query('de') || hoje();
  const ate = c.req.query('ate') || somarDias(de, 41);
  if (!zData.safeParse(de).success || !zData.safeParse(ate).success || ate < de || somarDias(de, 92) < ate)
    throw new ErroApp(422, 'dados_invalidos', 'Período da agenda inválido.');
  const cfg = await lerConfigAtelie(c.env.DB);
  const u = c.get('usuario');
  const costureira = u.papel === 'costureira';
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.numero, o.prazo, o.status, c.nome AS cliente,
       (SELECT GROUP_CONCAT(peca, ', ') FROM (SELECT peca FROM order_items WHERE order_id = o.id ORDER BY posicao)) AS pecas,
       (SELECT COALESCE(SUM(s.tempo_min), 0) FROM order_item_services s JOIN order_items i ON i.id = s.item_id WHERE i.order_id = o.id) AS tempo_min
     FROM orders o JOIN clients c ON c.id = o.client_id
     WHERE o.prazo BETWEEN ? AND ? AND o.status <> 'cancelada'
       ${costureira ? 'AND (o.responsavel_id = ? OR EXISTS (SELECT 1 FROM order_items vi WHERE vi.order_id = o.id AND vi.responsavel_id = ?))' : ''}
     ORDER BY o.prazo, o.numero`,
  ).bind(de, ate, ...(costureira ? [u.id, u.id] : [])).all();
  // A ocupação conta todas as OS do dia (capacidade do ateliê), mesmo as que a costureira não vê.
  const { results: ocupacao } = await c.env.DB.prepare(
    "SELECT prazo, COUNT(*) AS qtd FROM orders WHERE prazo BETWEEN ? AND ? AND status <> 'cancelada' GROUP BY prazo",
  ).bind(de, ate).all();
  return c.json({ de, ate, hoje: hoje(), capacidade: cfg.capacidade_diaria, limite_quase_cheio: cfg.limite_quase_cheio, ordens: results, ocupacao });
});
