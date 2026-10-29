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
  pode(p) { return this.perms.has(p); },
};

export async function carregarConfig() {
  sessao.config = await api('/config');
  return sessao.config;
}
