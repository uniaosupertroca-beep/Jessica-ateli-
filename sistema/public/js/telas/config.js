import { api, carregarConfig, definirUnidades, sessao } from '../api.js';
import { $, brl, dataBR, dataHora, esc, modal, opcoes, toast } from '../ui.js';
import { duracao, lerValor, valorParaCampo } from '../regras.js';
import { cabecalhoDoc, estiloDoc, urlLogo } from '../documento.js';

const diasTexto = d => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].filter((_, i) => d.includes(String(i))).join(', ');

const ABAS = [
  ['conta', 'Minha conta', () => true],
  ['atelie', 'Ateliê', () => sessao.pode('config.editar')],
  ['unidades', 'Unidades', () => sessao.pode('config.editar')],
  ['documentos', 'Documentos e logo', () => sessao.pode('config.editar')],
  ['cadastros', 'Pagamentos e medidas', () => sessao.pode('config.editar')],
  ['usuarios', 'Equipe', () => sessao.pode('usuarios.gerenciar')],
  ['auditoria', 'Auditoria', () => sessao.pode('auditoria.ver')],
  ['backup', 'Backup', () => sessao.pode('backup.gerenciar')],
];
let aba = 'conta';

export async function telaConfig(el) {
  const abas = ABAS.filter(a => a[2]());
  if (!abas.some(a => a[0] === aba)) aba = abas[0][0];
  if (aba === 'conta' && abas.length > 1 && !el.dataset.visto) aba = 'atelie';
  el.dataset.visto = '1';
  const desenhar = async () => {
    await carregarConfig();
    el.innerHTML = `<div class="head"><div><h1>${abas.length > 1 ? 'Configurações' : 'Minha conta'}</h1><p>As mudanças valem na hora para todo o sistema.</p></div></div>
      ${abas.length > 1 ? `<div class="tabs">${abas.map(([k, l]) => `<button class="${aba === k ? 'on' : ''}" data-aba="${k}">${l}</button>`).join('')}</div>` : ''}<div id="cfg"></div>`;
    const alvo = $('#cfg', el);
    await { conta: abaConta, atelie: abaAtelie, unidades: abaUnidades, documentos: abaDocumentos, cadastros: abaCadastros, usuarios: abaUsuarios, auditoria: abaAuditoria, backup: abaBackup }[aba](alvo, desenhar);
  };
  el.onclick = e => {
    const b = e.target.closest('[data-aba]');
    if (b) { aba = b.dataset.aba; desenhar(); }
  };
  await desenhar();
}

function abaConta(alvo) {
  alvo.innerHTML = `<div class="panel" style="max-width:480px;margin-top:12px"><h2>Trocar senha</h2>
    <p class="muted" style="margin:0">${esc(sessao.eu.nome)} · ${esc(sessao.eu.email)}</p>
    <div class="field"><label for="s-atual">Senha atual</label><input class="in" type="password" id="s-atual" autocomplete="current-password"></div>
    <div class="field"><label for="s-nova">Nova senha (mínimo 6 caracteres)</label><input class="in" type="password" id="s-nova" autocomplete="new-password"></div>
    <button class="btn pri" id="s-ok">Trocar senha</button><p class="ajuda" style="margin:0">Ao trocar, as sessões abertas em outros aparelhos são encerradas.</p></div>`;
  $('#s-ok', alvo).onclick = async () => {
    try {
      await api('/auth/senha', { corpo: { atual: $('#s-atual', alvo).value, nova: $('#s-nova', alvo).value } });
      toast('Senha alterada.');
      $('#s-atual', alvo).value = $('#s-nova', alvo).value = '';
    } catch (e) { toast(e.message, true); }
  };
}

function abaAtelie(alvo, depois) {
  const a = sessao.config.atelie;
  const campo = (k, l, tipo = 'text') => `<div class="field"><label for="a-${k}">${l}</label><input class="in" id="a-${k}" type="${tipo}" ${tipo === 'number' ? 'min="0" step="any"' : ''} value="${esc(a[k])}"></div>`;
  alvo.innerHTML = `<div class="grid g2" style="margin-top:12px"><div class="panel"><h2>Dados impressos na OS</h2>
      ${campo('nome', 'Nome do ateliê')}${campo('telefone', 'Telefone')}${campo('endereco', 'Endereço')}${campo('documento', 'CPF ou CNPJ (opcional)')}
      <div class="field"><label for="a-rodape_os">Texto no rodapé da OS</label><textarea class="in" id="a-rodape_os">${esc(a.rodape_os)}</textarea></div>
      <p class="ajuda" style="margin:0">Endereço, telefone e documento de cada filial ficam na aba <b>Unidades</b> e substituem estes na impressão das OS da filial.</p></div>
    <div class="panel"><h2>Precificação (calculadora)</h2>
      <div class="field"><label for="a-hora">Custo da hora de trabalho (R$)</label><input class="in num" id="a-hora" inputmode="decimal" value="${valorParaCampo(a.custo_hora_centavos)}"></div>
      ${campo('despesas_indiretas_pct', 'Despesas indiretas (%) — aluguel, luz, máquinas', 'number')}${campo('margem_pct', 'Margem desejada (%)', 'number')}
      <p class="ajuda" style="margin:0">Usados na calculadora de preço sugerido (Serviços) e na mão de obra estimada dos relatórios.</p>
      <button class="btn pri" id="a-ok">Salvar</button></div></div>`;
  $('#a-ok', alvo).onclick = async () => {
    const v = k => $(`#a-${k}`, alvo).value.trim();
    try {
      await api('/config/atelie', { metodo: 'PATCH', corpo: { nome: v('nome'), telefone: v('telefone'), endereco: v('endereco'), documento: v('documento'), rodape_os: v('rodape_os'),
        // capacidade e horários agora ficam em cada unidade (aba Unidades); aqui só se preserva o que já existe
        capacidade_diaria: a.capacidade_diaria, limite_quase_cheio: a.limite_quase_cheio,
        capacidade_provas_dia: a.capacidade_provas_dia, horario_inicio: a.horario_inicio, horario_fim: a.horario_fim,
        custo_hora_centavos: lerValor($('#a-hora', alvo).value || '0') ?? 0,
        despesas_indiretas_pct: Number(v('despesas_indiretas_pct').replace(',', '.')) || 0, margem_pct: Number(v('margem_pct').replace(',', '.')) || 0 } });
      toast('Dados do ateliê salvos.');
      depois();
    } catch (e) { toast(e.message, true); }
  };
}

function abaCadastros(alvo, depois) {
  const c = sessao.config;
  const lista = (titulo, rota, itens, extra = () => '', bloqueado = () => false) => `<div class="panel"><h2>${titulo}</h2><div class="list">
    ${itens.map(i => `<div class="li" style="cursor:default"><span style="${i.ativo ? '' : 'opacity:.5;text-decoration:line-through'}">${esc(i.nome)} ${extra(i)}</span>
      ${bloqueado(i) ? '<span class="ajuda">do sistema</span>' : `<button class="btn sm" data-tog="${rota}" data-id="${i.id}" data-ativo="${i.ativo ? 1 : 0}">${i.ativo ? 'Desativar' : 'Ativar'}</button>`}</div>`).join('')}</div>
    <div class="row"><input class="in" data-novo-nome="${rota}" placeholder="Novo item" style="flex:1">
      ${rota === 'categorias-financeiras' ? '<select class="in" data-novo-tipo style="width:auto"><option value="saida">Saída</option><option value="entrada">Entrada</option></select>' : ''}
      ${rota === 'formas-pagamento' ? '<label class="chk"><input type="checkbox" data-novo-dinheiro> conta na gaveta</label>' : ''}
      <button class="btn sm" data-add="${rota}">Adicionar</button></div></div>`;
  alvo.innerHTML = `<div class="grid g2" style="margin-top:12px">
    ${lista('Formas de pagamento', 'formas-pagamento', c.formas_pagamento, i => (i.eh_dinheiro ? '<span class="pill p-neutral">conta na gaveta</span>' : ''), i => i.eh_credito_cliente)}
    ${lista('Campos de medida (cm)', 'campos-medida', c.campos_medida)}
    ${lista('Categorias financeiras', 'categorias-financeiras', c.categorias_financeiras, i => `<span class="pill p-${i.tipo === 'entrada' ? 'ok' : 'crit'}">${i.tipo}</span>`, i => i.sistema)}
    </div><p class="ajuda">Itens já usados são desativados em vez de apagados, para o histórico continuar correto.</p>`;
  alvo.onclick = async e => {
    const t = e.target.closest('[data-tog]');
    const a = e.target.closest('[data-add]');
    try {
      if (t) await api(`/config/${t.dataset.tog}/${t.dataset.id}`, { metodo: 'PATCH', corpo: { ativo: t.dataset.ativo !== '1' } });
      else if (a) {
        const r = a.dataset.add;
        const painel = a.closest('.panel');
        const corpo = { nome: $(`[data-novo-nome="${r}"]`, painel).value.trim() };
        if (r === 'categorias-financeiras') corpo.tipo = $('[data-novo-tipo]', painel).value;
        if (r === 'formas-pagamento') corpo.eh_dinheiro = $('[data-novo-dinheiro]', painel).checked;
        await api(`/config/${r}`, { corpo });
      } else return;
      toast('Salvo.');
      depois();
    } catch (err) { toast(err.message, true); }
  };
}

function abaUnidades(alvo, depois) {
  const lista = sessao.config.unidades || [];
  alvo.innerHTML = `<div class="panel" style="margin-top:12px"><div class="panel-h"><h2>Unidades (filiais)</h2><button class="btn pri sm" data-nova>+ Nova unidade</button></div>
    <p class="ajuda" style="margin:0">Clientes, medidas, serviços e cadastro de materiais são compartilhados. Cada unidade tem suas OS, caixa, saldo de estoque, agenda e equipe.
      A numeração das OS é única para o ateliê todo; a sigla aparece ao lado do número.</p>
    <div class="tw"><table><thead><tr><th>Unidade</th><th>Sigla</th><th>Endereço</th><th>Telefone</th><th class="r">Entregas/dia</th><th class="r">Provas/dia</th><th>Horário</th><th></th></tr></thead><tbody>
      ${lista.map(u => `<tr style="${u.ativo ? '' : 'opacity:.5'}"><td><b>${esc(u.nome)}</b>${u.ativo ? '' : ' <span class="pill">inativa</span>'}</td><td><span class="tag-un">${esc(u.sigla)}</span></td>
        <td>${esc(u.endereco || '—')}</td><td>${esc(u.telefone || '—')}</td><td class="r num">${u.capacidade_diaria}</td><td class="r num">${u.capacidade_provas_dia}</td>
        <td>${esc(u.horario_inicio)}–${esc(u.horario_fim)}</td><td class="r"><button class="btn sm" data-ed="${esc(u.id)}">Editar</button></td></tr>`).join('')}</tbody></table></div></div>`;
  const form = u => modal({
    title: u ? `Editar unidade ${u.nome}` : 'Nova unidade',
    body: `<div class="grid g2" style="gap:12px">
      <div class="field"><label class="req" for="un-nome">Nome</label><input class="in" id="un-nome" value="${esc(u?.nome || '')}" placeholder="ex.: Filial Centro"></div>
      <div class="field"><label class="req" for="un-sigla">Sigla (2 a 5 letras)</label><input class="in" id="un-sigla" maxlength="5" style="text-transform:uppercase" value="${esc(u?.sigla || '')}" placeholder="ex.: CEN"></div>
      <div class="field" style="grid-column:1/-1"><label for="un-endereco">Endereço (sai na OS)</label><input class="in" id="un-endereco" value="${esc(u?.endereco || '')}"></div>
      <div class="field"><label for="un-telefone">Telefone</label><input class="in" id="un-telefone" value="${esc(u?.telefone || '')}"></div>
      <div class="field"><label for="un-documento">CNPJ (opcional)</label><input class="in" id="un-documento" value="${esc(u?.documento || '')}"></div>
      <div class="field"><label for="un-cap">Entregas por dia (lotado a partir de)</label><input class="in num" id="un-cap" type="number" min="1" value="${u?.capacidade_diaria ?? 6}"></div>
      <div class="field"><label for="un-quase">"Quase cheio" a partir de</label><input class="in num" id="un-quase" type="number" min="1" value="${u?.limite_quase_cheio ?? 5}"></div>
      <div class="field"><label for="un-provas">Provas por dia (no máximo)</label><input class="in num" id="un-provas" type="number" min="1" value="${u?.capacidade_provas_dia ?? 8}"></div>
      <div class="grid g2" style="gap:10px"><div class="field"><label for="un-ini">Abre às</label><input class="in" id="un-ini" type="time" value="${esc(u?.horario_inicio || '09:00')}"></div>
        <div class="field"><label for="un-fim">Fecha às</label><input class="in" id="un-fim" type="time" value="${esc(u?.horario_fim || '18:00')}"></div></div>
      ${u ? `<label class="chk"><input type="checkbox" id="un-ativo" ${u.ativo ? 'checked' : ''}> Unidade ativa</label>` : ''}</div>
      <p class="ajuda">Dia lotado não bloqueia: o sistema avisa e pede confirmação para encaixar. A capacidade em horas vem da Equipe ligada à unidade.</p>`,
    actions: [{ label: 'Voltar' }, { label: 'Salvar', cls: 'pri', fn: async m => {
      const v = k => $(`#un-${k}`, m).value.trim();
      const corpo = { nome: v('nome'), sigla: v('sigla'), endereco: v('endereco'), telefone: v('telefone'), documento: v('documento'),
        capacidade_diaria: Number(v('cap')), limite_quase_cheio: Number(v('quase')), capacidade_provas_dia: Number(v('provas')),
        horario_inicio: v('ini'), horario_fim: v('fim'), ativo: u ? $('#un-ativo', m).checked : true };
      try {
        if (u) await api(`/config/unidades/${u.id}`, { metodo: 'PUT', corpo });
        else await api('/config/unidades', { corpo });
        const eu = await api('/auth/eu');
        definirUnidades(eu.unidades);
      } catch (e) { toast(e.message, true); return false; }
      toast(u ? 'Unidade atualizada.' : 'Unidade criada. Ligue a equipe a ela na aba Equipe.');
      window.dispatchEvent(new CustomEvent('unidade-trocada'));
    } }],
  });
  alvo.onclick = e => {
    if (e.target.closest('[data-nova]')) form(null);
    const ed = e.target.closest('[data-ed]');
    if (ed) form(lista.find(u => u.id === ed.dataset.ed));
  };
}

async function abaUsuarios(alvo, depois) {
  const { usuarios } = await api('/usuarios');
  const PAP = { admin: 'Administrador', atendente: 'Atendente', costureira: 'Costureira' };
  const todasUn = (sessao.config.unidades || []).filter(x => x.ativo);
  const multi = todasUn.length > 1;
  const siglaDe = id => (sessao.config.unidades || []).find(x => x.id === id)?.sigla || '?';
  alvo.innerHTML = `<div class="panel" style="margin-top:12px"><div class="panel-h"><h2>Equipe</h2><button class="btn pri sm" data-novo>+ Nova pessoa</button></div>
    <p class="ajuda" style="margin:0"><b>Administrador:</b> tudo. <b>Atendente:</b> clientes, OS, recebimentos e caixa (sem alterar preço, estornar ou configurar).
      <b>Costureira:</b> vê as peças atribuídas a ela e atualiza a produção, sem valores.</p>
    <div class="tw"><table><thead><tr><th>Nome</th><th>Usuário</th><th>E-mail</th><th>Perfil</th>${multi ? '<th>Unidades</th>' : ''}<th>Produção/dia</th><th>Desde</th><th></th></tr></thead><tbody>
      ${usuarios.map(u => `<tr style="${u.ativo ? '' : 'opacity:.5'}"><td>${esc(u.nome)}${u.trocar_senha ? ' <span class="pill p-warn">senha inicial</span>' : ''}</td><td>${esc(u.login || '—')}</td><td>${esc(u.email)}</td><td>${PAP[u.papel]}</td>${multi ? `<td>${u.papel === 'admin' ? '<span class="muted">todas</span>' : (u.unidades || []).map(id => `<span class="tag-un">${esc(siglaDe(id))}</span>`).join(' ') || '<span class="pill p-warn">nenhuma</span>'}</td>` : ''}<td>${u.capacidade_min_dia ? duracao(u.capacidade_min_dia) + ' · ' + diasTexto(u.dias_trabalho) : '—'}</td><td>${dataBR(u.criado_em)}</td>
        <td class="r"><button class="btn sm" data-ed="${u.id}">Editar</button></td></tr>`).join('')}</tbody></table></div></div>`;
  const form = u => modal({
    title: u ? 'Editar pessoa' : 'Nova pessoa da equipe',
    body: `<div class="grid" style="gap:12px">
      <div class="field"><label class="req" for="u-nome">Nome</label><input class="in" id="u-nome" value="${esc(u?.nome || '')}"></div>
      ${u ? '' : '<div class="field"><label class="req" for="u-email">E-mail</label><input class="in" id="u-email" type="email"></div>'}
      <div class="field"><label for="u-login">Usuário para entrar (opcional)</label><input class="in" id="u-login" autocapitalize="none" value="${esc(u?.login || '')}" placeholder="ex.: maria"></div>
      <div class="field"><label for="u-papel">Perfil</label><select class="in" id="u-papel">${Object.entries(PAP).map(([k, l]) => `<option value="${k}" ${u?.papel === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label ${u ? '' : 'class="req"'} for="u-senha">${u ? 'Nova senha temporária (deixe vazio para manter)' : 'Senha inicial (mínimo 6 caracteres; a pessoa troca no primeiro acesso)'}</label><input class="in" id="u-senha" type="password" autocomplete="new-password"></div>
      <div class="field"><label for="u-cap">Horas de produção por dia (0 = não produz)</label><input class="in num" id="u-cap" inputmode="decimal" value="${u ? String(u.capacidade_min_dia / 60).replace('.', ',') : '0'}"></div>
      <fieldset class="field" style="border:none;padding:0;margin:0"><legend class="ajuda" style="margin-bottom:6px">Dias de trabalho</legend><div class="row">
        ${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((d, i) => `<label class="chk"><input type="checkbox" data-dia="${i}" ${(u?.dias_trabalho ?? '12345').includes(String(i)) ? 'checked' : ''}> ${d}</label>`).join('')}</div></fieldset>
      ${multi ? `<fieldset class="field" style="border:none;padding:0;margin:0"><legend class="ajuda" style="margin-bottom:6px">Unidades em que trabalha (administrador vê todas)</legend><div class="row">
        ${todasUn.map(x => `<label class="chk"><input type="checkbox" data-un="${esc(x.id)}" ${(u ? (u.unidades || []).includes(x.id) : (!sessao.unidade || sessao.unidade === x.id)) ? 'checked' : ''}> ${esc(x.nome)}</label>`).join('')}</div></fieldset>` : ''}
      ${u ? `<label class="chk"><input type="checkbox" id="u-ativo" ${u.ativo ? 'checked' : ''}> Acesso ativo</label>` : ''}</div>`,
    actions: [{ label: 'Voltar' }, { label: 'Salvar', cls: 'pri', fn: async m => {
      const unidades = multi ? [...m.querySelectorAll('[data-un]')].filter(x => x.checked).map(x => x.dataset.un) : undefined;
      if (multi && !unidades.length && $('#u-papel', m).value !== 'admin') { toast('Marque pelo menos uma unidade.', true); return false; }
      const senha = $('#u-senha', m).value;
      try {
        const login = $('#u-login', m).value.trim();
        const capacidade_min_dia = Math.round((Number($('#u-cap', m).value.replace(',', '.')) || 0) * 60);
        const dias_trabalho = [...m.querySelectorAll('[data-dia]')].filter(x => x.checked).map(x => x.dataset.dia).join('');
        if (u) await api(`/usuarios/${u.id}`, { metodo: 'PATCH', corpo: { nome: $('#u-nome', m).value.trim(), papel: $('#u-papel', m).value, ativo: $('#u-ativo', m).checked, login, capacidade_min_dia, dias_trabalho, ...(unidades && { unidades }), ...(senha && { senha }) } });
        else await api('/usuarios', { corpo: { nome: $('#u-nome', m).value.trim(), email: $('#u-email', m).value.trim(), login, papel: $('#u-papel', m).value, senha, capacidade_min_dia, dias_trabalho, ...(unidades && { unidades }) } });
      } catch (e) { toast(e.message, true); return false; }
      toast('Equipe atualizada.');
      depois();
    } }],
  });
  alvo.onclick = e => {
    if (e.target.closest('[data-novo]')) form(null);
    const ed = e.target.closest('[data-ed]');
    if (ed) form(usuarios.find(u => u.id === ed.dataset.ed));
  };
}

async function abaBackup(alvo, depois) {
  const { backups } = await api('/admin/backups');
  alvo.innerHTML = `<div class="panel" style="margin-top:12px"><div class="panel-h"><h2>Backups</h2><button class="btn pri sm" data-agora>Gerar backup agora</button></div>
    <p class="ajuda" style="margin:0">Um backup é gerado automaticamente todo dia às 03:17 (horário de Brasília) e guardado em local privado. Os antigos são apagados após o prazo de retenção.
      O passo a passo de restauração está em <code>docs/BACKUP-E-RESTAURACAO.md</code>.</p>
    ${backups.length ? `<div class="tw"><table><thead><tr><th>Arquivo</th><th>Gerado em</th><th class="r">Tamanho</th></tr></thead><tbody>
      ${backups.map(b => `<tr><td class="num" style="font-size:.82rem">${esc(b.chave)}</td><td>${dataHora(b.criado_em)}</td><td class="r num">${(b.tamanho / 1024).toFixed(1).replace('.', ',')} KB</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Nenhum backup ainda.</div>'}</div>`;
  alvo.onclick = async e => {
    const b = e.target.closest('[data-agora]');
    if (!b) return;
    b.disabled = true;
    try { await api('/admin/backup', { corpo: {} }); toast('Backup gerado.'); depois(); } catch (err) { toast(err.message, true); b.disabled = false; }
  };
}

async function abaAuditoria(alvo) {
  const filtro = { entidade: '', de: '', ate: '' };
  const ROT = { orders: 'Ordens', clients: 'Clientes', cash_movements: 'Financeiro', payables: 'Contas a pagar', materials: 'Estoque', users: 'Equipe',
    appointments: 'Agenda', order_items: 'Produção', cash_sessions: 'Caixa', system_settings: 'Configurações', service_catalog: 'Serviços', order_photos: 'Fotos',
    client_measurements: 'Medidas', stock_movements: 'Estoque', suppliers: 'Fornecedores' };
  const carregar = async () => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(filtro).filter(([, v]) => v)));
    const { registros } = await api('/auditoria?' + qs);
    $('#au-lista', alvo).innerHTML = registros.length ? `<table><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Área</th><th>Detalhes</th></tr></thead><tbody>
      ${registros.map(r => `<tr><td class="num" style="white-space:nowrap">${dataHora(r.em)}</td><td>${esc(r.usuario || '—')}</td><td>${esc(r.acao)}</td>
        <td>${esc(ROT[r.entidade] || r.entidade)}</td><td class="muted" style="font-size:.8rem;max-width:380px;word-break:break-word">${esc((r.dados || '').slice(0, 220))}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Nenhum registro.</div>';
  };
  alvo.innerHTML = `<div class="panel" style="margin-top:12px"><div class="row">
      <select class="in" id="au-ent" style="width:auto"><option value="">Todas as áreas</option>${Object.entries(ROT).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <label class="row" style="gap:6px">De <input class="in" type="date" id="au-de" style="width:auto"></label><label class="row" style="gap:6px">até <input class="in" type="date" id="au-ate" style="width:auto"></label></div>
    <p class="ajuda" style="margin:0">Registro de tudo o que foi feito no sistema. Não pode ser apagado nem alterado.</p><div class="tw" id="au-lista"></div></div>`;
  alvo.onchange = e => {
    if (e.target.id === 'au-ent') filtro.entidade = e.target.value;
    if (e.target.id === 'au-de') filtro.de = e.target.value;
    if (e.target.id === 'au-ate') filtro.ate = e.target.value;
    carregar();
  };
  await carregar();
}

/** Logo (guardado no próprio sistema, privado), cor e textos dos documentos impressos — com prévia ao vivo. */
function abaDocumentos(alvo, depois) {
  const a = { ...sessao.config.atelie };
  const logo = urlLogo(a);
  alvo.innerHTML = `<div class="grid s12" style="margin-top:12px;align-items:start">
    <div class="grid" style="gap:16px">
      <div class="panel"><h2>Logo</h2>
        ${logo ? `<img class="logo-atual" src="${logo}" alt="Logo atual">` : '<div class="empty">Nenhum logo enviado. Os documentos usam o nome do ateliê.</div>'}
        <div class="row"><label class="btn pri sm" style="cursor:pointer">${logo ? 'Trocar logo' : 'Enviar logo'}<input type="file" id="d-logo" accept="image/png,image/jpeg,image/webp" hidden></label>
          ${logo ? '<button class="btn sm danger" id="d-tirar">Remover</button>' : ''}</div>
        <p class="ajuda" style="margin:0">PNG (de preferência com fundo transparente), JPG ou WebP, até 2 MB. O arquivo fica guardado no sistema, de forma privada: só aparece para quem está logado e nos impressos.</p></div>
      <div class="panel"><h2>Aparência</h2>
        <div class="row"><label for="d-cor">Cor dos documentos</label><input type="color" id="d-cor" value="${esc(a.doc_cor || '#C92D6A')}" style="width:56px;height:40px;border:none;background:none;padding:0">
          <span class="ajuda">títulos, linhas e cabeçalho das tabelas</span></div>
        <label class="chk"><input type="checkbox" id="d-etq" ${a.doc_logo_etiqueta ? 'checked' : ''}> Mostrar o logo nas etiquetas</label>
        <label class="chk"><input type="checkbox" id="d-tel" ${a.doc_mostrar_telefone_cliente ? 'checked' : ''}> Mostrar o telefone da cliente nos documentos</label></div>
      <div class="panel"><h2>Textos</h2>
        <div class="field"><label for="d-cab">Linha extra no cabeçalho</label><input class="in" id="d-cab" value="${esc(a.doc_cabecalho || '')}" placeholder="ex.: @ateliejessica · seg a sex 9h–18h"></div>
        <div class="field"><label for="d-rod">Rodapé (termos da OS e comprovantes)</label><textarea class="in" id="d-rod" rows="3">${esc(a.rodape_os || '')}</textarea></div>
        <div class="grid g2" style="gap:10px"><div class="field"><label for="d-val">Validade do orçamento (dias)</label><input class="in num" type="number" min="1" max="365" id="d-val" value="${a.doc_validade_orcamento_dias || 7}"></div>
          <div class="field"><label for="d-ass">Nome na assinatura do ateliê</label><input class="in" id="d-ass" value="${esc(a.doc_assinatura || '')}" placeholder="${esc(a.nome)}"></div></div>
        <div class="field"><label for="d-orc">Condições do orçamento</label><textarea class="in" id="d-orc" rows="3">${esc(a.doc_termos_orcamento || '')}</textarea></div>
        <div class="field"><label for="d-ret">Texto do comprovante de retirada</label><textarea class="in" id="d-ret" rows="2">${esc(a.doc_texto_retirada || '')}</textarea></div>
        <button class="btn pri" id="d-salvar">Salvar documentos</button></div>
    </div>
    <div class="panel" style="position:sticky;top:12px"><div class="panel-h"><h2>Prévia</h2><span class="ajuda">como sai no papel</span></div>
      <div class="a4 previa-doc" id="d-previa"></div>
      <p class="ajuda" style="margin:0">Para imprimir de verdade, abra uma OS e toque em "Documentos / PDF".</p></div></div>`;
  const ler = () => ({
    doc_cor: $('#d-cor', alvo).value, doc_cabecalho: $('#d-cab', alvo).value.trim(), rodape_os: $('#d-rod', alvo).value.trim(),
    doc_termos_orcamento: $('#d-orc', alvo).value.trim(), doc_validade_orcamento_dias: Number($('#d-val', alvo).value) || 7,
    doc_texto_retirada: $('#d-ret', alvo).value.trim(), doc_assinatura: $('#d-ass', alvo).value.trim(),
    doc_logo_etiqueta: $('#d-etq', alvo).checked, doc_mostrar_telefone_cliente: $('#d-tel', alvo).checked,
  });
  const previa = () => {
    const x = { ...a, ...ler() };
    const p = $('#d-previa', alvo);
    p.setAttribute('style', estiloDoc(x).slice(7, -1));
    p.innerHTML = `${cabecalhoDoc(x, 'Orçamento', 'Nº 0142', [['Abertura', '29/10/2026'], ['Prazo', '05/11/2026']])}
      <div class="box" style="margin-top:10px"><b>Cliente:</b> Mariana Souza${x.doc_mostrar_telefone_cliente ? ' · <b>Telefone:</b> (11) 98765-4321' : ''}</div>
      <table style="margin-top:10px"><thead><tr><th>Peça</th><th>Serviço</th><th class="r">Valor</th></tr></thead><tbody><tr><td>Calça jeans</td><td>Barra italiana</td><td class="r num">R$ 35,00</td></tr></tbody></table>
      ${x.doc_termos_orcamento ? `<p style="white-space:pre-line">${esc(x.doc_termos_orcamento)}</p>` : ''}
      ${x.rodape_os ? `<div style="font-size:11px;color:#555;border-top:1px solid #ddd;padding-top:8px;white-space:pre-line">${esc(x.rodape_os)}</div>` : ''}
      <div class="ass" style="padding-top:24px"><div>Aprovação da cliente</div><div>${esc(x.doc_assinatura || x.nome)}</div></div>`;
  };
  alvo.addEventListener('input', previa);
  alvo.addEventListener('change', previa);
  previa();
  $('#d-salvar', alvo).onclick = async e => {
    e.target.disabled = true;
    try { await api('/config/documentos', { metodo: 'PATCH', corpo: ler() }); toast('Documentos salvos.'); depois(); } catch (er) { toast(er.message, true); e.target.disabled = false; }
  };
  $('#d-tirar', alvo)?.addEventListener('click', async () => {
    try { await api('/config/logo', { metodo: 'DELETE' }); toast('Logo removido.'); depois(); } catch (er) { toast(er.message, true); }
  });
  $('#d-logo', alvo).onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      // Logos grandes são reduzidos para até 1200 px em PNG (mantém transparência).
      let envio = f;
      const img = await createImageBitmap(f);
      if (f.size > 1.5 * 1024 * 1024 || Math.max(img.width, img.height) > 1200) {
        const k = Math.min(1, 1200 / Math.max(img.width, img.height));
        const cv = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        envio = await new Promise(ok => cv.toBlob(ok, 'image/png'));
      }
      const fd = new FormData();
      fd.append('arquivo', new File([envio], 'logo.png', { type: envio.type || f.type }));
      await api('/config/logo', { form: fd });
      toast('Logo atualizado.');
      depois();
    } catch (er) { toast(er.message || 'Não foi possível ler a imagem.', true); }
  };
}
