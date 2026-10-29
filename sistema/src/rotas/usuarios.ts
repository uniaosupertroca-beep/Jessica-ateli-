import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { hashSenha, validarSenhaNova } from '../lib/auth';
import { auditoria } from '../lib/auditoria';
import { ErroApp, naoEncontrado } from '../lib/erros';
import { agora, exigir, lerCorpo, uuid } from '../lib/util';

export const rotasUsuarios = new Hono<AppEnv>();

const zPapel = z.enum(['admin', 'atendente', 'costureira'], { error: 'Perfil inválido.' });

rotasUsuarios.get('/', async c => {
  exigir(c, 'usuarios.gerenciar');
  const { results } = await c.env.DB.prepare(
    'SELECT id, nome, email, papel, ativo, criado_em FROM users ORDER BY ativo DESC, nome',
  ).all();
  return c.json({ usuarios: results });
});

rotasUsuarios.post('/', async c => {
  exigir(c, 'usuarios.gerenciar');
  const d = await lerCorpo(c, z.object({
    nome: z.string().trim().min(2, 'Informe o nome.').max(120),
    email: z.string().trim().toLowerCase().email('E-mail inválido.').max(200),
    papel: zPapel,
    senha: z.string(),
  }));
  validarSenhaNova(d.senha);
  const id = uuid();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO users (id, nome, email, senha_hash, papel, criado_em) VALUES (?,?,?,?,?,?)')
      .bind(id, d.nome, d.email, await hashSenha(d.senha), d.papel, agora()),
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
    senha: z.string().optional(),
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
         senha_hash = COALESCE(?, senha_hash), atualizado_em = ? WHERE id = ?`,
    ).bind(d.nome ?? null, d.papel ?? null, d.ativo === undefined ? null : d.ativo ? 1 : 0,
      d.senha ? await hashSenha(d.senha) : null, agora(), id),
    auditoria(c, 'editar', 'users', id, { nome: d.nome, papel: d.papel, ativo: d.ativo, senha_alterada: !!d.senha }),
  ];
  // Desativar, trocar perfil ou redefinir senha derruba as sessões abertas dessa pessoa.
  if (d.ativo === false || d.papel || d.senha) stmts.push(c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});
