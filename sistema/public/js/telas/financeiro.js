import { api, novaChave, sessao } from '../api.js';
import { $, brl, dataBR, dataHora, esc, modal, nOS, opcoes, pill, toast } from '../ui.js';
import { lerValor, somarDias, valorParaCampo } from '../regras.js';
import { modalAbrirCaixa, modalEstorno } from './ordens.js';

const ABAS = [['caixa', 'Caixa do dia'], ['lancamentos', 'Lançamentos'], ['receber', 'A receber'], ['pagar', 'A pagar']];
const est = { aba: 'caixa', de: null, ate: null, tipo: '' };
const un = sigla => sigla && sessao.unidades.length > 1 ? ` <span class="tag-un">${esc(sigla)}</span>` : '';

export async function telaFinanceiro(el, _p, vivo) {
  est.de ??= somarDias(sessao.hoje, -6);
  const abaVinda = sessionStorage.getItem('aba-fin');
  if (abaVinda) { est.aba = abaVinda; sessionStorage.removeItem('aba-fin'); }
  est.ate ??= sessao.hoje;
  const desenhar = async () => {
    el.innerHTML = `<div class="head"><div><h1>Financeiro</h1><p>Caixa, recebimentos e valores a receber. Lançamentos não são apagados: correções são feitas por estorno.</p></div>
        ${sessao.pode('financeiro.lancar') ? `<div class="row"><button class="btn" data-a="lancar" data-tipo="saida">− Saída</button><button class="btn" data-a="sangria">Sangria</button>
          <button class="btn pri" data-a="lancar" data-tipo="entrada">+ Entrada</button></div>` : ''}</div>
      <div class="tabs">${ABAS.filter(([k]) => k !== 'pagar' || sessao.pode('pagar.ver')).map(([k, l]) => `<button class="${est.aba === k ? 'on' : ''}" data-aba="${k}">${l}</button>`).join('')}</div>
      <div id="fin"><p class="carregando">Carregando…</p></div>
      ${sessao.pode('relatorios.ver') ? '<p class="ajuda" style="margin:0">Resumo por período, gráficos e exportação: veja <a href="#relatorios">Relatórios</a>.</p>' : ''}`;
    const alvo = $('#fin', el);
    if (est.aba === 'caixa') await abaCaixa(alvo);
    if (est.aba === 'lancamentos') await abaLancamentos(alvo);
    if (est.aba === 'receber') await abaReceber(alvo);
    if (est.aba === 'pagar') await abaPagar(alvo, desenhar);
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
      <td>${esc(l.descricao)}${un(l.unidade_sigla)}${l.order_id ? ` <a class="btn link sm" href="#ordens/${l.order_id}">${nOS(l.os_numero)}</a>` : ''}</td>
      <td class="muted">${esc(l.categoria)}</td><td>${esc(l.forma)}</td><td class="muted">${esc(l.usuario || '')}</td>
      <td class="r num" style="color:${l.tipo === 'entrada' ? 'var(--ok)' : 'var(--crit)'};white-space:nowrap">${l.tipo === 'entrada' ? '+ ' : '− '}${brl(l.valor_centavos)}</td>
      <td class="r">${l.estornado_por ? '<span class="pill p-muted">Estornado</span>' : l.estorno_de ? '<span class="pill p-warn">Estorno</span>' : podeEstornar ? `<button class="btn sm" data-a="estornar" data-id="${l.id}">Estornar</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
}

async function abaCaixa(alvo, data = sessao.hoje) {
  const c = await api(`/caixa?data=${data}`);
  if (c.por_unidade) {
    // Visão "todas as unidades": um caixa por unidade; para operar, escolhe-se a unidade no topo.
    const t = k => c.por_unidade.reduce((x, u) => x + (u[k] || 0), 0);
    alvo.innerHTML = `<div class="row" style="margin:12px 0"><label class="row" style="gap:6px">Dia <input class="in" type="date" id="cx-data" value="${data}" max="${c.hoje}" style="width:auto"></label></div>
      <div class="grid g3"><div class="panel stat"><span class="lbl">Entradas (todas)</span><span class="val num" style="color:var(--ok)">${brl(t('entradas'))}</span></div>
        <div class="panel stat"><span class="lbl">Saídas (todas)</span><span class="val num" style="color:var(--crit)">${brl(t('saidas'))}</span></div>
        <div class="panel stat"><span class="lbl">Dinheiro nas gavetas</span><span class="val num">${brl(t('dinheiro_esperado'))}</span><span class="sub">esperado</span></div></div>
      <div class="panel"><h2>Caixa de cada unidade em ${dataBR(data)}</h2><div class="tw"><table><thead><tr><th>Unidade</th><th>Situação</th><th class="r">Entradas</th><th class="r">Saídas</th><th class="r">Na gaveta</th></tr></thead><tbody>
        ${c.por_unidade.map(u => `<tr><td><b>${esc(u.nome)}</b> <span class="tag-un">${esc(u.sigla)}</span></td>
          <td>${!u.sessao ? '<span class="pill p-muted">Não aberto</span>' : u.sessao.fechado_em ? `<span class="pill p-neutral">Fechado${u.diferenca ? ` · diferença ${brl(u.diferenca)}` : ''}</span>` : '<span class="pill p-ok">Aberto</span>'}</td>
          <td class="r num">${brl(u.entradas || 0)}</td><td class="r num">${brl(u.saidas || 0)}</td><td class="r num">${brl(u.dinheiro_esperado || 0)}</td></tr>`).join('')}</tbody></table></div>
        <p class="ajuda" style="margin:0">Para abrir, fechar ou lançar, escolha a unidade no topo da tela.</p></div>`;
    return;
  }
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
      ${r.ordens.map(o => `<tr><td class="num"><a href="#ordens/${o.id}">${nOS(o.numero)}</a>${un(o.unidade_sigla)}</td><td><a href="#clientes/${o.client_id}" style="color:inherit">${esc(o.cliente)}</a></td>
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

/* ---------------------------------------------------------------- contas a pagar */
let filtroPagar = 'abertas';
async function abaPagar(alvo, depois) {
  const r = await api('/pagar?status=' + filtroPagar);
  const pode = sessao.pode('pagar.editar');
  alvo.innerHTML = `<div class="grid g3" style="margin-top:12px">
      <div class="panel stat"><span class="lbl">Em aberto</span><span class="val num">${brl(r.total_aberto)}</span></div>
      <div class="panel stat"><span class="lbl">Vencido</span><span class="val num" style="color:${r.total_vencido ? 'var(--crit)' : 'inherit'}">${brl(r.total_vencido)}</span></div>
      <div class="panel stat" style="justify-content:center">${pode ? '<button class="btn pri" data-nova-conta>+ Nova conta a pagar</button>' : ''}</div></div>
    <div class="panel"><div class="row"><select class="in" id="p-st" style="width:auto">${[['abertas', 'Em aberto'], ['pagas', 'Pagas'], ['canceladas', 'Canceladas'], ['todas', 'Todas']]
      .map(([k, l]) => `<option value="${k}" ${filtroPagar === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    ${r.contas.length ? `<div class="tw"><table><thead><tr><th>Vencimento</th><th>Descrição</th>${sessao.unidades.length > 1 ? '<th>Unidade</th>' : ''}<th>Categoria</th><th>Fornecedor</th><th>Situação</th><th class="r">Valor</th><th></th></tr></thead><tbody>
      ${r.contas.map(k => `<tr><td>${dataBR(k.vencimento)}</td><td>${esc(k.descricao)}${k.observacoes ? `<div class="ajuda">${esc(k.observacoes)}</div>` : ''}</td>${sessao.unidades.length > 1 ? `<td><span class="tag-un">${esc(k.unidade_sigla)}</span></td>` : ''}<td class="muted">${esc(k.categoria)}</td>
        <td class="muted">${esc(k.fornecedor || '')}</td>
        <td>${k.status === 'paga' ? `<span class="pill p-ok">Paga em ${dataBR(k.paga_em)}</span>` : k.status === 'cancelada' ? `<span class="pill p-muted" title="${esc(k.motivo_cancelamento || '')}">Cancelada</span>`
          : k.vencida ? '<span class="pill p-crit">Vencida</span>' : k.vencimento <= somarDias(sessao.hoje, 7) ? '<span class="pill p-warn">Vence em breve</span>' : '<span class="pill p-neutral">Em aberto</span>'}</td>
        <td class="r num">${brl(k.valor_centavos)}</td>
        <td class="r">${pode && k.status === 'aberta' ? `<button class="btn pri sm" data-pagar="${k.id}">Pagar</button> <button class="btn sm ghost" data-cancelar="${k.id}">Cancelar</button>`
          : k.movimento_id && sessao.pode('financeiro.estornar') ? `<button class="btn sm" data-a="estornar" data-id="${k.movimento_id}">Estornar pagamento</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Nenhuma conta.</div>'}</div>`;
  $('#p-st', alvo).onchange = e => { filtroPagar = e.target.value; depois(); };
  alvo.onclick = e => {
    const conta = id => r.contas.find(k => k.id === id);
    if (e.target.closest('[data-nova-conta]')) novaConta(depois);
    const pg = e.target.closest('[data-pagar]');
    if (pg) pagarConta(conta(pg.dataset.pagar), depois);
    const cc = e.target.closest('[data-cancelar]');
    if (cc) modal({
      title: 'Cancelar conta', body: '<div class="field"><label class="req" for="c-mot">Motivo</label><input class="in" id="c-mot"></div>',
      actions: [{ label: 'Voltar' }, { label: 'Cancelar conta', cls: 'danger-solid', fn: async m => {
        try { await api(`/pagar/${cc.dataset.cancelar}/cancelar`, { corpo: { motivo: $('#c-mot', m).value.trim() } }); } catch (er) { toast(er.message, true); return false; }
        toast('Conta cancelada.'); depois();
      } }],
    });
  };
}

async function novaConta(depois) {
  const { fornecedores } = await api('/estoque/fornecedores').catch(() => ({ fornecedores: [] }));
  const cats = sessao.config.categorias_financeiras.filter(c => c.ativo && !c.sistema && c.tipo === 'saida');
  modal({
    title: 'Nova conta a pagar',
    body: `<div class="grid g2" style="gap:12px">
      <div class="field" style="grid-column:1/-1"><label class="req" for="n-desc">Descrição</label><input class="in" id="n-desc" placeholder="ex.: Aluguel de dezembro"></div>
      <div class="field"><label class="req" for="n-val">Valor total (R$)</label><input class="in num" id="n-val" inputmode="decimal"></div>
      <div class="field"><label for="n-venc">Vencimento (1ª parcela)</label><input class="in" type="date" id="n-venc" value="${somarDias(sessao.hoje, 10)}"></div>
      <div class="field"><label for="n-cat">Categoria</label><select class="in" id="n-cat">${opcoes(cats)}</select></div>
      <div class="field"><label for="n-parc">Parcelas</label><input class="in num" id="n-parc" type="number" min="1" max="36" value="1"></div>
      <div class="field" style="grid-column:1/-1"><label for="n-forn">Fornecedor</label><select class="in" id="n-forn">${opcoes(fornecedores.filter(f => f.ativo), null, '— nenhum —')}</select></div>
      <div class="field" style="grid-column:1/-1"><label for="n-obs">Observações</label><input class="in" id="n-obs"></div>
      ${sessao.unidades.length > 1 ? `<label class="chk" style="grid-column:1/-1"><input type="checkbox" id="n-grupo" ${sessao.unidade ? '' : 'checked'}> Despesa do grupo (todas as unidades, ex.: contador)</label>
        <p class="ajuda" style="grid-column:1/-1;margin:0">Sem marcar, a conta fica na unidade escolhida no topo${sessao.unidade ? ` (${esc(sessao.unidades.find(u => u.id === sessao.unidade)?.nome || '')})` : ''}.</p>` : ''}</div>`,
    actions: [{ label: 'Voltar' }, { label: 'Cadastrar', cls: 'pri', fn: async m => {
      const v = lerValor($('#n-val', m).value);
      if (!v) { toast('Informe o valor.', true); return false; }
      try {
        await api('/pagar', { corpo: { descricao: $('#n-desc', m).value.trim(), valor_centavos: v, vencimento: $('#n-venc', m).value, categoria_id: $('#n-cat', m).value,
          parcelas: Number($('#n-parc', m).value) || 1, supplier_id: $('#n-forn', m).value || null, observacoes: $('#n-obs', m).value.trim(), do_grupo: !!$('#n-grupo', m)?.checked } });
      } catch (e) { toast(e.message, true); return false; }
      toast('Conta cadastrada.'); depois();
    } }],
  });
}

function pagarConta(k, depois) {
  const chave = novaChave();
  modal({
    title: 'Pagar: ' + k.descricao,
    body: `<p style="margin:0 0 10px">Valor <b class="num">${brl(k.valor_centavos)}</b>. O pagamento vira uma saída no caixa de hoje.</p>
      <div class="field"><label for="p-forma">Forma de pagamento</label><select class="in" id="p-forma">${opcoes(sessao.config.formas_pagamento.filter(f => f.ativo && !f.eh_credito_cliente))}</select></div>`,
    actions: [{ label: 'Voltar' }, { label: 'Confirmar pagamento', cls: 'pri', fn: async m => {
      try { await api(`/pagar/${k.id}/pagar`, { chave, corpo: { forma_id: $('#p-forma', m).value } }); } catch (e) {
        if (e.codigo === 'caixa_fechado') return modalAbrirCaixa(() => pagarConta(k, depois)) && 'manter';
        toast(e.message, true); return false;
      }
      toast('Conta paga.'); depois();
    } }],
  });
}
