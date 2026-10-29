import { api, carregarConfig, sessao } from '../api.js';
import { $, brl, dataBR, dataHora, esc, modal, opcoes, toast } from '../ui.js';
import { duracao, lerValor, valorParaCampo } from '../regras.js';

const diasTexto = d => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].filter((_, i) => d.includes(String(i))).join(', ');

const ABAS = [
  ['conta', 'Minha conta', () => true],
  ['atelie', 'Ateliê', () => sessao.pode('config.editar')],
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
    await { conta: abaConta, atelie: abaAtelie, cadastros: abaCadastros, usuarios: abaUsuarios, auditoria: abaAuditoria, backup: abaBackup }[aba](alvo, desenhar);
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
      <div class="field"><label for="a-rodape_os">Texto no rodapé da OS</label><textarea class="in" id="a-rodape_os">${esc(a.rodape_os)}</textarea></div></div>
    <div class="panel"><h2>Agenda</h2>${campo('capacidade_diaria', 'Entregas por dia (lotado a partir de)', 'number')}${campo('limite_quase_cheio', 'Mostrar "quase cheio" a partir de', 'number')}
      ${campo('capacidade_provas_dia', 'Provas por dia (no máximo)', 'number')}
      <div class="grid g2" style="gap:10px">${campo('horario_inicio', 'Abre às', 'time')}${campo('horario_fim', 'Fecha às', 'time')}</div>
      <p class="ajuda" style="margin:0">Dia lotado não bloqueia: o sistema avisa e pede confirmação para encaixar. A capacidade em horas vem da Equipe.</p></div>
    <div class="panel"><h2>Precificação (calculadora)</h2>
      <div class="field"><label for="a-hora">Custo da hora de trabalho (R$)</label><input class="in num" id="a-hora" inputmode="decimal" value="${valorParaCampo(a.custo_hora_centavos)}"></div>
      ${campo('despesas_indiretas_pct', 'Despesas indiretas (%) — aluguel, luz, máquinas', 'number')}${campo('margem_pct', 'Margem desejada (%)', 'number')}
      <p class="ajuda" style="margin:0">Usados na calculadora de preço sugerido (Serviços) e na mão de obra estimada dos relatórios.</p>
      <button class="btn pri" id="a-ok">Salvar</button></div></div>`;
  $('#a-ok', alvo).onclick = async () => {
    const v = k => $(`#a-${k}`, alvo).value.trim();
    try {
      await api('/config/atelie', { metodo: 'PATCH', corpo: { nome: v('nome'), telefone: v('telefone'), endereco: v('endereco'), documento: v('documento'), rodape_os: v('rodape_os'),
        capacidade_diaria: Number(v('capacidade_diaria')), limite_quase_cheio: Number(v('limite_quase_cheio')),
        capacidade_provas_dia: Number(v('capacidade_provas_dia')), horario_inicio: v('horario_inicio'), horario_fim: v('horario_fim'),
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

async function abaUsuarios(alvo, depois) {
  const { usuarios } = await api('/usuarios');
  const PAP = { admin: 'Administrador', atendente: 'Atendente', costureira: 'Costureira' };
  alvo.innerHTML = `<div class="panel" style="margin-top:12px"><div class="panel-h"><h2>Equipe</h2><button class="btn pri sm" data-novo>+ Nova pessoa</button></div>
    <p class="ajuda" style="margin:0"><b>Administrador:</b> tudo. <b>Atendente:</b> clientes, OS, recebimentos e caixa (sem alterar preço, estornar ou configurar).
      <b>Costureira:</b> vê as peças atribuídas a ela e atualiza a produção, sem valores.</p>
    <div class="tw"><table><thead><tr><th>Nome</th><th>Usuário</th><th>E-mail</th><th>Perfil</th><th>Produção/dia</th><th>Desde</th><th></th></tr></thead><tbody>
      ${usuarios.map(u => `<tr style="${u.ativo ? '' : 'opacity:.5'}"><td>${esc(u.nome)}${u.trocar_senha ? ' <span class="pill p-warn">senha inicial</span>' : ''}</td><td>${esc(u.login || '—')}</td><td>${esc(u.email)}</td><td>${PAP[u.papel]}</td><td>${u.capacidade_min_dia ? duracao(u.capacidade_min_dia) + ' · ' + diasTexto(u.dias_trabalho) : '—'}</td><td>${dataBR(u.criado_em)}</td>
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
      ${u ? `<label class="chk"><input type="checkbox" id="u-ativo" ${u.ativo ? 'checked' : ''}> Acesso ativo</label>` : ''}</div>`,
    actions: [{ label: 'Voltar' }, { label: 'Salvar', cls: 'pri', fn: async m => {
      const senha = $('#u-senha', m).value;
      try {
        const login = $('#u-login', m).value.trim();
        const capacidade_min_dia = Math.round((Number($('#u-cap', m).value.replace(',', '.')) || 0) * 60);
        const dias_trabalho = [...m.querySelectorAll('[data-dia]')].filter(x => x.checked).map(x => x.dataset.dia).join('');
        if (u) await api(`/usuarios/${u.id}`, { metodo: 'PATCH', corpo: { nome: $('#u-nome', m).value.trim(), papel: $('#u-papel', m).value, ativo: $('#u-ativo', m).checked, login, capacidade_min_dia, dias_trabalho, ...(senha && { senha }) } });
        else await api('/usuarios', { corpo: { nome: $('#u-nome', m).value.trim(), email: $('#u-email', m).value.trim(), login, papel: $('#u-papel', m).value, senha, capacidade_min_dia, dias_trabalho } });
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
