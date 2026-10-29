import { api, novaChave, sessao } from '../api.js';
import { $, brl, dataBR, dataHora, esc, modal, nOS, opcoes, pill, toast } from '../ui.js';
import { lerValor, somarDias, valorParaCampo } from '../regras.js';
import { modalAbrirCaixa, modalEstorno } from './ordens.js';

const ABAS = [['caixa', 'Caixa do dia'], ['lancamentos', 'Lançamentos'], ['receber', 'A receber']];
const est = { aba: 'caixa', de: null, ate: null, tipo: '' };

export async function telaFinanceiro(el, _p, vivo) {
  est.de ??= somarDias(sessao.hoje, -6);
  est.ate ??= sessao.hoje;
  const desenhar = async () => {
    el.innerHTML = `<div class="head"><div><h1>Financeiro</h1><p>Caixa, recebimentos e valores a receber. Lançamentos não são apagados: correções são feitas por estorno.</p></div>
        ${sessao.pode('financeiro.lancar') ? `<div class="row"><button class="btn" data-a="lancar" data-tipo="saida">− Saída</button><button class="btn" data-a="sangria">Sangria</button>
          <button class="btn pri" data-a="lancar" data-tipo="entrada">+ Entrada</button></div>` : ''}</div>
      <div class="tabs">${ABAS.map(([k, l]) => `<button class="${est.aba === k ? 'on' : ''}" data-aba="${k}">${l}</button>`).join('')}</div><div id="fin"><p class="carregando">Carregando…</p></div>
      <p class="ajuda" style="margin:0">Contas a pagar, resumo por período e relatórios entram na fase 3.</p>`;
    const alvo = $('#fin', el);
    if (est.aba === 'caixa') await abaCaixa(alvo);
    if (est.aba === 'lancamentos') await abaLancamentos(alvo);
    if (est.aba === 'receber') await abaReceber(alvo);
  };
  el.onclick = async e => {
    const aba = e.target.closest('[data-aba]');
    if (aba) { est.aba = aba.dataset.aba; return desenhar(); }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'lancar') novoLancamento(b.dataset.tipo, desenhar);
    if (a === 'sangria') novoLancamento('sangria', desenhar);
    if (a === 'abrir') modalAbrirCaixa(desenhar);
    if (a === 'fechar') fecharCaixa(desenhar);
    if (a === 'reabrir') reabrirCaixa(desenhar);
    if (a === 'estornar') modalEstorno(b.dataset.id, desenhar);
    if (a === 'filtrar') {
      est.de = $('#l-de', el).value || est.de;
      est.ate = $('#l-ate', el).value || est.ate;
      est.tipo = $('#l-tipo', el).value;
      desenhar();
    }
  };
  el.onchange = e => {
    if (e.target.id === 'cx-data') abaCaixa($('#fin', el), e.target.value);
  };
  if (vivo()) await desenhar();
}

function tabelaLancamentos(ls, comData) {
  const podeEstornar = sessao.pode('financeiro.estornar');
  if (!ls.length) return '<div class="empty">Nenhum lançamento.</div>';
  return `<div class="tw"><table><thead><tr>${comData ? '<th>Data</th>' : '<th>Hora</th>'}<th>Descrição</th><th>Categoria</th><th>Forma</th><th>Por</th><th class="r">Valor</th><th></th></tr></thead><tbody>
    ${ls.map(l => `<tr>${comData ? `<td>${dataBR(l.data)}</td>` : `<td class="num">${dataHora(l.criado_em).slice(11)}</td>`}
      <td>${esc(l.descricao)}${l.order_id ? ` <a class="btn link sm" href="#ordens/${l.order_id}">${nOS(l.os_numero)}</a>` : ''}</td>
      <td class="muted">${esc(l.categoria)}</td><td>${esc(l.forma)}</td><td class="muted">${esc(l.usuario || '')}</td>
      <td class="r num" style="color:${l.tipo === 'entrada' ? 'var(--ok)' : 'var(--crit)'};white-space:nowrap">${l.tipo === 'entrada' ? '+ ' : '− '}${brl(l.valor_centavos)}</td>
      <td class="r">${l.estornado_por ? '<span class="pill p-muted">Estornado</span>' : l.estorno_de ? '<span class="pill p-warn">Estorno</span>' : podeEstornar ? `<button class="btn sm" data-a="estornar" data-id="${l.id}">Estornar</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
}

async function abaCaixa(alvo, data = sessao.hoje) {
  const c = await api(`/caixa?data=${data}`);
  const s = c.sessao;
  const ehHoje = data === c.hoje;
  alvo.innerHTML = `<div class="row" style="margin:12px 0"><label class="row" style="gap:6px">Dia <input class="in" type="date" id="cx-data" value="${data}" max="${c.hoje}" style="width:auto"></label></div>
    ${!s ? `<div class="panel" style="align-items:flex-start"><h2>Caixa de ${dataBR(data)} não foi aberto</h2>
        ${ehHoje && sessao.pode('caixa.operar') ? '<p class="muted" style="margin:0">Abra o caixa informando o troco inicial em dinheiro.</p><button class="btn pri" data-a="abrir">Abrir caixa</button>' : ''}</div>` : `
    <div class="grid g4">
      <div class="panel stat"><span class="lbl">Troco inicial</span><span class="val num">${brl(s.saldo_inicial_centavos)}</span><span class="sub">aberto por ${esc(s.aberto_por_nome || '')} ${s.reaberto_em ? '· reaberto ' + dataHora(s.reaberto_em).slice(11) : ''}</span></div>
      <div class="panel stat"><span class="lbl">Entradas</span><span class="val num" style="color:var(--ok)">${brl(c.entradas)}</span><span class="sub">sem contar uso de crédito</span></div>
      <div class="panel stat"><span class="lbl">Saídas</span><span class="val num" style="color:var(--crit)">${brl(c.saidas)}</span></div>
      <div class="panel stat"><span class="lbl">Dinheiro na gaveta</span><span class="val num">${brl(c.dinheiro_esperado)}</span><span class="sub">esperado</span></div></div>
    <div class="grid s12">
      <div class="panel"><h2>Por forma de pagamento</h2><table><thead><tr><th>Forma</th><th class="r">Entradas</th><th class="r">Saídas</th></tr></thead><tbody>
        ${c.por_forma.map(f => `<tr><td>${esc(f.nome)}${f.eh_credito_cliente ? ' <span class="ajuda">(não é dinheiro novo)</span>' : ''}</td><td class="r num">${brl(f.entradas)}</td><td class="r num">${brl(f.saidas)}</td></tr>`).join('')}</tbody></table>
        ${s.fechado_em ? `<div class="alert ${c.diferenca === 0 ? 'a-info' : 'a-warn'}">Caixa fechado por ${esc(s.fechado_por_nome || '')} em ${dataHora(s.fechado_em)}. Contado ${brl(s.contado_centavos)}, esperado ${brl(c.dinheiro_esperado)}.
            ${c.diferenca === 0 ? 'Sem diferença.' : `${c.diferenca < 0 ? 'Faltaram' : 'Sobraram'} ${brl(Math.abs(c.diferenca))}.`}</div>
          ${ehHoje && sessao.pode('caixa.reabrir') ? '<button class="btn" data-a="reabrir">Reabrir caixa</button>' : ''}`
        : ehHoje && sessao.pode('caixa.operar') ? '<button class="btn pri" data-a="fechar">Fechar caixa</button>' : ''}</div>
      <div class="panel"><h2>Lançamentos de ${dataBR(data)}</h2>${tabelaLancamentos(c.lancamentos, false)}</div></div>`}`;
  alvo.dataset.esperado = c.dinheiro_esperado ?? 0;
}

async function abaLancamentos(alvo) {
  const qs = new URLSearchParams({ de: est.de, ate: est.ate, ...(est.tipo && { tipo: est.tipo }) });
  const { lancamentos } = await api('/financeiro/lancamentos?' + qs);
  const ent = lancamentos.filter(l => l.tipo === 'entrada' && !l.eh_credito_cliente).reduce((s, l) => s + l.valor_centavos, 0);
  const sai = lancamentos.filter(l => l.tipo === 'saida' && !l.eh_credito_cliente).reduce((s, l) => s + l.valor_centavos, 0);
  alvo.innerHTML = `<div class="panel" style="margin-top:12px"><div class="row">
      <label class="row" style="gap:6px">De <input class="in" type="date" id="l-de" value="${est.de}" style="width:auto"></label>
      <label class="row" style="gap:6px">até <input class="in" type="date" id="l-ate" value="${est.ate}" style="width:auto"></label>
      <select class="in" id="l-tipo" style="width:auto"><option value="">Entradas e saídas</option><option value="entrada" ${est.tipo === 'entrada' ? 'selected' : ''}>Só entradas</option><option value="saida" ${est.tipo === 'saida' ? 'selected' : ''}>Só saídas</option></select>
      <button class="btn" data-a="filtrar">Filtrar</button></div>
    <div class="row" style="gap:20px"><span>Entradas <b class="num" style="color:var(--ok)">${brl(ent)}</b></span><span>Saídas <b class="num" style="color:var(--crit)">${brl(sai)}</b></span><span>Resultado <b class="num">${brl(ent - sai)}</b></span></div>
    ${tabelaLancamentos(lancamentos, true)}</div>`;
}

async function abaReceber(alvo) {
  const r = await api('/financeiro/receber');
  alvo.innerHTML = `<div class="panel" style="margin-top:12px"><div class="panel-h"><h2>A receber</h2><span class="num" style="font-weight:700;font-size:1.1rem">${brl(r.total)}</span></div>
    ${r.ordens.length ? `<div class="tw"><table><thead><tr><th>OS</th><th>Cliente</th><th>Prazo</th><th>Situação</th><th class="r">Total</th><th class="r">Pago</th><th class="r">Falta</th></tr></thead><tbody>
      ${r.ordens.map(o => `<tr><td class="num"><a href="#ordens/${o.id}">${nOS(o.numero)}</a></td><td><a href="#clientes/${o.client_id}" style="color:inherit">${esc(o.cliente)}</a></td>
        <td>${dataBR(o.prazo)}</td><td>${pill(o.status)}${o.status === 'pronta' ? ' <span class="pill p-warn">cobrar na retirada</span>' : ''}</td>
        <td class="r num">${brl(o.total)}</td><td class="r num">${brl(o.pago)}</td><td class="r num" style="color:var(--warn);font-weight:600">${brl(o.saldo)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Nada a receber.</div>'}</div>
    ${r.creditos.length ? `<div class="panel"><h2>Créditos de clientes</h2><p class="ajuda" style="margin:0">Valores recebidos a mais e guardados para as clientes (o ateliê deve estes valores).</p>
      <div class="list">${r.creditos.map(c => `<a class="li" href="#clientes/${c.id}/financeiro" style="color:inherit;text-decoration:none"><span>${esc(c.nome)}</span><b class="num">${brl(c.saldo)}</b></a>`).join('')}</div></div>` : ''}`;
}

function novoLancamento(tipo, depois) {
  const chave = novaChave();
  const sangria = tipo === 'sangria';
  const cats = sessao.config.categorias_financeiras.filter(c => c.ativo && !c.sistema && c.tipo === tipo);
  const formas = sessao.config.formas_pagamento.filter(f => f.ativo && !f.eh_credito_cliente);
  modal({
    title: sangria ? 'Sangria (retirada de dinheiro da gaveta)' : tipo === 'entrada' ? 'Nova entrada' : 'Nova saída',
    body: `<div class="grid" style="gap:12px">
      <div class="field"><label class="req" for="m-desc">Descrição</label><input class="in" id="m-desc" placeholder="${sangria ? 'Ex.: depósito no banco' : tipo === 'entrada' ? 'Ex.: venda de aviamentos' : 'Ex.: compra de linhas'}"></div>
      <div class="field"><label class="req" for="m-val">Valor (R$)</label><input class="in num" id="m-val" inputmode="decimal" placeholder="0,00"></div>
      ${sangria ? '' : `<div class="field"><label for="m-cat">Categoria</label><select class="in" id="m-cat">${opcoes(cats)}</select></div>
      <div class="field"><label for="m-forma">Forma de pagamento</label><select class="in" id="m-forma">${opcoes(formas)}</select></div>`}</div>`,
    actions: [{ label: 'Voltar' }, { label: 'Lançar', cls: 'pri', fn: async m => {
      const v = lerValor($('#m-val', m).value);
      const descricao = $('#m-desc', m).value.trim();
      if (descricao.length < 2) { toast('Informe a descrição.', true); return false; }
      if (!v) { toast('Informe um valor maior que zero.', true); return false; }
      const corpo = sangria ? { natureza: 'sangria', valor_centavos: v, descricao }
        : { natureza: 'avulso', tipo, valor_centavos: v, descricao, categoria_id: $('#m-cat', m).value, forma_id: $('#m-forma', m).value };
      try { await api('/financeiro/lancamentos', { chave, corpo }); } catch (e) {
        if (e.codigo === 'caixa_fechado') return modalAbrirCaixa(() => novoLancamento(tipo, depois)) && 'manter';
        toast(e.message, true); return false;
      }
      toast(`${brl(v)} lançado.`);
      depois();
    } }],
  });
}

function fecharCaixa(depois) {
  const esperado = Number($('#fin').dataset.esperado || 0);
  modal({
    title: 'Fechar o caixa de hoje',
    body: `<div class="grid" style="gap:12px"><p style="margin:0">Conte o dinheiro da gaveta. O sistema espera <b class="num">${brl(esperado)}</b>.</p>
      <div class="field"><label for="m-cont">Valor contado (R$)</label><input class="in num" id="m-cont" inputmode="decimal" value="${valorParaCampo(esperado)}"></div>
      <div id="m-dif" class="alert a-info">Sem diferença.</div>
      <div class="field"><label for="m-obs">Observações</label><input class="in" id="m-obs"></div>
      <p class="ajuda" style="margin:0">Depois de fechado, o caixa não aceita lançamentos, a não ser que o administrador o reabra (fica registrado).</p></div>`,
    onOpen: m => m.addEventListener('input', () => {
      const d = (lerValor($('#m-cont', m).value) ?? 0) - esperado;
      $('#m-dif', m).className = 'alert ' + (d === 0 ? 'a-info' : 'a-warn');
      $('#m-dif', m).textContent = d === 0 ? 'Sem diferença.' : `${d < 0 ? 'Faltam' : 'Sobram'} ${brl(Math.abs(d))} na gaveta.`;
    }),
    actions: [{ label: 'Voltar' }, { label: 'Fechar caixa', cls: 'pri', fn: async m => {
      const v = lerValor($('#m-cont', m).value);
      if (v === null) { toast('Informe o valor contado.', true); return false; }
      try { await api('/caixa/fechar', { corpo: { contado_centavos: v, observacoes: $('#m-obs', m).value.trim() } }); } catch (e) { toast(e.message, true); return false; }
      toast('Caixa fechado.');
      depois();
    } }],
  });
}

function reabrirCaixa(depois) {
  modal({
    title: 'Reabrir o caixa de hoje',
    body: '<div class="field"><label class="req" for="m-mot">Motivo da reabertura</label><input class="in" id="m-mot" placeholder="Ex.: faltou lançar um Pix"></div>',
    actions: [{ label: 'Voltar' }, { label: 'Reabrir', cls: 'pri', fn: async m => {
      try { await api('/caixa/reabrir', { corpo: { motivo: $('#m-mot', m).value.trim() } }); } catch (e) { toast(e.message, true); return false; }
      toast('Caixa reaberto. Lembre de fechar de novo.');
      depois();
    } }],
  });
}
