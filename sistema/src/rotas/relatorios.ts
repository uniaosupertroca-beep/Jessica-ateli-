import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ErroApp } from '../lib/erros';
import { exigir, hoje, zData } from '../lib/util';
import { lerConfigAtelie } from './config';
import { somarDias } from '../../public/js/regras.js';

/**
 * Relatórios. Definições (as mesmas usadas no Início):
 *  - Faturamento: soma do total das OS ENTREGUES no período (data da entrega).
 *  - Recebido: dinheiro que entrou de clientes no período (pagamentos de OS e créditos), menos estornos e devoluções.
 *    Uso de crédito não conta (não é dinheiro novo).
 *  - Despesas: saídas lançadas no caixa no período (exceto sangria e devolução a cliente), menos estornos.
 *  - Custo de materiais: consumo de estoque lançado nas OS no período, pelo custo médio.
 *  - Mão de obra estimada: tempo previsto dos serviços × custo da hora (Configurações).
 *  - Lucro estimado (das OS entregues) = faturamento − materiais dessas OS − mão de obra estimada.
 *  - Resultado de caixa (realizado) = recebido − despesas.
 * Datas comerciais no fuso de São Paulo (UTC−3).
 */
export const rotasRelatorios = new Hono<AppEnv>();

const DIA_SP = (col: string) => `date(${col}, '-3 hours')`;

/** Filtro por unidade com os ids já validados (entram direto no SQL; vêm só do banco/sessão). */
export function sqlUnidades(col: string, unidades: string[]) {
  const ok = unidades.filter(u => /^[A-Za-z0-9-]+$/.test(u));
  return ok.length ? `${col} IN (${ok.map(u => `'${u}'`).join(',')})` : '0';
}

function diasEntre(de: string, ate: string) {
  return Math.round((Date.parse(ate) - Date.parse(de)) / 86400000) + 1;
}

export async function indicadores(db: D1Database, de: string, ate: string, unidades: string[]) {
  const uo = sqlUnidades('o.unit_id', unidades);
  const um = sqlUnidades('m.unit_id', unidades);
  const us = sqlUnidades('sm.unit_id', unidades);
  const cfg = await lerConfigAtelie(db);
  const custoHora = cfg.custo_hora_centavos;
  const q = <T>(sql: string, ...b: unknown[]) => db.prepare(sql).bind(...b).first<T>();
  const [fat, receb, desp, mat, mao, pend] = await Promise.all([
    q<{ v: number; n: number; pecas: number }>(
      `SELECT COALESCE(SUM(t.total), 0) AS v, COUNT(*) AS n,
         COALESCE(SUM((SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id)), 0) AS pecas
       FROM orders o JOIN vw_order_totals t ON t.order_id = o.id WHERE o.status = 'entregue' AND ${uo} AND ${DIA_SP('o.entregue_em')} BETWEEN ? AND ?`, de, ate),
    q<{ v: number }>(
      `SELECT COALESCE(SUM(CASE WHEN m.tipo = 'entrada' THEN m.valor_centavos ELSE -m.valor_centavos END), 0) AS v
       FROM cash_movements m JOIN payment_methods p ON p.id = m.forma_id
       WHERE m.data BETWEEN ? AND ? AND ${um} AND p.eh_credito_cliente = 0 AND m.categoria_id IN ('fc-servicos', 'fc-credito', 'fc-devolucao')`, de, ate),
    q<{ v: number }>(
      `SELECT COALESCE(SUM(CASE WHEN m.tipo = 'saida' THEN m.valor_centavos ELSE -m.valor_centavos END), 0) AS v
       FROM cash_movements m JOIN finance_categories fc ON fc.id = m.categoria_id
       WHERE m.data BETWEEN ? AND ? AND ${um} AND fc.tipo = 'saida' AND m.categoria_id NOT IN ('fc-sangria', 'fc-devolucao')`, de, ate),
    q<{ v: number }>(
      `SELECT COALESCE(SUM(-sm.quantidade * sm.custo_unitario_centavos), 0) AS v FROM stock_movements sm
       WHERE sm.order_id IS NOT NULL AND ${us} AND (sm.tipo = 'consumo' OR (sm.tipo = 'reversao' AND EXISTS (SELECT 1 FROM stock_movements o WHERE o.id = sm.reverte_de AND o.tipo = 'consumo')))
         AND ${DIA_SP('sm.criado_em')} BETWEEN ? AND ?`, de, ate),
    q<{ min: number; mat: number }>(
      `SELECT COALESCE(SUM((SELECT COALESCE(SUM(s.tempo_min), 0) FROM order_item_services s JOIN order_items i ON i.id = s.item_id WHERE i.order_id = o.id)), 0) AS min,
         COALESCE(SUM((SELECT COALESCE(SUM(-sm.quantidade * sm.custo_unitario_centavos), 0) FROM stock_movements sm WHERE sm.order_id = o.id
           AND (sm.tipo = 'consumo' OR sm.tipo = 'reversao'))), 0) AS mat
       FROM orders o WHERE o.status = 'entregue' AND ${uo} AND ${DIA_SP('o.entregue_em')} BETWEEN ? AND ?`, de, ate),
    q<{ v: number }>(`SELECT COALESCE(SUM(t.total - t.pago), 0) AS v FROM orders o JOIN vw_order_totals t ON t.order_id = o.id WHERE o.status <> 'cancelada' AND ${uo} AND t.total > t.pago`),
  ]);
  const maoObra = Math.round(((mao?.min ?? 0) / 60) * custoHora);
  const faturamento = fat?.v ?? 0;
  const recebido = receb?.v ?? 0;
  const despesas = desp?.v ?? 0;
  return {
    faturamento, os_entregues: fat?.n ?? 0, pecas_entregues: fat?.pecas ?? 0,
    ticket_medio: fat?.n ? Math.round(faturamento / fat.n) : 0,
    recebido, despesas, a_receber: pend?.v ?? 0,
    custo_materiais: Math.round(mat?.v ?? 0),
    mao_obra_estimada: maoObra, mao_obra_configurada: custoHora > 0,
    lucro_estimado: Math.round(faturamento - (mao?.mat ?? 0) - maoObra),
    resultado_caixa: recebido - despesas,
  };
}

rotasRelatorios.get('/relatorios', async c => {
  exigir(c, 'relatorios.ver');
  const h = hoje();
  const de = c.req.query('de') || `${h.slice(0, 7)}-01`;
  const ate = c.req.query('ate') || h;
  if (!zData.safeParse(de).success || !zData.safeParse(ate).success || ate < de || diasEntre(de, ate) > 800)
    throw new ErroApp(422, 'dados_invalidos', 'Período inválido (máximo de 2 anos).');
  const db = c.env.DB;
  const atualU = c.get('unidade');
  const unidades = atualU ? [atualU] : c.get('unidades');
  const uo = sqlUnidades('o.unit_id', unidades);
  const um = sqlUnidades('m.unit_id', unidades);
  const us = sqlUnidades('sm.unit_id', unidades);
  const n = diasEntre(de, ate);
  const antDe = somarDias(de, -n);
  const antAte = somarDias(de, -1);
  const cfg = await lerConfigAtelie(db);
  const all = <T = Record<string, unknown>>(sql: string, ...b: unknown[]) => db.prepare(sql).bind(...b).all<T>().then(r => r.results);
  const inicio12 = (() => { const [a, m] = h.split('-').map(Number); const d = new Date(Date.UTC(a, m - 12, 1)); return d.toISOString().slice(0, 10); })();
  const [atual, anterior, servicos, clientes, recorrentes, atrasos, produtividade, materiais, formas, mensal, despesasCat] = await Promise.all([
    indicadores(db, de, ate, unidades),
    indicadores(db, antDe, antAte, unidades),
    all(`SELECT COALESCE(sc.nome, s.descricao) AS servico, COUNT(*) AS vezes, SUM(s.quantidade) AS quantidade, SUM(s.subtotal_centavos) AS receita,
           SUM(s.tempo_min) AS tempo_min, ROUND(AVG(i.tempo_real_min)) AS tempo_real_medio
         FROM order_item_services s JOIN order_items i ON i.id = s.item_id JOIN orders o ON o.id = i.order_id LEFT JOIN service_catalog sc ON sc.id = s.service_id
         WHERE o.status = 'entregue' AND ${uo} AND ${DIA_SP('o.entregue_em')} BETWEEN ? AND ? GROUP BY 1 ORDER BY vezes DESC, receita DESC LIMIT 30`, de, ate),
    all(`SELECT c.id, c.nome, COUNT(*) AS os, SUM(t.total) AS total FROM orders o JOIN clients c ON c.id = o.client_id JOIN vw_order_totals t ON t.order_id = o.id
         WHERE o.status = 'entregue' AND ${uo} AND ${DIA_SP('o.entregue_em')} BETWEEN ? AND ? GROUP BY c.id ORDER BY total DESC LIMIT 15`, de, ate),
    db.prepare(`SELECT COUNT(*) AS recorrentes, (SELECT COUNT(DISTINCT o.client_id) FROM orders o WHERE o.status <> 'cancelada' AND ${uo} AND o.aberta_em BETWEEN ?1 AND ?2) AS atendidas
         FROM (SELECT o.client_id FROM orders o WHERE o.status <> 'cancelada' AND ${uo} GROUP BY o.client_id HAVING COUNT(*) >= 2
           AND SUM(o.aberta_em BETWEEN ?1 AND ?2) >= 1)`).bind(de, ate).first<{ recorrentes: number; atendidas: number }>(),
    db.prepare(`SELECT
           SUM(o.status = 'entregue' AND ${DIA_SP('o.entregue_em')} BETWEEN ?1 AND ?2 AND ${DIA_SP('o.entregue_em')} > o.prazo) AS entregues_atrasadas,
           SUM(o.status = 'entregue' AND ${DIA_SP('o.entregue_em')} BETWEEN ?1 AND ?2) AS entregues,
           SUM(o.status NOT IN ('entregue','cancelada') AND o.prazo < ?3) AS atrasadas_agora
         FROM orders o WHERE ${uo}`).bind(de, ate, h).first<{ entregues_atrasadas: number; entregues: number; atrasadas_agora: number }>(),
    all(`SELECT u.id, u.nome, COUNT(i.id) AS pecas, COALESCE(SUM(i.tempo_real_min), 0) AS tempo_real,
           COALESCE(SUM((SELECT COALESCE(SUM(s.tempo_min), 0) FROM order_item_services s WHERE s.item_id = i.id)), 0) AS tempo_previsto,
           COALESCE(SUM(i.retrabalhos), 0) AS retrabalhos
         FROM users u JOIN order_items i ON i.responsavel_id = u.id JOIN orders o ON o.id = i.order_id
         WHERE ${uo} AND i.status_producao = 'finalizado' AND ${DIA_SP('i.finalizado_em')} BETWEEN ? AND ? GROUP BY u.id ORDER BY pecas DESC`, de, ate),
    all(`SELECT m.nome, m.unidade, ROUND(SUM(-sm.quantidade), 3) AS qtd_consumida, ROUND(SUM(-sm.quantidade * sm.custo_unitario_centavos)) AS custo
         FROM stock_movements sm JOIN materials m ON m.id = sm.material_id
         WHERE sm.order_id IS NOT NULL AND ${us} AND sm.tipo IN ('consumo','reversao') AND ${DIA_SP('sm.criado_em')} BETWEEN ? AND ?
         GROUP BY m.id HAVING qtd_consumida <> 0 ORDER BY custo DESC LIMIT 30`, de, ate),
    all(`SELECT p.nome, SUM(CASE WHEN m.tipo = 'entrada' THEN m.valor_centavos ELSE -m.valor_centavos END) AS valor
         FROM cash_movements m JOIN payment_methods p ON p.id = m.forma_id
         WHERE m.data BETWEEN ? AND ? AND ${um} AND m.categoria_id IN ('fc-servicos','fc-credito') GROUP BY p.id HAVING valor <> 0 ORDER BY valor DESC`, de, ate),
    all(`WITH meses AS (SELECT substr(m.data, 1, 7) AS mes FROM cash_movements m WHERE m.data >= ?1 AND ${um}
           UNION SELECT substr(${DIA_SP('o.entregue_em')}, 1, 7) FROM orders o WHERE o.status = 'entregue' AND ${uo} AND ${DIA_SP('o.entregue_em')} >= ?1)
         SELECT mes,
           (SELECT COALESCE(SUM(t.total), 0) FROM orders o JOIN vw_order_totals t ON t.order_id = o.id WHERE o.status = 'entregue' AND ${uo} AND substr(${DIA_SP('o.entregue_em')}, 1, 7) = mes) AS faturamento,
           (SELECT COALESCE(SUM(CASE WHEN m.tipo = 'entrada' THEN m.valor_centavos ELSE -m.valor_centavos END), 0) FROM cash_movements m JOIN payment_methods p ON p.id = m.forma_id
              WHERE substr(m.data, 1, 7) = mes AND ${um} AND p.eh_credito_cliente = 0 AND m.categoria_id IN ('fc-servicos','fc-credito','fc-devolucao')) AS recebido,
           (SELECT COALESCE(SUM(CASE WHEN m.tipo = 'saida' THEN m.valor_centavos ELSE -m.valor_centavos END), 0) FROM cash_movements m JOIN finance_categories fc ON fc.id = m.categoria_id
              WHERE substr(m.data, 1, 7) = mes AND ${um} AND fc.tipo = 'saida' AND m.categoria_id NOT IN ('fc-sangria','fc-devolucao')) AS despesas
         FROM meses WHERE mes IS NOT NULL ORDER BY mes`, inicio12),
    all(`SELECT fc.nome, SUM(CASE WHEN m.tipo = 'saida' THEN m.valor_centavos ELSE -m.valor_centavos END) AS valor
         FROM cash_movements m JOIN finance_categories fc ON fc.id = m.categoria_id
         WHERE m.data BETWEEN ? AND ? AND ${um} AND fc.tipo = 'saida' AND m.categoria_id NOT IN ('fc-sangria','fc-devolucao') GROUP BY fc.id HAVING valor <> 0 ORDER BY valor DESC`, de, ate),
  ]);
  // Margem estimada por serviço: receita − mão de obra estimada (tempo × custo da hora).
  const margem = (servicos as Array<{ receita: number; tempo_min: number }>).map(s => ({
    ...s, mao_obra: Math.round(((s.tempo_min ?? 0) / 60) * cfg.custo_hora_centavos),
    margem: Math.round(s.receita - ((s.tempo_min ?? 0) / 60) * cfg.custo_hora_centavos),
  }));
  // Comparativo entre unidades quando "todas" está escolhido.
  let porUnidade: unknown[] = [];
  if (!atualU && unidades.length > 1) {
    const nomes = await db.prepare(`SELECT id, nome, sigla FROM units WHERE ${sqlUnidades('id', unidades)} ORDER BY nome`).all<{ id: string; nome: string; sigla: string }>();
    porUnidade = await Promise.all(nomes.results.map(async u => ({ ...u, ...(await indicadores(db, de, ate, [u.id])) })));
  }
  return c.json({
    de, ate, por_unidade: porUnidade, periodo_anterior: { de: antDe, ate: antAte }, atual, anterior,
    servicos: margem, clientes, recorrencia: recorrentes, atrasos, produtividade, materiais, formas, mensal, despesas_categoria: despesasCat,
    custo_hora_centavos: cfg.custo_hora_centavos,
  });
});
