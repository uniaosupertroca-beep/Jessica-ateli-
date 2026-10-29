// Comunicação com o servidor. Toda tela usa estas funções (nunca fetch direto).

export class ErroApi extends Error {
  constructor(status, dados) {
    super(dados?.mensagem || (status === 0 ? 'Sem conexão. Verifique a internet e tente de novo.' : 'Algo deu errado. Tente novamente.'));
    this.status = status;
    this.codigo = dados?.codigo;
    this.dados = dados || {};
  }
}

/** Gera a chave de idempotência de uma ação (um clique = uma chave, mesmo se a rede repetir). */
export const novaChave = () => crypto.randomUUID().replace(/-/g, '');

export async function api(caminho, { metodo, corpo, form, chave } = {}) {
  const headers = {};
  let body;
  if (form) body = form;
  else if (corpo !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(corpo);
  }
  if (chave) headers['Idempotency-Key'] = chave;
  if (sessao.unidade) headers['X-Unidade'] = sessao.unidade;
  let r;
  try {
    r = await fetch('/api' + caminho, { method: metodo || (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin' });
  } catch {
    throw new ErroApi(0, null);
  }
  const tipo = r.headers.get('Content-Type') || '';
  const dados = tipo.includes('json') ? await r.json().catch(() => null) : null;
  if (!r.ok) {
    if (r.status === 401 && !caminho.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('sessao-expirada'));
    throw new ErroApi(r.status, dados);
  }
  return dados;
}

/** Estado compartilhado da sessão. */
export const sessao = {
  eu: null,
  perms: new Set(),
  config: null,
  hoje: null,
  unidades: [],   // unidades que a pessoa pode usar
  unidade: null,  // escolhida no topo (null = todas)
  pode(p) { return this.perms.has(p); },
  /** Nome curto da unidade para mostrar nas listas (só quando há mais de uma). */
  sigla(id) { return this.unidades.length > 1 ? this.unidades.find(u => u.id === id)?.sigla || '' : ''; },
};

const CHAVE_UNIDADE = 'atelie-unidade';
/** Lembra a unidade escolhida neste aparelho; confere se ela ainda é permitida. */
export function definirUnidades(lista) {
  sessao.unidades = lista || [];
  let salva = null;
  try { salva = localStorage.getItem(CHAVE_UNIDADE); } catch {}
  if (sessao.unidades.length === 1) sessao.unidade = sessao.unidades[0].id;
  else sessao.unidade = sessao.unidades.some(u => u.id === salva) ? salva : null;
}
export function escolherUnidade(id) {
  sessao.unidade = id || null;
  try { id ? localStorage.setItem(CHAVE_UNIDADE, id) : localStorage.removeItem(CHAVE_UNIDADE); } catch {}
}

export async function carregarConfig() {
  sessao.config = await api('/config');
  return sessao.config;
}
