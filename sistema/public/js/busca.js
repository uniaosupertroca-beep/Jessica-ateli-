// Barra do topo: pesquisa geral (clientes, OS, peças e materiais).
import { api } from './api.js';
import { $, esc, formatarTelefone, nOS, pill } from './ui.js';

let tempo;

export function barraTopo() {
  const b = document.createElement('div');
  b.className = 'barra-topo nao-imprimir';
  b.innerHTML = `<div class="busca-geral"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input type="search" class="in" placeholder="Pesquisar por cliente, peça, nº da OS ou material" aria-label="Pesquisa geral" autocomplete="off">
      <div class="busca-res" hidden role="listbox"></div></div>`;
  const inp = $('input', b);
  const res = $('.busca-res', b);
  inp.addEventListener('input', () => {
    clearTimeout(tempo);
    const q = inp.value.trim();
    if (q.length < 2) { res.hidden = true; return; }
    tempo = setTimeout(async () => {
      const r = await api('/busca?q=' + encodeURIComponent(q)).catch(() => null);
      if (!r || inp.value.trim() !== q) return;
      const grupo = (titulo, itens) => itens.length ? `<div class="busca-grupo">${titulo}</div>${itens.join('')}` : '';
      const html = grupo('Clientes', r.clientes.map(c => `<a href="#clientes/${c.id}" role="option"><b>${esc(c.nome)}</b> <span class="muted">${c.telefone ? formatarTelefone(c.telefone) : ''}</span></a>`))
        + grupo('Ordens de serviço', r.ordens.map(o => `<a href="#ordens/${o.id}" role="option"><b>${nOS(o.numero)}</b> ${esc(o.cliente)} ${pill(o.status)}</a>`))
        + grupo('Peças', r.pecas.map(p => `<a href="#ordens/${p.order_id}" role="option"><b>${esc(p.codigo)}</b> ${esc(p.peca)} <span class="muted">${nOS(p.numero)}</span></a>`))
        + grupo('Materiais', r.materiais.map(m => `<a href="#estoque/${m.id}" role="option"><b>${esc(m.nome)}</b> <span class="muted">${esc(m.codigo)} · ${String(m.quantidade).replace('.', ',')} ${esc(m.unidade)}</span></a>`));
      res.innerHTML = html || '<div class="empty" style="padding:10px">Nada encontrado.</div>';
      res.hidden = false;
    }, 250);
  });
  inp.addEventListener('keydown', e => { if (e.key === 'Escape') { res.hidden = true; inp.blur(); } });
  res.addEventListener('click', e => { if (e.target.closest('a')) { res.hidden = true; inp.value = ''; } });
  document.addEventListener('click', e => { if (!b.contains(e.target)) res.hidden = true; });
  return b;
}
