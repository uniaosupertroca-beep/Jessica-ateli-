import { api, sessao } from '../api.js';
import { $, $$, dataBR, dataHora, esc, modal, nOS, toast } from '../ui.js';
import { COLUNAS_KANBAN, duracao, minutosEntre, situacaoCarga, STATUS_PRODUCAO } from '../regras.js';

const filtro = { responsavel: '', prazo: '', q: '', urgentes: false };

export async function telaProducao(el, _p, vivo) {
  const podeAtribuir = sessao.pode('producao.atribuir');
  const carregar = async () => {
    const qs = new URLSearchParams({ ...(filtro.responsavel && { responsavel: filtro.responsavel }), ...(filtro.prazo && { prazo: filtro.prazo }),
      ...(filtro.q && { q: filtro.q }), ...(filtro.urgentes && { urgentes: '1' }) });
    const d = await api('/producao?' + qs);
    if (!vivo()) return;
    desenhar(d);
  };

  const desenhar = d => {
    const agora = new Date().toISOString();
    const real = p => p.tempo_real_min + (p.status_producao === 'em_execucao' && p.iniciado_em ? Math.min(600, minutosEntre(p.iniciado_em, agora)) : 0);
    const cartao = p => {
      const atrasado = p.prazo < d.hoje && p.status_producao !== 'finalizado';
      const idx = COLUNAS_KANBAN.indexOf(p.status_producao);
      const minha = p.responsavel_id === sessao.eu.id;
      const pode = sessao.eu.papel !== 'costureira' || minha;
      return `<article class="cartao ${p.urgente ? 'urgente' : ''} ${atrasado ? 'atrasado' : ''}" draggable="${pode}" data-id="${p.id}" data-os="${p.order_id}">
        <div class="topo"><a href="#ordens/${p.order_id}" class="num" style="font-size:.78rem;color:var(--muted)">${esc(p.codigo)} · ${nOS(p.numero)}</a>
          ${p.urgente ? '<span class="pill p-crit">urgente</span>' : ''}</div>
        <b>${esc(p.peca)}</b>
        <span class="ajuda">${esc(p.cliente)} · ${esc(p.servicos || '')}</span>
        <span class="ajuda prazo">Prazo ${dataBR(p.prazo)}${atrasado ? ' · atrasada' : ''}${p.proxima_prova ? ` · prova ${dataBR(p.proxima_prova.slice(0, 10))} ${esc(p.proxima_prova.slice(11))}` : ''}</span>
        <span class="cron">${p.tempo_previsto ? `previsto ${duracao(p.tempo_previsto)} · ` : ''}feito ${duracao(real(p))}${p.retrabalhos ? ` · ${p.retrabalhos} retrabalho(s)` : ''}</span>
        ${p.obs_interna ? `<span class="ajuda" style="color:var(--warn)">📝 ${esc(p.obs_interna)}</span>` : ''}
        <span class="ajuda">${p.responsavel_nome ? '👤 ' + esc(p.responsavel_nome) : '<i>sem responsável</i>'}</span>
        <div class="acoes">
          ${pode && idx > 0 ? `<button class="btn sm ghost" data-mover="${COLUNAS_KANBAN[idx - 1]}" aria-label="Voltar etapa">‹</button>` : ''}
          ${pode && idx < COLUNAS_KANBAN.length - 1 ? `<button class="btn sm sec" data-mover="${COLUNAS_KANBAN[idx + 1]}">${STATUS_PRODUCAO[COLUNAS_KANBAN[idx + 1]]} ›</button>` : ''}
          ${!p.responsavel_id ? '<button class="btn sm" data-assumir>Assumir</button>' : ''}
          <button class="btn sm ghost" data-detalhe>Detalhes</button></div></article>`;
    };
    const colunas = COLUNAS_KANBAN.map(st => {
      const lista = d.pecas.filter(p => p.status_producao === st);
      return `<section class="coluna" data-coluna="${st}" aria-label="${STATUS_PRODUCAO[st]}"><h3>${STATUS_PRODUCAO[st]} <span class="pill p-neutral">${lista.length}</span></h3>
        ${lista.map(cartao).join('') || '<div class="empty" style="padding:6px">Nenhuma peça.</div>'}</section>`;
    }).join('');
    el.innerHTML = `<div class="head"><div><h1>Produção</h1><p>Arraste os cartões entre as colunas (ou use os botões). O tempo de execução é contado sozinho.</p></div></div>
      ${d.profissionais.length && sessao.eu.papel !== 'costureira' ? `<div class="grid g4">${d.profissionais.map(p => {
        const sit = situacaoCarga(p.carga_min, p.capacidade_min_dia);
        const pct = p.capacidade_min_dia ? Math.min(100, Math.round((p.carga_min / p.capacidade_min_dia) * 100)) : 0;
        return `<div class="panel stat" style="gap:6px"><div class="topo"><span class="lbl">${esc(p.nome)}</span><span class="pill p-neutral">${p.pecas} peça(s)</span></div>
          <span class="sub">${duracao(p.carga_min)} na fila${p.capacidade_min_dia ? ` · ${duracao(p.capacidade_min_dia)}/dia` : ''}</span>
          ${p.capacidade_min_dia ? `<div class="barra-carga" title="${pct}% de um dia de trabalho"><i class="${sit}" style="width:${pct}%"></i></div>` : ''}</div>`;
      }).join('')}</div>` : ''}
      <div class="panel"><div class="row">
        <input class="in" id="pr-q" type="search" placeholder="Buscar peça, código, cliente ou nº da OS" value="${esc(filtro.q)}" style="flex:1;min-width:200px">
        ${podeAtribuir ? `<select class="in" id="pr-resp" style="width:auto"><option value="">Todas as profissionais</option><option value="sem" ${filtro.responsavel === 'sem' ? 'selected' : ''}>Sem responsável</option>
          ${sessao.config.usuarios.map(u => `<option value="${u.id}" ${filtro.responsavel === u.id ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')}</select>` : ''}
        <select class="in" id="pr-prazo" style="width:auto"><option value="">Qualquer prazo</option><option value="atrasadas" ${filtro.prazo === 'atrasadas' ? 'selected' : ''}>Atrasadas</option>
          <option value="hoje" ${filtro.prazo === 'hoje' ? 'selected' : ''}>Até hoje</option><option value="semana" ${filtro.prazo === 'semana' ? 'selected' : ''}>Próximos 7 dias</option></select>
        <label class="chk"><input type="checkbox" id="pr-urg" ${filtro.urgentes ? 'checked' : ''}> Só urgentes</label></div></div>
      <div class="kanban">${colunas}</div>`;
    ligar(d);
  };

  const mover = async (id, os, para, extra = {}) => {
    try {
      const r = await api(`/ordens/${os}/itens/${id}?resposta=curta`, { metodo: 'PATCH', corpo: { status_producao: para, ...extra } });
      toast(`${STATUS_PRODUCAO[para]}.${r.status_os === 'pronta' ? ' A OS ficou pronta!' : ''}`);
    } catch (e) { toast(e.message, true); }
    carregar();
  };

  const ligar = d => {
    let t;
    $('#pr-q', el)?.addEventListener('input', e => { filtro.q = e.target.value; clearTimeout(t); t = setTimeout(carregar, 300); });
    $('#pr-resp', el)?.addEventListener('change', e => { filtro.responsavel = e.target.value; carregar(); });
    $('#pr-prazo', el)?.addEventListener('change', e => { filtro.prazo = e.target.value; carregar(); });
    $('#pr-urg', el)?.addEventListener('change', e => { filtro.urgentes = e.target.checked; carregar(); });
    $$('.cartao', el).forEach(c => {
      c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', c.dataset.id); c.style.opacity = '.5'; });
      c.addEventListener('dragend', () => { c.style.opacity = ''; });
    });
    $$('.coluna', el).forEach(col => {
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('alvo'); });
      col.addEventListener('dragleave', () => col.classList.remove('alvo'));
      col.addEventListener('drop', e => {
        e.preventDefault();
        col.classList.remove('alvo');
        const id = e.dataTransfer.getData('text/plain');
        const p = d.pecas.find(x => x.id === id);
        if (p && p.status_producao !== col.dataset.coluna) mover(p.id, p.order_id, col.dataset.coluna);
      });
    });
    el.onclick = async e => {
      const c = e.target.closest('.cartao');
      if (!c) return;
      const p = d.pecas.find(x => x.id === c.dataset.id);
      const b = e.target.closest('button');
      if (!b) return;
      b.disabled = true;
      if (b.dataset.mover) await mover(p.id, p.order_id, b.dataset.mover);
      else if (b.hasAttribute('data-assumir')) {
        try { await api(`/ordens/${p.order_id}/itens/${p.id}?resposta=curta`, { metodo: 'PATCH', corpo: { assumir: true } }); toast('A peça agora é sua.'); } catch (er) { toast(er.message, true); }
        carregar();
      } else if (b.hasAttribute('data-detalhe')) detalhes(p);
      b.disabled = false;
    };
  };

  const detalhes = async p => {
    const { eventos } = await api(`/producao/${p.id}/eventos`);
    const pode = sessao.eu.papel !== 'costureira' || p.responsavel_id === sessao.eu.id;
    const ROT = { inicio: 'Início', pausa: 'Pausa', fim: 'Finalizada', retrabalho: 'Retrabalho', atribuicao: 'Responsável', observacao: 'Observação', tempo: 'Tempo lançado', urgencia: 'Urgência' };
    modal({
      title: `${p.codigo} · ${p.peca}`,
      body: `<p class="ajuda" style="margin-top:0">${esc(p.cliente)} · ${nOS(p.numero)} · prazo ${dataBR(p.prazo)}</p>
        ${pode ? `<div class="field"><label for="d-obs">Observação interna (não aparece para a cliente)</label><textarea class="in" id="d-obs">${esc(p.obs_interna || '')}</textarea></div>
        <div class="row" style="margin-top:8px"><label class="row" style="gap:6px">Lançar tempo (min) <input class="in num" id="d-tempo" type="number" min="1" max="1440" style="width:90px"></label>
        ${podeAtribuir ? `<label class="chk"><input type="checkbox" id="d-urg" ${p.urgente ? 'checked' : ''}> Urgente</label>` : ''}</div>
        ${podeAtribuir ? `<div class="field" style="margin-top:8px"><label for="d-resp">Responsável</label><select class="in" id="d-resp"><option value="">— sem responsável —</option>
          ${sessao.config.usuarios.map(u => `<option value="${u.id}" ${p.responsavel_id === u.id ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')}</select></div>` : ''}` : ''}
        <h3 style="margin-top:14px">Histórico</h3><div class="hist">${eventos.map(ev => `<div><span class="muted num">${dataHora(ev.em)}</span><b>${ROT[ev.tipo] || ev.tipo}</b>
          ${ev.minutos ? `<span>${duracao(ev.minutos)}</span>` : ''}${ev.texto ? `<span class="muted">${esc(ev.texto)}</span>` : ''}<span class="muted">${esc(ev.usuario || '')}</span></div>`).join('') || '<div class="empty">Sem eventos.</div>'}</div>`,
      actions: [{ label: 'Fechar' }, ...(pode ? [{ label: 'Salvar', cls: 'pri', fn: async m => {
        const corpo = { obs_interna: $('#d-obs', m).value.trim() };
        const t = Number($('#d-tempo', m).value);
        if (t) corpo.tempo_manual_min = t;
        if ($('#d-urg', m)) corpo.urgente = $('#d-urg', m).checked;
        if ($('#d-resp', m) && ($('#d-resp', m).value || null) !== p.responsavel_id) corpo.responsavel_id = $('#d-resp', m).value || null;
        try { await api(`/ordens/${p.order_id}/itens/${p.id}?resposta=curta`, { metodo: 'PATCH', corpo }); } catch (e) { toast(e.message, true); return false; }
        toast('Peça atualizada.');
        carregar();
      } }] : [])],
    });
  };

  await carregar();
}
