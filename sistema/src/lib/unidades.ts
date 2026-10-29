import type { Context, Next } from 'hono';
import type { AppEnv } from '../env';
import { ErroApp } from './erros';

export type Unidade = { id: string; nome: string; sigla: string };

/** Unidades que a pessoa pode usar: a administradora vê todas as ativas; as demais, só as ligadas a ela. */
export async function unidadesPermitidas(db: D1Database, userId: string, papel: string) {
  const sql = papel === 'admin'
    ? 'SELECT id, nome, sigla FROM units WHERE ativo = 1 ORDER BY nome'
    : 'SELECT u.id, u.nome, u.sigla FROM units u JOIN user_units uu ON uu.unit_id = u.id WHERE uu.user_id = ? AND u.ativo = 1 ORDER BY u.nome';
  const r = papel === 'admin' ? await db.prepare(sql).all<Unidade>() : await db.prepare(sql).bind(userId).all<Unidade>();
  return r.results;
}

/**
 * Define a unidade da requisição a partir do cabeçalho X-Unidade (escolhida no topo da tela).
 * "todas" (ou vazio, para quem tem mais de uma) mostra os dados de todas as unidades permitidas.
 */
export async function carregarUnidades(c: Context<AppEnv>, next: Next) {
  const u = c.get('usuario');
  const permitidas = await unidadesPermitidas(c.env.DB, u.id, u.papel);
  if (!permitidas.length) throw new ErroApp(403, 'sem_unidade', 'Você ainda não está ligada a nenhuma unidade. Peça à administradora para liberar.');
  const pedida = c.req.header('X-Unidade') || '';
  let atual: string | null;
  if (permitidas.some(x => x.id === pedida)) atual = pedida;
  else if (permitidas.length === 1) atual = permitidas[0].id;
  else atual = null; // todas
  c.set('unidades', permitidas.map(x => x.id));
  c.set('unidade', atual);
  await next();
}

/** Filtro SQL pela unidade escolhida (ou por todas as permitidas). */
export function filtroUnidade(c: Context<AppEnv>, coluna: string) {
  const atual = c.get('unidade');
  if (atual) return { sql: `${coluna} = ?`, binds: [atual] as unknown[] };
  const ids = c.get('unidades');
  return { sql: `${coluna} IN (${ids.map(() => '?').join(',')})`, binds: [...ids] as unknown[] };
}

/** Unidade em que um registro novo será gravado: exige uma unidade escolhida (não "todas"). */
export function unidadeParaGravar(c: Context<AppEnv>) {
  const atual = c.get('unidade');
  if (!atual) throw new ErroApp(422, 'escolha_unidade', 'Escolha a unidade no topo da tela para registrar.');
  return atual;
}

export function podeUnidade(c: Context<AppEnv>, unitId: string) {
  return c.get('unidades').includes(unitId);
}
