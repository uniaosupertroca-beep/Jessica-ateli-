// Barra do topo: pesquisa geral (clientes, OS, peças, materiais) e leitura de QR Code das etiquetas.
import { api } from './api.js';
import { $, esc, fecharModal, formatarTelefone, modal, nOS, pill, toast } from './ui.js';

let tempo;

export function barraTopo() {
  const b = document.createElement('div');
  b.className = 'barra-topo nao-imprimir';
  b.innerHTML = `<div class="busca-geral"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input type="search" class="in" placeholder="Pesquisar cliente, OS, peça ou material" aria-label="Pesquisa geral" autocomplete="off">
      <div class="busca-res" hidden role="listbox"></div></div>
    <button type="button" class="btn icon ghost" data-qr title="Ler QR Code da etiqueta" aria-label="Ler QR Code da etiqueta">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4"/><path d="M7 7h4v4H7zM13 13h4v4h-4zM13 7h4M7 13v4"/></svg></button>`;
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
  $('[data-qr]', b).addEventListener('click', lerQR);
  return b;
}

/** Abre a OS de uma peça a partir do código da etiqueta (ex.: 142-2). */
export async function abrirPecaPorCodigo(codigo) {
  try {
    const r = await api(`/pecas/${encodeURIComponent(codigo)}`);
    location.replace(`#ordens/${r.order_id}`);
    sessionStorage.setItem('destacar-peca', r.item_id);
  } catch (e) {
    toast(e.message, true);
    location.replace('#inicio');
  }
}

/** Leitor de QR Code pela câmera (quando o navegador oferece), ou digitação do código. */
async function lerQR() {
  const temLeitor = 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia;
  let fluxo = null;
  let ativo = true;
  const parar = () => { ativo = false; fluxo?.getTracks().forEach(t => t.stop()); };
  modal({
    title: 'Ler etiqueta',
    body: `${temLeitor ? '<video id="qr-video" playsinline muted style="width:100%;border-radius:12px;background:#000;aspect-ratio:1;object-fit:cover"></video><p class="ajuda">Aponte a câmera para o QR Code da etiqueta.</p>'
      : '<p class="ajuda" style="margin-top:0">Este navegador não lê QR Code aqui dentro. Use a câmera do celular apontada para a etiqueta: ela abre o sistema na peça certa. Ou digite o código impresso:</p>'}
      <div class="field"><label for="qr-cod">Código da peça</label><input class="in" id="qr-cod" placeholder="ex.: 142-2" inputmode="numeric" autocomplete="off"></div>`,
    actions: [{ label: 'Fechar', fn: () => { parar(); } }, { label: 'Abrir', cls: 'pri', fn: m => {
      const v = $('#qr-cod', m).value.trim();
      if (!/^\d{1,9}-\d{1,4}$/.test(v)) { toast('Digite o código como aparece na etiqueta (ex.: 142-2).', true); return false; }
      parar();
      location.hash = `p/${v}`;
    } }],
    onOpen: async box => {
      if (!temLeitor) return;
      try {
        fluxo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = $('#qr-video', box);
        v.srcObject = fluxo;
        await v.play();
        const det = new window.BarcodeDetector({ formats: ['qr_code'] });
        const ler = async () => {
          if (!ativo || !document.body.contains(v)) return parar();
          const cods = await det.detect(v).catch(() => []);
          const txt = cods[0]?.rawValue || '';
          const m = txt.match(/#p\/(\d{1,9}-\d{1,4})/) || txt.match(/^(\d{1,9}-\d{1,4})$/);
          if (m) { parar(); fecharModal(); location.hash = `p/${m[1]}`; return; }
          requestAnimationFrame(ler);
        };
        ler();
      } catch {
        toast('Não foi possível usar a câmera. Digite o código.', true);
      }
    },
  });
}
