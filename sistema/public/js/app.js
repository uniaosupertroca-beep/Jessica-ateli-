// Ponto de entrada: login, menu e navegação entre telas (por endereço #tela/parametro).
import { api, carregarConfig, definirUnidades, ErroApi, sessao } from './api.js';
import { $, esc, fecharModal, toast } from './ui.js';
import { telaLogin, telaConfigurarInicial, telaTrocarSenha } from './telas/login.js';
import { telaInicio } from './telas/inicio.js';
import { telaOrdens, telaOS, telaImpressao } from './telas/ordens.js';
import { telaClientes, telaCliente } from './telas/clientes.js';
import { telaAgenda } from './telas/agenda.js';
import { telaFinanceiro } from './telas/financeiro.js';
import { telaConfig } from './telas/config.js';
import { telaProducao } from './telas/producao.js';
import { telaEstoque } from './telas/estoque.js';
import { telaRelatorios } from './telas/relatorios.js';
import { telaServicos } from './telas/servicos.js';
import { telaMedidas } from './telas/medidas.js';
import { barraTopo } from './busca.js';

const ICONES = {
  inicio: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  ordens: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>',
  agenda: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  clientes: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.8 3.1 2.5 3.5 5.2"/>',
  financeiro: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.3"/>',
  config: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  producao: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  medidas: '<path d="M2 7h20v10H2z"/><path d="M6 7v4M10 7v6M14 7v4M18 7v6"/>',
  servicos: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="2"/>',
  estoque: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  relatorios: '<path d="M3 3v18h18"/><path d="M7 15v-4M12 15V8M17 15v-7"/>',
  mais: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  sair: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
};
const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[k]}</svg>`;

/** Itens do menu, conforme as permissões de quem está logado. */
function itensMenu() {
  return [
    ['inicio', 'Início', true],
    ['ordens', 'Ordens de serviço', sessao.pode('os.ver')],
    ['producao', 'Produção', sessao.pode('producao.ver')],
    ['agenda', 'Agenda', sessao.pode('agenda.ver')],
    ['clientes', 'Clientes', sessao.pode('clientes.ver')],
    ['medidas', 'Medidas', sessao.pode('medidas.ver') && sessao.pode('clientes.ver')],
    ['servicos', 'Serviços', sessao.pode('os.financeiro.ver')],
    ['estoque', 'Estoque', sessao.pode('estoque.ver')],
    ['financeiro', 'Financeiro', sessao.pode('financeiro.ver')],
    ['relatorios', 'Relatórios', sessao.pode('relatorios.ver')],
    ['config', sessao.pode('config.editar') ? 'Configurações' : 'Minha conta', true],
  ].filter(i => i[2]);
}
const CURTO = { inicio: 'Início', ordens: 'OS', producao: 'Produção', agenda: 'Agenda', clientes: 'Clientes', medidas: 'Medidas', servicos: 'Serviços',
  estoque: 'Estoque', financeiro: 'Financeiro', relatorios: 'Relatórios', config: 'Ajustes' };

const ROTAS = {
  inicio: () => telaInicio,
  ordens: p => (p[0] === 'nova' ? telaOS : p[0] && (p[1] === 'imprimir' || p[1] === 'etiquetas') ? telaImpressao : p[0] ? telaOS : telaOrdens),
  producao: () => telaProducao,
  medidas: () => telaMedidas,
  servicos: () => telaServicos,
  estoque: () => telaEstoque,
  relatorios: () => telaRelatorios,
  clientes: p => (p[0] ? telaCliente : telaClientes),
  agenda: () => telaAgenda,
  financeiro: () => telaFinanceiro,
  config: () => telaConfig,
};

export function ir(hash) {
  if (location.hash === '#' + hash) renderizar();
  else location.hash = hash;
}

function desenharMenu(atual) {
  const itens = itensMenu();
  $('#nav-side').innerHTML = itens.map(([k, l]) => `<a href="#${k}" class="${k === atual ? 'on' : ''}" ${k === atual ? 'aria-current="page"' : ''}>${svg(k)}${esc(l)}</a>`).join('');
  $('#side-usuario').innerHTML = `<span><b>${esc(sessao.eu.nome)}</b><br><span class="muted">${esc({ admin: 'Administrador', atendente: 'Atendente', costureira: 'Costureira' }[sessao.eu.papel])}</span></span>
    <button class="btn sm ghost" data-sair>Sair</button>`;
  // Celular: até 4 atalhos fixos + "Mais" com o restante (erro 6 corrigido).
  const fixos = itens.slice(0, itens.length > 5 ? 4 : 5);
  const resto = itens.slice(fixos.length);
  const noResto = resto.some(([k]) => k === atual);
  $('#nav-bottom').innerHTML = fixos.map(([k]) => `<a href="#${k}" class="${k === atual ? 'on' : ''}">${svg(k)}<span>${CURTO[k]}</span></a>`).join('') +
    `<button type="button" data-mais class="${noResto ? 'on' : ''}" aria-haspopup="true">${svg('mais')}<span>Mais</span></button>`;
  $('#mais').innerHTML = `<div class="mais-box" role="menu">${resto.map(([k, l]) => `<a href="#${k}" class="${k === atual ? 'on' : ''}" role="menuitem">${svg(k)}${esc(l)}</a>`).join('')}
    <button type="button" data-sair role="menuitem">${svg('sair')}Sair (${esc(sessao.eu.nome)})</button></div>`;
  $('#brand-nome').textContent = sessao.config?.atelie?.nome || 'Ateliê Jessica';
}

let geracao = 0;
export async function renderizar() {
  fecharModal();
  $('#mais').hidden = true;
  if (!sessao.eu) return;
  const [nome = 'inicio', ...params] = location.hash.slice(1).split('/').map(decodeURIComponent);
  const rota = ROTAS[nome] ? nome : 'inicio';
  if (!itensMenu().some(([k]) => k === rota)) return ir('inicio');
  desenharMenu(rota);
  const tela = ROTAS[rota](params);
  const main = $('#main');
  const el = document.createElement('div');
  el.className = 'wrap';
  el.innerHTML = '<p class="carregando">Carregando…</p>';
  main.replaceChildren(barraTopo(), el);
  const minha = ++geracao;
  try {
    await tela(el, params, () => minha === geracao);
  } catch (e) {
    if (minha !== geracao) return;
    if (e instanceof ErroApi && e.status === 401) return;
    el.innerHTML = `<div class="erro-tela">${esc(e.message || 'Erro ao carregar a tela.')}</div>`;
    console.error(e);
  }
}

async function sair() {
  await api('/auth/sair', { corpo: {} }).catch(() => {});
  sessao.eu = null;
  location.hash = '';
  iniciar();
}

/* App instalável (PWA): registra o service worker e avisa quando há versão nova. */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').then(reg => {
    const avisar = sw => {
      const t = $('#toast');
      t.innerHTML = 'Nova versão do sistema disponível. <button class="btn sm sec" id="sw-atualizar" style="margin-left:8px">Atualizar</button>';
      t.hidden = false;
      $('#sw-atualizar').onclick = () => sw.postMessage('atualizar');
    };
    if (reg.waiting && navigator.serviceWorker.controller) avisar(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const novo = reg.installing;
      novo?.addEventListener('statechange', () => { if (novo.state === 'installed' && navigator.serviceWorker.controller) avisar(novo); });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => {});
  let recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!recarregou) { recarregou = true; location.reload(); } });
}

document.addEventListener('click', e => {
  if (e.target.closest('[data-sair]')) return sair();
  if (e.target.closest('[data-mais]')) {
    $('#mais').hidden = !$('#mais').hidden;
    return;
  }
  if (e.target.id === 'mais') $('#mais').hidden = true;
});
window.addEventListener('hashchange', () => { renderizar(); window.scrollTo(0, 0); });
window.addEventListener('unidade-trocada', async () => { await carregarConfig().catch(() => {}); renderizar(); });
window.addEventListener('sessao-expirada', () => {
  if (!sessao.eu) return;
  sessao.eu = null;
  toast('Sua sessão terminou. Entre novamente.', true);
  iniciar();
});

/** Mantém "hoje" atualizado se o sistema ficar aberto de um dia para o outro (erro 3). */
setInterval(async () => {
  if (!sessao.eu || document.hidden) return;
  const { hoje } = await api('/auth/estado').catch(() => ({}));
  if (hoje && hoje !== sessao.hoje) {
    sessao.hoje = hoje;
    renderizar();
  }
}, 5 * 60 * 1000);

export async function iniciar() {
  try {
    const eu = await api('/auth/eu');
    sessao.eu = eu.usuario;
    sessao.perms = new Set(eu.permissoes);
    sessao.hoje = eu.hoje;
    definirUnidades(eu.unidades);
    if (eu.usuario.trocar_senha) {
      document.body.classList.add('deslogado');
      const el = document.createElement('div');
      $('#main').replaceChildren(el);
      $('#nav-bottom').innerHTML = '';
      return telaTrocarSenha(el, iniciar);
    }
    await carregarConfig();
    document.body.classList.remove('deslogado');
    renderizar();
  } catch (e) {
    if (!(e instanceof ErroApi) || e.status !== 401) {
      $('#main').innerHTML = `<div class="wrap"><div class="erro-tela">${esc(e.message)}</div></div>`;
      return;
    }
    const estado = await api('/auth/estado');
    document.body.classList.add('deslogado');
    $('#nav-bottom').innerHTML = '';
    const tela = estado.precisa_configurar ? telaConfigurarInicial : telaLogin;
    const main = $('#main');
    const el = document.createElement('div');
    main.replaceChildren(el);
    $('#nav-side').innerHTML = '';
    $('#side-usuario').innerHTML = '';
    tela(el, iniciar);
  }
}

iniciar();
