import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ErroApp, erroValidacao, semPermissao } from './erros';
import { dataValida, hoje } from '../../public/js/regras.js';

export const uuid = () => crypto.randomUUID();
export const agora = () => new Date().toISOString();
export { hoje };

export const zData = z.string().refine(dataValida, 'Data inválida (use AAAA-MM-DD).');
export const zId = z.string().min(1).max(64);
export const zCentavos = z.number({ error: 'Valor inválido.' }).int('Valor inválido.').min(0, 'Valor não pode ser negativo.').max(1_000_000_00, 'Valor muito alto.');

export async function lerCorpo<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.infer<S>> {
  let dados: unknown;
  try {
    dados = await c.req.json();
  } catch {
    throw new ErroApp(400, 'json_invalido', 'Requisição inválida.');
  }
  const r = schema.safeParse(dados);
  if (!r.success) throw erroValidacao(r.error);
  return r.data;
}

export function exigir(c: Context<AppEnv>, ...perms: string[]) {
  const p = c.get('perms');
  if (!perms.every(x => p.has(x))) throw semPermissao();
}

export const pode = (c: Context<AppEnv>, perm: string) => c.get('perms').has(perm);

/** Chave de idempotência enviada pelo navegador (um clique = uma chave). */
export function chaveIdempotencia(c: Context<AppEnv>): string {
  const k = c.req.header('Idempotency-Key') || '';
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(k)) throw new ErroApp(400, 'idempotencia', 'Requisição sem identificador de operação. Recarregue a página.');
  return k;
}

export function ip(c: Context<AppEnv>) {
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'local';
}

/** Remove acentos e deixa em minúsculas (para busca). */
export function textoBusca(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Executa um lote atômico (transação) no D1. */
export async function lote(db: D1Database, stmts: D1PreparedStatement[]) {
  return db.batch(stmts.filter(Boolean));
}
