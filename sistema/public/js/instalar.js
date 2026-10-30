// Instalação do app (PWA): botão "Instalar app" no menu, no Início (celular) e na tela de entrada.
// Android/Chrome/Edge: usa o pedido nativo do navegador. iPhone/iPad (Safari): mostra o passo a passo,
// porque a Apple não permite instalar por botão.
import { $, modal, toast } from './ui.js';

let pedido = null; // evento guardado para abrir a instalação na hora do clique

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  pedido = e;
  window.dispatchEvent(new CustomEvent('instalacao-mudou'));
});
window.addEventListener('appinstalled', () => {
  pedido = null;
  toast('App instalado. Agora é só abrir pelo ícone "Ateliê Jessica".');
  window.dispatchEvent(new CustomEvent('instalacao-mudou'));
});

const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ehCelular = () => matchMedia('(max-width: 760px)').matches || /android|iphone|ipad|ipod/i.test(navigator.userAgent);

/** Já está aberto como app instalado? */
export const instalado = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** Mostra a opção de instalar? (no iPhone sempre, até instalar; nos outros, quando o navegador permite) */
export const podeInstalar = () => !instalado() && (!!pedido || ehIOS() || ehCelular());

export async function instalar() {
  if (instalado()) return toast('O app já está instalado neste aparelho.');
  if (pedido) {
    const p = pedido;
    pedido = null;
    await p.prompt();
    const { outcome } = await p.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (outcome !== 'accepted') toast('Instalação cancelada. Você pode instalar depois pelo menu.');
    window.dispatchEvent(new CustomEvent('instalacao-mudou'));
    return;
  }
  const passos = ehIOS()
    ? ['Toque no botão <b>Compartilhar</b> <span aria-hidden="true">(quadrado com seta para cima)</span>, na barra do Safari.',
      'Role e toque em <b>Adicionar à Tela de Início</b>.', 'Confirme em <b>Adicionar</b>. O ícone "Ateliê Jessica" aparece junto dos outros apps.']
    : ['Abra o menu do navegador <span aria-hidden="true">(⋮ ou ⋯)</span>.',
      'Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.', 'Confirme. O ícone "Ateliê Jessica" aparece junto dos outros apps.'];
  modal({
    title: 'Instalar o app Ateliê Jessica',
    body: `<p style="margin:0 0 10px">Com o app instalado, o sistema abre em tela cheia, direto pelo ícone, como um aplicativo.</p>
      ${ehIOS() ? '<p class="ajuda" style="margin:0 0 10px">No iPhone, use o <b>Safari</b> (em outros navegadores do iPhone a opção pode não aparecer).</p>' : ''}
      <ol style="margin:0;padding-left:20px;display:grid;gap:8px">${passos.map(p => `<li>${p}</li>`).join('')}</ol>`,
    actions: [{ label: 'Entendi', cls: 'pri' }],
  });
}

const ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/></svg>';

/** Botão para o menu (lateral ou "Mais"). */
export const botaoMenu = (cls = '') => (podeInstalar() ? `<button type="button" class="${cls}" data-instalar role="menuitem">${ICONE}Instalar app</button>` : '');

/** Aviso no Início do celular (some depois de instalado ou dispensado). */
export function avisoInicio() {
  let dispensado = false;
  try { dispensado = localStorage.getItem('atelie-instalar-dispensado') === '1'; } catch {}
  if (!podeInstalar() || !ehCelular() || dispensado) return '';
  return `<div class="aviso-instalar nao-imprimir" role="region" aria-label="Instalar o app">
    <img src="/icones/icone-192.png" alt="" width="44" height="44">
    <div><b>Instale o app no seu celular</b><span>Abra o ateliê direto pelo ícone, em tela cheia.</span></div>
    <button type="button" class="btn pri sm" data-instalar>Instalar</button>
    <button type="button" class="x" data-instalar-fechar aria-label="Agora não">×</button></div>`;
}

document.addEventListener('click', e => {
  if (e.target.closest('[data-instalar]')) { e.preventDefault(); $('#mais') && ($('#mais').hidden = true); instalar(); }
  const f = e.target.closest('[data-instalar-fechar]');
  if (f) {
    try { localStorage.setItem('atelie-instalar-dispensado', '1'); } catch {}
    f.closest('.aviso-instalar')?.remove();
  }
});

