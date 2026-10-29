import { exports, env } from 'cloudflare:workers';

export const BASE = 'https://atelie.teste';
export const db = () => (env as unknown as { DB: D1Database }).DB;

type Opcoes = { metodo?: string; corpo?: unknown; cookie?: string; chave?: string; form?: FormData; origem?: string };

export async function chamar(caminho: string, o: Opcoes = {}) {
  const headers: Record<string, string> = {};
  if (o.cookie) headers.Cookie = o.cookie;
  if (o.chave) headers['Idempotency-Key'] = o.chave;
  if (o.origem) headers.Origin = o.origem;
  let body: BodyInit | undefined;
  if (o.form) body = o.form;
  else if (o.corpo !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(o.corpo);
  }
  const r = await (exports as unknown as { default: Fetcher }).default.fetch(`${BASE}/api${caminho}`, {
    method: o.metodo ?? (o.corpo !== undefined || o.form ? 'POST' : 'GET'), headers, body,
  });
  const tipo = r.headers.get('Content-Type') || '';
  const dados = tipo.includes('json') ? await r.json<any>() : null;
  return { status: r.status, dados, r };
}

export function cookieDe(r: Response) {
  const sc = r.headers.get('Set-Cookie') || '';
  const m = sc.match(/__Host-sid=([^;]+)/);
  if (!m) throw new Error('sem cookie: ' + sc);
  return `__Host-sid=${m[1]}`;
}

export const SENHA = 'senha-forte-123';
let contador = 0;
export const chave = () => `k${Date.now()}x${++contador}x${Math.random().toString(36).slice(2, 8)}`;

/** Garante um administrador e devolve o cookie de sessão dele. */
export async function admin() {
  const est = await chamar('/auth/estado');
  if (est.dados.precisa_configurar) {
    const r = await chamar('/auth/configurar', { corpo: { token: 'token-de-teste-123456', nome: 'Jessica', email: 'admin@teste.com', senha: SENHA } });
    if (r.status !== 200) throw new Error('configurar falhou ' + JSON.stringify(r.dados));
    return cookieDe(r.r);
  }
  const r = await chamar('/auth/entrar', { corpo: { email: 'admin@teste.com', senha: SENHA } });
  if (r.status !== 200) throw new Error('login admin falhou ' + JSON.stringify(r.dados));
  return cookieDe(r.r);
}

export async function usuario(cookieAdmin: string, papel: 'atendente' | 'costureira') {
  const email = `${papel}${chave().toLowerCase()}@teste.com`;
  const c = await chamar('/usuarios', { cookie: cookieAdmin, corpo: { nome: `Pessoa ${papel}`, email, papel, senha: SENHA } });
  if (c.status !== 201) throw new Error('criar usuário falhou ' + JSON.stringify(c.dados));
  const r = await chamar('/auth/entrar', { corpo: { email, senha: SENHA } });
  const cookie = cookieDe(r.r);
  // senha criada pelo administrador é temporária: troca no primeiro acesso
  const t = await chamar('/auth/senha', { cookie, corpo: { atual: SENHA, nova: SENHA + '-nova' } });
  if (t.status !== 200) throw new Error('troca de senha falhou ' + JSON.stringify(t.dados));
  return { cookie, id: c.dados.id as string };
}

export async function cliente(cookie: string, nome = `Cliente ${chave()}`, telefone: string | null = null) {
  const r = await chamar('/clientes', { cookie, corpo: { nome, telefone, confirmar_duplicado: true } });
  if (r.status !== 201) throw new Error('cliente falhou ' + JSON.stringify(r.dados));
  return r.dados.id as string;
}

export async function abrirCaixa(cookie: string) {
  await chamar('/caixa/abrir', { cookie, corpo: { saldo_inicial_centavos: 10000 } });
}

export function hojeSP() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

/** Cria OS com serviços livres (admin pode definir preço). valores em centavos. */
export async function criarOS(cookie: string, clientId: string, pecas: Array<{ peca: string; servicos: Array<{ descricao: string; valor: number; quantidade?: number; unidade?: string }> }>, extra: Record<string, unknown> = {}) {
  const r = await chamar('/ordens', {
    cookie, chave: chave(),
    corpo: {
      client_id: clientId, prazo: hojeSP(), confirmar_lotado: true,
      itens: pecas.map(p => ({ peca: p.peca, servicos: p.servicos.map(s => ({ descricao: s.descricao, quantidade: s.quantidade ?? 1, unidade: s.unidade ?? 'un', valor_unitario_centavos: s.valor })) })),
      ...extra,
    },
  });
  if (r.status !== 201) throw new Error('OS falhou ' + JSON.stringify(r.dados));
  return r.dados as { id: string; numero: number };
}
