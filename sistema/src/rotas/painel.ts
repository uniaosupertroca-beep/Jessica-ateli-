import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { hoje, pode } from '../lib/util';
import { capacidadeAgenda } from './config';
import { resumoCaixa } from './financeiro';
import { indicadores } from './relatorios';
import { filtroUnidade } from '../lib/unidades';
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
  // Tudo do Início considera a unidade escolhida no topo (ou todas as da pessoa).
  const uo = filtroUnidade(c, 'o.unit_id');
  const ua = filtroUnidade(c, 'a.unit_id');
  const um = filtroUnidade(c, 'm.unit_id');
  const unidades = c.get('unidade') ? [c.get('unidade')!] : c.get('unidades');
  const vis = costureira
    ? { sql: `AND ${uo.sql} AND (o.responsavel_id = ? OR EXISTS (SELECT 1 FROM order_items vi WHERE vi.order_id = o.id AND vi.responsavel_id = ?))`, b: [...uo.binds, u.id, u.id] }
    : { sql: `AND ${uo.sql}`, b: [...uo.binds] };
  const lista = (cond: string, ...b: unknown[]) => db.prepare(
    `SELECT o.id, o.numero, o.prazo, o.status, c.nome AS cliente, t.total - t.pago AS saldo,
       (SELECT GROUP_CONCAT(peca, ', ') FROM (SELECT peca FROM order_items WHERE order_id = o.id ORDER BY posicao)) AS pecas
     FROM orders o JOIN clients c ON c.id = o.client_id JOIN vw_order_totals t ON t.order_id = o.id
     WHERE ${cond} ${vis.sql} ORDER BY o.prazo, o.numero LIMIT 50`,
  ).bind(...b, ...vis.b).all();
  const [cfg, contagens, hojeL, amanhaL, prontas, atrasadas] = await Promise.all([
    capacidadeAgenda(db, unidades),
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
    const [caixas, receber, recebidoMes] = await Promise.all([
      Promise.all(unidades.map(x => resumoCaixa(db, h, x))),
      db.prepare(`SELECT COALESCE(SUM(t.total - t.pago), 0) AS v FROM orders o JOIN vw_order_totals t ON t.order_id = o.id
        WHERE o.status <> 'cancelada' AND t.total > t.pago AND ${uo.sql}`).bind(...uo.binds).first<{ v: number }>(),
      db.prepare(
        `SELECT COALESCE(SUM(CASE WHEN m.tipo = 'entrada' THEN m.valor_centavos ELSE -m.valor_centavos END), 0) AS v
         FROM cash_movements m JOIN payment_methods p ON p.id = m.forma_id
         WHERE substr(m.data, 1, 7) = ? AND p.eh_credito_cliente = 0 AND ${um.sql}
           AND m.categoria_id IN ('fc-servicos', 'fc-credito', 'fc-devolucao')`,
      ).bind(mes, ...um.binds).first<{ v: number }>(),
    ]);
    // Na visão "todas", o caixa de hoje soma as unidades.
    const caixa = {
      sessao: caixas.length === 1 ? caixas[0].sessao : null,
      abertos: caixas.filter(x => x.sessao && !x.sessao.fechado_em).length, existem: caixas.filter(x => x.sessao).length,
      entradas: caixas.reduce((t, x) => t + x.entradas, 0), saidas: caixas.reduce((t, x) => t + x.saidas, 0),
    };
    const [ind, serie] = await Promise.all([
      indicadores(db, `${mes}-01`, h, unidades),
      db.prepare(
        `SELECT m.data AS dia, SUM(CASE WHEN m.tipo = 'entrada' THEN m.valor_centavos ELSE -m.valor_centavos END) AS valor
         FROM cash_movements m JOIN payment_methods p ON p.id = m.forma_id
         WHERE m.data BETWEEN ? AND ? AND p.eh_credito_cliente = 0 AND ${um.sql} AND m.categoria_id IN ('fc-servicos','fc-credito','fc-devolucao') GROUP BY m.data`,
      ).bind(somarDias(h, -29), h, ...um.binds).all<{ dia: string; valor: number }>(),
    ]);
    financeiro = {
      caixa_aberto: caixa.abertos > 0, caixa_existe: caixa.existem > 0, caixas_abertos: caixa.abertos, unidades: unidades.length,
      entradas_hoje: caixa.entradas, saidas_hoje: caixa.saidas, a_receber: receber?.v ?? 0, recebido_mes: recebidoMes?.v ?? 0,
      faturamento_mes: ind.faturamento, despesas_mes: ind.despesas, lucro_estimado_mes: ind.lucro_estimado, resultado_caixa_mes: ind.resultado_caixa,
      mao_obra_configurada: ind.mao_obra_configurada,
      recebimentos_30d: Array.from({ length: 30 }, (_, i) => {
        const dia = somarDias(h, i - 29);
        return { dia, valor: serie.results.find(s => s.dia === dia)?.valor ?? 0 };
      }),
    };
  }
  // Agenda e produção dos próximos dias
  const [provas, urgentes, lembreteProva, prontasParadas, atividades, estoqueBaixo, contasVencendo] = await Promise.all([
    db.prepare(
      `SELECT a.id, a.dia, a.hora_inicio, a.titulo, a.order_id, c.nome AS cliente FROM appointments a LEFT JOIN clients c ON c.id = a.client_id
       WHERE a.tipo = 'prova' AND a.status = 'agendado' AND a.dia BETWEEN ? AND ? AND ${ua.sql} ${costureira ? 'AND (a.profissional_id = ? OR a.profissional_id IS NULL)' : ''}
       ORDER BY a.dia, a.hora_inicio LIMIT 10`,
    ).bind(h, somarDias(h, 7), ...ua.binds, ...(costureira ? [u.id] : [])).all(),
    db.prepare(
      `SELECT i.id, i.codigo, i.peca, i.status_producao, COALESCE(i.prazo, o.prazo) AS prazo, o.id AS order_id, o.numero, c.nome AS cliente
       FROM order_items i JOIN orders o ON o.id = i.order_id JOIN clients c ON c.id = o.client_id
       WHERE i.urgente = 1 AND i.status_producao <> 'finalizado' AND o.status NOT IN ('entregue','cancelada','pausada') AND ${uo.sql}
         ${costureira ? 'AND (i.responsavel_id = ? OR i.responsavel_id IS NULL)' : ''} ORDER BY prazo LIMIT 10`,
    ).bind(...uo.binds, ...(costureira ? [u.id] : [])).all(),
    pode(c, 'whatsapp.usar')
      ? db.prepare(
        `SELECT a.id, a.dia, a.hora_inicio, a.order_id, o.numero, c.nome AS cliente, c.telefone, c.whatsapp
         FROM appointments a JOIN clients c ON c.id = a.client_id LEFT JOIN orders o ON o.id = a.order_id
         WHERE a.tipo = 'prova' AND a.status = 'agendado' AND a.dia = ? AND ${ua.sql} ORDER BY a.hora_inicio`,
      ).bind(amanha, ...ua.binds).all()
      : Promise.resolve({ results: [] }),
    pode(c, 'whatsapp.usar')
      ? db.prepare(
        `SELECT o.id, o.numero, c.nome AS cliente, c.telefone, c.whatsapp, t.total - t.pago AS saldo,
           (SELECT MAX(h.em) FROM order_status_history h WHERE h.order_id = o.id AND h.para = 'pronta') AS pronta_desde,
           (SELECT GROUP_CONCAT(peca, ', ') FROM (SELECT peca FROM order_items WHERE order_id = o.id ORDER BY posicao)) AS pecas
         FROM orders o JOIN clients c ON c.id = o.client_id JOIN vw_order_totals t ON t.order_id = o.id
         WHERE o.status = 'pronta' AND ${uo.sql} AND (SELECT MAX(h.em) FROM order_status_history h WHERE h.order_id = o.id AND h.para = 'pronta') <= ?
         ORDER BY pronta_desde LIMIT 10`,
      ).bind(...uo.binds, new Date(Date.now() - 3 * 86400000).toISOString()).all()
      : Promise.resolve({ results: [] }),
    costureira
      ? Promise.resolve({ results: [] })
      : db.prepare(
        `SELECT h.em, h.de, h.para, h.item_id, o.id AS order_id, o.numero, u.nome AS usuario, i.codigo
         FROM order_status_history h JOIN orders o ON o.id = h.order_id LEFT JOIN users u ON u.id = h.user_id LEFT JOIN order_items i ON i.id = h.item_id
         WHERE ${uo.sql} ORDER BY h.em DESC LIMIT 12`,
      ).bind(...uo.binds).all(),
    pode(c, 'estoque.ver')
      ? db.prepare(`SELECT COUNT(*) AS n FROM materials m WHERE m.ativo = 1 AND ROUND(COALESCE((SELECT SUM(sm.quantidade) FROM stock_movements sm
          WHERE sm.material_id = m.id AND ${filtroUnidade(c, 'sm.unit_id').sql}), 0), 3) <= m.estoque_minimo`).bind(...filtroUnidade(c, 'sm.unit_id').binds).first<{ n: number }>()
      : null,
    pode(c, 'pagar.ver')
      ? db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(valor_centavos), 0) AS v FROM payables p WHERE status = 'aberta' AND vencimento <= ?
          AND (${filtroUnidade(c, 'p.unit_id').sql} OR p.unit_id IS NULL)`).bind(somarDias(h, 7), ...filtroUnidade(c, 'p.unit_id').binds).first<{ n: number; v: number }>()
      : null,
  ]);
  const tirarValores = (r: { results: Record<string, unknown>[] }) => (verValores ? r.results : r.results.map(x => ({ ...x, saldo: undefined })));
  return c.json({
    hoje: h, capacidade: cfg.capacidade_diaria, contagens, financeiro,
    entregas_hoje: tirarValores(hojeL), entregas_amanha: tirarValores(amanhaL), prontas: tirarValores(prontas), atrasadas: tirarValores(atrasadas),
    provas: provas.results, urgentes: urgentes.results, lembrete_provas: lembreteProva.results,
    prontas_paradas: verValores ? prontasParadas.results : prontasParadas.results.map(x => ({ ...x, saldo: undefined })),
    atividades: atividades.results, estoque_baixo: estoqueBaixo?.n ?? null, contas_vencendo: contasVencendo,
  });
});
