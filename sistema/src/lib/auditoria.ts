import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { agora, ip, uuid } from './util';

/** Comando de auditoria para entrar no mesmo lote (transação) da operação auditada. */
export function auditoria(c: Context<AppEnv>, acao: string, entidade: string, entidadeId: string | null, dados?: unknown) {
  const u = c.get('usuario');
  return c.env.DB.prepare(
    'INSERT INTO audit_logs (id, user_id, acao, entidade, entidade_id, dados, ip, em) VALUES (?,?,?,?,?,?,?,?)',
  ).bind(uuid(), u?.id ?? null, acao, entidade, entidadeId, dados === undefined ? null : JSON.stringify(dados), ip(c), agora());
}
