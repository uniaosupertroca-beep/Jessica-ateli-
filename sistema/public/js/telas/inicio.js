import { api, sessao } from '../api.js';
import { $, brl, dataBR, dataHora, dataSemana, esc, nOS, pill } from '../ui.js';
import { barras } from '../graficos.js';
import { FUSO, linkWhatsApp, montarMensagem, numeroWhatsApp, STATUS_OS, STATUS_PRODUCAO } from '../regras.js';

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

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const PRODUCAO = { aguardando: 'aguardando', em_execucao: 'em execução', aguardando_prova: 'aguardando prova', ajustes_finais: 'ajustes finais', finalizado: 'finalizada' };

export async function telaInicio(el) {
  const d = await api('/inicio');
  const [a, m, dia] = d.hoje.split('-').map(Number);
  const semana = DIAS[new Date(Date.UTC(a, m - 1, dia, 12)).getUTCDay()];
  const k = d.contagens || {};
  const f = d.financeiro;
  const atalhos = [
    sessao.pode('os.editar') && '<a class="btn pri" href="#ordens/nova">+ Nova OS</a>',
    sessao.pode('clientes.editar') && '<a class="btn" href="#clientes/nova">+ Nova cliente</a>',
    sessao.pode('pagamentos.receber') && '<a class="btn" href="#ordens" data-atalho="pagar">Registrar pagamento</a>',
    sessao.pode('agenda.editar') && '<a class="btn" href="#agenda">Agendar prova</a>',
    sessao.pode('os.status') && '<a class="btn" href="#ordens" data-atalho="entrega">Registrar entrega</a>',
    '<button class="btn ghost" data-atalho="consultar">Consultar ordem</button>',
  ].filter(Boolean).join('');
  const avisos = [
    d.estoque_baixo ? `<a class="alert a-warn" href="#estoque" style="display:block;text-decoration:none">${d.estoque_baixo} material(is) no estoque mínimo.</a>` : '',
    d.contas_vencendo?.n ? `<a class="alert a-warn" href="#financeiro" data-atalho="pagar-contas" style="display:block;text-decoration:none">${d.contas_vencendo.n} conta(s) a pagar vencendo em até 7 dias: ${brl(d.contas_vencendo.v)}.</a>` : '',
  ].join('');
  const lembretes = [
    ...d.lembrete_provas.map(p => ({ tipo: 'lembrete_prova', texto: `Prova amanhã${p.hora_inicio ? ' às ' + p.hora_inicio : ''}: ${p.cliente}`, p,
      msg: montarMensagem('lembrete_prova', { atelie: sessao.config.atelie.nome, cliente: p.cliente, numero: p.numero, dataProva: p.dia, horaProva: p.hora_inicio }) })),
    ...d.prontas_paradas.map(o => ({ tipo: 'retirada', texto: `Pronta desde ${dataBR(o.pronta_desde?.slice(0, 10))}: ${o.cliente} (${nOS(o.numero)})`, p: o,
      msg: montarMensagem('retirada', { atelie: sessao.config.atelie.nome, cliente: o.cliente, numero: o.numero, pecas: (o.pecas || '').split(', '), saldo: Math.max(0, o.saldo ?? 0) }) })),
  ];
  el.innerHTML = `
    <div class="head"><div><h1>${semana}, ${dia} de ${MESES[m - 1]} de ${a}</h1><p>Olá, ${esc(sessao.eu.nome.split(' ')[0])}. Resumo do ateliê hoje.</p></div></div>
    <div class="row">${atalhos}</div>
    ${avisos}
    <div class="grid g4">
      ${cartao('Entregas hoje', `${k.entregas_hoje ?? 0}<span class="muted" style="font-size:1rem">/${d.capacidade}</span>`, `${k.abertas ?? 0} OS em aberto`, 'entrega')}
      ${cartao('Prontas p/ retirada', k.prontas ?? 0, 'aguardando a cliente', 'pronta', 'ok')}
      ${cartao('Em produção', k.em_producao ?? 0, `${k.aguardando_prova ?? 0} aguardando prova`, 'tesoura', 'info')}
      ${cartao('Atrasadas', k.atrasadas ?? 0, 'prazo já passou', 'alerta', k.atrasadas ? 'crit' : 'warn', k.atrasadas ? 'var(--crit)' : '')}
    </div>
    ${f ? `<div class="grid g4">
      ${cartao(`Faturamento de ${MES_CURTO[m - 1]}`, brl(f.faturamento_mes), 'OS entregues no mês', 'mes')}
      ${cartao('Recebido no mês', brl(f.recebido_mes), 'pagamentos de clientes', 'receber', 'ok', 'var(--ok)')}
      ${cartao('Despesas do mês', brl(f.despesas_mes), `resultado de caixa ${brl(f.resultado_caixa_mes)}`, 'caixa', 'crit')}
      ${cartao('Lucro estimado', brl(f.lucro_estimado_mes), f.mao_obra_configurada ? 'faturamento − materiais − mão de obra' : 'faturamento − materiais', 'pronta', 'ok')}
    </div>
    <div class="grid s21">
      <div class="panel"><div class="panel-h"><h2>Recebido nos últimos 30 dias</h2><span class="ajuda">por dia</span></div><div id="g-30d"></div></div>
      <div class="grid" style="gap:16px">
        ${cartao('Caixa de hoje', brl(f.entradas_hoje - f.saidas_hoje), `${f.unidades > 1 ? `${f.caixas_abertos} de ${f.unidades} abertos` : f.caixa_aberto ? 'aberto' : f.caixa_existe ? 'fechado' : 'não aberto'} · entradas ${brl(f.entradas_hoje)}`, 'caixa')}
        ${cartao('A receber', brl(f.a_receber), 'saldo de OS não canceladas', 'receber', 'warn', 'var(--warn)')}
      </div></div>` : ''}
    ${lembretes.length ? `<div class="panel"><div class="panel-h"><h2>Lembretes</h2><span class="ajuda">o WhatsApp abre com a mensagem pronta</span></div><div class="list">
      ${lembretes.map((l, i) => `<div class="li"><span>${esc(l.texto)}</span>${numeroWhatsApp(l.p) ? `<a class="btn sm wa" target="_blank" rel="noopener" data-lembrete="${i}" href="${esc(linkWhatsApp(numeroWhatsApp(l.p), l.msg))}">WhatsApp</a>` : '<span class="ajuda">sem telefone</span>'}</div>`).join('')}</div></div>` : ''}
    <div class="grid g2">
      <div class="panel"><div class="panel-h"><h2>Entregas de hoje</h2><span class="muted">${dataSemana(d.hoje)}</span></div><div class="list">${lista(d.entregas_hoje, 'Nenhuma entrega hoje.')}</div></div>
      <div class="panel"><div class="panel-h"><h2>Provas nos próximos 7 dias</h2><a class="btn link sm" href="#agenda">Agenda</a></div><div class="list">
        ${d.provas.map(p => `<a class="li" href="${p.order_id ? '#ordens/' + p.order_id : '#agenda'}" style="color:inherit;text-decoration:none"><div><div class="t">${esc(p.cliente || p.titulo)}</div>
          <div class="s">${dataSemana(p.dia)}${p.hora_inicio ? ' · ' + esc(p.hora_inicio) : ''}</div></div><span class="pill p-warn">prova</span></a>`).join('') || '<div class="empty">Nenhuma prova agendada.</div>'}</div></div>
      <div class="panel"><div class="panel-h"><h2>Urgentes</h2><a class="btn link sm" href="#producao">Produção</a></div><div class="list">
        ${d.urgentes.map(u => `<a class="li" href="#ordens/${u.order_id}" style="color:inherit;text-decoration:none"><div><div class="t">${esc(u.peca)} <span class="muted num" style="font-size:.8rem">${esc(u.codigo)}</span></div>
          <div class="s">${esc(u.cliente)} · prazo ${dataBR(u.prazo)}</div></div><span class="pill p-crit">${esc(PRODUCAO[u.status_producao] || u.status_producao)}</span></a>`).join('') || '<div class="empty">Nenhuma peça urgente.</div>'}</div></div>
      <div class="panel"><div class="panel-h"><h2>Atrasadas</h2></div><div class="list">${lista(d.atrasadas, 'Nenhuma OS atrasada.', o => 'era para ' + dataBR(o.prazo))}</div></div>
      <div class="panel"><div class="panel-h"><h2>Entregas de amanhã</h2></div><div class="list">${lista(d.entregas_amanha, 'Nenhuma entrega amanhã.')}</div></div>
      <div class="panel"><div class="panel-h"><h2>Prontas para retirada</h2></div><div class="list">${lista(d.prontas, 'Nenhuma peça pronta aguardando.')}</div></div>
      ${d.atividades.length ? `<div class="panel" style="grid-column:1/-1"><div class="panel-h"><h2>Atividade recente</h2></div><div class="hist">
        ${d.atividades.map(x => `<div><span class="muted num">${dataHora(x.em)}</span><a href="#ordens/${x.order_id}">${nOS(x.numero)}${x.codigo ? ' · ' + esc(x.codigo) : ''}</a>
          <span>${esc(STATUS_OS[x.para] || STATUS_PRODUCAO[x.para] || x.para)}</span><span class="muted">${esc(x.usuario || '')}</span></div>`).join('')}</div></div>` : ''}
    </div>
    <p class="ajuda" style="margin:0">Datas e prazos no horário de Brasília (${FUSO}).</p>`;
  if (f) {
    const g = $('#g-30d', el);
    barras(g, f.recebimentos_30d.map(x => ({ rotulo: dataSemana(x.dia), rotuloCurto: x.dia.slice(8, 10), valor: x.valor })),
      { fmt: brl, fmtEixo: c => (c >= 100000 ? `${Math.round(c / 100000)} mil` : brl(c).replace(',00', '')), mostrarCada: 5, nome: 'Recebido por dia nos últimos 30 dias' });
  }
  el.onclick = e => {
    const at = e.target.closest('[data-atalho]');
    if (!at) return;
    if (at.dataset.atalho === 'consultar') { e.preventDefault(); document.querySelector('.busca-geral input')?.focus(); }
    if (at.dataset.atalho === 'entrega') sessionStorage.setItem('filtro-os', 'pronta');
    if (at.dataset.atalho === 'pagar') sessionStorage.setItem('filtro-os', 'ativas');
    if (at.dataset.atalho === 'pagar-contas') sessionStorage.setItem('aba-fin', 'pagar');
  };
}
