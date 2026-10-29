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
      <div class="panel stat"><span class="lbl">Entregas hoje</span><span class="val num">${k.entregas_hoje ?? 0}<span class="muted" style="font-size:1rem">/${d.capacidade}</span></span><span class="sub">prazo em ${dataBR(d.hoje)}</span></div>
      <div class="panel stat"><span class="lbl">Prontas p/ retirada</span><span class="val num">${k.prontas ?? 0}</span><span class="sub">aguardando a cliente</span></div>
      <div class="panel stat"><span class="lbl">Em produção</span><span class="val num">${k.em_producao ?? 0}</span><span class="sub">${k.aguardando_prova ?? 0} aguardando prova</span></div>
      <div class="panel stat"><span class="lbl">Atrasadas</span><span class="val num" style="color:${k.atrasadas ? 'var(--crit)' : 'inherit'}">${k.atrasadas ?? 0}</span><span class="sub">${k.abertas ?? 0} OS em aberto</span></div>
    </div>
    ${f ? `<div class="grid g3">
      <div class="panel stat"><span class="lbl">Caixa de hoje</span><span class="val num">${brl(f.entradas_hoje - f.saidas_hoje)}</span>
        <span class="sub">${f.caixa_aberto ? 'aberto' : f.caixa_existe ? 'fechado' : 'não aberto'} · entradas ${brl(f.entradas_hoje)}</span></div>
      <div class="panel stat"><span class="lbl">A receber</span><span class="val num" style="color:var(--warn)">${brl(f.a_receber)}</span><span class="sub">saldo de OS não canceladas</span></div>
      <div class="panel stat"><span class="lbl">Recebido no mês</span><span class="val num" style="color:var(--ok)">${brl(f.recebido_mes)}</span><span class="sub">pagamentos de clientes, já descontados estornos</span></div>
    </div>` : ''}
    <div class="grid g2">
      <div class="panel"><div class="panel-h"><h2>Entregas de hoje</h2><span class="muted">${dataSemana(d.hoje)}</span></div><div class="list">${lista(d.entregas_hoje, 'Nenhuma entrega hoje.')}</div></div>
      <div class="panel"><div class="panel-h"><h2>Entregas de amanhã</h2></div><div class="list">${lista(d.entregas_amanha, 'Nenhuma entrega amanhã.')}</div></div>
      <div class="panel"><div class="panel-h"><h2>Atrasadas</h2></div><div class="list">${lista(d.atrasadas, 'Nenhuma OS atrasada.', o => 'era para ' + dataBR(o.prazo))}</div></div>
      <div class="panel"><div class="panel-h"><h2>Prontas para retirada</h2></div><div class="list">${lista(d.prontas, 'Nenhuma peça pronta aguardando.')}</div></div>
    </div>
    <p class="ajuda" style="margin:0">Datas e prazos no horário de Brasília (${FUSO}).</p>`;
}
