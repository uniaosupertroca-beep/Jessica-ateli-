import { api } from '../api.js';
import { $, dataBR, esc } from '../ui.js';

/** Atalho para as fichas de medidas: busca a cliente e abre a aba de medidas dela. */
export async function telaMedidas(el, _p, vivo) {
  el.innerHTML = `<div class="head"><div><h1>Medidas</h1><p>Fichas de medidas por cliente (corporais ou de uma encomenda), com histórico e comparação.</p></div></div>
    <div class="panel"><input class="in" id="md-q" type="search" placeholder="Buscar cliente por nome ou telefone" aria-label="Buscar cliente"><div id="md-lista" class="list"></div></div>`;
  let t;
  const buscar = async q => {
    const { clientes } = await api('/clientes' + (q ? '?q=' + encodeURIComponent(q) : ''));
    if (!vivo()) return;
    $('#md-lista', el).innerHTML = clientes.slice(0, 50).map(c => `<a class="li" href="#clientes/${c.id}/medidas" style="color:inherit;text-decoration:none">
      <div><div class="t">${esc(c.nome)}</div><div class="s">cliente desde ${dataBR(c.criado_em)}</div></div><span class="btn sm sec">Abrir medidas</span></a>`).join('')
      || '<div class="empty">Nenhuma cliente encontrada.</div>';
  };
  $('#md-q', el).oninput = e => { clearTimeout(t); t = setTimeout(() => buscar(e.target.value.trim()), 250); };
  await buscar('');
}
