import { api, carregarConfig, sessao } from '../api.js';
import { $, brl, dataBR, dataHora, esc, modal, opcoes, toast } from '../ui.js';
import { lerValor, UNIDADES, valorParaCampo } from '../regras.js';

const ABAS = [
  ['conta', 'Minha conta', () => true],
  ['atelie', 'Ateliê', () => sessao.pode('config.editar')],
  ['servicos', 'Serviços e preços', () => sessao.pode('config.editar')],
  ['cadastros', 'Pagamentos e medidas', () => sessao.pode('config.editar')],
  ['usuarios', 'Equipe', () => sessao.pode('usuarios.gerenciar')],
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
    await { conta: abaConta, atelie: abaAtelie, servicos: abaServicos, cadastros: abaCadastros, usuarios: abaUsuarios, backup: abaBackup }[aba](alvo, desenhar);
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
  const campo = (k, l, tipo = 'text') => `<div class="field"><label for="a-${k}">${l}</label><input class="in" id="a-${k}" type="${tipo}" ${tipo === 'number' ? 'min="1"' : ''} value="${esc(a[k])}"></div>`;
  alvo.innerHTML = `<div class="grid g2" style="margin-top:12px"><div class="panel"><h2>Dados impressos na OS</h2>
      ${campo('nome', 'Nome do ateliê')}${campo('telefone', 'Telefone')}${campo('endereco', 'Endereço')}${campo('documento', 'CPF ou CNPJ (opcional)')}
      <div class="field"><label for="a-rodape_os">Texto no rodapé da OS</label><textarea class="in" id="a-rodape_os">${esc(a.rodape_os)}</textarea></div></div>
    <div class="panel"><h2>Capacidade da agenda</h2>${campo('capacidade_diaria', 'Entregas por dia (lotado a partir de)', 'number')}${campo('limite_quase_cheio', 'Mostrar "quase cheio" a partir de', 'number')}
      <p class="ajuda" style="margin:0">Dia lotado não bloqueia: o sistema avisa e pede confirmação para encaixar.</p>
      <button class="btn pri" id="a-ok">Salvar</button></div></div>`;
  $('#a-ok', alvo).onclick = async () => {
    const v = k => $(`#a-${k}`, alvo).value.trim();
    try {
      await api('/config/atelie', { metodo: 'PATCH', corpo: { nome: v('nome'), telefone: v('telefone'), endereco: v('endereco'), documento: v('documento'), rodape_os: v('rodape_os'),
        capacidade_diaria: Number(v('capacidade_diaria')), limite_quase_cheio: Number(v('limite_quase_cheio')) } });
      toast('Dados do ateliê salvos.');
      depois();
    } catch (e) { toast(e.message, true); }
  };
}

function abaServicos(alvo, depois) {
  const { categorias_servico: cats, servicos } = sessao.config;
  alvo.innerHTML = `<div class="panel" style="margin-top:12px"><div class="panel-h"><h2>Catálogo de serviços</h2><button class="btn pri sm" data-novo>+ Novo serviço</button></div>
    <p class="ajuda" style="margin:0">Os preços são definidos por você. Serviços com preço R$ 0,00 aparecem na OS, mas só o administrador consegue lançar valor diferente do catálogo.</p>
    ${cats.map(c => {
      const lista = servicos.filter(s => s.categoria_id === c.id);
      return `<h3 style="margin-top:10px">${esc(c.nome)}${c.ativo ? '' : ' <span class="pill p-muted">inativa</span>'}</h3>
      ${lista.length ? `<div class="tw"><table><thead><tr><th>Serviço</th><th>Unid.</th><th class="r">Preço</th><th class="r">Tempo</th><th class="r">Mão de obra</th><th></th></tr></thead><tbody>
        ${lista.map(s => `<tr style="${s.ativo ? '' : 'opacity:.5'}"><td>${esc(s.nome)}${s.descricao ? `<div class="ajuda">${esc(s.descricao)}</div>` : ''}</td><td>${s.unidade}</td>
          <td class="r num" style="${s.preco_centavos ? '' : 'color:var(--warn)'}">${s.preco_centavos ? brl(s.preco_centavos) : 'definir'}</td><td class="r num">${s.tempo_min ? s.tempo_min + ' min' : '—'}</td>
          <td class="r num">${s.custo_mao_obra_centavos ? brl(s.custo_mao_obra_centavos) : '—'}</td><td class="r"><button class="btn sm" data-editar="${s.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nenhum serviço.</div>'}`;
    }).join('')}
    <div class="row"><input class="in" id="nova-cat" placeholder="Nova categoria de serviço" style="flex:1;min-width:200px"><button class="btn" data-nova-cat>Adicionar categoria</button></div></div>`;
  alvo.onclick = async e => {
    if (e.target.closest('[data-novo]')) formServico(null, depois);
    const ed = e.target.closest('[data-editar]');
    if (ed) formServico(servicos.find(s => s.id === ed.dataset.editar), depois);
    if (e.target.closest('[data-nova-cat]')) {
      try { await api('/config/categorias-servico', { corpo: { nome: $('#nova-cat', alvo).value.trim() } }); toast('Categoria criada.'); depois(); } catch (err) { toast(err.message, true); }
    }
  };
}

function formServico(s, depois) {
  const x = s || { categoria_id: sessao.config.categorias_servico[0]?.id, nome: '', descricao: '', unidade: 'un', preco_centavos: 0, tempo_min: 0, custo_mao_obra_centavos: 0, ativo: 1 };
  modal({
    title: s ? 'Editar serviço' : 'Novo serviço',
    body: `<div class="grid g2" style="gap:12px">
      <div class="field" style="grid-column:1/-1"><label class="req" for="sv-nome">Nome</label><input class="in" id="sv-nome" value="${esc(x.nome)}"></div>
      <div class="field"><label for="sv-cat">Categoria</label><select class="in" id="sv-cat">${opcoes(sessao.config.categorias_servico, x.categoria_id)}</select></div>
      <div class="field"><label for="sv-un">Cobrança por</label><select class="in" id="sv-un">${Object.entries(UNIDADES).map(([k, l]) => `<option value="${k}" ${x.unidade === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="sv-preco">Preço (R$)</label><input class="in num" id="sv-preco" inputmode="decimal" value="${valorParaCampo(x.preco_centavos)}"></div>
      <div class="field"><label for="sv-tempo">Tempo estimado (minutos)</label><input class="in num" id="sv-tempo" type="number" min="0" value="${x.tempo_min}"></div>
      <div class="field"><label for="sv-mo">Custo de mão de obra estimado (R$)</label><input class="in num" id="sv-mo" inputmode="decimal" value="${valorParaCampo(x.custo_mao_obra_centavos)}"></div>
      <div class="field" style="grid-column:1/-1"><label for="sv-desc">Descrição</label><input class="in" id="sv-desc" value="${esc(x.descricao)}"></div>
      <label class="chk"><input type="checkbox" id="sv-ativo" ${x.ativo ? 'checked' : ''}> Ativo (aparece na OS)</label></div>`,
    actions: [{ label: 'Voltar' }, { label: 'Salvar', cls: 'pri', fn: async m => {
      const preco = lerValor($('#sv-preco', m).value);
      const mo = lerValor($('#sv-mo', m).value || '0');
      if (preco === null || mo === null) { toast('Valor inválido.', true); return false; }
      const corpo = { categoria_id: $('#sv-cat', m).value, nome: $('#sv-nome', m).value.trim(), descricao: $('#sv-desc', m).value.trim(), unidade: $('#sv-un', m).value,
        preco_centavos: preco, tempo_min: Number($('#sv-tempo', m).value) || 0, custo_mao_obra_centavos: mo, ativo: $('#sv-ativo', m).checked };
      try {
        await api(s ? `/config/servicos/${s.id}` : '/config/servicos', { metodo: s ? 'PUT' : 'POST', corpo });
      } catch (e) { toast(e.message, true); return false; }
      toast('Serviço salvo.');
      depois();
    } }],
  });
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
    <div class="tw"><table><thead><tr><th>Nome</th><th>Usuário</th><th>E-mail</th><th>Perfil</th><th>Desde</th><th></th></tr></thead><tbody>
      ${usuarios.map(u => `<tr style="${u.ativo ? '' : 'opacity:.5'}"><td>${esc(u.nome)}${u.trocar_senha ? ' <span class="pill p-warn">senha inicial</span>' : ''}</td><td>${esc(u.login || '—')}</td><td>${esc(u.email)}</td><td>${PAP[u.papel]}</td><td>${dataBR(u.criado_em)}</td>
        <td class="r"><button class="btn sm" data-ed="${u.id}">Editar</button></td></tr>`).join('')}</tbody></table></div></div>`;
  const form = u => modal({
    title: u ? 'Editar pessoa' : 'Nova pessoa da equipe',
    body: `<div class="grid" style="gap:12px">
      <div class="field"><label class="req" for="u-nome">Nome</label><input class="in" id="u-nome" value="${esc(u?.nome || '')}"></div>
      ${u ? '' : '<div class="field"><label class="req" for="u-email">E-mail</label><input class="in" id="u-email" type="email"></div>'}
      <div class="field"><label for="u-login">Usuário para entrar (opcional)</label><input class="in" id="u-login" autocapitalize="none" value="${esc(u?.login || '')}" placeholder="ex.: maria"></div>
      <div class="field"><label for="u-papel">Perfil</label><select class="in" id="u-papel">${Object.entries(PAP).map(([k, l]) => `<option value="${k}" ${u?.papel === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label ${u ? '' : 'class="req"'} for="u-senha">${u ? 'Nova senha temporária (deixe vazio para manter)' : 'Senha inicial (mínimo 6 caracteres; a pessoa troca no primeiro acesso)'}</label><input class="in" id="u-senha" type="password" autocomplete="new-password"></div>
      ${u ? `<label class="chk"><input type="checkbox" id="u-ativo" ${u.ativo ? 'checked' : ''}> Acesso ativo</label>` : ''}</div>`,
    actions: [{ label: 'Voltar' }, { label: 'Salvar', cls: 'pri', fn: async m => {
      const senha = $('#u-senha', m).value;
      try {
        const login = $('#u-login', m).value.trim();
        if (u) await api(`/usuarios/${u.id}`, { metodo: 'PATCH', corpo: { nome: $('#u-nome', m).value.trim(), papel: $('#u-papel', m).value, ativo: $('#u-ativo', m).checked, login, ...(senha && { senha }) } });
        else await api('/usuarios', { corpo: { nome: $('#u-nome', m).value.trim(), email: $('#u-email', m).value.trim(), login, papel: $('#u-papel', m).value, senha } });
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
