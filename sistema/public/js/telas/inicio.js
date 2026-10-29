import { api, sessao } from '../api.js';
import { brl, dataBR, dataSemana, esc, nOS, pill } from '../ui.js';
import { FUSO } from '../regras.js';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function linhaOS(o, extra = '') {
  return `<a class="li" href="#ordens/${o.id}" style="color:inherit;text-decoration:none">
    <div><div class="t">${esc(o.cliente)} <span class="muted num" style="font-size:.8rem">${nOS(o.numero)}</span></div>
      <div class="s">${esc(o.pecas || '')}${extra ? ' · ' + extra : ''}</div></div>
    <div style="text-align:right">${pill(o.status)}${o.saldo !== undefined && o.saldo !== null
      ? `<div class="s num" style="margin-top:3px">${o.saldo > 0 ? 'falta ' + brl(o.saldo) : 'pago'}</div>` : ''}</div></a>`;
}

// Ícones no estilo Lucide (traço), usados nos cartões de estatística.
const ICO = {
  entrega: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>',
  pronta: '<path d="M20 6 9 17l-5-5"/>',
  tesoura: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  alerta: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  caixa: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  receber: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  mes: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/>',
};
const icone = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k]}</svg>`;

/** Cartão de estatística (padrão "Stats Card" do 21st.dev): título + ícone, valor grande, linha de apoio. */
const cartao = (lbl, val, sub, ico, tom = '', cor = '') => `<div class="panel stat">
  <div class="topo"><span class="lbl">${lbl}</span><span class="ico ${tom}">${icone(ico)}</span></div>
  <span class="val num" ${cor ? `style="color:${cor}"` : ''}>${val}</span><span class="sub">${sub}</span></div>`;

const lista = (itens, vazio, extra) => itens.length ? itens.map(o => linhaOS(o, extra?.(o))).join('') : `<div class="empty">${vazio}</div>`;

export async function telaInicio(el) {
  const d = await api('/inicio');
  const [a, m, dia] = d.hoje.split('-').map(Number);
  const semana = DIAS[new Date(Date.UTC(a, m - 1, dia, 12)).getUTCDay()];
  const k = d.contagens || {};
  const f = d.financeiro;
  const podeCriar = sessao.pode('os.editar');
  el.innerHTML = `
    <div class="head"><div><h1>${semana}, ${dia} de ${MESES[m - 1]} de ${a}</h1><p>Olá, ${esc(sessao.eu.nome.split(' ')[0])}. Resumo do ateliê hoje.</p></div>
      <div class="row">${podeCriar ? '<a class="btn pri" href="#ordens/nova">+ Nova OS</a>' : ''}
        ${sessao.pode('clientes.editar') ? '<a class="btn" href="#clientes/nova">+ Nova cliente</a>' : ''}</div></div>
    <div class="grid g4">
      ${cartao('Entregas hoje', `${k.entregas_hoje ?? 0}<span class="muted" style="font-size:1rem">/${d.capacidade}</span>`, `prazo em ${dataBR(d.hoje)}`, 'entrega')}
      ${cartao('Prontas p/ retirada', k.prontas ?? 0, 'aguardando a cliente', 'pronta', 'ok')}
      ${cartao('Em produção', k.em_producao ?? 0, `${k.aguardando_prova ?? 0} aguardando prova`, 'tesoura', 'info')}
      ${cartao('Atrasadas', k.atrasadas ?? 0, `${k.abertas ?? 0} OS em aberto`, 'alerta', k.atrasadas ? 'crit' : 'warn', k.atrasadas ? 'var(--crit)' : '')}
    </div>
    ${f ? `<div class="grid g3">
      ${cartao('Caixa de hoje', brl(f.entradas_hoje - f.saidas_hoje), `${f.caixa_aberto ? 'aberto' : f.caixa_existe ? 'fechado' : 'não aberto'} · entradas ${brl(f.entradas_hoje)}`, 'caixa')}
      ${cartao('A receber', brl(f.a_receber), 'saldo de OS não canceladas', 'receber', 'warn', 'var(--warn)')}
      ${cartao('Recebido no mês', brl(f.recebido_mes), 'pagamentos de clientes, já descontados estornos', 'mes', 'ok', 'var(--ok)')}
    </div>` : ''}
    <div class="grid g2">
      <div class="panel"><div class="panel-h"><h2>Entregas de hoje</h2><span class="muted">${dataSemana(d.hoje)}</span></div><div class="list">${lista(d.entregas_hoje, 'Nenhuma entrega hoje.')}</div></div>
      <div class="panel"><div class="panel-h"><h2>Entregas de amanhã</h2></div><div class="list">${lista(d.entregas_amanha, 'Nenhuma entrega amanhã.')}</div></div>
      <div class="panel"><div class="panel-h"><h2>Atrasadas</h2></div><div class="list">${lista(d.atrasadas, 'Nenhuma OS atrasada.', o => 'era para ' + dataBR(o.prazo))}</div></div>
      <div class="panel"><div class="panel-h"><h2>Prontas para retirada</h2></div><div class="list">${lista(d.prontas, 'Nenhuma peça pronta aguardando.')}</div></div>
    </div>
    <p class="ajuda" style="margin:0">Datas e prazos no horário de Brasília (${FUSO}).</p>`;
}
