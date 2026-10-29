import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import {
  criarSessao, encerrarSessao, exigirLogin, gastarTempoDeHash, hashSenha, limparFalhas, registrarFalha,
  validarSenhaNova, verificarBloqueio, verificarSenha,
} from '../lib/auth';
import { ErroApp } from '../lib/erros';
import { agora, hoje, ip, lerCorpo, uuid } from '../lib/util';
import { auditoria } from '../lib/auditoria';

export const rotasAuth = new Hono<AppEnv>();

const zEmail = z.string().trim().toLowerCase().email('E-mail inválido.').max(200);

rotasAuth.get('/estado', async c => {
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return c.json({ precisa_configurar: !n?.n, hoje: hoje() });
});

/** Cria o primeiro administrador. Só funciona com o banco vazio e o segredo SETUP_TOKEN. */
rotasAuth.post('/configurar', async c => {
  const d = await lerCorpo(c, z.object({
    token: z.string().min(1),
    nome: z.string().trim().min(2, 'Informe o nome.').max(120),
    email: zEmail,
    senha: z.string(),
  }));
  const segredo = c.env.SETUP_TOKEN;
  if (!segredo || segredo.length < 16 || d.token !== segredo)
    throw new ErroApp(403, 'token_invalido', 'Código de configuração inválido.');
  validarSenhaNova(d.senha);
  const id = uuid();
  const r = await c.env.DB.prepare(
    `INSERT INTO users (id, nome, email, senha_hash, papel, criado_em)
     SELECT ?,?,?,?, 'admin', ? WHERE NOT EXISTS (SELECT 1 FROM users)`,
  ).bind(id, d.nome, d.email, await hashSenha(d.senha), agora()).run();
  if (!r.meta.changes) throw new ErroApp(409, 'ja_configurado', 'O sistema já foi configurado.');
  await criarSessao(c, id);
  return c.json({ ok: true });
});

rotasAuth.post('/entrar', async c => {
  const d = await lerCorpo(c, z.object({ email: zEmail, senha: z.string().min(1, 'Informe a senha.').max(200) }));
  const chaves = [`email:${d.email}`, `ip:${ip(c)}`];
  await verificarBloqueio(c.env.DB, chaves);
  const u = await c.env.DB.prepare('SELECT id, senha_hash, ativo FROM users WHERE email = ?')
    .bind(d.email).first<{ id: string; senha_hash: string; ativo: number }>();
  const ok = u ? await verificarSenha(d.senha, u.senha_hash) : (await gastarTempoDeHash(d.senha), false);
  if (!u || !ok || !u.ativo) {
    await registrarFalha(c.env.DB, chaves);
    throw new ErroApp(401, 'credenciais_invalidas', 'E-mail ou senha incorretos.');
  }
  await limparFalhas(c.env.DB, chaves);
  await criarSessao(c, u.id);
  return c.json({ ok: true });
});

rotasAuth.post('/sair', async c => {
  await encerrarSessao(c);
  return c.json({ ok: true });
});

rotasAuth.get('/eu', exigirLogin, c => c.json({
  usuario: c.get('usuario'),
  permissoes: [...c.get('perms')],
  hoje: hoje(),
}));

rotasAuth.post('/senha', exigirLogin, async c => {
  const d = await lerCorpo(c, z.object({ atual: z.string().min(1), nova: z.string() }));
  const u = c.get('usuario');
  const r = await c.env.DB.prepare('SELECT senha_hash FROM users WHERE id = ?').bind(u.id).first<{ senha_hash: string }>();
  if (!r || !(await verificarSenha(d.atual, r.senha_hash))) throw new ErroApp(422, 'senha_atual', 'A senha atual está incorreta.');
  validarSenhaNova(d.nova);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET senha_hash = ?, atualizado_em = ? WHERE id = ?').bind(await hashSenha(d.nova), agora(), u.id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').bind(u.id, c.get('sessaoId')),
    auditoria(c, 'alterar_senha', 'users', u.id),
  ]);
  return c.json({ ok: true });
});
