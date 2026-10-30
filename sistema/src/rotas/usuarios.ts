import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { hashSenha, validarSenhaNova } from '../lib/auth';
import { auditoria } from '../lib/auditoria';
import { ErroApp, naoEncontrado } from '../lib/erros';
import { agora, exigir, lerCorpo, uuid } from '../lib/util';
import { AJUSTAVEIS, permissoesDo, permissoesEfetivas, ROTULOS } from '../lib/permissoes';
import type { Papel } from '../env';

export const rotasUsuarios = new Hono<AppEnv>();

const zLogin = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'Usuário: 3 a 40 letras sem acento, números, ponto, hífen ou _.').optional().nullable()
  .or(z.literal('').transform(() => null));

const zCapacidade = z.number().int().min(0).max(1440).optional();
const zDias = z.string().regex(/^[0-6]{0,7}$/, 'Dias de trabalho inválidos.').optional();

const zUnidades = z.array(z.string().max(64)).max(50).optional();

/** Confere se as unidades existem e monta os comandos que gravam o vínculo da pessoa. */
async function vinculos(db: D1Database, userId: string, unidades: string[] | undefined) {
  if (!unidades) return [];
  const ids = new Set((await db.prepare('SELECT id FROM units').all<{ id: string }>()).results.map(r => r.id));
  if (unidades.some(u => !ids.has(u))) throw new ErroApp(422, 'unidade_invalida', 'Unidade inválida.');
  return [db.prepare('DELETE FROM user_units WHERE user_id = ?').bind(userId),
    ...unidades.map(u => db.prepare('INSERT INTO user_units (user_id, unit_id) VALUES (?, ?)').bind(userId, u))];
}

const zPapel = z.enum(['admin', 'atendente', 'costureira'], { error: 'Perfil inválido.' });

rotasUsuarios.get('/', async c => {
  exigir(c, 'usuarios.gerenciar');
  const { results } = await c.env.DB.prepare(
    `SELECT id, nome, email, login, papel, ativo, trocar_senha, capacidade_min_dia, dias_trabalho, criado_em,
       (SELECT GROUP_CONCAT(unit_id) FROM user_units WHERE user_id = users.id) AS unidades FROM users ORDER BY ativo DESC, nome`,
  ).all<Record<string, unknown> & { unidades: string | null }>();
  return c.json({ usuarios: results.map(u => ({ ...u, unidades: u.unidades ? u.unidades.split(',') : [] })) });
});

rotasUsuarios.post('/', async c => {
  exigir(c, 'usuarios.gerenciar');
  const d = await lerCorpo(c, z.object({
    nome: z.string().trim().min(2, 'Informe o nome.').max(120),
    email: z.string().trim().toLowerCase().email('E-mail inválido.').max(200),
    login: zLogin,
    papel: zPapel,
    senha: z.string(),
    capacidade_min_dia: zCapacidade,
    dias_trabalho: zDias,
    unidades: zUnidades,
  }));
  validarSenhaNova(d.senha);
  const id = uuid();
  // Sem unidade informada, a pessoa entra na unidade que está aberta na tela (ou em todas, se for "todas").
  const unidades = d.unidades?.length ? d.unidades : c.get('unidade') ? [c.get('unidade')!] : c.get('unidades');
  await c.env.DB.batch([
    // A senha criada pelo administrador é temporária: a pessoa troca no primeiro acesso.
    c.env.DB.prepare(`INSERT INTO users (id, nome, email, login, senha_hash, papel, trocar_senha, capacidade_min_dia, dias_trabalho, criado_em)
      VALUES (?,?,?,?,?,?,1,?,?,?)`)
      .bind(id, d.nome, d.email, d.login ?? null, await hashSenha(d.senha), d.papel, d.capacidade_min_dia ?? 0, d.dias_trabalho ?? '12345', agora()),
    ...(await vinculos(c.env.DB, id, unidades)),
    auditoria(c, 'criar', 'users', id, { nome: d.nome, email: d.email, papel: d.papel, unidades }),
  ]);
  return c.json({ id }, 201);
});

rotasUsuarios.patch('/:id', async c => {
  exigir(c, 'usuarios.gerenciar');
  const id = c.req.param('id');
  const d = await lerCorpo(c, z.object({
    nome: z.string().trim().min(2).max(120).optional(),
    papel: zPapel.optional(),
    ativo: z.boolean().optional(),
    login: zLogin,
    senha: z.string().optional(),
    capacidade_min_dia: zCapacidade,
    dias_trabalho: zDias,
    unidades: zUnidades,
  }));
  if (d.unidades && !d.unidades.length) throw new ErroApp(422, 'unidade_invalida', 'Escolha pelo menos uma unidade.');
  const atual = await c.env.DB.prepare('SELECT id, papel, ativo FROM users WHERE id = ?').bind(id).first<{ papel: string; ativo: number }>();
  if (!atual) throw naoEncontrado('Usuário');
  const deixaDeSerAdmin = atual.papel === 'admin' && atual.ativo === 1 && ((d.papel && d.papel !== 'admin') || d.ativo === false);
  if (deixaDeSerAdmin) {
    const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE papel = 'admin' AND ativo = 1").first<{ n: number }>();
    if ((n?.n ?? 0) <= 1) throw new ErroApp(409, 'ultimo_admin', 'É preciso manter pelo menos um administrador ativo.');
  }
  if (d.senha !== undefined) validarSenhaNova(d.senha);
  const stmts = [
    c.env.DB.prepare(
      `UPDATE users SET nome = COALESCE(?, nome), papel = COALESCE(?, papel), ativo = COALESCE(?, ativo),
         senha_hash = COALESCE(?, senha_hash), trocar_senha = CASE WHEN ? THEN 1 ELSE trocar_senha END,
         login = CASE WHEN ? THEN ? ELSE login END, capacidade_min_dia = COALESCE(?, capacidade_min_dia), dias_trabalho = COALESCE(?, dias_trabalho),
         atualizado_em = ? WHERE id = ?`,
    ).bind(d.nome ?? null, d.papel ?? null, d.ativo === undefined ? null : d.ativo ? 1 : 0,
      d.senha ? await hashSenha(d.senha) : null, d.senha ? 1 : 0, d.login !== undefined ? 1 : 0, d.login ?? null,
      d.capacidade_min_dia ?? null, d.dias_trabalho ?? null, agora(), id),
    ...(await vinculos(c.env.DB, id, d.unidades)),
    auditoria(c, 'editar', 'users', id, { nome: d.nome, papel: d.papel, ativo: d.ativo, senha_alterada: !!d.senha, unidades: d.unidades }),
  ];
  // Desativar, trocar perfil ou redefinir senha derruba as sessões abertas dessa pessoa.
  if (d.ativo === false || d.papel || d.senha) stmts.push(c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

/* ---------- permissões por pessoa (perfil + ajustes) ---------- */
rotasUsuarios.get('/:id/permissoes', async c => {
  exigir(c, 'usuarios.gerenciar');
  const u = await c.env.DB.prepare('SELECT id, papel FROM users WHERE id = ?').bind(c.req.param('id')).first<{ id: string; papel: Papel }>();
  if (!u) throw naoEncontrado('Pessoa');
  const ajustes = (await c.env.DB.prepare('SELECT permissao, concedida FROM user_permissions WHERE user_id = ?').bind(u.id).all<{ permissao: string; concedida: number }>()).results;
  const efetivas = permissoesEfetivas(u.papel, ajustes);
  const perfil = permissoesDo(u.papel);
  return c.json({
    papel: u.papel,
    permissoes: AJUSTAVEIS.map(p => ({ id: p, nome: ROTULOS[p], ativa: efetivas.has(p), do_perfil: perfil.has(p) })),
  });
});

rotasUsuarios.put('/:id/permissoes', async c => {
  exigir(c, 'usuarios.gerenciar');
  const id = c.req.param('id');
  const { permissoes } = await lerCorpo(c, z.object({ permissoes: z.array(z.string().max(60)).max(100) }));
  const u = await c.env.DB.prepare('SELECT papel FROM users WHERE id = ?').bind(id).first<{ papel: Papel }>();
  if (!u) throw naoEncontrado('Pessoa');
  if (u.papel === 'admin') throw new ErroApp(422, 'admin_tem_tudo', 'O administrador já tem todas as permissões.');
  const validas = new Set<string>(AJUSTAVEIS);
  if (permissoes.some(p => !validas.has(p))) throw new ErroApp(422, 'permissao_invalida', 'Permissão inválida.');
  const quer = new Set(permissoes);
  const perfil = permissoesDo(u.papel);
  // Grava só as diferenças em relação ao perfil: se o perfil mudar, os ajustes continuam valendo.
  const ajustes = AJUSTAVEIS.filter(p => quer.has(p) !== perfil.has(p)).map(p => ({ p, v: quer.has(p) ? 1 : 0 }));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM user_permissions WHERE user_id = ?').bind(id),
    ...ajustes.map(a => c.env.DB.prepare('INSERT INTO user_permissions (user_id, permissao, concedida) VALUES (?,?,?)').bind(id, a.p, a.v)),
    auditoria(c, 'permissoes', 'users', id, { ajustes }),
  ]);
  return c.json({ ok: true, ajustes: ajustes.length });
});
