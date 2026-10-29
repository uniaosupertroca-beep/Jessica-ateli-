import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { hashSenha, validarSenhaNova } from '../lib/auth';
import { auditoria } from '../lib/auditoria';
import { ErroApp, naoEncontrado } from '../lib/erros';
import { agora, exigir, lerCorpo, uuid } from '../lib/util';

export const rotasUsuarios = new Hono<AppEnv>();

const zLogin = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'Usuário: 3 a 40 letras sem acento, números, ponto, hífen ou _.').optional().nullable()
  .or(z.literal('').transform(() => null));

const zCapacidade = z.number().int().min(0).max(1440).optional();
const zDias = z.string().regex(/^[0-6]{0,7}$/, 'Dias de trabalho inválidos.').optional();

const zPapel = z.enum(['admin', 'atendente', 'costureira'], { error: 'Perfil inválido.' });

rotasUsuarios.get('/', async c => {
  exigir(c, 'usuarios.gerenciar');
  const { results } = await c.env.DB.prepare(
    'SELECT id, nome, email, login, papel, ativo, trocar_senha, capacidade_min_dia, dias_trabalho, criado_em FROM users ORDER BY ativo DESC, nome',
  ).all();
  return c.json({ usuarios: results });
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
  }));
  validarSenhaNova(d.senha);
  const id = uuid();
  await c.env.DB.batch([
    // A senha criada pelo administrador é temporária: a pessoa troca no primeiro acesso.
    c.env.DB.prepare(`INSERT INTO users (id, nome, email, login, senha_hash, papel, trocar_senha, capacidade_min_dia, dias_trabalho, criado_em)
      VALUES (?,?,?,?,?,?,1,?,?,?)`)
      .bind(id, d.nome, d.email, d.login ?? null, await hashSenha(d.senha), d.papel, d.capacidade_min_dia ?? 0, d.dias_trabalho ?? '12345', agora()),
    auditoria(c, 'criar', 'users', id, { nome: d.nome, email: d.email, papel: d.papel }),
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
  }));
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
    auditoria(c, 'editar', 'users', id, { nome: d.nome, papel: d.papel, ativo: d.ativo, senha_alterada: !!d.senha }),
  ];
  // Desativar, trocar perfil ou redefinir senha derruba as sessões abertas dessa pessoa.
  if (d.ativo === false || d.papel || d.senha) stmts.push(c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});
