import { api, sessao } from '../api.js';
import { $, brl, dataBR, esc } from '../ui.js';
import { duracao, ORIGENS_CLIENTE, paraCSV, somarDias, STATUS_OS } from '../regras.js';
import { barrasH, linhas } from '../graficos.js';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const est = { de: null, ate: null, profissional: '', categoria: '' };
const brlCurto = c => {
  const v = c / 100;
  return Math.abs(v) >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : brl(c).replace(',00', '');
};

export async function telaRelatorios(el, _p, vivo) {
  const hoje = sessao.hoje;
  est.de ??= `${hoje.slice(0, 7)}-01`;
  est.ate ??= hoje;
  const r = await api(`/relatorios?${new URLSearchParams({ de: est.de, ate: est.ate, ...(est.profissional && { profissional: est.profissional }), ...(est.categoria && { categoria: est.categoria }) })}`);
  if (!vivo()) return;
  const a = r.atual;
  const b = r.anterior;
  const varia = (x, y) => {
    if (!y) return '';
    const p = Math.round(((x - y) / Math.abs(y)) * 100);
    return `<span class="${p >= 0 ? 's-livre' : 's-lotado'}" style="font-weight:600">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}%</span> vs. período anterior`;
  };
  const card = (lbl, val, sub, cor = '') => `<div class="panel stat"><span class="lbl">${lbl}</span><span class="val num" ${cor ? `style="color:${cor}"` : ''}>${val}</span><span class="sub">${sub}</span></div>`;
  const presets = [['mes', 'Este mês', `${hoje.slice(0, 7)}-01`, hoje], ['30', 'Últimos 30 dias', somarDias(hoje, -29), hoje],
    ['90', 'Últimos 90 dias', somarDias(hoje, -89), hoje], ['ano', 'Este ano', `${hoje.slice(0, 4)}-01-01`, hoje]];
  el.innerHTML = `<div class="head"><div><h1>Relatórios</h1><p>${sessao.unidades.length > 1 ? `<b>${esc(sessao.unidades.find(u => u.id === sessao.unidade)?.nome || 'Todas as unidades')}</b> · ` : ''}${dataBR(r.de)} a ${dataBR(r.ate)} · comparado com ${dataBR(r.periodo_anterior.de)} a ${dataBR(r.periodo_anterior.ate)}</p></div>
      <div class="row nao-imprimir"><button class="btn" data-csv>Exportar CSV</button><button class="btn" data-imprimir>Imprimir</button></div></div>
    <div class="panel nao-imprimir"><div class="row">${presets.map(([k, l, de, ate]) => `<button class="btn sm ${est.de === de && est.ate === ate ? 'sec' : 'ghost'}" data-de="${de}" data-ate="${ate}">${l}</button>`).join('')}
      <label class="row" style="gap:6px">De <input class="in" type="date" id="r-de" value="${est.de}" style="width:auto"></label>
      <label class="row" style="gap:6px">até <input class="in" type="date" id="r-ate" value="${est.ate}" max="${hoje}" style="width:auto"></label>
      <select class="in" id="r-prof" style="width:auto" aria-label="Profissional"><option value="">Todas as profissionais</option>${r.filtros.profissionais.map(p => `<option value="${esc(p.id)}" ${est.profissional === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select>
      <select class="in" id="r-cat" style="width:auto" aria-label="Categoria de serviço"><option value="">Todas as categorias</option>${r.filtros.categorias.map(p => `<option value="${esc(p.id)}" ${est.categoria === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></div>
      ${est.profissional || est.categoria ? '<p class="ajuda" style="margin:0">Profissional e categoria filtram "Serviços mais realizados" e "Produtividade". Os indicadores financeiros acima são do ateliê todo.</p>' : ''}</div>
    <div class="grid g4">
      ${card('Faturamento', brl(a.faturamento), `${a.os_entregues} OS entregues · ${varia(a.faturamento, b.faturamento) || 'sem comparação'}`)}
      ${card('Recebido', brl(a.recebido), varia(a.recebido, b.recebido) || 'pagamentos de clientes', 'var(--ok)')}
      ${card('Despesas', brl(a.despesas), varia(a.despesas, b.despesas) || 'saídas do caixa', 'var(--crit)')}
      ${card('A receber', brl(a.a_receber), 'saldo atual das OS', 'var(--warn)')}
    </div>
    <div class="grid g4">
      ${card('Ticket médio', brl(a.ticket_medio), `${a.pecas_entregues} peças entregues`)}
      ${card('Custo de materiais', brl(a.custo_materiais), 'consumo lançado nas OS')}
      ${card('Lucro estimado', brl(a.lucro_estimado), a.mao_obra_configurada ? `faturamento − materiais − mão de obra estimada (${brl(a.mao_obra_estimada)})` : 'faturamento − materiais (informe o custo da hora para descontar a mão de obra)')}
      ${card('Resultado de caixa', brl(a.resultado_caixa), 'recebido − despesas (realizado)', a.resultado_caixa >= 0 ? 'var(--ok)' : 'var(--crit)')}
    </div>
    ${r.por_unidade?.length ? `<div class="panel"><h2>Comparativo entre unidades</h2><div class="tw"><table><thead><tr><th>Unidade</th><th class="r">Faturamento</th><th class="r">OS entregues</th>
        <th class="r">Ticket médio</th><th class="r">Recebido</th><th class="r">Despesas</th><th class="r">Resultado de caixa</th><th class="r">Lucro estimado</th><th class="r">A receber</th></tr></thead><tbody>
      ${r.por_unidade.map(u => `<tr><td><b>${esc(u.nome)}</b> <span class="tag-un">${esc(u.sigla)}</span></td><td class="r num">${brl(u.faturamento)}</td><td class="r num">${u.os_entregues}</td>
        <td class="r num">${brl(u.ticket_medio)}</td><td class="r num">${brl(u.recebido)}</td><td class="r num">${brl(u.despesas)}</td>
        <td class="r num" style="color:${u.resultado_caixa >= 0 ? 'var(--ok)' : 'var(--crit)'}">${brl(u.resultado_caixa)}</td><td class="r num">${brl(u.lucro_estimado)}</td><td class="r num">${brl(u.a_receber)}</td></tr>`).join('')}
      </tbody></table></div><p class="ajuda" style="margin:0">Despesas do grupo (sem unidade) entram no caixa da unidade que pagou.</p></div>` : ''}
    <div class="panel"><div class="panel-h"><h2>Evolução mensal</h2><span class="ajuda">últimos 12 meses</span></div><div id="g-mensal"></div>
      <details><summary class="ajuda">Ver em tabela</summary><div class="tw"><table><thead><tr><th>Mês</th><th class="r">Faturamento</th><th class="r">Recebido</th><th class="r">Despesas</th></tr></thead><tbody>
        ${r.mensal.map(x => `<tr><td>${MESES[+x.mes.slice(5) - 1]}/${x.mes.slice(0, 4)}</td><td class="r num">${brl(x.faturamento)}</td><td class="r num">${brl(x.recebido)}</td><td class="r num">${brl(x.despesas)}</td></tr>`).join('')}</tbody></table></div></details></div>
    <div class="grid g2">
      <div class="panel"><h2>Recebido por forma de pagamento</h2><div id="g-formas"></div></div>
      <div class="panel"><h2>Despesas por categoria</h2><div id="g-desp"></div></div>
    </div>
    <div class="panel"><h2>Serviços mais realizados</h2>${r.servicos.length ? `<div class="tw"><table><thead><tr><th>Serviço</th><th class="r">Vezes</th><th class="r">Receita</th><th class="r">Tempo previsto</th><th class="r">Tempo real médio/peça</th>
        ${r.custo_hora_centavos ? '<th class="r">Mão de obra est.</th><th class="r">Margem est.</th>' : ''}</tr></thead><tbody>
      ${r.servicos.map(s => `<tr><td>${esc(s.servico)}</td><td class="r num">${s.vezes}</td><td class="r num">${brl(s.receita)}</td><td class="r num">${s.tempo_min ? duracao(s.tempo_min) : '—'}</td>
        <td class="r num">${s.tempo_real_medio ? duracao(s.tempo_real_medio) : '—'}</td>${r.custo_hora_centavos ? `<td class="r num">${brl(s.mao_obra)}</td><td class="r num">${brl(s.margem)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Nenhuma OS entregue no período.</div>'}</div>
    <div class="grid g2">
      <div class="panel"><h2>OS abertas no período, por situação</h2>${r.situacao.length ? `<div class="tw"><table><thead><tr><th>Situação</th><th class="r">OS</th></tr></thead><tbody>
        ${r.situacao.map(x => `<tr><td>${esc(STATUS_OS[x.status] || x.status)}</td><td class="r num">${x.n}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nenhuma OS aberta no período.</div>'}</div>
      <div class="panel"><h2>Como as clientes conheceram o ateliê</h2>${r.origens.length ? `<div class="tw"><table><thead><tr><th>Origem</th><th class="r">Clientes</th></tr></thead><tbody>
        ${r.origens.map(x => `<tr><td>${esc(ORIGENS_CLIENTE[x.origem] || 'Não informado')}</td><td class="r num">${x.n}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Sem clientes atendidas no período.</div>'}</div>
    </div>
    <div class="grid g2">
      <div class="panel"><h2>Produtividade da equipe</h2>${r.produtividade.length ? `<div class="tw"><table><thead><tr><th>Profissional</th><th class="r">Peças</th><th class="r">Tempo real</th><th class="r">Previsto</th><th class="r">Retrabalhos</th></tr></thead><tbody>
        ${r.produtividade.map(p => `<tr><td>${esc(p.nome)}</td><td class="r num">${p.pecas}</td><td class="r num">${duracao(p.tempo_real)}</td><td class="r num">${duracao(p.tempo_previsto)}</td><td class="r num">${p.retrabalhos}</td></tr>`).join('')}</tbody></table></div>
        <p class="ajuda" style="margin:0">Tempo médio por peça: ${duracao(r.produtividade.reduce((s, p) => s + p.tempo_real, 0) / Math.max(1, r.produtividade.reduce((s, p) => s + p.pecas, 0)))}</p>` : '<div class="empty">Nenhuma peça finalizada no período.</div>'}</div>
      <div class="panel"><h2>Clientes</h2>
        <dl class="kv"><dt>Atendidas no período</dt><dd class="num">${r.recorrencia?.atendidas ?? 0}</dd><dt>Recorrentes (2+ OS)</dt><dd class="num">${r.recorrencia?.recorrentes ?? 0}</dd>
          <dt>Entregas no prazo</dt><dd class="num">${r.atrasos?.entregues ? `${r.atrasos.entregues - (r.atrasos.entregues_atrasadas || 0)} de ${r.atrasos.entregues}` : '—'}</dd>
          <dt>Atrasadas agora</dt><dd class="num">${r.atrasos?.atrasadas_agora ?? 0}</dd></dl>
        ${r.clientes.length ? `<h3>Quem mais trouxe serviço</h3><div class="list">${r.clientes.slice(0, 8).map(c => `<a class="li" href="#clientes/${c.id}" style="color:inherit;text-decoration:none"><span>${esc(c.nome)} <span class="muted">· ${c.os} OS</span></span><b class="num">${brl(c.total)}</b></a>`).join('')}</div>` : ''}</div>
    </div>
    <div class="panel"><h2>Consumo de materiais</h2>${r.materiais.length ? `<div class="tw"><table><thead><tr><th>Material</th><th class="r">Quantidade</th><th class="r">Custo</th></tr></thead><tbody>
      ${r.materiais.map(m => `<tr><td>${esc(m.nome)}</td><td class="r num">${String(m.qtd_consumida).replace('.', ',')} ${esc(m.unidade)}</td><td class="r num">${brl(m.custo)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Nenhum material lançado em OS no período.</div>'}</div>
    <p class="ajuda">Faturamento = total das OS entregues no período. Recebido = dinheiro que entrou de clientes (uso de crédito não conta), já descontados estornos e devoluções.
      Despesas = saídas do caixa, exceto sangria e devolução a cliente. Lucro estimado é uma previsão; o resultado de caixa é o realizado.</p>`;

  const rot = r.mensal.map(x => `${MESES[+x.mes.slice(5) - 1]}/${x.mes.slice(2, 4)}`);
  if (r.mensal.length) linhas($('#g-mensal', el), rot, [
    { nome: 'Faturamento', classe: 'serie-1', valores: r.mensal.map(x => x.faturamento) },
    { nome: 'Recebido', classe: 'serie-2', valores: r.mensal.map(x => x.recebido) },
    { nome: 'Despesas', classe: 'serie-3', valores: r.mensal.map(x => x.despesas) },
  ], { fmt: brl, fmtEixo: brlCurto, nome: 'Evolução mensal de faturamento, recebido e despesas' });
  else $('#g-mensal', el).innerHTML = '<div class="empty">Ainda não há movimento para mostrar.</div>';
  barrasH($('#g-formas', el), r.formas.map(f => ({ rotulo: f.nome, valor: f.valor })), { fmt: brl, nome: 'Recebido por forma de pagamento' });
  barrasH($('#g-desp', el), r.despesas_categoria.map(f => ({ rotulo: f.nome, valor: f.valor })), { fmt: brl, nome: 'Despesas por categoria' });

  el.onclick = e => {
    const p = e.target.closest('[data-de]');
    if (p) { est.de = p.dataset.de; est.ate = p.dataset.ate; return telaRelatorios(el, _p, vivo); }
    if (e.target.closest('[data-imprimir]')) window.print();
    if (e.target.closest('[data-csv]')) exportar(r);
  };
  el.onchange = e => {
    if (e.target.id === 'r-de' && e.target.value) est.de = e.target.value;
    if (e.target.id === 'r-ate' && e.target.value) est.ate = e.target.value;
    if (e.target.id === 'r-prof') est.profissional = e.target.value;
    if (e.target.id === 'r-cat') est.categoria = e.target.value;
    if (['r-de', 'r-ate', 'r-prof', 'r-cat'].includes(e.target.id)) telaRelatorios(el, _p, vivo);
  };
}

function exportar(r) {
  const reais = c => ((c || 0) / 100).toFixed(2).replace('.', ',');
  const partes = [
    `Relatório Ateliê Jessica;${r.de} a ${r.ate}`,
    '',
    paraCSV([{ titulo: 'Indicador', valor: x => x[0] }, { titulo: 'Período (R$)', valor: x => x[1] }, { titulo: 'Período anterior (R$)', valor: x => x[2] }],
      [['Faturamento', 'faturamento'], ['Recebido', 'recebido'], ['Despesas', 'despesas'], ['A receber', 'a_receber'], ['Ticket médio', 'ticket_medio'],
        ['Custo de materiais', 'custo_materiais'], ['Mão de obra estimada', 'mao_obra_estimada'], ['Lucro estimado', 'lucro_estimado'], ['Resultado de caixa', 'resultado_caixa']]
        .map(([n, k]) => [n, reais(r.atual[k]), reais(r.anterior[k])])),
    '',
    paraCSV([{ titulo: 'Mês', valor: x => x.mes }, { titulo: 'Faturamento', valor: x => reais(x.faturamento) }, { titulo: 'Recebido', valor: x => reais(x.recebido) }, { titulo: 'Despesas', valor: x => reais(x.despesas) }], r.mensal),
    '',
    paraCSV([{ titulo: 'Serviço', valor: x => x.servico }, { titulo: 'Vezes', valor: x => x.vezes }, { titulo: 'Receita', valor: x => reais(x.receita) }, { titulo: 'Tempo previsto (min)', valor: x => x.tempo_min }], r.servicos),
    '',
    paraCSV([{ titulo: 'Profissional', valor: x => x.nome }, { titulo: 'Peças', valor: x => x.pecas }, { titulo: 'Tempo real (min)', valor: x => x.tempo_real }, { titulo: 'Retrabalhos', valor: x => x.retrabalhos }], r.produtividade),
    '',
    paraCSV([{ titulo: 'Material', valor: x => x.nome }, { titulo: 'Quantidade', valor: x => String(x.qtd_consumida).replace('.', ',') }, { titulo: 'Unidade', valor: x => x.unidade }, { titulo: 'Custo', valor: x => reais(x.custo) }], r.materiais),
  ];
  const blob = new Blob(['﻿' + partes.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: `relatorio-${r.de}-a-${r.ate}.csv` }).click();
  URL.revokeObjectURL(url);
}
