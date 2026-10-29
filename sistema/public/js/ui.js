// Utilidades de interface: escape de HTML, modal, confirmação, aviso (toast) e formatação.
import { brl, dataBR, formatarTelefone, STATUS_OS, STATUS_PRODUCAO } from './regras.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export { brl, dataBR, formatarTelefone };
export const nOS = n => 'Nº ' + String(n ?? '').padStart(4, '0');
export const dataHora = iso => {
  if (!iso) return '—';
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return f.format(d).replace(',', '');
};
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const diaSemana = iso => DIAS[new Date(iso + 'T12:00:00Z').getUTCDay()];
export const dataSemana = iso => `${diaSemana(iso)}, ${dataBR(iso)}`;

const COR_STATUS = {
  recebida: 'neutral', aguardando_aprovacao: 'warn', aprovada: 'info', em_producao: 'info', aguardando_prova: 'warn',
  ajustes_finais: 'info', pronta: 'ok', entregue: 'muted', pausada: 'warn', cancelada: 'crit',
};
export const pill = st => `<span class="pill p-${COR_STATUS[st] || 'neutral'}">${esc(STATUS_OS[st] || st)}</span>`;
export const pillProd = st => `<span class="pill p-${{ aguardando: 'neutral', em_execucao: 'info', aguardando_prova: 'warn', ajustes_finais: 'info', finalizado: 'ok' }[st] || 'neutral'}">${esc(STATUS_PRODUCAO[st] || st)}</span>`;

/* ---------- aviso rápido ---------- */
let tt;
export function toast(msg, erro = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.background = erro ? 'var(--crit)' : '';
  t.style.color = erro ? '#fff' : '';
  t.hidden = false;
  clearTimeout(tt);
  tt = setTimeout(() => (t.hidden = true), erro ? 5000 : 2800);
}

/* ---------- modal ---------- */
let acoes = [];
let anterior = null;
/**
 * Abre um modal. actions: [{label, cls, fn}] — se fn retornar false (ou Promise<false>), o modal continua aberto.
 * Durante a execução de fn os botões ficam desabilitados (evita clique duplo).
 */
export function modal({ title, body = '', actions, wide = false, onOpen }) {
  acoes = actions || [{ label: 'Fechar' }];
  anterior = document.activeElement;
  const m = $('#modal');
  m.innerHTML = `<div class="mbox ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="m-title">
    <h2 id="m-title">${esc(title)}</h2><div class="m-corpo">${body}</div>
    <div class="mact">${acoes.map((a, i) => `<button type="button" class="btn ${a.cls || ''}" data-mact="${i}">${esc(a.label)}</button>`).join('')}</div></div>`;
  m.hidden = false;
  const f = $('input:not([type=hidden]), select, textarea', m) || $('[data-mact]:last-child', m);
  f?.focus();
  // Os ouvintes vão na caixa interna (recriada a cada modal) para não se acumularem.
  onOpen?.($('.mbox', m));
  return m;
}
export function fecharModal() {
  const m = $('#modal');
  m.hidden = true;
  m.innerHTML = '';
  anterior?.focus?.();
}
document.addEventListener('click', async e => {
  const m = $('#modal');
  if (m.hidden) return;
  if (e.target === m) return fecharModal();
  const b = e.target.closest('[data-mact]');
  if (!b || !m.contains(b)) return;
  const a = acoes[+b.dataset.mact];
  if (!a.fn) return fecharModal();
  const botoes = $$('[data-mact]', m);
  botoes.forEach(x => (x.disabled = true));
  try {
    const r = await a.fn(m);
    if (r === false) return;
    if (r !== 'manter') fecharModal();
  } finally {
    botoes.forEach(x => (x.disabled = false));
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#modal').hidden) fecharModal();
});

export function confirmar(title, msg, okLabel, { perigo = false } = {}) {
  return new Promise(resolve => {
    modal({
      title, body: `<p style="margin:0">${msg}</p>`,
      actions: [{ label: 'Voltar', fn: () => resolve(false) }, { label: okLabel, cls: perigo ? 'danger' : 'pri', fn: () => resolve(true) }],
    });
    const m = $('#modal');
    const obs = new MutationObserver(() => { if (m.hidden) { obs.disconnect(); resolve(false); } });
    obs.observe(m, { attributes: true, attributeFilter: ['hidden'] });
  });
}

/** Trava um botão enquanto a ação roda (evita cliques repetidos). */
export async function comBotao(botao, fn) {
  if (botao?.disabled) return;
  if (botao) botao.disabled = true;
  try {
    return await fn();
  } finally {
    if (botao) botao.disabled = false;
  }
}

export const opcoes = (lista, sel, vazio) =>
  (vazio !== undefined ? `<option value="">${esc(vazio)}</option>` : '') +
  lista.map(o => `<option value="${esc(o.id)}" ${o.id === sel ? 'selected' : ''}>${esc(o.nome)}</option>`).join('');
