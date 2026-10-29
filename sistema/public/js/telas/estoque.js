import { api, novaChave, sessao } from '../api.js';
import { $, brl, dataBR, dataHora, esc, modal, nOS, opcoes, toast } from '../ui.js';
import { CATEGORIAS_MATERIAL, lerValor, TIPOS_MOVIMENTO, UNIDADES_ESTOQUE } from '../regras.js';
import { modalAbrirCaixa } from './ordens.js';

const est = { aba: 'materiais', q: '', categoria: '', baixo: false };
const qtd = (v, un) => `${String(Math.round(v * 1000) / 1000).replace('.', ',')} ${esc(un)}`;
const lerQtd = t => { const n = Number(String(t).trim().replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : NaN; };

export async function telaEstoque(el, params, vivo) {
  if (params[0]) return telaMaterial(el, params[0], vivo);
  const pode = sessao.pode('estoque.movimentar');
  const desenhar = async () => {
    if (est.aba === 'fornecedores') return abaFornecedores(el, desenhar, pode);
    const qs = new URLSearchParams({ ...(est.q && { q: est.q }), ...(est.categoria && { categoria: est.categoria }), ...(est.baixo && { baixo: '1' }) });
    const { materiais } = await api('/estoque/materiais?' + qs);
    if (!vivo()) return;
    const verCusto = sessao.pode('os.financeiro.ver');
    const baixos = materiais.filter(m => m.abaixo_minimo).length;
    el.innerHTML = cabecalho(pode) + `
      ${baixos && !est.baixo ? `<div class="alert a-warn">${baixos} material(is) no estoque mínimo ou abaixo. <button class="btn link sm" data-baixo>Ver</button></div>` : ''}
      <div class="panel"><div class="row">
        <input class="in" id="e-q" type="search" placeholder="Buscar por nome ou código" value="${esc(est.q)}" style="flex:1;min-width:180px">
        <select class="in" id="e-cat" style="width:auto"><option value="">Todas as categorias</option>${Object.entries(CATEGORIAS_MATERIAL).map(([k, l]) => `<option value="${k}" ${est.categoria === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label class="chk"><input type="checkbox" id="e-baixo" ${est.baixo ? 'checked' : ''}> Só abaixo do mínimo</label></div>
      ${materiais.length ? `<div class="tw"><table><thead><tr><th>Código</th><th>Material</th><th>Categoria</th><th class="r">Saldo</th><th class="r">Mínimo</th>${verCusto ? '<th class="r">Custo médio</th><th class="r">Valor em estoque</th>' : ''}<th>Local</th></tr></thead><tbody>
        ${materiais.map(m => `<tr class="click" data-href="#estoque/${m.id}"><td class="num">${esc(m.codigo)}</td><td><b>${esc(m.nome)}</b>${m.fornecedor ? `<div class="ajuda">${esc(m.fornecedor)}</div>` : ''}</td>
          <td>${CATEGORIAS_MATERIAL[m.categoria]}</td><td class="r num" style="${m.abaixo_minimo ? 'color:var(--crit);font-weight:700' : ''}">${qtd(m.quantidade, m.unidade)}</td>
          <td class="r num muted">${qtd(m.estoque_minimo, m.unidade)}</td>${verCusto ? `<td class="r num">${brl(m.custo_medio_centavos)}</td><td class="r num">${brl(Math.max(0, m.quantidade) * m.custo_medio_centavos)}</td>` : ''}
          <td class="muted">${esc(m.localizacao || '')}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">Nenhum material cadastrado com esses filtros.</div>'}</div>`;
    let t;
    $('#e-q', el).oninput = e => { est.q = e.target.value; clearTimeout(t); t = setTimeout(desenhar, 300); };
    $('#e-cat', el).onchange = e => { est.categoria = e.target.value; desenhar(); };
    $('#e-baixo', el).onchange = e => { est.baixo = e.target.checked; desenhar(); };
  };
  el.onclick = e => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
    const aba = e.target.closest('[data-aba]');
    if (aba) { est.aba = aba.dataset.aba; desenhar(); }
    if (e.target.closest('[data-baixo]')) { est.baixo = true; desenhar(); }
    if (e.target.closest('[data-novo-mat]')) formMaterial(null, desenhar);
  };
  await desenhar();
}

const cabecalho = pode => `<div class="head"><div><h1>Estoque</h1><p>Materiais, compras e consumo nas OS. O saldo só muda por movimentação registrada.</p></div>
    ${pode ? '<button class="btn pri" data-novo-mat>+ Novo material</button>' : ''}</div>
  <div class="tabs"><button class="${est.aba === 'materiais' ? 'on' : ''}" data-aba="materiais">Materiais</button><button class="${est.aba === 'fornecedores' ? 'on' : ''}" data-aba="fornecedores">Fornecedores</button></div>`;

async function formMaterial(m, depois) {
  const { fornecedores } = await api('/estoque/fornecedores');
  const x = m || { codigo: '', nome: '', categoria: 'tecido', unidade: 'm', estoque_minimo: 0, localizacao: '', ativo: 1 };
  modal({
    title: m ? 'Editar material' : 'Novo material',
    body: `<div class="grid g2" style="gap:12px">
      <div class="field"><label class="req" for="m-cod">Código</label><input class="in" id="m-cod" value="${esc(x.codigo)}" placeholder="ex.: TEC-001"></div>
      <div class="field"><label class="req" for="m-nome">Nome</label><input class="in" id="m-nome" value="${esc(x.nome)}" placeholder="ex.: Tricoline branca"></div>
      <div class="field"><label for="m-cat">Categoria</label><select class="in" id="m-cat">${Object.entries(CATEGORIAS_MATERIAL).map(([k, l]) => `<option value="${k}" ${x.categoria === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="m-un">Unidade</label><select class="in" id="m-un">${Object.entries(UNIDADES_ESTOQUE).map(([k, l]) => `<option value="${k}" ${x.unidade === k ? 'selected' : ''}>${l} (${k})</option>`).join('')}</select></div>
      <div class="field"><label for="m-min">Estoque mínimo</label><input class="in num" id="m-min" inputmode="decimal" value="${String(x.estoque_minimo).replace('.', ',')}"></div>
      <div class="field"><label for="m-loc">Localização</label><input class="in" id="m-loc" value="${esc(x.localizacao || '')}" placeholder="ex.: armário 2, gaveta B"></div>
      <div class="field" style="grid-column:1/-1"><label for="m-forn">Fornecedor</label><select class="in" id="m-forn">${opcoes(fornecedores.filter(f => f.ativo), x.supplier_id, '— nenhum —')}</select></div>
      <label class="chk"><input type="checkbox" id="m-ativo" ${x.ativo ? 'checked' : ''}> Ativo</label></div>
      ${m ? '' : '<p class="ajuda">O saldo começa em zero. Depois de cadastrar, registre a entrada por compra (ou um ajuste de inventário com a quantidade que você já tem).</p>'}`,
    actions: [{ label: 'Voltar' }, { label: 'Salvar', cls: 'pri', fn: async box => {
      const minimo = lerQtd($('#m-min', box).value || '0');
      if (!(minimo >= 0)) { toast('Estoque mínimo inválido.', true); return false; }
      const corpo = { codigo: $('#m-cod', box).value.trim(), nome: $('#m-nome', box).value.trim(), categoria: $('#m-cat', box).value, unidade: $('#m-un', box).value,
        estoque_minimo: minimo, localizacao: $('#m-loc', box).value.trim(), supplier_id: $('#m-forn', box).value || null, ativo: $('#m-ativo', box).checked };
      try {
        const r = await api(m ? `/estoque/materiais/${m.id}` : '/estoque/materiais', { metodo: m ? 'PUT' : 'POST', corpo });
        toast('Material salvo.');
        if (!m) { location.hash = `estoque/${r.id}`; return; }
      } catch (e) { toast(e.message, true); return false; }
      depois();
    } }],
  });
}

async function telaMaterial(el, id, vivo) {
  const [{ materiais }, { movimentos }] = await Promise.all([api('/estoque/materiais?inativos=1'), api(`/estoque/materiais/${id}/movimentos`)]);
  if (!vivo()) return;
  const m = materiais.find(x => x.id === id);
  if (!m) throw new Error('Material não encontrado.');
  const pode = sessao.pode('estoque.movimentar');
  const verCusto = sessao.pode('os.financeiro.ver');
  el.innerHTML = `<div class="head"><div><a class="btn link" href="#estoque" style="padding-left:0">← Estoque</a><h1>${esc(m.nome)}</h1>
      <p>${esc(m.codigo)} · ${CATEGORIAS_MATERIAL[m.categoria]}${m.localizacao ? ' · ' + esc(m.localizacao) : ''}${m.fornecedor ? ' · ' + esc(m.fornecedor) : ''}</p></div>
      ${pode ? '<button class="btn" data-a="editar">Editar</button>' : ''}</div>
    <div class="grid g3">
      <div class="panel stat"><span class="lbl">Saldo</span><span class="val num" style="${m.abaixo_minimo ? 'color:var(--crit)' : ''}">${qtd(m.quantidade, m.unidade)}</span><span class="sub">mínimo ${qtd(m.estoque_minimo, m.unidade)}</span></div>
      ${verCusto ? `<div class="panel stat"><span class="lbl">Custo médio</span><span class="val num">${brl(m.custo_medio_centavos)}</span><span class="sub">por ${UNIDADES_ESTOQUE[m.unidade]}</span></div>
      <div class="panel stat"><span class="lbl">Valor em estoque</span><span class="val num">${brl(Math.max(0, m.quantidade) * m.custo_medio_centavos)}</span></div>` : ''}
    </div>
    ${pode ? `<div class="row"><button class="btn pri" data-mov="compra">+ Entrada por compra</button><button class="btn" data-mov="devolucao">Devolução</button>
      <button class="btn" data-mov="perda">Perda</button><button class="btn" data-mov="ajuste">Ajuste de inventário</button></div>` : ''}
    <div class="panel"><h2>Movimentações</h2>${movimentos.length ? `<div class="tw"><table><thead><tr><th>Quando</th><th>Tipo</th><th class="r">Quantidade</th>${verCusto ? '<th class="r">Custo un.</th>' : ''}<th>OS / documento</th><th>Motivo</th><th>Por</th><th></th></tr></thead><tbody>
      ${movimentos.map(v => `<tr><td class="num">${dataHora(v.criado_em)}</td><td>${TIPOS_MOVIMENTO[v.tipo]}${v.autorizado_negativo ? ' <span class="pill p-warn">negativo autorizado</span>' : ''}</td>
        <td class="r num" style="color:${v.quantidade > 0 ? 'var(--ok)' : 'var(--crit)'}">${v.quantidade > 0 ? '+' : '−'} ${qtd(Math.abs(v.quantidade), m.unidade)}</td>
        ${verCusto ? `<td class="r num">${v.custo_unitario_centavos ? brl(v.custo_unitario_centavos) : '—'}</td>` : ''}
        <td>${v.order_id ? `<a href="#ordens/${v.order_id}">${nOS(v.os_numero)}${v.peca_codigo ? ' · ' + esc(v.peca_codigo) : ''}</a>` : esc(v.documento || '')}</td>
        <td class="muted">${esc(v.motivo || '')}</td><td class="muted">${esc(v.usuario || '')}</td>
        <td class="r">${v.revertido_por ? '<span class="pill p-muted">Revertido</span>' : v.reverte_de ? '<span class="pill p-warn">Reversão</span>' : pode ? `<button class="btn sm" data-reverter="${v.id}">Reverter</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Nenhuma movimentação ainda.</div>'}</div>`;
  const recarregar = () => telaMaterial(el, id, vivo);
  el.onclick = e => {
    const b = e.target.closest('[data-a],[data-mov],[data-reverter]');
    if (!b) return;
    if (b.dataset.a === 'editar') formMaterial(m, recarregar);
    if (b.dataset.mov) formMovimento(m, b.dataset.mov, recarregar);
    if (b.dataset.reverter) reverter(b.dataset.reverter, recarregar);
  };
}

async function formMovimento(m, tipo, depois) {
  const chave = novaChave();
  const [{ fornecedores }] = await Promise.all([tipo === 'compra' ? api('/estoque/fornecedores') : Promise.resolve({ fornecedores: [] })]);
  const podePagar = sessao.pode('pagar.editar');
  const podeLancar = sessao.pode('financeiro.lancar');
  const podeNeg = sessao.pode('estoque.negativo');
  modal({
    title: `${TIPOS_MOVIMENTO[tipo]} · ${m.nome}`,
    body: `<div class="grid g2" style="gap:12px">
      ${tipo === 'ajuste' ? `<div class="field" style="grid-column:1/-1"><label class="req" for="v-cont">Quantidade contada agora (${esc(m.unidade)})</label><input class="in num" id="v-cont" inputmode="decimal">
          <span class="ajuda">Saldo no sistema: ${qtd(m.quantidade, m.unidade)}. A diferença vira um ajuste.</span></div>`
        : `<div class="field"><label class="req" for="v-qtd">Quantidade (${esc(m.unidade)})</label><input class="in num" id="v-qtd" inputmode="decimal" placeholder="ex.: 1,5"></div>`}
      ${tipo === 'compra' || tipo === 'devolucao' ? `<div class="field"><label for="v-custo">Custo por ${esc(UNIDADES_ESTOQUE[m.unidade])} (R$)</label><input class="in num" id="v-custo" inputmode="decimal" placeholder="0,00"></div>` : ''}
      ${tipo === 'compra' ? `<div class="field"><label for="v-forn">Fornecedor</label><select class="in" id="v-forn">${opcoes(fornecedores.filter(f => f.ativo), m.supplier_id, '— nenhum —')}</select></div>
        <div class="field"><label for="v-doc">Nota / recibo</label><input class="in" id="v-doc"></div>
        <div class="field" style="grid-column:1/-1"><label for="v-pag">Pagamento</label><select class="in" id="v-pag"><option value="nenhum">Não registrar no financeiro</option>
          ${podePagar ? '<option value="conta">Gerar conta a pagar</option>' : ''}${podeLancar ? '<option value="pago">Já paguei (sai do caixa de hoje)</option>' : ''}</select></div>
        <div class="field" id="v-venc-f" hidden><label for="v-venc">Vencimento</label><input class="in" type="date" id="v-venc" value="${sessao.hoje}"></div>
        <div class="field" id="v-forma-f" hidden><label for="v-forma">Forma</label><select class="in" id="v-forma">${opcoes(sessao.config.formas_pagamento.filter(f => f.ativo && !f.eh_credito_cliente))}</select></div>` : ''}
      <div class="field" style="grid-column:1/-1"><label ${tipo === 'perda' || tipo === 'ajuste' ? 'class="req"' : ''} for="v-mot">Motivo / observação</label><input class="in" id="v-mot"></div>
      ${podeNeg && (tipo === 'perda' || tipo === 'ajuste') ? '<label class="chk" style="grid-column:1/-1"><input type="checkbox" id="v-neg"> Autorizar saldo negativo</label>' : ''}</div>`,
    onOpen: box => {
      const pag = $('#v-pag', box);
      if (pag) pag.onchange = () => { $('#v-venc-f', box).hidden = pag.value !== 'conta'; $('#v-forma-f', box).hidden = pag.value !== 'pago'; };
    },
    actions: [{ label: 'Voltar' }, { label: 'Registrar', cls: 'pri', fn: async box => {
      const corpo = { material_id: m.id, tipo, motivo: $('#v-mot', box).value.trim(), autorizar_negativo: $('#v-neg', box)?.checked || undefined };
      if (tipo === 'ajuste') {
        corpo.contado = lerQtd($('#v-cont', box).value);
        if (!(corpo.contado >= 0)) { toast('Informe a quantidade contada.', true); return false; }
      } else {
        corpo.quantidade = lerQtd($('#v-qtd', box).value);
        if (!(corpo.quantidade > 0)) { toast('Informe uma quantidade maior que zero.', true); return false; }
        if (m.unidade === 'un' && !Number.isInteger(corpo.quantidade)) { toast('Material em unidades: use número inteiro.', true); return false; }
      }
      if ($('#v-custo', box)) corpo.custo_unitario_centavos = lerValor($('#v-custo', box).value || '0') ?? 0;
      if (tipo === 'compra') Object.assign(corpo, { supplier_id: $('#v-forn', box).value || null, documento: $('#v-doc', box).value.trim(), pagamento: $('#v-pag', box).value,
        vencimento: $('#v-venc', box).value, forma_id: $('#v-forma', box).value });
      try {
        const r = await api('/estoque/movimentos', { chave, corpo });
        toast(r.sem_diferenca ? 'Sem diferença: nada a ajustar.' : 'Movimentação registrada.');
      } catch (e) {
        if (e.codigo === 'caixa_fechado') return modalAbrirCaixa(() => formMovimento(m, tipo, depois)) && 'manter';
        toast(e.message, true); return false;
      }
      depois();
    } }],
  });
}

function reverter(id, depois) {
  const chave = novaChave();
  modal({
    title: 'Reverter movimentação',
    body: `<p style="margin:0 0 10px">Será lançada uma movimentação no sentido contrário. A original continua no histórico. Se for uma compra com conta a pagar, cancele a conta no Financeiro.</p>
      <div class="field"><label class="req" for="r-mot">Motivo</label><input class="in" id="r-mot"></div>
      ${sessao.pode('estoque.negativo') ? '<label class="chk" style="margin-top:8px"><input type="checkbox" id="r-neg"> Autorizar saldo negativo</label>' : ''}`,
    actions: [{ label: 'Voltar' }, { label: 'Reverter', cls: 'danger-solid', fn: async box => {
      try {
        await api(`/estoque/movimentos/${id}/reverter`, { chave, corpo: { motivo: $('#r-mot', box).value.trim(), autorizar_negativo: $('#r-neg', box)?.checked || undefined } });
      } catch (e) { toast(e.message, true); return false; }
      toast('Movimentação revertida.');
      depois();
    } }],
  });
}

async function abaFornecedores(el, depois, pode) {
  const { fornecedores } = await api('/estoque/fornecedores');
  el.innerHTML = cabecalho(pode) + `<div class="panel"><div class="panel-h"><h2>Fornecedores</h2>${pode ? '<button class="btn pri sm" data-novo-forn>+ Novo fornecedor</button>' : ''}</div>
    ${fornecedores.length ? `<div class="tw"><table><thead><tr><th>Nome</th><th>Telefone</th><th>E-mail</th><th>CNPJ/CPF</th><th class="r">Materiais</th><th></th></tr></thead><tbody>
      ${fornecedores.map(f => `<tr style="${f.ativo ? '' : 'opacity:.5'}"><td><b>${esc(f.nome)}</b>${f.observacoes ? `<div class="ajuda">${esc(f.observacoes)}</div>` : ''}</td><td>${esc(f.telefone || '')}</td>
        <td>${esc(f.email || '')}</td><td>${esc(f.documento || '')}</td><td class="r num">${f.materiais}</td><td class="r">${pode ? `<button class="btn sm" data-ed-forn="${f.id}">Editar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Nenhum fornecedor cadastrado.</div>'}</div>`;
  const form = f => modal({
    title: f ? 'Editar fornecedor' : 'Novo fornecedor',
    body: `<div class="grid g2" style="gap:12px"><div class="field" style="grid-column:1/-1"><label class="req" for="f-nome">Nome</label><input class="in" id="f-nome" value="${esc(f?.nome || '')}"></div>
      <div class="field"><label for="f-tel">Telefone</label><input class="in" id="f-tel" value="${esc(f?.telefone || '')}"></div>
      <div class="field"><label for="f-email">E-mail</label><input class="in" id="f-email" value="${esc(f?.email || '')}"></div>
      <div class="field"><label for="f-doc">CNPJ / CPF</label><input class="in" id="f-doc" value="${esc(f?.documento || '')}"></div>
      <div class="field"><label for="f-obs">Observações</label><input class="in" id="f-obs" value="${esc(f?.observacoes || '')}"></div>
      <label class="chk"><input type="checkbox" id="f-ativo" ${!f || f.ativo ? 'checked' : ''}> Ativo</label></div>`,
    actions: [{ label: 'Voltar' }, { label: 'Salvar', cls: 'pri', fn: async box => {
      const corpo = { nome: $('#f-nome', box).value.trim(), telefone: $('#f-tel', box).value.trim(), email: $('#f-email', box).value.trim(),
        documento: $('#f-doc', box).value.trim(), observacoes: $('#f-obs', box).value.trim(), ativo: $('#f-ativo', box).checked };
      try { await api(f ? `/estoque/fornecedores/${f.id}` : '/estoque/fornecedores', { metodo: f ? 'PUT' : 'POST', corpo }); } catch (e) { toast(e.message, true); return false; }
      toast('Fornecedor salvo.');
      depois();
    } }],
  });
  el.onclick = e => {
    const aba = e.target.closest('[data-aba]');
    if (aba) { est.aba = aba.dataset.aba; depois(); }
    if (e.target.closest('[data-novo-mat]')) formMaterial(null, depois);
    if (e.target.closest('[data-novo-forn]')) form(null);
    const ed = e.target.closest('[data-ed-forn]');
    if (ed) form(fornecedores.find(f => f.id === ed.dataset.edForn));
  };
}

