import { api, novaChave, sessao } from '../api.js';
import { $, brl, dataBR, dataHora, esc, fecharModal, formatarTelefone, modal, nOS, pill, toast } from '../ui.js';
import { lerValor, linkWhatsApp, MODELOS_MENSAGEM, normalizarTelefone, numeroWhatsApp, valorParaCampo } from '../regras.js';
import { modalAbrirCaixa, modalEstorno } from './ordens.js';

/* =========================================================================
 * Formulário de cliente (usado na tela e no cadastro rápido dentro da OS)
 * ======================================================================= */
function camposCliente(c = {}) {
  const v = k => esc(c[k] ?? '');
  return `<div class="grid g2" style="gap:12px">
    <div class="field" style="grid-column:1/-1"><label class="req" for="c-nome">Nome completo</label><input class="in" id="c-nome" name="nome" value="${v('nome')}" autocomplete="off"></div>
    <div class="field"><label for="c-tel">Telefone</label><input class="in" id="c-tel" name="telefone" inputmode="tel" placeholder="(11) 90000-0000" value="${c.telefone ? formatarTelefone(c.telefone) : ''}"></div>
    <div class="field"><label for="c-wa">WhatsApp (se for outro número)</label><input class="in" id="c-wa" name="whatsapp" inputmode="tel" placeholder="Igual ao telefone" value="${c.whatsapp ? formatarTelefone(c.whatsapp) : ''}"></div>
    <div class="field"><label for="c-email">E-mail</label><input class="in" id="c-email" name="email" type="email" value="${v('email')}"></div>
    <div class="field"><label for="c-nasc">Data de nascimento</label><input class="in" id="c-nasc" name="nascimento" type="date" max="${sessao.hoje}" value="${v('nascimento')}"></div>
    <div class="field" style="grid-column:1/-1"><label for="c-end">Endereço</label><input class="in" id="c-end" name="endereco" value="${v('endereco')}"></div>
    <div class="field" style="grid-column:1/-1"><label for="c-pref">Preferências de atendimento</label><input class="in" id="c-pref" name="preferencias" placeholder="Ex.: prefere barra italiana; avisar por WhatsApp à tarde" value="${v('preferencias')}"></div>
    <div class="field" style="grid-column:1/-1"><label for="c-obs">Observações</label><textarea class="in" id="c-obs" name="observacoes" placeholder="Ex.: alergia a níquel">${v('observacoes')}</textarea></div>
  </div><div id="c-dup"></div>`;
}

function lerCampos(m) {
  const g = n => $(`[name=${n}]`, m).value.trim();
  for (const [n, rot] of [['telefone', 'Telefone'], ['whatsapp', 'WhatsApp']]) {
    const v = g(n);
    if (v && !normalizarTelefone(v).valido) {
      $(`[name=${n}]`, m).setAttribute('aria-invalid', 'true');
      throw new Error(`${rot}: ${normalizarTelefone(v).motivo}`);
    }
  }
  if (g('nome').length < 2) throw new Error('Informe o nome completo.');
  return { nome: g('nome'), telefone: g('telefone') || null, whatsapp: g('whatsapp') || null, email: g('email') || null,
    nascimento: g('nascimento') || null, endereco: g('endereco') || null, preferencias: g('preferencias'), observacoes: g('observacoes') };
}

/** Salva a cliente; se o servidor apontar possível duplicidade, mostra as candidatas e pede confirmação. */
async function salvarCliente(m, id, extra = {}) {
  let dados;
  try { dados = { ...lerCampos(m), ...extra }; } catch (e) { toast(e.message, true); return null; }
  try {
    return id ? (await api(`/clientes/${id}`, { metodo: 'PUT', corpo: dados }), { id }) : await api('/clientes', { corpo: dados });
  } catch (e) {
    if (e.codigo === 'possivel_duplicado') {
      $('#c-dup', m).innerHTML = `<div class="alert a-warn" style="margin-top:12px">${esc(e.message)}</div>
        ${e.dados.candidatos.map(c => `<div class="cand" style="margin-top:6px"><span><b>${esc(c.nome)}</b> · ${c.telefone ? formatarTelefone(c.telefone) : 'sem telefone'} · desde ${dataBR(c.criado_em)}</span>
          <button type="button" class="btn sm" data-usar="${c.id}">Usar esta</button></div>`).join('')}
        <label class="chk" style="margin-top:8px"><input type="checkbox" id="c-confirma"> É outra pessoa: cadastrar mesmo assim</label>`;
      return null;
    }
    toast(e.message, true);
    return null;
  }
}

export function modalNovaCliente(aoCriar, nomeInicial = '') {
  modal({
    title: 'Cadastrar cliente', body: camposCliente({ nome: nomeInicial }),
    onOpen: m => m.addEventListener('click', async e => {
      const b = e.target.closest('[data-usar]');
      if (!b) return;
      const { cliente } = await api(`/clientes/${b.dataset.usar}`);
      fecharModal();
      aoCriar(cliente);
    }),
    actions: [{ label: 'Voltar' }, { label: 'Cadastrar', cls: 'pri', fn: async m => {
      const r = await salvarCliente(m, null, { confirmar_duplicado: $('#c-confirma', m)?.checked || undefined });
      if (!r) return false;
      const { cliente } = await api(`/clientes/${r.id}`);
      toast('Cliente cadastrada.');
      aoCriar(cliente);
    } }],
  });
}

/* =========================================================================
 * Lista
 * ======================================================================= */
let busca = '';
export async function telaClientes(el, _p, vivo) {
  const verValores = sessao.pode('os.financeiro.ver');
  el.innerHTML = `<div class="head"><div><h1>Clientes</h1><p id="cl-qtd">Carregando…</p></div>
      ${sessao.pode('clientes.editar') ? '<button class="btn pri" data-nova>+ Nova cliente</button>' : ''}</div>
    <div class="panel"><input class="in" id="cl-q" type="search" placeholder="Buscar por nome ou telefone" value="${esc(busca)}" aria-label="Buscar cliente">
      <div class="tw" id="cl-tab"></div></div>`;
  let t;
  const carregar = async () => {
    const { clientes } = await api('/clientes' + (busca ? '?q=' + encodeURIComponent(busca) : ''));
    if (!vivo()) return;
    $('#cl-qtd').textContent = `${clientes.length} cliente${clientes.length === 1 ? '' : 's'}${busca ? ' encontrada' + (clientes.length === 1 ? '' : 's') : ''}`;
    $('#cl-tab').innerHTML = clientes.length ? `<table><thead><tr><th>Nome</th><th>Telefone</th><th class="r">OS</th>${verValores ? '<th class="r">Em aberto</th><th class="r">Crédito</th>' : ''}<th>Cliente desde</th></tr></thead><tbody>
      ${clientes.map(c => `<tr class="click" data-href="#clientes/${c.id}"><td><b>${esc(c.nome)}</b>${c.observacoes ? `<div class="muted" style="font-size:.82rem">${esc(c.observacoes)}</div>` : ''}</td>
        <td class="num">${c.telefone ? formatarTelefone(c.telefone) : '<span class="muted">—</span>'}</td><td class="r num">${c.qtd_os}</td>
        ${verValores ? `<td class="r num" style="${c.em_aberto ? 'color:var(--warn)' : ''}">${c.em_aberto ? brl(c.em_aberto) : '—'}</td><td class="r num">${c.credito ? brl(c.credito) : '—'}</td>` : ''}
        <td>${dataBR(c.criado_em)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nenhuma cliente encontrada.</div>';
  };
  el.addEventListener('input', e => { if (e.target.id === 'cl-q') { busca = e.target.value; clearTimeout(t); t = setTimeout(carregar, 250); } });
  el.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
    if (e.target.closest('[data-nova]')) modalNovaCliente(c => (location.hash = `clientes/${c.id}`));
  });
  await carregar();
}

/* =========================================================================
 * Ficha da cliente
 * ======================================================================= */
const ABAS = [['os', 'Ordens'], ['medidas', 'Medidas'], ['financeiro', 'Pagamentos e crédito'], ['fotos', 'Fotos'], ['atendimento', 'Atendimento']];

export async function telaCliente(el, params, vivo) {
  if (params[0] === 'nova') {
    el.innerHTML = '<p class="carregando">Abrindo cadastro…</p>';
    modalNovaCliente(c => (location.hash = `clientes/${c.id}`));
    return;
  }
  if (params[1] === 'ficha' && params[2]) return imprimirFicha(el, params[0], params[2]);
  const id = params[0];
  const aba = ABAS.some(a => a[0] === params[1]) ? params[1] : 'os';
  const d = await api(`/clientes/${id}`);
  if (!vivo()) return;
  const c = d.cliente;
  const fone = numeroWhatsApp(c);
  const wa = fone ? linkWhatsApp(fone, `Olá, ${c.nome.split(' ')[0]}!`) : null;
  const verValores = sessao.pode('os.financeiro.ver');
  const ativas = d.ordens.filter(o => o.status !== 'cancelada');
  el.innerHTML = `
    <div class="head"><div><a class="btn link" href="#clientes" style="padding-left:0">← Clientes</a><h1>${esc(c.nome)}${c.ativo ? '' : ' <span class="pill p-muted">inativa</span>'}</h1>
        <p>${c.telefone ? formatarTelefone(c.telefone) : 'Sem telefone'} · cliente desde ${dataBR(c.criado_em)}</p></div>
      <div class="row">${wa ? `<a class="btn wa" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>`
        : '<button class="btn wa" disabled title="Cadastre um telefone válido">WhatsApp</button>'}
        ${sessao.pode('clientes.editar') ? '<button class="btn" data-a="editar">Editar</button>' : ''}
        ${sessao.pode('os.editar') && c.ativo ? `<a class="btn pri" href="#ordens/nova/${c.id}">+ Nova OS</a>` : ''}</div></div>
    ${!wa ? '<div class="alert a-info">Para usar o WhatsApp, cadastre um telefone válido com DDD.</div>' : ''}
    <div class="grid g4">
      <div class="panel stat"><span class="lbl">Ordens de serviço</span><span class="val num">${ativas.length}</span><span class="sub">${d.ordens.length - ativas.length} cancelada(s)</span></div>
      ${verValores ? `<div class="panel stat"><span class="lbl">Total já pago</span><span class="val num">${brl(ativas.reduce((s, o) => s + o.pago, 0))}</span></div>
      <div class="panel stat"><span class="lbl">Em aberto</span><span class="val num" style="${ativas.some(o => o.saldo > 0) ? 'color:var(--warn)' : ''}">${brl(ativas.reduce((s, o) => s + Math.max(0, o.saldo), 0))}</span></div>
      <div class="panel stat"><span class="lbl">Crédito</span><span class="val num" style="${d.credito > 0 ? 'color:var(--ok)' : ''}">${brl(d.credito)}</span></div>` : ''}
    </div>
    <div class="panel"><dl class="kv">
      <dt>Cliente desde</dt><dd>${dataBR(c.criado_em)}</dd>
      <dt>Telefone</dt><dd>${c.telefone ? formatarTelefone(c.telefone) : '—'}</dd>
      ${c.whatsapp ? `<dt>WhatsApp</dt><dd>${formatarTelefone(c.whatsapp)}</dd>` : ''}
      <dt>E-mail</dt><dd>${esc(c.email || '—')}</dd>
      <dt>Nascimento</dt><dd>${c.nascimento ? dataBR(c.nascimento) : '—'}</dd>
      <dt>Endereço</dt><dd>${esc(c.endereco || '—')}</dd>
      <dt>Preferências</dt><dd>${esc(c.preferencias || '—')}</dd>
      <dt>Observações</dt><dd>${esc(c.observacoes || '—')}</dd></dl></div>
    <div class="tabs" role="tablist">${ABAS.filter(([k]) => k !== 'financeiro' || verValores).filter(([k]) => k !== 'medidas' || sessao.pode('medidas.ver'))
      .map(([k, l]) => `<a href="#clientes/${id}/${k}" role="tab" class="${aba === k ? 'on' : ''}" style="padding:10px 14px;font-weight:600;color:${aba === k ? 'var(--accent)' : 'var(--muted)'};border-bottom:2px solid ${aba === k ? 'var(--accent)' : 'transparent'};text-decoration:none;white-space:nowrap">${l}</a>`).join('')}</div>
    <div id="aba"></div>
    ${sessao.pode('clientes.exportar') ? `<div class="row" style="justify-content:flex-end"><button class="btn sm" data-a="exportar">Exportar dados (LGPD)</button>
      ${sessao.pode('clientes.anonimizar') && c.ativo ? '<button class="btn sm danger" data-a="anonimizar">Excluir dados pessoais</button>' : ''}</div>` : ''}`;
  const alvo = $('#aba', el);
  if (aba === 'os') abaOrdens(alvo, d, verValores);
  if (aba === 'medidas') await abaMedidas(alvo, c, d);
  if (aba === 'financeiro') abaFinanceiro(alvo, c, d);
  if (aba === 'fotos') alvo.innerHTML = d.fotos.length ? `<div class="panel"><div class="fotos">${d.fotos.map(f => `<figure><a href="#ordens/${f.order_id}"><img src="/api/fotos/${f.id}" alt="Foto da OS ${nOS(f.numero)}" loading="lazy" style="cursor:pointer"></a>
      <figcaption>${nOS(f.numero)} · ${dataBR(f.criado_em)}</figcaption></figure>`).join('')}</div></div>` : '<div class="panel"><div class="empty">Nenhuma foto.</div></div>';
  if (aba === 'atendimento') alvo.innerHTML = `<div class="panel"><h2>Mensagens de WhatsApp abertas</h2>${d.mensagens.length
    ? `<div class="hist">${d.mensagens.map(m => `<div><span class="muted num">${dataHora(m.criado_em)}</span><span>${esc(MODELOS_MENSAGEM[m.modelo] || m.modelo)}</span>${m.numero ? `<span class="muted">${nOS(m.numero)}</span>` : ''}</div>`).join('')}</div>`
    : '<div class="empty">Nenhuma mensagem registrada.</div>'}<p class="ajuda" style="margin:0">O sistema registra quando o WhatsApp foi aberto com a mensagem; o envio é confirmado no aplicativo.</p></div>`;

  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]');
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
    if (!b) return;
    if (b.dataset.a === 'editar') editarCliente(c);
    if (b.dataset.a === 'exportar') {
      const r = await fetch(`/api/clientes/${id}/exportar`, { credentials: 'same-origin' });
      if (!r.ok) return toast('Não foi possível exportar.', true);
      const url = URL.createObjectURL(await r.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: `cliente-${c.nome.replace(/\W+/g, '-')}.json` });
      a.click();
      URL.revokeObjectURL(url);
    }
    if (b.dataset.a === 'anonimizar') modal({
      title: 'Excluir dados pessoais',
      body: `<p style="margin:0 0 10px">Nome, telefones, e-mail, endereço, observações e <b>todas as fotos</b> de ${esc(c.nome)} serão apagados. As OS e os valores continuam no sistema, sem identificar a pessoa. Não dá para desfazer.</p>
        <div class="field"><label for="m-conf">Digite ANONIMIZAR para confirmar</label><input class="in" id="m-conf" autocomplete="off"></div>`,
      actions: [{ label: 'Voltar' }, { label: 'Excluir dados', cls: 'danger', fn: async m => {
        try { await api(`/clientes/${id}/anonimizar`, { corpo: { confirmacao: $('#m-conf', m).value.trim() } }); } catch (err) { toast(err.message, true); return false; }
        toast('Dados pessoais excluídos.');
        location.hash = 'clientes';
      } }],
    });
    if (b.dataset.a === 'nova-ficha') novaFicha(c, d);
    if (b.dataset.a === 'medir') novaMedicao(b.dataset.ficha, el.__fichas, d);
    if (b.dataset.a === 'estornar') modalEstorno(b.dataset.id, () => telaClienteRecarregar());
    if (b.dataset.a === 'devolver') devolverCredito(c, d.credito);
  });
}

const telaClienteRecarregar = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

function editarCliente(c) {
  modal({
    title: 'Editar cliente', body: camposCliente(c) + `<label class="chk" style="margin-top:10px"><input type="checkbox" id="c-ativo" ${c.ativo ? 'checked' : ''}> Cliente ativa</label>`,
    actions: [{ label: 'Voltar' }, { label: 'Salvar', cls: 'pri', fn: async m => {
      const r = await salvarCliente(m, c.id, { ativo: $('#c-ativo', m).checked, confirmar_duplicado: $('#c-confirma', m)?.checked || undefined });
      if (!r) return false;
      toast('Cliente atualizada.');
      telaClienteRecarregar();
    } }],
  });
}

function abaOrdens(alvo, d, verValores) {
  alvo.innerHTML = `<div class="panel"><h2>Histórico de OS</h2><div class="tw">${d.ordens.length ? `<table><thead><tr><th>OS</th><th>Abertura</th><th>Prazo</th><th>Peças</th><th>Serviços</th><th>Situação</th>
      ${verValores ? '<th class="r">Total</th><th class="r">Falta</th>' : ''}</tr></thead><tbody>
    ${d.ordens.map(o => `<tr class="click" data-href="#ordens/${o.id}"><td class="num">${nOS(o.numero)}</td><td>${dataBR(o.aberta_em)}</td><td>${dataBR(o.prazo)}</td>
      <td>${esc(o.pecas || '')}</td><td class="muted">${esc(o.servicos || '')}</td><td>${pill(o.status)}</td>
      ${verValores ? `<td class="r num">${brl(o.total)}</td><td class="r num">${o.saldo > 0 && o.status !== 'cancelada' ? brl(o.saldo) : '—'}</td>` : ''}</tr>`).join('')}</tbody></table>`
    : '<div class="empty">Esta cliente ainda não tem OS.</div>'}</div></div>`;
}

function abaFinanceiro(alvo, c, d) {
  const podeEstornar = sessao.pode('financeiro.estornar');
  alvo.innerHTML = `<div class="grid s21">
    <div class="panel"><h2>Pagamentos</h2>${d.pagamentos.length ? `<div class="tw"><table><thead><tr><th>Data</th><th>Descrição</th><th>Forma</th><th class="r">Valor</th><th></th></tr></thead><tbody>
      ${d.pagamentos.map(p => `<tr><td>${dataBR(p.data)}</td><td>${esc(p.descricao)}${p.order_id ? ` <a class="btn link sm" href="#ordens/${p.order_id}">${nOS(p.os_numero)}</a>` : ''}</td><td>${esc(p.forma)}</td>
        <td class="r num" style="color:${p.tipo === 'entrada' ? 'var(--ok)' : 'var(--crit)'};white-space:nowrap">${p.tipo === 'entrada' ? '' : '− '}${brl(p.valor_centavos)}</td>
        <td class="r">${p.estornado ? '<span class="pill p-muted">Estornado</span>' : p.estorno_de ? '<span class="pill p-warn">Estorno</span>' : podeEstornar ? `<button class="btn sm" data-a="estornar" data-id="${p.id}">Estornar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Nenhum pagamento.</div>'}</div>
    <div class="panel"><div class="panel-h"><h2>Crédito</h2><span class="num" style="font-weight:700">${brl(d.credito)}</span></div>
      ${d.creditos.length ? `<div class="hist">${d.creditos.map(x => `<div><span class="muted num">${dataBR(x.criado_em)}</span><span class="num" style="color:${x.valor_centavos > 0 ? 'var(--ok)' : 'var(--crit)'}">${x.valor_centavos > 0 ? '+' : '−'} ${brl(Math.abs(x.valor_centavos))}</span><span>${esc(x.descricao)}</span></div>`).join('')}</div>`
        : '<div class="empty">Sem movimentação de crédito.</div>'}
      ${d.credito > 0 && sessao.pode('financeiro.estornar') ? '<button class="btn sm" data-a="devolver">Devolver crédito à cliente</button>' : ''}</div></div>`;
}

function devolverCredito(c, saldo) {
  const chave = novaChave();
  modal({
    title: 'Devolver crédito', body: `<p style="margin:0 0 10px">${esc(c.nome)} tem ${brl(saldo)} de crédito. A devolução sai do caixa de hoje.</p>
      <div class="grid g2" style="gap:12px"><div class="field"><label for="m-val">Valor (R$)</label><input class="in num" id="m-val" inputmode="decimal" value="${valorParaCampo(saldo)}"></div>
      <div class="field"><label for="m-forma">Devolver em</label><select class="in" id="m-forma">${sessao.config.formas_pagamento.filter(f => f.ativo && !f.eh_credito_cliente).map(f => `<option value="${f.id}">${esc(f.nome)}</option>`).join('')}</select></div></div>`,
    actions: [{ label: 'Voltar' }, { label: 'Devolver', cls: 'pri', fn: async m => {
      const v = lerValor($('#m-val', m).value);
      if (!v || v > saldo) { toast(`Informe um valor entre R$ 0,01 e ${brl(saldo)}.`, true); return false; }
      try { await api(`/clientes/${c.id}/credito/devolucao`, { chave, corpo: { valor_centavos: v, forma_id: $('#m-forma', m).value } }); } catch (e) {
        if (e.codigo === 'caixa_fechado') { fecharModal(); return modalAbrirCaixa(() => devolverCredito(c, saldo)) && 'manter'; }
        toast(e.message, true); return false;
      }
      toast('Crédito devolvido.');
      telaClienteRecarregar();
    } }],
  });
}

/* ---------------------------------------------------------------- medidas */
async function abaMedidas(alvo, c, d) {
  const { fichas } = await api(`/clientes/${c.id}/medidas`);
  alvo.closest('.wrap').__fichas = fichas;
  const campos = sessao.config.campos_medida;
  const pode = sessao.pode('medidas.editar');
  alvo.innerHTML = `<div class="panel"><div class="panel-h"><h2>Fichas de medidas</h2>${pode ? '<button class="btn sm pri" data-a="nova-ficha">+ Nova ficha</button>' : ''}</div>
    <p class="ajuda" style="margin:0">Medidas em centímetros. Cada medição nova é guardada sem apagar as anteriores, para comparar.</p></div>
    ${fichas.length ? fichas.map(f => {
      const usados = campos.filter(cp => f.versoes.some(v => v.valores[cp.id] !== undefined));
      return `<div class="panel"><div class="panel-h"><div><h2>${esc(f.titulo)}</h2>${f.peca ? `<span class="ajuda">Peça ${esc(f.peca_codigo)} · ${esc(f.peca)}</span>` : ''}</div>
        <div class="row">${f.versoes.length ? `<a class="btn sm" href="#clientes/${c.id}/ficha/${f.id}">Imprimir ficha</a>` : ''}${pode ? `<button class="btn sm pri" data-a="medir" data-ficha="${f.id}">Nova medição</button>` : ''}</div></div>
        ${f.versoes.length ? `<div class="med"><table><thead><tr><th>Medida (cm)</th>${f.versoes.map((v, i) => `<th class="r">${dataBR(v.medido_em)}${i === 0 ? ' · atual' : ''}</th>`).join('')}</tr></thead><tbody>
          ${usados.map(cp => `<tr><td>${esc(cp.nome)}</td>${f.versoes.map((v, i) => {
            const val = v.valores[cp.id];
            const ant = f.versoes[i + 1]?.valores[cp.id];
            const dif = val !== undefined && ant !== undefined ? Math.round((val - ant) * 10) / 10 : 0;
            return `<td class="r num ${dif > 0 ? 'dif-mais' : dif < 0 ? 'dif-menos' : ''}" ${dif ? `title="${dif > 0 ? '+' : ''}${String(dif).replace('.', ',')} cm em relação à medição anterior"` : ''}>${val !== undefined ? String(val).replace('.', ',') : '—'}${dif ? ` <small>(${dif > 0 ? '+' : ''}${String(dif).replace('.', ',')})</small>` : ''}</td>`;
          }).join('')}</tr>`).join('')}
          <tr><td class="muted">Observações</td>${f.versoes.map(v => `<td class="muted" style="font-size:.82rem">${esc(v.observacoes || '—')}</td>`).join('')}</tr>
          <tr><td class="muted">Medido por</td>${f.versoes.map(v => `<td class="muted" style="font-size:.82rem">${esc(v.medido_por_nome || '—')}</td>`).join('')}</tr>
          </tbody></table></div>` : '<div class="empty">Nenhuma medição registrada nesta ficha.</div>'}</div>`;
    }).join('') : '<div class="panel"><div class="empty">Nenhuma ficha de medidas. Crie uma ficha "Medidas corporais" ou uma para uma encomenda específica.</div></div>'}`;
}

function novaFicha(c, d) {
  const pecas = [];
  modal({
    title: 'Nova ficha de medidas',
    body: `<div class="grid" style="gap:12px"><div class="field"><label class="req" for="m-tit">Nome da ficha</label><input class="in" id="m-tit" value="Medidas corporais"></div>
      <div class="field"><label for="m-peca">Encomenda (opcional)</label><select class="in" id="m-peca"><option value="">Medidas gerais da cliente</option></select>
      <span class="ajuda">Escolha uma peça quando as medidas forem específicas de uma encomenda.</span></div></div>`,
    onOpen: async m => {
      for (const o of d.ordens.filter(x => !['entregue', 'cancelada'].includes(x.status)).slice(0, 15)) {
        const os = await api(`/ordens/${o.id}`).catch(() => null);
        os?.itens.forEach(i => pecas.push({ id: i.id, nome: `${nOS(o.numero)} · ${i.codigo} · ${i.peca}` }));
      }
      const sel = $('#m-peca', m);
      if (sel) sel.innerHTML += pecas.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
    },
    actions: [{ label: 'Voltar' }, { label: 'Criar ficha', cls: 'pri', fn: async m => {
      try {
        await api(`/clientes/${c.id}/medidas`, { corpo: { titulo: $('#m-tit', m).value.trim(), order_item_id: $('#m-peca', m).value || null } });
      } catch (e) { toast(e.message, true); return false; }
      toast('Ficha criada.');
      telaClienteRecarregar();
    } }],
  });
}

function novaMedicao(fichaId, fichas) {
  const ficha = fichas.find(f => f.id === fichaId);
  const ultima = ficha.versoes[0]?.valores || {};
  const campos = sessao.config.campos_medida.filter(c => c.ativo || ultima[c.id] !== undefined);
  modal({
    wide: true, title: `Nova medição · ${ficha.titulo}`,
    body: `<p class="ajuda" style="margin:0 0 10px">Valores em centímetros (use vírgula para meio centímetro). Os campos vêm com a última medição; deixe em branco o que não se aplica.</p>
      <div class="field" style="max-width:220px;margin-bottom:10px"><label for="m-data">Data da medição</label><input class="in" type="date" id="m-data" max="${sessao.hoje}" value="${sessao.hoje}"></div>
      <div class="grid g3" style="gap:10px">${campos.map(cp => `<div class="field"><label for="mc-${cp.id}">${esc(cp.nome)}</label>
        <input class="in num" id="mc-${cp.id}" data-campo="${cp.id}" inputmode="decimal" value="${ultima[cp.id] !== undefined ? String(ultima[cp.id]).replace('.', ',') : ''}"></div>`).join('')}</div>
      <div class="field" style="margin-top:10px"><label for="m-obs">Observações de caimento</label><textarea class="in" id="m-obs" placeholder="Ex.: prefere cintura mais folgada; ombro direito mais baixo"></textarea></div>`,
    actions: [{ label: 'Voltar' }, { label: 'Salvar medição', cls: 'pri', fn: async m => {
      const valores = {};
      for (const inp of m.querySelectorAll('[data-campo]')) {
        const t = inp.value.trim();
        if (!t) continue;
        const v = Number(t.replace(',', '.'));
        if (!(v > 0 && v < 400)) { inp.setAttribute('aria-invalid', 'true'); inp.focus(); toast('Medida inválida: use um número entre 0,1 e 399.', true); return false; }
        valores[inp.dataset.campo] = v;
      }
      if (!Object.keys(valores).length) { toast('Preencha pelo menos uma medida.', true); return false; }
      try {
        await api(`/medidas/${fichaId}/versoes`, { corpo: { medido_em: $('#m-data', m).value, observacoes: $('#m-obs', m).value.trim(), valores } });
      } catch (e) { toast(e.message, true); return false; }
      toast('Medição registrada.');
      telaClienteRecarregar();
    } }],
  });
}

async function imprimirFicha(el, clientId, fichaId) {
  const { cliente, fichas } = await api(`/clientes/${clientId}/medidas`);
  const f = fichas.find(x => x.id === fichaId);
  if (!f) throw new Error('Ficha não encontrada.');
  const v = f.versoes[0];
  const campos = sessao.config.campos_medida.filter(c => v?.valores[c.id] !== undefined);
  el.innerHTML = `<div class="row nao-imprimir"><a class="btn" href="#clientes/${clientId}/medidas">← Voltar</a><button class="btn pri" data-imp>Imprimir / Salvar PDF</button></div>
    <div class="a4wrap"><div class="a4">
      <div class="top"><div><h2>${esc(sessao.config.atelie.nome)}</h2><div>Ficha de medidas</div></div>
        <div style="text-align:right"><div><b>${esc(cliente.nome)}</b></div><div>${esc(f.titulo)}</div><div>Medido em ${v ? dataBR(v.medido_em) : '—'}</div></div></div>
      ${f.peca ? `<div class="box">Encomenda: peça ${esc(f.peca_codigo)} · ${esc(f.peca)}</div>` : ''}
      <table><thead><tr><th>Medida</th><th class="r">Centímetros</th></tr></thead><tbody>
        ${campos.map(c => `<tr><td>${esc(c.nome)}</td><td class="r num">${String(v.valores[c.id]).replace('.', ',')}</td></tr>`).join('')}</tbody></table>
      ${v?.observacoes ? `<div class="box"><b>Observações de caimento:</b> ${esc(v.observacoes)}</div>` : ''}
      <div class="ass"><div>Medido por: ${esc(v?.medido_por_nome || '')}</div><div>Conferido pela cliente</div></div></div></div>`;
  el.addEventListener('click', e => { if (e.target.closest('[data-imp]')) window.print(); });
}

