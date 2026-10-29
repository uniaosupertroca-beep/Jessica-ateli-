import { api, carregarConfig, sessao } from '../api.js';
import { $, brl, esc, modal, opcoes, toast } from '../ui.js';
import { duracao, lerValor, precoSugerido, UNIDADES, valorParaCampo } from '../regras.js';

/** Catálogo de serviços com preço, tempo, custo de mão de obra e calculadora de preço sugerido. */
export async function telaServicos(el) {
  await carregarConfig();
  const { categorias_servico: cats, servicos, atelie } = sessao.config;
  const pode = sessao.pode('config.editar');
  const semPreco = servicos.filter(s => s.ativo && !s.preco_centavos).length;
  el.innerHTML = `<div class="head"><div><h1>Serviços</h1><p>Catálogo usado nas OS. Os preços são definidos por você; a calculadora só sugere.</p></div>
      ${pode ? '<button class="btn pri" data-novo>+ Novo serviço</button>' : ''}</div>
    ${semPreco && pode ? `<div class="alert a-warn">${semPreco} serviço(s) ativo(s) ainda sem preço. Sem preço, só a administradora consegue lançar valor na OS.</div>` : ''}
    ${pode && !atelie.custo_hora_centavos ? '<div class="alert a-info">Para a calculadora sugerir preços, informe o custo da sua hora de trabalho em Configurações → Ateliê.</div>' : ''}
    ${cats.map(c => {
      const lista = servicos.filter(s => s.categoria_id === c.id);
      if (!lista.length && !pode) return '';
      return `<div class="panel"><div class="panel-h"><h2>${esc(c.nome)}${c.ativo ? '' : ' <span class="pill p-muted">inativa</span>'}</h2></div>
      ${lista.length ? `<div class="tw"><table><thead><tr><th>Serviço</th><th>Cobrança</th><th class="r">Preço</th><th class="r">Tempo</th><th class="r">Mão de obra</th><th class="r">Sugerido</th><th></th></tr></thead><tbody>
        ${lista.map(s => {
          const sug = precoSugerido({ tempoMin: s.tempo_min, custoHoraCentavos: atelie.custo_hora_centavos, indiretasPct: atelie.despesas_indiretas_pct, margemPct: atelie.margem_pct });
          return `<tr style="${s.ativo ? '' : 'opacity:.5'}"><td><b>${esc(s.nome)}</b>${s.descricao ? `<div class="ajuda">${esc(s.descricao)}</div>` : ''}</td><td>por ${UNIDADES[s.unidade]}</td>
          <td class="r num" style="${s.preco_centavos ? '' : 'color:var(--warn)'}">${s.preco_centavos ? brl(s.preco_centavos) : 'definir'}</td><td class="r num">${s.tempo_min ? duracao(s.tempo_min) : '—'}</td>
          <td class="r num">${s.custo_mao_obra_centavos ? brl(s.custo_mao_obra_centavos) : '—'}</td>
          <td class="r num muted">${atelie.custo_hora_centavos && s.tempo_min ? brl(sug.preco) : '—'}</td>
          <td class="r">${pode ? `<button class="btn sm" data-editar="${s.id}">Editar</button>` : ''}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="empty">Nenhum serviço nesta categoria.</div>'}</div>`;
    }).join('')}
    ${pode ? '<div class="panel"><div class="row"><input class="in" id="nova-cat" placeholder="Nova categoria de serviço" style="flex:1;min-width:200px"><button class="btn" data-nova-cat>Adicionar categoria</button></div></div>' : ''}`;
  const recarregar = () => telaServicos(el);
  el.onclick = async e => {
    if (e.target.closest('[data-novo]')) formServico(null, recarregar);
    const ed = e.target.closest('[data-editar]');
    if (ed) formServico(servicos.find(s => s.id === ed.dataset.editar), recarregar);
    if (e.target.closest('[data-nova-cat]')) {
      try { await api('/config/categorias-servico', { corpo: { nome: $('#nova-cat', el).value.trim() } }); toast('Categoria criada.'); recarregar(); } catch (er) { toast(er.message, true); }
    }
  };
}

export function formServico(s, depois) {
  const a = sessao.config.atelie;
  const x = s || { categoria_id: sessao.config.categorias_servico[0]?.id, nome: '', descricao: '', unidade: 'un', preco_centavos: 0, tempo_min: 0, custo_mao_obra_centavos: 0, ativo: 1 };
  modal({
    wide: true,
    title: s ? 'Editar serviço' : 'Novo serviço',
    body: `<div class="grid g2" style="gap:12px;align-items:start"><div class="grid g2" style="gap:12px">
      <div class="field" style="grid-column:1/-1"><label class="req" for="sv-nome">Nome</label><input class="in" id="sv-nome" value="${esc(x.nome)}"></div>
      <div class="field"><label for="sv-cat">Categoria</label><select class="in" id="sv-cat">${opcoes(sessao.config.categorias_servico, x.categoria_id)}</select></div>
      <div class="field"><label for="sv-un">Cobrança por</label><select class="in" id="sv-un">${Object.entries(UNIDADES).map(([k, l]) => `<option value="${k}" ${x.unidade === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="sv-tempo">Tempo estimado (min)</label><input class="in num" id="sv-tempo" type="number" min="0" value="${x.tempo_min}"></div>
      <div class="field"><label for="sv-mo">Mão de obra estimada (R$)</label><input class="in num" id="sv-mo" inputmode="decimal" value="${valorParaCampo(x.custo_mao_obra_centavos)}"></div>
      <div class="field" style="grid-column:1/-1"><label for="sv-desc">Descrição</label><input class="in" id="sv-desc" value="${esc(x.descricao)}"></div>
      <div class="field"><label class="req" for="sv-preco">Preço (R$)</label><input class="in num" id="sv-preco" inputmode="decimal" value="${valorParaCampo(x.preco_centavos)}"></div>
      <label class="chk" style="align-self:end"><input type="checkbox" id="sv-ativo" ${x.ativo ? 'checked' : ''}> Ativo (aparece na OS)</label></div>
      <div class="panel" style="background:var(--sunk);box-shadow:none"><h3>Calculadora de preço sugerido</h3>
        <div class="grid g2" style="gap:10px">
          <div class="field"><label for="cl-hora">Custo da hora (R$)</label><input class="in num" id="cl-hora" inputmode="decimal" value="${valorParaCampo(a.custo_hora_centavos)}"></div>
          <div class="field"><label for="cl-mat">Materiais (R$)</label><input class="in num" id="cl-mat" inputmode="decimal" value="0,00"></div>
          <div class="field"><label for="cl-ind">Despesas indiretas (%)</label><input class="in num" id="cl-ind" inputmode="decimal" value="${String(a.despesas_indiretas_pct).replace('.', ',')}"></div>
          <div class="field"><label for="cl-mar">Margem desejada (%)</label><input class="in num" id="cl-mar" inputmode="decimal" value="${String(a.margem_pct).replace('.', ',')}"></div></div>
        <dl class="kv" id="cl-res"></dl>
        <button type="button" class="btn sec sm" id="cl-usar">Usar o preço sugerido</button>
        <p class="ajuda" style="margin:0">Custo direto = tempo × hora + materiais. Total = direto + despesas indiretas. Preço = total + margem (arredondado para cima em R$ 0,50).</p></div></div>`,
    onOpen: box => {
      const num = id => Number(String($(id, box).value).replace(/\./g, '').replace(',', '.')) || 0;
      let sug = null;
      const calc = () => {
        sug = precoSugerido({ tempoMin: num('#sv-tempo'), custoHoraCentavos: lerValor($('#cl-hora', box).value) ?? 0, materiaisCentavos: lerValor($('#cl-mat', box).value) ?? 0,
          indiretasPct: num('#cl-ind'), margemPct: num('#cl-mar') });
        $('#cl-res', box).innerHTML = `<dt>Custo direto</dt><dd class="num">${brl(sug.direto)}</dd><dt>Custo total</dt><dd class="num">${brl(sug.total)}</dd>
          <dt><b>Preço sugerido</b></dt><dd class="num"><b>${brl(sug.preco)}</b></dd>`;
      };
      box.addEventListener('input', calc);
      $('#cl-usar', box).onclick = () => { $('#sv-preco', box).value = valorParaCampo(sug.preco); };
      calc();
    },
    actions: [{ label: 'Voltar' }, { label: 'Salvar', cls: 'pri', fn: async m => {
      const preco = lerValor($('#sv-preco', m).value || '0');
      const mo = lerValor($('#sv-mo', m).value || '0');
      if (preco === null || mo === null) { toast('Valor inválido.', true); return false; }
      const corpo = { categoria_id: $('#sv-cat', m).value, nome: $('#sv-nome', m).value.trim(), descricao: $('#sv-desc', m).value.trim(), unidade: $('#sv-un', m).value,
        preco_centavos: preco, tempo_min: Number($('#sv-tempo', m).value) || 0, custo_mao_obra_centavos: mo, ativo: $('#sv-ativo', m).checked };
      try { await api(s ? `/config/servicos/${s.id}` : '/config/servicos', { metodo: s ? 'PUT' : 'POST', corpo }); } catch (e) { toast(e.message, true); return false; }
      toast('Serviço salvo.');
      depois();
    } }],
  });
}
