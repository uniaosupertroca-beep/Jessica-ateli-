import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { hoje, pode } from '../lib/util';
import { lerConfigAtelie } from './config';
import { resumoCaixa } from './financeiro';
import { indicadores } from './relatorios';
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
    const [ind, serie] = await Promise.all([
      indicadores(db, `${mes}-01`, h),
      db.prepare(
        `SELECT m.data AS dia, SUM(CASE WHEN m.tipo = 'entrada' THEN m.valor_centavos ELSE -m.valor_centavos END) AS valor
         FROM cash_movements m JOIN payment_methods p ON p.id = m.forma_id
         WHERE m.data BETWEEN ? AND ? AND p.eh_credito_cliente = 0 AND m.categoria_id IN ('fc-servicos','fc-credito','fc-devolucao') GROUP BY m.data`,
      ).bind(somarDias(h, -29), h).all<{ dia: string; valor: number }>(),
    ]);
    financeiro = {
      caixa_aberto: !!caixa.sessao && !caixa.sessao.fechado_em, caixa_existe: !!caixa.sessao,
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
       WHERE a.tipo = 'prova' AND a.status = 'agendado' AND a.dia BETWEEN ? AND ? ${costureira ? 'AND (a.profissional_id = ? OR a.profissional_id IS NULL)' : ''}
       ORDER BY a.dia, a.hora_inicio LIMIT 10`,
    ).bind(h, somarDias(h, 7), ...(costureira ? [u.id] : [])).all(),
    db.prepare(
      `SELECT i.id, i.codigo, i.peca, i.status_producao, COALESCE(i.prazo, o.prazo) AS prazo, o.id AS order_id, o.numero, c.nome AS cliente
       FROM order_items i JOIN orders o ON o.id = i.order_id JOIN clients c ON c.id = o.client_id
       WHERE i.urgente = 1 AND i.status_producao <> 'finalizado' AND o.status NOT IN ('entregue','cancelada','pausada')
         ${costureira ? 'AND (i.responsavel_id = ? OR i.responsavel_id IS NULL)' : ''} ORDER BY prazo LIMIT 10`,
    ).bind(...(costureira ? [u.id] : [])).all(),
    pode(c, 'whatsapp.usar')
      ? db.prepare(
        `SELECT a.id, a.dia, a.hora_inicio, a.order_id, o.numero, c.nome AS cliente, c.telefone, c.whatsapp
         FROM appointments a JOIN clients c ON c.id = a.client_id LEFT JOIN orders o ON o.id = a.order_id
         WHERE a.tipo = 'prova' AND a.status = 'agendado' AND a.dia = ? ORDER BY a.hora_inicio`,
      ).bind(amanha).all()
      : Promise.resolve({ results: [] }),
    pode(c, 'whatsapp.usar')
      ? db.prepare(
        `SELECT o.id, o.numero, c.nome AS cliente, c.telefone, c.whatsapp, t.total - t.pago AS saldo,
           (SELECT MAX(h.em) FROM order_status_history h WHERE h.order_id = o.id AND h.para = 'pronta') AS pronta_desde,
           (SELECT GROUP_CONCAT(peca, ', ') FROM (SELECT peca FROM order_items WHERE order_id = o.id ORDER BY posicao)) AS pecas
         FROM orders o JOIN clients c ON c.id = o.client_id JOIN vw_order_totals t ON t.order_id = o.id
         WHERE o.status = 'pronta' AND (SELECT MAX(h.em) FROM order_status_history h WHERE h.order_id = o.id AND h.para = 'pronta') <= ?
         ORDER BY pronta_desde LIMIT 10`,
      ).bind(new Date(Date.now() - 3 * 86400000).toISOString()).all()
      : Promise.resolve({ results: [] }),
    costureira
      ? Promise.resolve({ results: [] })
      : db.prepare(
        `SELECT h.em, h.de, h.para, h.item_id, o.id AS order_id, o.numero, u.nome AS usuario, i.codigo
         FROM order_status_history h JOIN orders o ON o.id = h.order_id LEFT JOIN users u ON u.id = h.user_id LEFT JOIN order_items i ON i.id = h.item_id
         ORDER BY h.em DESC LIMIT 12`,
      ).all(),
    pode(c, 'estoque.ver') ? db.prepare('SELECT COUNT(*) AS n FROM materials WHERE ativo = 1 AND quantidade <= estoque_minimo').first<{ n: number }>() : null,
    pode(c, 'pagar.ver')
      ? db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(valor_centavos), 0) AS v FROM payables WHERE status = 'aberta' AND vencimento <= ?").bind(somarDias(h, 7)).first<{ n: number; v: number }>()
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
