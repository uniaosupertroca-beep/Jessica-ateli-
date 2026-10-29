import type { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv, Papel, Usuario } from '../env';
import { ErroApp } from './erros';
import { permissoesDo } from './permissoes';
import { agora, ip, uuid } from './util';

export const COOKIE = '__Host-sid';
const DURACAO_SESSAO_MS = 7 * 24 * 3600 * 1000;
const ITERACOES = 100_000; // máximo aceito pelo PBKDF2 do runtime da Cloudflare

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const deB64 = (s: string) => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));

async function derivar(senha: string, sal: Uint8Array, iteracoes: number) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteracoes }, chave, 256);
}

export async function hashSenha(senha: string) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const h = await derivar(senha, sal, ITERACOES);
  return `pbkdf2$${ITERACOES}$${b64(sal)}$${b64(h)}`;
}

function iguais(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

export async function verificarSenha(senha: string, armazenado: string) {
  const [alg, it, sal, hash] = armazenado.split('$');
  if (alg !== 'pbkdf2' || !it || !sal || !hash) return false;
  const h = new Uint8Array(await derivar(senha, deB64(sal), Number(it)));
  return iguais(h, deB64(hash));
}

/** Usado quando o e-mail não existe, para o tempo de resposta não revelar quem tem conta. */
export async function gastarTempoDeHash(senha: string) {
  await derivar(senha, new Uint8Array(16), ITERACOES);
}

async function sha256(s: string) {
  return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/** Normaliza o identificador de login: e-mail em minúsculas ou nome de usuário. */
export function identificador(texto: string) {
  return texto.trim().toLowerCase();
}

export function validarSenhaNova(senha: string) {
  if (senha.length < 10) throw new ErroApp(422, 'senha_fraca', 'A senha precisa ter pelo menos 10 caracteres.');
  if (senha.length > 200) throw new ErroApp(422, 'senha_longa', 'Senha muito longa.');
}

export async function criarSessao(c: Context<AppEnv>, userId: string) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, ch => ({ '+': '-', '/': '_', '=': '' })[ch]!);
  const id = await sha256(token);
  const expira = new Date(Date.now() + DURACAO_SESSAO_MS);
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, criada_em, expira_em, ip, user_agent) VALUES (?,?,?,?,?,?)')
    .bind(id, userId, agora(), expira.toISOString(), ip(c), (c.req.header('User-Agent') || '').slice(0, 200))
    .run();
  setCookie(c, COOKIE, token, { path: '/', secure: true, httpOnly: true, sameSite: 'Strict', expires: expira });
}

export async function encerrarSessao(c: Context<AppEnv>) {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
  deleteCookie(c, COOKIE, { path: '/', secure: true });
}

/** Exige sessão válida e carrega usuário + permissões. */
export async function exigirLogin(c: Context<AppEnv>, next: Next) {
  const token = getCookie(c, COOKIE);
  if (!token) throw new ErroApp(401, 'nao_autenticado', 'Entre com seu e-mail e senha.');
  const id = await sha256(token);
  const u = await c.env.DB.prepare(
    `SELECT u.id, u.nome, u.email, u.login, u.papel, u.trocar_senha FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expira_em > ? AND u.ativo = 1`,
  ).bind(id, agora()).first<Usuario>();
  if (!u) {
    deleteCookie(c, COOKIE, { path: '/', secure: true });
    throw new ErroApp(401, 'sessao_expirada', 'Sua sessão terminou. Entre novamente.');
  }
  c.set('usuario', u);
  c.set('perms', permissoesDo(u.papel as Papel));
  c.set('sessaoId', id);
  // Senha inicial/temporária: só permite trocar a senha (e ver os próprios dados ou sair).
  const livre = /\/auth\/(eu|senha|sair)$/.test(new URL(c.req.url).pathname);
  if (u.trocar_senha && !livre)
    throw new ErroApp(403, 'troca_obrigatoria', 'Troque a senha inicial antes de continuar.');
  await next();
}

/* ---------- limite de tentativas de login ----------
 * Por e-mail: 5 erros em 15 min bloqueiam aquela conta por 15 min.
 * Por IP: 30 erros (o ateliê inteiro pode sair pelo mesmo IP, então o limite é maior).
 */
const JANELA_MS = 15 * 60 * 1000;
export const maxFalhas = (chave: string) => (chave.startsWith('ip:') ? 30 : 5);

export async function verificarBloqueio(db: D1Database, chaves: string[]) {
  const agoraIso = agora();
  for (const k of chaves) {
    const r = await db.prepare('SELECT bloqueado_ate FROM login_attempts WHERE chave = ?').bind(k).first<{ bloqueado_ate: string | null }>();
    if (r?.bloqueado_ate && r.bloqueado_ate > agoraIso)
      throw new ErroApp(429, 'muitas_tentativas', 'Muitas tentativas de entrada. Aguarde 15 minutos e tente de novo.');
  }
}

export async function registrarFalha(db: D1Database, chaves: string[]) {
  const agoraMs = Date.now();
  const inicioJanela = new Date(agoraMs - JANELA_MS).toISOString();
  const bloqueio = new Date(agoraMs + JANELA_MS).toISOString();
  await db.batch(chaves.map(k => db.prepare(
    `INSERT INTO login_attempts (chave, falhas, janela_inicio) VALUES (?1, 1, ?2)
     ON CONFLICT(chave) DO UPDATE SET
       falhas = CASE WHEN janela_inicio < ?3 THEN 1 ELSE falhas + 1 END,
       janela_inicio = CASE WHEN janela_inicio < ?3 THEN ?2 ELSE janela_inicio END,
       bloqueado_ate = CASE WHEN janela_inicio >= ?3 AND falhas + 1 >= ?4 THEN ?5 ELSE bloqueado_ate END`,
  ).bind(k, new Date(agoraMs).toISOString(), inicioJanela, maxFalhas(k), bloqueio)));
}

export async function limparFalhas(db: D1Database, chaves: string[]) {
  await db.batch(chaves.map(k => db.prepare('DELETE FROM login_attempts WHERE chave = ?').bind(k)));
}

export const novoId = uuid;
