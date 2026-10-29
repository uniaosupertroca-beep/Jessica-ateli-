import { api, ErroApi, novaChave, sessao } from '../api.js';
import {
  $, $$, brl, comBotao, confirmar, dataBR, dataHora, dataSemana, esc, fecharModal, formatarTelefone, modal, nOS, opcoes, pill, pillProd, tagUn, toast,
} from '../ui.js';
import {
  duracao, FLUXO_OS, STATUS_DE_PRODUCAO, TIPOS_AGENDA, lerQuantidade, lerValor, linkWhatsApp, montarMensagem, MODELOS_MENSAGEM, numeroWhatsApp, situacaoDia, somarDias,
  STATUS_OS, STATUS_PRODUCAO, subtotal, transicoesManuais, UNIDADES, valorParaCampo,
} from '../regras.js';
import { modalNovaCliente } from './clientes.js';
import { modalCompromisso } from './agenda.js';
import { assinaturaAtelie, cabecalhoDoc, estiloDoc, urlLogo } from '../documento.js';

/* =========================================================================
 * LISTA DE OS
 * ======================================================================= */
const FILTROS = [['ativas', 'Em andamento'], ['atrasadas', 'Atrasadas'], ['todas', 'Todas'], ...Object.entries(STATUS_OS)];
const filtro = { q: '', status: 'ativas', de: '', ate: '' };

export async function telaOrdens(el, _p, vivo) {
  const vindo = sessionStorage.getItem('filtro-os');
  if (vindo) { filtro.status = vindo; sessionStorage.removeItem('filtro-os'); }
  const verValores = sessao.pode('os.financeiro.ver');
  el.innerHTML = `<div class="head"><div><h1>Ordens de serviço</h1><p id="os-qtd">Carregando…</p></div>
      ${sessao.pode('os.editar') ? '<a class="btn pri" href="#ordens/nova">+ Nova OS</a>' : ''}</div>
    <div class="panel"><div class="row">
      <input class="in" id="os-q" type="search" placeholder="Buscar por nome da cliente, peça ou nº da OS" value="${esc(filtro.q)}" style="flex:1;min-width:200px" aria-label="Buscar">
      <select class="in" id="os-st" style="width:auto" aria-label="Situação">${FILTROS.map(([k, l]) => `<option value="${k}" ${filtro.status === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <label class="row" style="gap:6px">Prazo de <input class="in" type="date" id="os-de" value="${filtro.de}" style="width:auto"></label>
      <label class="row" style="gap:6px">até <input class="in" type="date" id="os-ate" value="${filtro.ate}" style="width:auto"></label>
    </div><div class="tw" id="os-tab"><p class="carregando">Carregando…</p></div></div>`;
  let t;
  const carregar = async () => {
    const qs = new URLSearchParams({ status: filtro.status, ...(filtro.q && { q: filtro.q }), ...(filtro.de && { de: filtro.de }), ...(filtro.ate && { ate: filtro.ate }) });
    const { ordens } = await api('/ordens?' + qs);
    if (!vivo()) return;
    $('#os-qtd').textContent = `${ordens.length} OS encontrada${ordens.length === 1 ? '' : 's'}`;
    $('#os-tab').innerHTML = ordens.length ? `<table><thead><tr><th>OS</th><th>Cliente</th><th>Peças</th><th>Prazo</th><th>Situação</th>
        ${verValores ? '<th class="r">Total</th><th class="r">Falta pagar</th>' : ''}</tr></thead><tbody>
      ${ordens.map(o => {
        const atrasada = o.prazo < sessao.hoje && !['entregue', 'cancelada'].includes(o.status);
        return `<tr class="click" data-href="#ordens/${o.id}"><td class="num">${nOS(o.numero)}${tagUn(o.unidade_sigla)}</td><td>${esc(o.cliente)}</td>
          <td class="muted" style="max-width:220px">${esc(o.pecas || '')}</td>
          <td style="${atrasada ? 'color:var(--crit);font-weight:600' : ''}">${dataSemana(o.prazo)}${atrasada ? ' · atrasada' : ''}</td><td>${pill(o.status)}</td>
          ${verValores ? `<td class="r num">${brl(o.total)}</td><td class="r num" style="${o.saldo > 0 ? 'color:var(--warn)' : ''}">${o.saldo > 0 ? brl(o.saldo) : '—'}</td>` : ''}</tr>`;
      }).join('')}</tbody></table>` : '<div class="empty">Nenhuma OS encontrada com esses filtros.</div>';
  };
  el.addEventListener('input', e => {
    if (e.target.id !== 'os-q') return;
    filtro.q = e.target.value;
    clearTimeout(t);
    t = setTimeout(carregar, 250);
  });
  el.addEventListener('change', e => {
    if (e.target.id === 'os-st') filtro.status = e.target.value;
    else if (e.target.id === 'os-de') filtro.de = e.target.value;
    else if (e.target.id === 'os-ate') filtro.ate = e.target.value;
    else return;
    carregar();
  });
  el.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });
  await carregar();
}

/* =========================================================================
 * FORMULÁRIO / DETALHE DA OS
 * ======================================================================= */
const servicoVazio = () => ({ service_id: '', descricao: '', unidade: 'un', quantidade: '1', valor: 0, tempo_min: undefined });
const pecaVazia = () => ({ peca: '', descricao: '', prazo: '', responsavel_id: '', servicos: [servicoVazio()] });

function modeloDe(os) {
  return {
    id: os.id, numero: os.numero, versao: os.versao, status: os.status, client_id: os.client_id, cliente: os.cliente,
    aberta_em: os.aberta_em, prazo: os.prazo, responsavel_id: os.responsavel_id || '', desconto_centavos: os.desconto_centavos ?? 0,
    observacoes: os.observacoes || '',
    itens: os.itens.map(i => ({
      id: i.id, codigo: i.codigo, peca: i.peca, descricao: i.descricao, prazo: i.prazo || '', responsavel_id: i.responsavel_id || '',
      status_producao: i.status_producao, responsavel_nome: i.responsavel_nome, urgente: i.urgente, tempo_real_min: i.tempo_real_min, retrabalhos: i.retrabalhos,
      obs_interna: i.obs_interna,
      servicos: i.servicos.map(s => ({ id: s.id, service_id: s.service_id || '', descricao: s.descricao, unidade: s.unidade,
        quantidade: String(s.quantidade).replace('.', ','), valor: s.valor_unitario_centavos ?? 0, tempo_min: s.tempo_min })),
    })),
  };
}

export async function telaOS(el, params, vivo) {
  const nova = params[0] === 'nova';
  let os = null;
  let f;
  if (nova) {
    if (!sessao.pode('os.editar')) throw new Error('Você não tem permissão para criar OS.');
    f = { id: null, status: 'recebida', client_id: params[1] || '', cliente: null, aberta_em: sessao.hoje, prazo: somarDias(sessao.hoje, 3),
      responsavel_id: '', desconto_centavos: 0, observacoes: '', itens: [pecaVazia()], _chave: novaChave() };
    if (f.client_id) f.cliente = (await api(`/clientes/${f.client_id}`)).cliente;
  } else {
    os = await api(`/ordens/${params[0]}`);
    f = modeloDe(os);
  }
  if (!vivo()) return;
  const ctx = { el, f, os, vivo, recarregar: async () => {
    ctx.os = os = await api(`/ordens/${f.id}`);
    ctx.f = f = modeloDe(os);
    desenhar(ctx);
  } };
  desenhar(ctx);
  ligarEventos(ctx);
}

const cfg = () => sessao.config;
const servicoCat = id => cfg().servicos.find(s => s.id === id);
const editavel = ctx => sessao.pode('os.editar') && !['entregue', 'cancelada'].includes(ctx.f.status);
const podePreco = () => sessao.pode('os.alterar_preco');

function totaisModelo(f, pago = 0) {
  let soma = 0;
  let valido = true;
  for (const it of f.itens) for (const s of it.servicos) {
    const q = lerQuantidade(s.quantidade, s.unidade);
    if (q === null) valido = false;
    else soma += subtotal(q, s.valor || 0);
  }
  const total = soma - (f.desconto_centavos || 0);
  return { soma, total, pago, saldo: total - pago, valido };
}

/* ---------------------------------------------------------------- desenho */
function desenhar(ctx) {
  const { el, f, os } = ctx;
  const ed = editavel(ctx);
  const salva = !!f.id;
  const verValores = sessao.pode('os.financeiro.ver');
  el.innerHTML = `
    <div class="head"><div><a class="btn link" href="#ordens" style="padding-left:0">← Ordens de serviço</a>
        <h1>${salva ? 'OS ' + nOS(f.numero) + tagUn(os?.unidade_sigla) : 'Nova ordem de serviço'}</h1>
        <p>${salva ? `Aberta em ${dataBR(f.aberta_em)}${os?.unidade_nome && sessao.unidades.length > 1 ? ' · ' + esc(os.unidade_nome) : ''} · ${pill(f.status)}`
          : sessao.unidades.length > 1 ? (sessao.unidade ? `Será aberta em <b>${esc(sessao.unidades.find(u => u.id === sessao.unidade)?.nome || '')}</b>. O número é gerado ao salvar.` : '<b>Escolha a unidade no topo da tela antes de salvar.</b>') : 'O número é gerado ao salvar.'}</p></div>
      <div class="row nao-imprimir">${salva ? `<a class="btn" href="#ordens/${f.id}/imprimir">Documentos / PDF</a><a class="btn" href="#ordens/${f.id}/etiquetas">Etiquetas</a>` : ''}
        ${ed ? `<button class="btn pri" data-a="salvar">${salva ? 'Salvar alterações' : 'Salvar OS'}</button>` : ''}</div></div>
    ${salva ? painelStatus(ctx) : ''}
    <div class="panel"><h2>Cliente e prazos</h2>
      <div class="grid g2">
        <div class="field"><label class="req" for="f-cli-busca">Cliente</label>${seletorCliente(ctx, ed)}</div>
        <div class="grid g2" style="gap:10px">
          <div class="field"><label for="f-aberta">Abertura</label><input type="date" class="in" id="f-aberta" value="${f.aberta_em}" max="${sessao.hoje}" ${ed ? '' : 'disabled'}></div>
          <div class="field"><label for="f-resp">Responsável pela OS</label><select class="in" id="f-resp" ${ed ? '' : 'disabled'}>${opcoes(cfg().usuarios, f.responsavel_id, '— ninguém —')}</select></div>
        </div>
      </div>
      <div class="field"><label class="req" for="f-prazo">Prazo de entrega</label>
        <div class="row"><input type="date" class="in" id="f-prazo" value="${f.prazo}" min="${f.aberta_em}" style="width:auto" ${ed ? '' : 'disabled'}>
          <span class="ajuda">Ocupação dos próximos dias (máx. ${cfg().atelie.capacidade_diaria} entregas por dia):</span></div>
        <div class="strip" id="strip"></div><div id="prazo-aviso"></div></div>
    </div>
    <div class="panel"><div class="panel-h"><h2>Peças e serviços</h2>${ed ? '<button class="btn sm" data-a="add-peca">+ Adicionar peça</button>' : ''}</div>
      <div id="pecas" style="display:flex;flex-direction:column;gap:12px">${f.itens.map((it, i) => blocoPeca(ctx, it, i)).join('')}</div>
      <div class="grid g2" style="align-items:start">
        <div class="field"><label for="f-obs">Observações da OS</label><textarea class="in" id="f-obs" ${ed ? '' : 'disabled'} placeholder="Ex.: tecido da cliente, cuidado com a renda">${esc(f.observacoes)}</textarea></div>
        ${verValores ? `<div class="totais" id="totais">
          <span class="k">Soma dos serviços</span><span class="v num" id="t-soma"></span>
          <label class="k" for="f-desc">Desconto (R$)</label><input class="in num v" id="f-desc" inputmode="decimal" value="${valorParaCampo(f.desconto_centavos)}" style="width:120px;justify-self:end;text-align:right" ${ed && podePreco() ? '' : 'disabled'} ${podePreco() ? '' : 'title="Somente o administrador pode dar desconto"'}>
          <span class="k"><b>Total</b></span><span class="v num big" id="t-total"></span>
          <span class="k">Pago</span><span class="v num" id="t-pago" style="color:var(--ok)"></span>
          <span class="k"><b>Falta pagar</b></span><span class="v num big" id="t-saldo"></span></div>` : ''}
      </div>
    </div>
    ${salva && verValores ? painelPagamentos(ctx) : ''}
    ${salva ? painelAgendaMateriais(ctx) : ''}
    ${salva && sessao.pode('fotos.ver') ? painelFotos(ctx) : ''}
    ${salva ? painelHistorico(ctx) : ''}
    ${ed ? `<div class="row nao-imprimir" style="justify-content:flex-end"><button class="btn pri" data-a="salvar">${salva ? 'Salvar alterações' : 'Salvar OS'}</button></div>` : ''}`;
  atualizarTotais(ctx);
  desenharFaixa(ctx);
}

function seletorCliente(ctx, ed) {
  const c = ctx.f.cliente;
  const info = c ? [c.telefone ? formatarTelefone(c.telefone) : 'sem telefone', c.observacoes].filter(Boolean).map(esc).join(' · ') : '';
  if (!ed) return `<div><b>${esc(c?.nome || '')}</b>${info ? `<div class="ajuda">${info}</div>` : ''}${c?.id && sessao.pode('clientes.ver') ? ` <a href="#clientes/${c.id}" class="btn link sm">ver ficha</a>` : ''}</div>`;
  return `<div style="position:relative"><div class="row" style="flex-wrap:nowrap">
      <input class="in" id="f-cli-busca" type="search" autocomplete="off" placeholder="Digite nome ou telefone" value="${esc(c?.nome || '')}">
      ${sessao.pode('clientes.editar') ? '<button class="btn sm" type="button" data-a="nova-cliente">+ Nova</button>' : ''}</div>
    <div id="cli-res" class="busca-res" hidden></div>
    <div class="ajuda" id="cli-info">${info}</div></div>`;
}

function blocoPeca(ctx, it, i) {
  const ed = editavel(ctx);
  const salva = !!ctx.f.id;
  const verValores = sessao.pode('os.financeiro.ver');
  const servOpts = cfg().categorias_servico.filter(c => c.ativo).map(c => {
    const svs = cfg().servicos.filter(s => s.categoria_id === c.id && (s.ativo || it.servicos.some(x => x.service_id === s.id)));
    return svs.length ? `<optgroup label="${esc(c.nome)}">${svs.map(s => `<option value="${s.id}">${esc(s.nome)}${verValores && s.preco_centavos !== undefined ? ' — ' + brl(s.preco_centavos) : ''}</option>`).join('')}</optgroup>` : '';
  }).join('');
  const prodPode = salva && it.id && sessao.pode('producao.atualizar') && (sessao.eu.papel !== 'costureira' || it.responsavel_id === sessao.eu.id);
  return `<div class="peca" data-i="${i}">
    <div class="peca-h"><div class="row"><b>Peça ${i + 1}</b>${it.codigo ? `<span class="codigo">código ${esc(it.codigo)}</span>` : ''}${it.status_producao ? pillProd(it.status_producao) : ''}
      ${it.urgente ? '<span class="pill p-crit">urgente</span>' : ''}${it.tempo_real_min ? `<span class="ajuda">feito ${duracao(it.tempo_real_min)}</span>` : ''}${it.retrabalhos ? `<span class="ajuda">${it.retrabalhos} retrabalho(s)</span>` : ''}</div>
      ${ed && ctx.f.itens.length > 1 && (!it.status_producao || it.status_producao === 'aguardando') ? `<button class="btn sm danger" type="button" data-a="rm-peca" data-i="${i}">Remover peça</button>` : ''}</div>
    <div class="grid g3" style="gap:10px">
      <div class="field"><label class="req" for="p-${i}-peca">Peça</label><input class="in" id="p-${i}-peca" data-p="peca" value="${esc(it.peca)}" placeholder="Ex.: Calça jeans azul" ${ed ? '' : 'disabled'}></div>
      <div class="field"><label for="p-${i}-prazo">Prazo próprio (opcional)</label><input class="in" type="date" id="p-${i}-prazo" data-p="prazo" value="${it.prazo || ''}" ${ed ? '' : 'disabled'}></div>
      <div class="field"><label for="p-${i}-resp">Costureira responsável</label><select class="in" id="p-${i}-resp" data-p="responsavel_id" ${ed || (salva && sessao.pode('producao.atribuir') && !['entregue', 'cancelada'].includes(ctx.f.status)) ? '' : 'disabled'}>${opcoes(cfg().usuarios, it.responsavel_id, '— a definir —')}</select></div>
    </div>
    <div class="field"><label for="p-${i}-desc">Descrição / observações da peça</label><input class="in" id="p-${i}-desc" data-p="descricao" value="${esc(it.descricao)}" placeholder="Ex.: barra 3 cm mais curta, manter a barra original" ${ed ? '' : 'disabled'}></div>
    <div class="sv sv-h"><span>Serviço do catálogo</span><span>Descrição</span><span>Unid.</span><span>Qtd</span>${verValores ? '<span>Valor un. (R$)</span><span style="text-align:right">Subtotal</span>' : '<span></span><span></span>'}<span></span></div>
    ${it.servicos.map((s, j) => `<div class="sv" data-j="${j}">
      <select class="in" data-s="service_id" aria-label="Serviço do catálogo" ${ed ? '' : 'disabled'}><option value="">${podePreco() ? 'Item livre (fora do catálogo)' : 'Escolha o serviço…'}</option>${servOpts.replace(`value="${s.service_id}"`, `value="${s.service_id}" selected`)}</select>
      <input class="in sv-desc" data-s="descricao" value="${esc(s.descricao)}" placeholder="Ex.: Barra italiana" aria-label="Descrição do serviço" ${ed ? '' : 'disabled'}>
      <select class="in" data-s="unidade" aria-label="Unidade" ${ed ? '' : 'disabled'}>${Object.entries(UNIDADES).map(([k, l]) => `<option value="${k}" ${s.unidade === k ? 'selected' : ''} title="${l}">${k}</option>`).join('')}</select>
      <input class="in num" data-s="quantidade" inputmode="decimal" value="${esc(s.quantidade)}" aria-label="Quantidade" ${ed ? '' : 'disabled'}>
      ${verValores ? `<input class="in num" data-s="valor" inputmode="decimal" value="${valorParaCampo(s.valor)}" aria-label="Valor unitário" ${ed && podePreco() ? '' : 'disabled'} ${podePreco() ? '' : 'title="Preço do catálogo — só o administrador altera"'}>
      <span class="sub num" data-sub></span>` : '<span></span><span></span>'}
      ${ed && it.servicos.length > 1 ? `<button class="x" type="button" data-a="rm-serv" data-j="${j}" aria-label="Remover serviço" title="Remover serviço">×</button>` : '<span></span>'}
    </div>`).join('')}
    <div class="row" style="justify-content:space-between">${ed ? '<button class="btn sm" type="button" data-a="add-serv">+ Serviço nesta peça</button>' : '<span></span>'}
      ${prodPode && ['recebida', 'aguardando_aprovacao'].includes(ctx.f.status) ? '<span class="ajuda">Aprove a OS para iniciar a produção.</span>' : ''}
      ${prodPode && STATUS_DE_PRODUCAO.includes(ctx.f.status) ? `<label class="prod">Produção: <select class="in" data-a-prod data-item="${it.id}" style="width:auto">${Object.entries(STATUS_PRODUCAO).map(([k, l]) => `<option value="${k}" ${it.status_producao === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}</div>
  </div>`;
}

function painelStatus(ctx) {
  const { f, os } = ctx;
  const trans = sessao.pode('os.status') ? transicoesManuais(f.status) : [];
  const idx = FLUXO_OS.indexOf(f.status);
  const rot = { aguardando_aprovacao: 'Pedir aprovação', aprovada: 'Aprovar orçamento', recebida: 'Voltar para recebida', entregue: 'Registrar entrega', pausada: 'Pausar', retomar: 'Retomar', cancelada: 'Cancelar OS' };
  const fluxo = ['pausada', 'cancelada'].includes(f.status)
    ? `<span class="on" style="background:var(--${f.status === 'cancelada' ? 'crit' : 'warn'})">${STATUS_OS[f.status]}</span>`
    : FLUXO_OS.map((s, i) => `<span class="${i === idx ? 'on' : i < idx ? 'done' : ''}">${STATUS_OS[s]}</span>`).join('<span style="background:none;padding:0">›</span>');
  return `<div class="panel nao-imprimir"><div class="flow">${fluxo}</div>
    ${f.status === 'aprovada' || f.status === 'em_producao' ? '<p class="ajuda" style="margin:0">A situação avança sozinha conforme a produção de cada peça é atualizada.</p>' : ''}
    ${os.motivo && ['cancelada', 'pausada'].includes(f.status) ? `<div class="alert ${f.status === 'cancelada' ? 'a-crit' : 'a-warn'}">Motivo: ${esc(os.motivo)}</div>` : ''}
    <div class="row">${trans.map(t => `<button class="btn sm ${t === 'cancelada' ? 'danger' : t === 'entregue' || t === 'aprovada' ? 'pri' : t === 'pausada' || t === 'retomar' ? 'sec' : ''}" data-a="status" data-st="${t}">${rot[t] || STATUS_OS[t]}</button>`).join('')}
      ${sessao.pode('whatsapp.usar') ? blocoWhatsApp(ctx) : ''}</div></div>`;
}

/* ---------------------------------------------------------------- WhatsApp */
function dadosMensagem(ctx) {
  const { f, os } = ctx;
  return { atelie: cfg().atelie.nome, cliente: os.cliente.nome, numero: f.numero, pecas: f.itens.map(i => i.peca), total: os.total, saldo: Math.max(0, os.saldo ?? 0), prazo: f.prazo };
}
function blocoWhatsApp(ctx) {
  const fone = numeroWhatsApp(ctx.os.cliente);
  if (!fone) return `<button class="btn sm wa" disabled title="Cadastre um telefone válido na ficha da cliente">WhatsApp indisponível</button>
    <span class="ajuda">Cadastre um telefone válido na ficha da cliente para usar o WhatsApp.</span>`;
  const principal = ctx.f.status === 'pronta' ? 'pronta' : ctx.f.status === 'entregue' ? 'agradecimento' : ctx.f.status === 'aguardando_aprovacao' ? 'aprovacao' : ctx.f.status === 'aguardando_prova' ? 'prova' : 'recebimento';
  return `<button class="btn sm wa" data-a="wa" data-modelo="${principal}">${principal === 'pronta' ? 'Avisar que está pronta' : 'WhatsApp: ' + MODELOS_MENSAGEM[principal].toLowerCase()}</button>
    <button class="btn sm ghost" data-a="wa-outras">Outras mensagens</button>`;
}
async function abrirWhatsApp(ctx, modelo, prova) {
  const prox = prova || ctx.os.compromissos?.find(c => c.tipo === 'prova' && c.status === 'agendado' && c.dia >= sessao.hoje);
  const texto = montarMensagem(modelo, { ...dadosMensagem(ctx), dataProva: prox?.dia, horaProva: prox?.hora_inicio });
  const link = linkWhatsApp(numeroWhatsApp(ctx.os.cliente), texto);
  if (!link) return toast('Telefone da cliente inválido.', true);
  modal({
    title: 'Mensagem para ' + ctx.os.cliente.nome.split(' ')[0], body: `<div class="field"><label for="wa-txt">Confira o texto antes de abrir o WhatsApp</label>
      <textarea class="in" id="wa-txt" rows="5">${esc(texto)}</textarea></div>
      <p class="ajuda" style="margin:8px 0 0">O sistema só abre o WhatsApp com o texto pronto. O envio é feito por você no aplicativo.</p>`,
    actions: [{ label: 'Voltar' }, { label: 'Abrir WhatsApp', cls: 'wa', fn: async m => {
      const t = $('#wa-txt', m).value.trim();
      window.open(linkWhatsApp(numeroWhatsApp(ctx.os.cliente), t), '_blank', 'noopener');
      await api(`/ordens/${ctx.f.id}/mensagens`, { corpo: { modelo, texto: t } }).catch(() => {});
      toast('WhatsApp aberto. Envie a mensagem no aplicativo.');
    } }],
  });
}

/* ---------------------------------------------------------------- agenda e materiais da OS */
function painelAgendaMateriais(ctx) {
  const { os, f } = ctx;
  const aberta = !['entregue', 'cancelada'].includes(f.status);
  const verCusto = sessao.pode('os.financeiro.ver');
  const comps = os.compromissos || [];
  const mats = os.materiais || [];
  const custoMat = mats.reduce((s, m) => s + (-m.quantidade * (m.custo_unitario_centavos || 0)), 0);
  return `<div class="grid g2">
    <div class="panel"><div class="panel-h"><h2>Provas e compromissos</h2>${sessao.pode('agenda.editar') && aberta ? `<div class="row">
        <button class="btn sm pri" data-a="agendar" data-tipo="prova">+ Agendar prova</button><button class="btn sm ghost" data-a="agendar" data-tipo="retirada">+ Outro</button></div>` : ''}</div>
      ${comps.length ? `<div class="list">${comps.map(c => `<div class="li" ${sessao.pode('agenda.editar') ? `data-a="comp" data-id="${c.id}"` : ''}><div><div class="t">${dataBR(c.dia)}${c.hora_inicio ? ' · ' + esc(c.hora_inicio) : ''} — ${esc(TIPOS_AGENDA[c.tipo])}</div>
          <div class="s">${esc(c.profissional || '')}${c.status !== 'agendado' ? ' · ' + esc(c.status) : ''}</div></div>
          ${c.tipo === 'prova' && c.status === 'agendado' && sessao.pode('whatsapp.usar') && numeroWhatsApp(os.cliente) ? `<button class="btn sm wa" data-a="wa-prova" data-id="${c.id}">Lembrar</button>` : ''}</div>`).join('')}</div>`
        : '<div class="empty">Nada agendado para esta OS.</div>'}</div>
    <div class="panel"><div class="panel-h"><h2>Materiais usados</h2>${sessao.pode('estoque.consumir') && f.status !== 'cancelada' ? '<button class="btn sm pri" data-a="material">+ Lançar material</button>' : ''}</div>
      ${mats.length ? `<div class="tw"><table><thead><tr><th>Material</th><th>Peça</th><th class="r">Qtd</th>${verCusto ? '<th class="r">Custo</th>' : ''}<th></th></tr></thead><tbody>
        ${mats.map(m => `<tr><td>${esc(m.nome)}${m.tipo === 'reversao' ? ' <span class="pill p-warn">reversão</span>' : ''}</td><td class="num">${esc(f.itens.find(i => i.id === m.item_id)?.codigo || '—')}</td>
          <td class="r num">${String(Math.round(-m.quantidade * 1000) / 1000).replace('.', ',')} ${esc(m.unidade)}</td>
          ${verCusto ? `<td class="r num">${brl(-m.quantidade * (m.custo_unitario_centavos || 0))}</td>` : ''}
          <td class="r">${m.revertido_por ? '<span class="pill p-muted">Revertido</span>' : m.tipo === 'consumo' && sessao.pode('estoque.movimentar') ? `<button class="btn sm ghost" data-a="rev-mat" data-id="${m.id}">Desfazer</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
        ${verCusto ? `<p class="ajuda" style="margin:0">Custo de materiais desta OS: <b>${brl(custoMat)}</b>${os.total ? ` · margem antes da mão de obra: <b>${brl(os.total - custoMat)}</b>` : ''}</p>` : ''}`
        : '<div class="empty">Nenhum material lançado.</div>'}</div></div>`;
}

async function modalConsumo(ctx) {
  const { materiais } = await api('/estoque/materiais');
  const chave = novaChave();
  const ativos = materiais.filter(m => m.ativo);
  if (!ativos.length) return toast('Nenhum material cadastrado no estoque.', true);
  modal({
    title: 'Lançar material usado',
    body: `<div class="grid" style="gap:12px">
      <div class="field"><label for="cm-mat">Material</label><select class="in" id="cm-mat">${ativos.map(m => `<option value="${m.id}">${esc(m.nome)} — saldo ${String(m.quantidade).replace('.', ',')} ${esc(m.unidade)}</option>`).join('')}</select></div>
      <div class="field"><label for="cm-qtd">Quantidade</label><input class="in num" id="cm-qtd" inputmode="decimal" placeholder="ex.: 1,5"></div>
      <div class="field"><label for="cm-peca">Peça</label><select class="in" id="cm-peca"><option value="">OS inteira</option>${ctx.f.itens.map(i => `<option value="${i.id}">${esc(i.codigo + ' · ' + i.peca)}</option>`).join('')}</select></div>
      ${sessao.pode('estoque.negativo') ? '<label class="chk"><input type="checkbox" id="cm-neg"> Autorizar saldo negativo</label>' : ''}</div>`,
    actions: [{ label: 'Voltar' }, { label: 'Lançar', cls: 'pri', fn: async m => {
      const q = Number($('#cm-qtd', m).value.trim().replace(',', '.'));
      if (!(q > 0)) { toast('Informe a quantidade.', true); return false; }
      try {
        await api('/estoque/consumos', { chave, corpo: { order_id: ctx.f.id, item_id: $('#cm-peca', m).value || null, material_id: $('#cm-mat', m).value, quantidade: Math.round(q * 1000) / 1000,
          autorizar_negativo: $('#cm-neg', m)?.checked || undefined } });
      } catch (e) { toast(e.message, true); return false; }
      toast('Material lançado na OS.');
      await ctx.recarregar();
    } }],
  });
}

function modalReverterConsumo(ctx, id) {
  const chave = novaChave();
  modal({
    title: 'Desfazer lançamento de material',
    body: '<p style="margin:0 0 10px">O material volta para o estoque. O lançamento original continua no histórico.</p><div class="field"><label class="req" for="rv-mot">Motivo</label><input class="in" id="rv-mot" placeholder="ex.: lançado na OS errada"></div>',
    actions: [{ label: 'Voltar' }, { label: 'Desfazer', cls: 'danger-solid', fn: async m => {
      try { await api(`/estoque/movimentos/${id}/reverter`, { chave, corpo: { motivo: $('#rv-mot', m).value.trim() } }); } catch (e) { toast(e.message, true); return false; }
      toast('Material devolvido ao estoque.');
      await ctx.recarregar();
    } }],
  });
}

/* ---------------------------------------------------------------- pagamentos */
function painelPagamentos(ctx) {
  const { os, f } = ctx;
  const podeEstornar = sessao.pode('financeiro.estornar');
  return `<div class="panel"><div class="panel-h"><h2>Pagamentos</h2>
      ${f.status !== 'cancelada' && sessao.pode('pagamentos.receber') ? '<button class="btn pri sm" data-a="pagar">Registrar pagamento</button>' : ''}</div>
    ${os.credito_cliente > 0 ? `<div class="alert a-info">Esta cliente tem ${brl(os.credito_cliente)} de crédito. Use a forma "Crédito da cliente" para abater.</div>` : ''}
    ${os.pagamentos.length ? `<div class="tw"><table><thead><tr><th>Data</th><th>Descrição</th><th>Forma</th><th>Por</th><th class="r">Valor</th><th></th></tr></thead><tbody>
      ${os.pagamentos.map(p => `<tr><td>${dataBR(p.data)}</td><td>${esc(p.descricao)}</td><td>${esc(p.forma)}</td><td class="muted">${esc(p.usuario || '')}</td>
        <td class="r num" style="color:${p.tipo === 'entrada' ? 'var(--ok)' : 'var(--crit)'};white-space:nowrap">${p.tipo === 'entrada' ? '' : '− '}${brl(p.valor_centavos)}</td>
        <td class="r">${p.estornado_por ? '<span class="pill p-muted">Estornado</span>' : p.estorno_de ? '<span class="pill p-warn">Estorno</span>'
          : podeEstornar ? `<button class="btn sm" data-a="estornar" data-id="${p.id}">Estornar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Nenhum pagamento registrado.</div>'}</div>`;
}

async function modalPagamento(ctx) {
  const { os } = ctx;
  const saldo = Math.max(0, os.saldo);
  const formas = cfg().formas_pagamento.filter(fp => fp.ativo && (!fp.eh_credito_cliente || os.credito_cliente > 0));
  const chave = novaChave();
  const podeCredito = sessao.pode('financeiro.lancar');
  modal({
    title: 'Registrar pagamento · ' + nOS(os.numero),
    body: `<div class="grid" style="gap:12px">
      <p class="muted" style="margin:0">Total ${brl(os.total)} · pago ${brl(os.pago)} · <b>falta ${brl(saldo)}</b></p>
      <div class="field"><label class="req" for="m-val">Valor recebido (R$)</label><input class="in num" id="m-val" inputmode="decimal" value="${valorParaCampo(saldo)}"></div>
      <div class="field"><label for="m-forma">Forma de pagamento</label><select class="in" id="m-forma">${formas.map(fp => `<option value="${fp.id}">${esc(fp.nome)}${fp.eh_credito_cliente ? ` (disponível ${brl(os.credito_cliente)})` : ''}</option>`).join('')}</select></div>
      <div id="m-exc" hidden class="alert a-warn"></div>
      <label class="chk" id="m-cred-l" hidden><input type="checkbox" id="m-cred"> <span id="m-cred-t"></span></label></div>`,
    onOpen: m => {
      const conferir = () => {
        const v = lerValor($('#m-val', m).value) ?? 0;
        const forma = cfg().formas_pagamento.find(x => x.id === $('#m-forma', m).value);
        const exc = v - saldo;
        const mostrar = exc > 0;
        $('#m-exc', m).hidden = !mostrar;
        $('#m-exc', m).textContent = mostrar ? `O valor passa do saldo devido em ${brl(exc)}. Por padrão o sistema não aceita valor acima do saldo.` : '';
        const cred = mostrar && podeCredito && !forma?.eh_credito_cliente;
        $('#m-cred-l', m).hidden = !cred;
        $('#m-cred-t', m).textContent = `Recebi ${brl(v)} e quero guardar ${brl(exc)} como crédito da cliente`;
        if (!cred) $('#m-cred', m).checked = false;
      };
      m.addEventListener('input', conferir);
      m.addEventListener('change', conferir);
    },
    actions: [{ label: 'Voltar' }, { label: 'Registrar', cls: 'pri', fn: async m => {
      const v = lerValor($('#m-val', m).value);
      if (!v) { toast('Informe um valor maior que zero.', true); return false; }
      const excede = v > saldo;
      if (excede && !$('#m-cred', m).checked) { toast(`O valor máximo para esta OS é ${brl(saldo)}.`, true); return false; }
      try {
        await api(`/ordens/${os.id}/pagamentos`, { chave, corpo: { valor_centavos: v, forma_id: $('#m-forma', m).value, excedente: excede ? 'credito' : 'bloquear' } });
      } catch (e) {
        if (e.codigo === 'caixa_fechado') {
          fecharModal();
          return modalAbrirCaixa(() => modalPagamento(ctx)) && 'manter';
        }
        toast(e.message, true);
        return false;
      }
      toast(`${brl(v)} registrado no caixa de hoje.`);
      await ctx.recarregar();
    } }],
  });
}

export function modalAbrirCaixa(depois) {
  modal({
    title: 'Abrir o caixa de hoje',
    body: `<p style="margin:0 0 12px">O caixa de ${dataBR(sessao.hoje)} ainda não foi aberto (ou já foi fechado). Informe o troco inicial em dinheiro.</p>
      <div class="field"><label for="m-troco">Troco inicial (R$)</label><input class="in num" id="m-troco" inputmode="decimal" value="0,00"></div>`,
    actions: [{ label: 'Voltar' }, { label: 'Abrir caixa', cls: 'pri', fn: async m => {
      const v = lerValor($('#m-troco', m).value);
      if (v === null) { toast('Valor inválido.', true); return false; }
      try {
        await api('/caixa/abrir', { corpo: { saldo_inicial_centavos: v } });
      } catch (e) { toast(e.message, true); return false; }
      toast('Caixa aberto.');
      if (depois) setTimeout(depois, 0);
    } }],
  });
  return true;
}

export async function modalEstorno(id, aoConcluir) {
  const chave = novaChave();
  modal({
    title: 'Estornar lançamento',
    body: `<p style="margin:0 0 12px">Será criado um lançamento de correção no caixa de hoje. O original continua no histórico e não é apagado.</p>
      <div class="field"><label class="req" for="m-mot">Motivo do estorno</label><input class="in" id="m-mot" placeholder="Ex.: valor digitado errado"></div>`,
    actions: [{ label: 'Voltar' }, { label: 'Estornar', cls: 'danger-solid', fn: async m => {
      const motivo = $('#m-mot', m).value.trim();
      if (motivo.length < 3) { toast('Informe o motivo.', true); return false; }
      try {
        await api(`/financeiro/lancamentos/${id}/estorno`, { chave, corpo: { motivo } });
      } catch (e) {
        if (e.codigo === 'caixa_fechado') { fecharModal(); return modalAbrirCaixa(() => modalEstorno(id, aoConcluir)) && 'manter'; }
        toast(e.message, true);
        return false;
      }
      toast('Lançamento estornado.');
      await aoConcluir();
    } }],
  });
}

/* ---------------------------------------------------------------- fotos */
const CAT_FOTO = { entrada: 'Entrada', defeito: 'Defeito existente', referencia: 'Referência', durante: 'Durante o serviço', concluida: 'Concluída' };
function painelFotos(ctx) {
  const { os, f } = ctx;
  const podeEnviar = sessao.pode('fotos.enviar') && !['cancelada'].includes(f.status);
  return `<div class="panel"><div class="panel-h"><h2>Fotos</h2><span class="ajuda">As fotos só aparecem para quem está logado.</span></div>
    ${os.fotos.length ? `<div class="fotos">${os.fotos.map(ft => {
      const peca = f.itens.find(i => i.id === ft.item_id);
      return `<figure><img src="/api/fotos/${ft.id}" alt="${esc(CAT_FOTO[ft.categoria])}${peca ? ' — ' + esc(peca.peca) : ''}" loading="lazy" data-foto="${ft.id}">
        <figcaption>${esc(CAT_FOTO[ft.categoria])}${peca ? ' · ' + esc(peca.codigo || peca.peca) : ''}</figcaption></figure>`;
    }).join('')}</div>` : '<div class="empty">Nenhuma foto ainda. Fotografe a peça na entrada para registrar o estado dela.</div>'}
    ${podeEnviar ? `<div class="row">
      <select class="in" id="ft-cat" style="width:auto" aria-label="Tipo de foto">${Object.entries(CAT_FOTO).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <select class="in" id="ft-peca" style="width:auto" aria-label="Peça">${f.itens.length > 1 ? '<option value="">OS inteira</option>' : ''}${f.itens.map(i => `<option value="${i.id}">${esc(i.codigo + ' · ' + i.peca)}</option>`).join('')}</select>
      <label class="btn pri sm" style="cursor:pointer">📷 Tirar ou escolher foto<input type="file" id="ft-arq" accept="image/jpeg,image/png,image/webp,image/heic,image/*" capture="environment" multiple hidden></label>
      <span id="ft-prog" class="ajuda"></span></div>` : ''}</div>`;
}

/** Reduz a foto para no máximo 2000 px e regrava em JPEG (remove dados de localização do celular). */
async function comprimir(arquivo) {
  const img = await createImageBitmap(arquivo);
  const escala = Math.min(1, 2000 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * escala);
  c.height = Math.round(img.height * escala);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  img.close?.();
  return new Promise((ok, falha) => c.toBlob(b => (b ? ok(b) : falha(new Error('Não foi possível ler a foto.'))), 'image/jpeg', 0.86));
}

async function enviarFotos(ctx, arquivos) {
  const prog = $('#ft-prog');
  const cat = $('#ft-cat').value;
  const peca = $('#ft-peca').value || (ctx.f.itens.length === 1 ? ctx.f.itens[0].id : '');
  let n = 0;
  for (const a of arquivos) {
    prog.textContent = `Enviando ${++n} de ${arquivos.length}…`;
    try {
      const blob = await comprimir(a);
      const fd = new FormData();
      fd.append('arquivo', new File([blob], 'foto.jpg', { type: 'image/jpeg' }));
      fd.append('categoria', cat);
      if (peca) fd.append('item_id', peca);
      await api(`/ordens/${ctx.f.id}/fotos`, { form: fd });
    } catch (e) {
      toast(`Foto ${n}: ${e.message}`, true);
    }
  }
  prog.textContent = '';
  toast('Fotos salvas.');
  await ctx.recarregar();
}

/* ---------------------------------------------------------------- histórico */
function painelHistorico(ctx) {
  const { os } = ctx;
  const nomePeca = id => ctx.f.itens.find(i => i.id === id)?.codigo;
  return `<div class="panel"><h2>Histórico</h2><div class="hist">
    ${os.historico.map(h => `<div><span class="muted num">${dataHora(h.em)}</span><span>${h.item_id ? `Peça ${esc(nomePeca(h.item_id) || '')}: ${esc(STATUS_PRODUCAO[h.de] || h.de || '')} → ${esc(STATUS_PRODUCAO[h.para] || h.para)}`
      : `${h.de ? esc(STATUS_OS[h.de] || h.de) + ' → ' : ''}${esc(STATUS_OS[h.para] || h.para)}`}</span>
      ${h.motivo ? `<span class="muted">(${esc(h.motivo)})</span>` : ''}<span class="muted">${esc(h.usuario || '')}</span></div>`).join('')}
    ${os.mensagens.map(m => `<div><span class="muted num">${dataHora(m.criado_em)}</span><span>WhatsApp aberto: ${esc(MODELOS_MENSAGEM[m.modelo] || m.modelo)}</span><span class="muted">${esc(m.usuario || '')}</span></div>`).join('')}
  </div></div>`;
}

/* ---------------------------------------------------------------- faixa de ocupação */
async function desenharFaixa(ctx) {
  const { f } = ctx;
  const ed = editavel(ctx);
  const ini = sessao.hoje;
  if (!ctx.ocupacao) {
    const ag = await api(`/agenda?de=${ini}&ate=${somarDias(ini, 13)}`).catch(() => null);
    if (!ag) return;
    ctx.ocupacao = Object.fromEntries(ag.ocupacao.map(o => [o.prazo, o.qtd]));
    ctx.prazoOriginal = f.id ? (ctx.os.status === 'cancelada' ? null : ctx.os.prazo) : null;
  }
  const strip = $('#strip', ctx.el);
  if (!strip) return;
  const cap = cfg().atelie.capacidade_diaria;
  const lim = cfg().atelie.limite_quase_cheio;
  const qtd = d => (ctx.ocupacao[d] || 0) - (d === ctx.prazoOriginal ? 1 : 0);
  let h = '';
  for (let k = 0; k < 14; k++) {
    const d = somarDias(ini, k);
    const n = qtd(d);
    const s = situacaoDia(n, cap, lim);
    h += `<button type="button" class="chip ${d === f.prazo ? 'sel' : ''}" data-a="prazo" data-d="${d}" ${ed ? '' : 'disabled'}>
      <span class="w">${dataSemana(d).split(',')[0]}</span><span class="d">${dataBR(d).slice(0, 5)}</span><span class="c s-${s}">${n}/${cap}</span></button>`;
  }
  strip.innerHTML = h;
  const n = qtd(f.prazo);
  const s = situacaoDia(n, cap, lim);
  $('#prazo-aviso', ctx.el).innerHTML = f.prazo < f.aberta_em ? '<div class="alert a-crit">O prazo não pode ser antes da abertura.</div>'
    : s === 'lotado' ? `<div class="alert a-crit">${dataSemana(f.prazo)} já tem ${n} de ${cap} entregas. Dá para encaixar, com confirmação.</div>`
      : s === 'quase' ? `<div class="alert a-warn">${dataSemana(f.prazo)} está quase cheio: ${n} de ${cap}.</div>` : '';
}

function atualizarTotais(ctx) {
  if (!sessao.pode('os.financeiro.ver')) return;
  const { f, el } = ctx;
  const t = totaisModelo(f, ctx.os?.pago || 0);
  $$('.peca', el).forEach((p, i) => $$('.sv[data-j]', p).forEach((row, j) => {
    const s = f.itens[i]?.servicos[j];
    if (!s) return;
    const q = lerQuantidade(s.quantidade, s.unidade);
    const sub = $('[data-sub]', row);
    if (sub) sub.textContent = q === null ? 'qtd. inválida' : brl(subtotal(q, s.valor || 0));
    $('[data-s="quantidade"]', row)?.setAttribute('aria-invalid', q === null ? 'true' : 'false');
  }));
  if (!$('#t-soma', el)) return;
  $('#t-soma', el).textContent = brl(t.soma);
  $('#t-total', el).textContent = brl(t.total);
  $('#t-total', el).style.color = t.total < 0 ? 'var(--crit)' : '';
  $('#t-pago', el).textContent = brl(t.pago);
  $('#t-saldo', el).textContent = brl(Math.max(0, t.saldo));
  $('#t-saldo', el).style.color = t.saldo > 0 ? 'var(--warn)' : 'var(--ok)';
}

/* ---------------------------------------------------------------- validação e envio */
function validar(ctx) {
  const { f, el } = ctx;
  $$('[aria-invalid="true"]', el).forEach(x => x.setAttribute('aria-invalid', 'false'));
  const erro = (sel, msg) => {
    const campo = sel && $(sel, el);
    campo?.setAttribute('aria-invalid', 'true');
    campo?.focus();
    toast(msg, true);
    return false;
  };
  if (!f.client_id) return erro('#f-cli-busca', 'Escolha a cliente.');
  if (!f.prazo) return erro('#f-prazo', 'Informe o prazo de entrega.');
  if (f.prazo < f.aberta_em) return erro('#f-prazo', 'O prazo não pode ser antes da abertura.');
  for (const [i, it] of f.itens.entries()) {
    if (!it.peca.trim()) return erro(`#p-${i}-peca`, `Informe o nome da peça ${i + 1}.`);
    for (const [j, s] of it.servicos.entries()) {
      const sel = `.peca[data-i="${i}"] .sv[data-j="${j}"]`;
      if (!s.descricao.trim()) return erro(`${sel} [data-s="descricao"]`, `Descreva o serviço da peça ${i + 1}.`);
      if (lerQuantidade(s.quantidade, s.unidade) === null)
        return erro(`${sel} [data-s="quantidade"]`, s.unidade === 'un' ? 'Quantidade deve ser um número inteiro, no mínimo 1.' : 'Quantidade deve ser maior que zero.');
      if (!podePreco() && !s.service_id) return erro(`${sel} [data-s="service_id"]`, 'Escolha um serviço do catálogo.');
    }
  }
  const t = totaisModelo(f, ctx.os?.pago || 0);
  if (t.total < 0) return erro('#f-desc', 'O desconto é maior que a soma dos serviços.');
  return true;
}

function corpoEnvio(f, confirmarLotado) {
  return {
    client_id: f.client_id, aberta_em: f.aberta_em, prazo: f.prazo, responsavel_id: f.responsavel_id || null,
    desconto_centavos: f.desconto_centavos || 0, observacoes: f.observacoes, versao: f.versao, confirmar_lotado: confirmarLotado || undefined,
    itens: f.itens.map(it => ({
      id: it.id, peca: it.peca.trim(), descricao: it.descricao.trim(), prazo: it.prazo || null, responsavel_id: it.responsavel_id || null,
      servicos: it.servicos.map(s => ({ id: s.id, service_id: s.service_id || null, descricao: s.descricao.trim(), unidade: s.unidade,
        quantidade: lerQuantidade(s.quantidade, s.unidade), valor_unitario_centavos: s.valor || 0, tempo_min: s.tempo_min })),
    })),
  };
}

async function salvar(ctx, confirmarLotado = false) {
  const { f } = ctx;
  if (!validar(ctx)) return;
  try {
    if (!f.id) {
      const r = await api('/ordens', { chave: f._chave, corpo: corpoEnvio(f, confirmarLotado) });
      toast(`OS ${nOS(r.numero)} criada.`);
      location.hash = `ordens/${r.id}`;
    } else {
      const os = await api(`/ordens/${f.id}`, { metodo: 'PUT', corpo: corpoEnvio(f, confirmarLotado) });
      ctx.os = os;
      ctx.f = modeloDe(os);
      ctx.ocupacao = null;
      desenhar(ctx);
      toast('OS salva.');
    }
  } catch (e) {
    if (e.codigo === 'dia_lotado') {
      if (await confirmar('Dia lotado', esc(e.message), 'Encaixar mesmo assim')) return salvar(ctx, true);
      return;
    }
    toast(e.message, true);
  }
}

async function mudarStatus(ctx, para) {
  const { f, os } = ctx;
  const corpo = { para };
  if (para === 'cancelada' || para === 'pausada') {
    const verbo = para === 'cancelada' ? 'cancelar' : 'pausar';
    return modal({
      title: `${verbo[0].toUpperCase() + verbo.slice(1)} ${nOS(f.numero)}`,
      body: `${para === 'cancelada' && os.pago > 0 ? `<div class="alert a-warn" style="margin-bottom:10px">Esta OS tem ${brl(os.pago)} em pagamentos. Estorne-os antes de cancelar.</div>` : ''}
        <div class="field"><label class="req" for="m-mot">Motivo</label><textarea class="in" id="m-mot" placeholder="${para === 'cancelada' ? 'Ex.: cliente desistiu' : 'Ex.: aguardando tecido da cliente'}"></textarea></div>`,
      actions: [{ label: 'Voltar' }, { label: verbo === 'cancelar' ? 'Cancelar OS' : 'Pausar', cls: para === 'cancelada' ? 'danger-solid' : 'pri', fn: async m => {
        corpo.motivo = $('#m-mot', m).value.trim();
        if (!corpo.motivo) { toast('Informe o motivo.', true); return false; }
        return enviarStatus(ctx, corpo);
      } }],
    });
  }
  if (para === 'entregue' && os.saldo > 0) {
    if (!(await confirmar('Entregar com saldo pendente?', `Ainda faltam <b>${brl(os.saldo)}</b>. A OS continua em "A receber" até ser paga. Prefere registrar o pagamento antes?`, 'Entregar mesmo assim'))) return;
    corpo.confirmar_saldo_pendente = true;
  }
  return enviarStatus(ctx, corpo);
}
async function enviarStatus(ctx, corpo) {
  try {
    const os = await api(`/ordens/${ctx.f.id}/status`, { corpo });
    ctx.os = os;
    ctx.f = modeloDe(os);
    desenhar(ctx);
    toast(`Situação: ${STATUS_OS[os.status]}.`);
  } catch (e) {
    toast(e.message, true);
    return false;
  }
}

/* ---------------------------------------------------------------- eventos */
function ligarEventos(ctx) {
  const { el } = ctx;
  let buscaT;
  el.addEventListener('input', e => {
    const t = e.target;
    const f = ctx.f;
    if (t.id === 'f-cli-busca') {
      clearTimeout(buscaT);
      buscaT = setTimeout(() => buscarClientes(ctx, t.value), 250);
      return;
    }
    if (t.id === 'f-obs') f.observacoes = t.value;
    if (t.id === 'f-desc') { f.desconto_centavos = lerValor(t.value) ?? 0; atualizarTotais(ctx); }
    const peca = t.closest('.peca');
    if (!peca) return;
    const it = f.itens[+peca.dataset.i];
    if (t.dataset.p && t.dataset.p !== 'responsavel_id') it[t.dataset.p] = t.value;
    const row = t.closest('.sv[data-j]');
    if (row && t.dataset.s && t.tagName !== 'SELECT') {
      const s = it.servicos[+row.dataset.j];
      if (t.dataset.s === 'valor') s.valor = lerValor(t.value) ?? 0;
      else s[t.dataset.s] = t.value;
      atualizarTotais(ctx);
    }
  });

  el.addEventListener('change', async e => {
    const t = e.target;
    const f = ctx.f;
    if (t.id === 'f-aberta') { f.aberta_em = t.value; desenharFaixa(ctx); }
    if (t.id === 'f-prazo') { f.prazo = t.value; desenharFaixa(ctx); }
    if (t.id === 'f-resp') f.responsavel_id = t.value;
    if (t.id === 'ft-arq') {
      if (t.files.length) enviarFotos(ctx, [...t.files]);
      return;
    }
    if (t.matches('[data-a-prod]')) {
      const sel = t;
      sel.disabled = true;
      try {
        const os = await api(`/ordens/${f.id}/itens/${sel.dataset.item}`, { metodo: 'PATCH', corpo: { status_producao: sel.value } });
        ctx.os = os;
        ctx.f = modeloDe(os);
        desenhar(ctx);
        toast(`Peça: ${STATUS_PRODUCAO[sel.value]}. OS: ${STATUS_OS[os.status]}.`);
      } catch (err) {
        toast(err.message, true);
        sel.disabled = false;
        await ctx.recarregar();
      }
      return;
    }
    const peca = t.closest('.peca');
    if (!peca) return;
    const it = f.itens[+peca.dataset.i];
    if (t.dataset.p === 'responsavel_id') {
      // Em OS salva sem permissão de editar (ex.: só atribuir), grava direto na peça.
      if (f.id && !editavel(ctx)) {
        try {
          const os = await api(`/ordens/${f.id}/itens/${it.id}`, { metodo: 'PATCH', corpo: { responsavel_id: t.value || null } });
          ctx.os = os; ctx.f = modeloDe(os); desenhar(ctx); toast('Responsável atualizado.');
        } catch (err) { toast(err.message, true); }
        return;
      }
      it.responsavel_id = t.value;
    }
    const row = t.closest('.sv[data-j]');
    if (row && t.dataset.s === 'service_id') {
      const s = it.servicos[+row.dataset.j];
      s.service_id = t.value;
      const cat = servicoCat(t.value);
      if (cat) {
        s.descricao = cat.nome;
        s.unidade = cat.unidade;
        s.tempo_min = cat.tempo_min;
        if (cat.preco_centavos !== undefined) s.valor = cat.preco_centavos;
        $('[data-s="descricao"]', row).value = s.descricao;
        $('[data-s="unidade"]', row).value = s.unidade;
        const v = $('[data-s="valor"]', row);
        if (v) v.value = valorParaCampo(s.valor);
        if (!it.peca.trim()) $(`[data-p="peca"]`, peca).focus();
      } else if (!podePreco()) s.valor = 0;
      atualizarTotais(ctx);
    }
    if (row && t.dataset.s === 'unidade') {
      it.servicos[+row.dataset.j].unidade = t.value;
      atualizarTotais(ctx);
    }
  });

  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]');
    const img = e.target.closest('img[data-foto]');
    if (img) return verFoto(ctx, img.dataset.foto);
    const cand = e.target.closest('[data-cli]');
    if (cand) {
      const c = ctx.clientesBusca.find(x => x.id === cand.dataset.cli);
      escolherCliente(ctx, c);
      return;
    }
    if (!b || b.disabled) return;
    const f = ctx.f;
    const a = b.dataset.a;
    const peca = b.closest('.peca');
    const it = peca ? f.itens[+peca.dataset.i] : null;
    if (a === 'salvar') return comBotao(b, () => salvar(ctx));
    if (a === 'add-peca') { f.itens.push(pecaVazia()); desenhar(ctx); $(`#p-${f.itens.length - 1}-peca`, el)?.focus(); }
    if (a === 'rm-peca') {
      const i = +b.dataset.i;
      if (f.itens[i].id && !(await confirmar('Remover peça?', `A peça "${esc(f.itens[i].peca)}" sairá da OS quando você salvar.`, 'Remover', { perigo: true }))) return;
      f.itens.splice(i, 1);
      desenhar(ctx);
    }
    if (a === 'add-serv') { it.servicos.push(servicoVazio()); desenhar(ctx); }
    if (a === 'rm-serv') { it.servicos.splice(+b.dataset.j, 1); desenhar(ctx); }
    if (a === 'prazo') { f.prazo = b.dataset.d; $('#f-prazo', el).value = f.prazo; desenharFaixa(ctx); }
    if (a === 'nova-cliente') modalNovaCliente(c => escolherCliente(ctx, c), $('#f-cli-busca', el)?.value);
    if (a === 'status') return comBotao(b, () => mudarStatus(ctx, b.dataset.st));
    if (a === 'pagar') modalPagamento(ctx);
    if (a === 'estornar') modalEstorno(b.dataset.id, ctx.recarregar);
    if (a === 'wa') abrirWhatsApp(ctx, b.dataset.modelo);
    if (a === 'agendar') return modalCompromisso({ tipo: b.dataset.tipo || 'prova', order_id: f.id, numero: f.numero, client_id: f.client_id }, ctx.recarregar);
    if (a === 'comp') return modalCompromisso({ ...ctx.os.compromissos.find(x => x.id === b.dataset.id), order_id: f.id, numero: f.numero }, ctx.recarregar);
    if (a === 'material') return modalConsumo(ctx);
    if (a === 'rev-mat') return modalReverterConsumo(ctx, b.dataset.id);
    if (a === 'wa-prova') return abrirWhatsApp(ctx, 'lembrete_prova', ctx.os.compromissos.find(x => x.id === b.dataset.id));
    if (a === 'wa-outras') modal({
      title: 'Mensagens de WhatsApp', body: `<div class="list">${Object.entries(MODELOS_MENSAGEM).map(([k, l]) => `<button class="btn" style="justify-content:flex-start;margin-bottom:6px" data-wa="${k}">${esc(l)}</button>`).join('')}</div>`,
      onOpen: m => m.addEventListener('click', ev => { const w = ev.target.closest('[data-wa]'); if (w) { fecharModal(); abrirWhatsApp(ctx, w.dataset.wa); } }),
    });
  });
}

async function buscarClientes(ctx, q) {
  const res = $('#cli-res', ctx.el);
  if (q.trim().length < 2) { res.hidden = true; return; }
  const { clientes } = await api('/clientes?q=' + encodeURIComponent(q));
  ctx.clientesBusca = clientes;
  res.hidden = false;
  res.innerHTML = clientes.length
    ? clientes.slice(0, 12).map(c => `<button type="button" data-cli="${c.id}"><b>${esc(c.nome)}</b> <span class="muted">${c.telefone ? formatarTelefone(c.telefone) : 'sem telefone'}</span></button>`).join('')
    : `<div class="empty" style="padding:10px">Nenhuma cliente encontrada.${sessao.pode('clientes.editar') ? ' Use "+ Nova" para cadastrar.' : ''}</div>`;
}

function escolherCliente(ctx, c) {
  ctx.f.client_id = c.id;
  ctx.f.cliente = c;
  $('#f-cli-busca', ctx.el).value = c.nome;
  $('#cli-res', ctx.el).hidden = true;
  $('#cli-info', ctx.el).innerHTML = [c.telefone ? formatarTelefone(c.telefone) : 'sem telefone', c.observacoes].filter(Boolean).map(esc).join(' · ');
}

function verFoto(ctx, id) {
  const ft = ctx.os.fotos.find(x => x.id === id);
  const peca = ctx.f.itens.find(i => i.id === ft.item_id);
  modal({
    wide: true, title: `${CAT_FOTO[ft.categoria]}${peca ? ' · ' + peca.peca : ''}`,
    body: `<img class="foto-grande" src="/api/fotos/${id}" alt=""><p class="ajuda">Enviada em ${dataHora(ft.criado_em)}</p>`,
    actions: [{ label: 'Fechar' }, ...(sessao.pode('fotos.excluir') ? [{ label: 'Excluir foto', cls: 'danger-solid', fn: async () => {
      if (!(await confirmar('Excluir foto?', 'A imagem será apagada definitivamente.', 'Excluir', { perigo: true }))) return;
      await api(`/fotos/${id}`, { metodo: 'DELETE' });
      toast('Foto excluída.');
      await ctx.recarregar();
    } }] : [])],
  });
}

/* =========================================================================
 * DOCUMENTOS (A4 / PDF) e ETIQUETAS das peças
 * ======================================================================= */
export const DOCUMENTOS = {
  os: 'Comprovante de recebimento', orcamento: 'Orçamento', producao: 'Ordem de produção (interna)',
  pagamento: 'Comprovante de pagamento', retirada: 'Comprovante de retirada', etiquetas: 'Etiquetas das peças',
};

export async function telaImpressao(el, params) {
  const tipo = params[1] === 'etiquetas' ? 'etiquetas' : DOCUMENTOS[params[2]] ? params[2] : 'os';
  const { os, atelie } = await api(`/ordens/${params[0]}/impressao`);
  const verValores = os.total !== undefined;
  const tiposDisp = Object.entries(DOCUMENTOS).filter(([k]) => verValores || !['os', 'orcamento', 'pagamento'].includes(k));
  const barra = `<div class="row nao-imprimir"><a class="btn" href="#ordens/${os.id}">← Voltar para a OS</a>
      <select class="in" id="doc-tipo" style="width:auto" aria-label="Documento">${tiposDisp.map(([k, l]) => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${tipo === 'etiquetas' ? `<select class="in" id="et-fmt" style="width:auto" aria-label="Formato"><option value="a4-3">A4 · 3 por linha</option><option value="a4-2">A4 · 2 por linha</option><option value="termica">Etiqueta 60 × 40 mm</option></select>` : ''}
      <button class="btn pri" data-imprimir>Imprimir / Salvar PDF</button><span class="ajuda">No celular, escolha "Salvar como PDF" na tela de impressão.</span></div>`;
  if (tipo === 'etiquetas') {
    el.innerHTML = barra + `<div class="a4wrap"><div class="etiquetas a4-3" id="etqs"></div></div>`;
    // Etiqueta para prender na peça: identifica pela cliente e pela peça (sem QR Code).
    const logo = atelie.doc_logo_etiqueta && urlLogo(atelie);
    $('#etqs', el).innerHTML = os.itens.map(i => `<div class="etiqueta"><div style="min-width:0">
      ${logo ? `<img class="et-logo" src="${logo}" alt="">` : `<small>${esc(atelie.nome)}</small>`}
      <b class="et-cliente">${esc(os.cliente.nome)}</b><span class="et-peca">${esc(i.peca)}</span>
      <small>${nOS(os.numero)} · peça ${esc(i.codigo)} · prazo ${dataBR(i.prazo || os.prazo)}</small></div></div>`).join('');
  } else {
    const fone = os.cliente.telefone && atelie.doc_mostrar_telefone_cliente ? formatarTelefone(os.cliente.telefone) : '';
    const pagos = (os.pagamentos || []).filter(p => !p.estornado_por && !p.estorno_de);
    let fichas = [];
    if (tipo === 'producao' && sessao.pode('medidas.ver') && sessao.pode('clientes.ver'))
      fichas = (await api(`/clientes/${os.client_id}/medidas`).catch(() => ({ fichas: [] }))).fichas.filter(f => f.versoes.length);
    const titulo = DOCUMENTOS[tipo];
    const comValores = verValores && tipo !== 'producao';
    const tabela = `<table><thead><tr><th>Código</th><th>Peça</th><th>Serviço</th><th class="r">Qtd</th>${comValores ? '<th class="r">Valor un.</th><th class="r">Subtotal</th>' : ''}
        ${tipo === 'producao' ? '<th>Responsável</th><th>Feito</th>' : ''}</tr></thead><tbody>
      ${os.itens.map(i => i.servicos.map((s, j) => `<tr>${j === 0 ? `<td rowspan="${i.servicos.length}" class="num">${esc(i.codigo)}</td><td rowspan="${i.servicos.length}">${esc(i.peca)}${i.urgente && tipo === 'producao' ? ' <b>(URGENTE)</b>' : ''}${i.descricao ? `<br><small>${esc(i.descricao)}</small>` : ''}${tipo === 'producao' && i.obs_interna ? `<br><small><b>Obs.:</b> ${esc(i.obs_interna)}</small>` : ''}${tipo === 'producao' && i.prazo ? `<br><small>Prazo da peça: ${dataBR(i.prazo)}</small>` : ''}</td>` : ''}
        <td>${esc(s.descricao)}</td><td class="r">${String(s.quantidade).replace('.', ',')} ${esc(s.unidade)}</td>
        ${comValores ? `<td class="r num">${brl(s.valor_unitario_centavos)}</td><td class="r num">${brl(s.subtotal_centavos)}</td>` : ''}
        ${tipo === 'producao' ? (j === 0 ? `<td rowspan="${i.servicos.length}">${esc(i.responsavel_nome || '')}</td><td rowspan="${i.servicos.length}">☐</td>` : '') : ''}</tr>`).join('')).join('')}</tbody></table>`;
    const totais = comValores ? `<div class="totais" style="min-width:220px"><span class="k">Soma</span><span class="v num">${brl(os.soma_itens)}</span>
        <span class="k">Desconto</span><span class="v num">${brl(os.desconto_centavos)}</span><span class="k"><b>Total</b></span><span class="v num"><b>${brl(os.total)}</b></span>
        ${tipo === 'orcamento' ? '' : `<span class="k">Pago</span><span class="v num">${brl(os.pago)}</span><span class="k"><b>Falta pagar</b></span><span class="v num"><b>${brl(Math.max(0, os.saldo))}</b></span>`}</div>` : '';
    const camposMedida = sessao.config.campos_medida;
    const corpo = {
      os: () => `${tabela}<div style="display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap"><div style="flex:1;min-width:200px">
          ${pagos.length ? '<b>Pagamentos</b><br>' + pagos.map(p => `${dataBR(p.data)} · ${esc(p.forma)} · ${brl(p.valor_centavos)}`).join('<br>') : ''}
          ${os.observacoes ? `<div style="margin-top:10px"><b>Observações</b><br>${esc(os.observacoes)}</div>` : ''}</div>${totais}</div>`,
      orcamento: () => `${tabela}<div style="display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap"><div style="flex:1;min-width:200px">
          <p>Válido até <b>${dataBR(somarDias(sessao.hoje, atelie.doc_validade_orcamento_dias || 7))}</b>. Prazo estimado de entrega: <b>${dataBR(os.prazo)}</b>.</p>
          ${atelie.doc_termos_orcamento ? `<p style="white-space:pre-line">${esc(atelie.doc_termos_orcamento)}</p>` : ''}
          ${os.observacoes ? `<p><b>Observações:</b> ${esc(os.observacoes)}</p>` : ''}</div>${totais}</div>`,
      producao: () => `${tabela}${os.observacoes ? `<div class="box"><b>Observações da OS:</b> ${esc(os.observacoes)}</div>` : ''}
        ${os.compromissos?.filter(c => c.tipo === 'prova' && c.status === 'agendado').length ? `<div class="box"><b>Provas agendadas:</b> ${os.compromissos.filter(c => c.tipo === 'prova' && c.status === 'agendado').map(c => `${dataBR(c.dia)}${c.hora_inicio ? ' ' + esc(c.hora_inicio) : ''}`).join(', ')}</div>` : ''}
        ${fichas.map(f => { const v = f.versoes[0]; const cps = camposMedida.filter(c => v.valores[c.id] !== undefined);
          return `<div class="box"><b>Medidas — ${esc(f.titulo)}</b> (${dataBR(v.medido_em)})<br>${cps.map(c => `${esc(c.nome)}: <b>${String(v.valores[c.id]).replace('.', ',')} cm</b>`).join(' · ')}${v.observacoes ? `<br><i>${esc(v.observacoes)}</i>` : ''}</div>`; }).join('')}`,
      pagamento: () => `<table><thead><tr><th>Data</th><th>Descrição</th><th>Forma</th><th class="r">Valor</th></tr></thead><tbody>
          ${pagos.map(p => `<tr><td>${dataBR(p.data)}</td><td>${esc(p.descricao)}</td><td>${esc(p.forma)}</td><td class="r num">${brl(p.valor_centavos)}</td></tr>`).join('') || '<tr><td colspan="4">Nenhum pagamento.</td></tr>'}</tbody></table>
        <div style="display:flex;justify-content:flex-end">${totais}</div>
        <p>Recebemos de <b>${esc(os.cliente.nome)}</b> o valor de <b>${brl(os.pago)}</b> referente à ${nOS(os.numero)}.</p>`,
      retirada: () => `<p style="white-space:pre-line">${esc(atelie.doc_texto_retirada || 'Declaro que retirei as peças abaixo.')} Referente à ${nOS(os.numero)}${os.entregue_em ? `, em ${dataBR(os.entregue_em.slice(0, 10))}` : ''}.</p>
        <table><thead><tr><th>Código</th><th>Peça</th><th>Serviços</th></tr></thead><tbody>${os.itens.map(i => `<tr><td class="num">${esc(i.codigo)}</td><td>${esc(i.peca)}</td>
          <td>${i.servicos.map(s => esc(s.descricao)).join(', ')}</td></tr>`).join('')}</tbody></table>
        ${verValores ? `<p>${os.saldo > 0 ? `<b>Saldo pendente na retirada: ${brl(os.saldo)}</b>` : 'Serviço totalmente pago.'}</p>` : ''}`,
    }[tipo]();
    el.innerHTML = barra + `<div class="a4wrap"><div class="a4" ${estiloDoc(atelie)}>
      ${cabecalhoDoc(atelie, titulo, nOS(os.numero), [['Abertura', dataBR(os.aberta_em)], ['Prazo', dataBR(os.prazo)]])}
      ${tipo === 'producao' ? `<div class="box"><b>Cliente:</b> ${esc(os.cliente.nome)} · <b>Documento interno — sem valores</b></div>`
        : `<div class="box"><b>Cliente:</b> ${esc(os.cliente.nome)}${fone ? ` &nbsp;·&nbsp; <b>Telefone:</b> ${esc(fone)}` : ''}</div>`}
      ${corpo}
      ${tipo === 'producao' || !atelie.rodape_os ? '' : `<div style="font-size:11px;color:#555;border-top:1px solid #ddd;padding-top:8px;white-space:pre-line">${esc(atelie.rodape_os)}</div>`}
      <div class="ass"><div>${tipo === 'orcamento' ? 'Aprovação da cliente' : tipo === 'producao' ? 'Responsável pela produção' : 'Assinatura da cliente'}</div><div>${assinaturaAtelie(atelie)}</div></div>
    </div></div>`;
  }
  el.onclick = e => { if (e.target.closest('[data-imprimir]')) window.print(); };
  el.onchange = e => {
    if (e.target.id === 'doc-tipo') location.hash = e.target.value === 'etiquetas' ? `ordens/${os.id}/etiquetas` : `ordens/${os.id}/imprimir/${e.target.value}`;
    if (e.target.id === 'et-fmt') $('#etqs', el).className = `etiquetas ${e.target.value}`;
  };
}
