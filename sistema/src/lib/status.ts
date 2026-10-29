import { STATUS_DE_PRODUCAO } from '../../public/js/regras.js';

const LISTA_PRODUCAO = STATUS_DE_PRODUCAO.map((s: string) => `'${s}'`).join(',');

/**
 * Expressão SQL que calcula a situação da OS a partir das peças — espelha
 * derivarStatusProducao() de public/js/regras.js. Usa o parâmetro ?1 (id da OS).
 */
const DERIVADO = `(CASE
  WHEN NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = ?1 AND status_producao <> 'finalizado') THEN 'pronta'
  WHEN EXISTS (SELECT 1 FROM order_items WHERE order_id = ?1 AND status_producao = 'aguardando_prova') THEN 'aguardando_prova'
  WHEN EXISTS (SELECT 1 FROM order_items WHERE order_id = ?1 AND status_producao = 'ajustes_finais') THEN 'ajustes_finais'
  WHEN EXISTS (SELECT 1 FROM order_items WHERE order_id = ?1 AND status_producao IN ('em_execucao','finalizado')) THEN 'em_producao'
  ELSE 'aprovada' END)`;

/**
 * Comandos que recalculam a situação da OS (só quando ela está numa etapa de produção)
 * e registram a mudança no histórico. Devem entrar no mesmo lote que alterou as peças.
 */
export function recalcularStatus(db: D1Database, orderId: string, userId: string, em: string) {
  return [
    db.prepare(
      `INSERT INTO order_status_history (id, order_id, de, para, motivo, user_id, em)
       SELECT lower(hex(randomblob(16))), ?1, status, ${DERIVADO}, 'calculado pelas peças', ?2, ?3
       FROM orders WHERE id = ?1 AND status IN (${LISTA_PRODUCAO}) AND status <> ${DERIVADO}`,
    ).bind(orderId, userId, em),
    db.prepare(
      `UPDATE orders SET status = ${DERIVADO}, versao = versao + 1, atualizado_em = ?2
       WHERE id = ?1 AND status IN (${LISTA_PRODUCAO}) AND status <> ${DERIVADO}`,
    ).bind(orderId, em),
  ];
}
