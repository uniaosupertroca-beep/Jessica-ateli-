import { api, sessao } from '../api.js';
import { $, dataBR, esc, modal, nOS, opcoes, toast } from '../ui.js';
import { diaDaSemana, duracao, situacaoCarga, situacaoDia, somarDias, TIPOS_AGENDA } from '../regras.js';
import { linhaOS } from './inicio.js';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DIAS_L = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const COR_TIPO = { prova: 'warn', entrega: 'ok', retirada: 'ok', recebimento: 'info', atendimento: 'info', prazo_producao: 'neutral', ausencia: 'crit' };
const est = { mes: null, dia: null, vista: 'mes' };

export async function telaAgenda(el, _p, vivo) {
  est.mes ??= sessao.hoje.slice(0, 7);
  est.dia ??= sessao.hoje;
  const [y, m] = est.mes.split('-').map(Number);
  const primeiro = `${est.mes}-01`;
  const inicio = est.vista === 'mes' ? somarDias(primeiro, -diaDaSemana(primeiro)) : est.vista === 'semana' ? somarDias(est.dia, -diaDaSemana(est.dia)) : est.dia;
  const fim = somarDias(inicio, est.vista === 'mes' ? 41 : est.vista === 'semana' ? 6 : 0);
  const ag = await api(`/agenda?de=${inicio}&ate=${fim}`);
  if (!vivo()) return;
  const cap = ag.capacidade;
  const ocup = Object.fromEntries(ag.ocupacao.map(o => [o.prazo, o.qtd]));
  const doDia = d => ag.ordens.filter(o => o.prazo === d);
  const compDia = d => ag.compromissos.filter(c => c.dia === d);
  const sit = d => situacaoDia(ocup[d] || 0, cap, ag.limite_quase_cheio);
  const carga = d => ag.carga[d] || { capacidade_min: 0, demanda_min: 0, provas: 0 };
  const sitHoras = d => situacaoCarga(carga(d).demanda_min, carga(d).capacidade_min);
  const usaHoras = ag.profissionais.length > 0;
  const podeEditar = sessao.pode('agenda.editar');
  const pinos = n => `<span class="pins s-${situacaoDia(n, cap, ag.limite_quase_cheio)}" aria-hidden="true">${Array.from({ length: Math.min(cap, 12) }, (_, i) => `<i class="${i < n ? 'f' : ''}"></i>`).join('')}</span>`;
  const comp = c => `<div class="li" data-comp="${c.id}" style="cursor:${podeEditar ? 'pointer' : 'default'}"><div><div class="t">${c.hora_inicio ? `<span class="num">${esc(c.hora_inicio)}${c.hora_fim ? '–' + esc(c.hora_fim) : ''}</span> · ` : ''}${esc(c.titulo)}</div>
      <div class="s">${c.cliente ? esc(c.cliente) : ''}${c.profissional ? ' · 👤 ' + esc(c.profissional) : ''}${c.excecao ? ' · <span style="color:var(--warn)">encaixe justificado</span>' : ''}</div></div>
      <div style="text-align:right"><span class="pill p-${COR_TIPO[c.tipo]}">${esc(TIPOS_AGENDA[c.tipo])}</span>${c.status !== 'agendado' ? `<div class="s">${esc(c.status)}</div>` : ''}</div></div>`;
  const resumoDia = d => {
    const k = carga(d);
    return `${usaHoras ? `<div class="row ajuda" style="gap:12px"><span>Trabalho previsto: <b class="s-${sitHoras(d)}">${duracao(k.demanda_min)}</b> de ${duracao(k.capacidade_min)}</span>
      <span>Provas: <b>${k.provas}</b>/${ag.capacidade_provas_dia}</span>${k.ausentes?.length ? `<span style="color:var(--crit)">${k.ausentes.length} ausência(s)</span>` : ''}</div>` : ''}`;
  };
  let corpo = '';
  if (est.vista === 'mes') {
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = somarDias(inicio, i);
      const n = ocup[d] || 0;
      const nc = compDia(d).length;
      const lot = (n && sit(d) === 'lotado') || (usaHoras && sitHoras(d) === 'lotado');
      cells += `<button type="button" class="day ${d.slice(0, 7) !== est.mes ? 'out' : ''} ${d === ag.hoje ? 'hoje' : ''} ${d === est.dia ? 'sel' : ''} ${lot ? 'lotado' : ''}" data-dia="${d}" aria-label="${dataBR(d)}: ${n} entregas, ${nc} compromissos">
        <span class="dn">${+d.slice(8)}</span>${n ? `${pinos(n)}<span class="cnt s-${sit(d)}">${n}/${cap}${n > cap ? ' · encaixe' : ''}</span>` : ''}
        ${nc ? `<span class="cnt" style="color:var(--info)">${nc} compromisso${nc > 1 ? 's' : ''}</span>` : ''}
        ${usaHoras && carga(d).demanda_min ? `<span class="cnt s-${sitHoras(d)}">${duracao(carga(d).demanda_min)}</span>` : ''}</button>`;
    }
    corpo = `<div class="grid s21">
      <div class="panel"><div class="panel-h"><button class="btn sm" data-mes="-1" aria-label="Mês anterior">‹</button><h2 style="text-transform:capitalize">${MESES[m - 1]} ${y}</h2><button class="btn sm" data-mes="1" aria-label="Próximo mês">›</button></div>
        <div class="cal">${DIAS.map(d => `<span class="dow">${d}</span>`).join('')}${cells}</div>
        <div class="row muted" style="font-size:.82rem;gap:16px"><span><span class="pins s-livre"><i class="f"></i></span> livre</span><span><span class="pins s-quase"><i class="f"></i></span> quase cheio</span><span><span class="pins s-lotado"><i class="f"></i></span> lotado</span></div></div>
      ${painelDia(est.dia)}</div>`;
  } else if (est.vista === 'semana') {
    corpo = `<div class="panel-h"><button class="btn sm" data-sem="-7">‹ Semana anterior</button><b>${dataBR(inicio)} a ${dataBR(fim)}</b><button class="btn sm" data-sem="7">Próxima semana ›</button></div>
      <div class="grid g2">${Array.from({ length: 7 }, (_, i) => {
        const d = somarDias(inicio, i);
        const n = ocup[d] || 0;
        return `<div class="panel" style="padding:14px"><div class="panel-h"><h3>${DIAS_L[i]}, ${dataBR(d)}</h3><span class="row">${pinos(n)}<span class="num s-${sit(d)}" style="font-weight:600">${n}/${cap}</span></span></div>
          ${resumoDia(d)}<div class="list">${compDia(d).map(comp).join('')}${doDia(d).map(o => linhaOS(o)).join('') || (compDia(d).length ? '' : '<div class="empty">Dia livre.</div>')}</div></div>`;
      }).join('')}</div>`;
  } else {
    corpo = `<div class="panel-h"><button class="btn sm" data-sem="-1">‹ Dia anterior</button><b>${DIAS_L[diaDaSemana(est.dia)]}, ${dataBR(est.dia)}</b><button class="btn sm" data-sem="1">Próximo dia ›</button></div>
      ${painelDia(est.dia)}
      ${usaHoras ? `<div class="panel"><h2>Carga por profissional</h2>${ag.profissionais.map(p => {
        const x = carga(est.dia).por_profissional?.[p.id] || { capacidade_min: 0, demanda_min: 0 };
        const pct = x.capacidade_min ? Math.min(100, Math.round((x.demanda_min / x.capacidade_min) * 100)) : 0;
        return `<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px"><span>${esc(p.nome)}</span><span class="num">${duracao(x.demanda_min)} / ${x.capacidade_min ? duracao(x.capacidade_min) : 'folga'}</span>
          <div class="barra-carga" style="grid-column:span 2"><i class="${situacaoCarga(x.demanda_min, x.capacidade_min)}" style="width:${x.capacidade_min ? pct : 100}%"></i></div></div>`;
      }).join('')}</div>` : ''}`;
  }

  function painelDia(d) {
    const n = ocup[d] || 0;
    return `<div class="panel"><div class="panel-h"><h2>${DIAS_L[diaDaSemana(d)]}, ${dataBR(d)}</h2><span class="pill p-${{ livre: 'ok', quase: 'warn', lotado: 'crit' }[sit(d)]}">${n}/${cap} entregas</span></div>
      ${resumoDia(d)}
      ${compDia(d).length ? `<h3>Compromissos</h3><div class="list">${compDia(d).map(comp).join('')}</div>` : ''}
      <h3>Entregas</h3><div class="list">${doDia(d).map(o => linhaOS(o, o.tempo_min ? `${duracao(o.tempo_min)} previstas` : '')).join('') || '<div class="empty">Nenhuma entrega neste dia.</div>'}</div>
      <div class="row">${podeEditar ? `<button class="btn pri" data-novo="${d}">+ Agendar</button>` : ''}${sessao.pode('os.editar') && d >= ag.hoje ? '<a class="btn" href="#ordens/nova">+ Nova OS</a>' : ''}</div></div>`;
  }

  el.innerHTML = `<div class="head"><div><h1>Agenda</h1><p>Entregas (até ${cap}/dia), provas (até ${ag.capacidade_provas_dia}/dia)${usaHoras ? ' e horas de trabalho previstas' : ''}. Funcionamento ${esc(ag.horario_inicio)}–${esc(ag.horario_fim)}.</p></div>
      <div class="tabs" style="border:none"><button class="${est.vista === 'dia' ? 'on' : ''}" data-vista="dia">Dia</button><button class="${est.vista === 'semana' ? 'on' : ''}" data-vista="semana">Semana</button><button class="${est.vista === 'mes' ? 'on' : ''}" data-vista="mes">Mês</button></div></div>
    ${!usaHoras && sessao.pode('usuarios.gerenciar') ? '<div class="alert a-info">Para a agenda calcular a capacidade por horas, informe em Configurações → Equipe quantas horas cada profissional trabalha por dia.</div>' : ''}
    ${corpo}`;
  el.onclick = e => {
    const b = e.target.closest('[data-dia],[data-mes],[data-sem],[data-vista],[data-novo],[data-comp]');
    if (!b) return;
    if (b.dataset.novo) return modalCompromisso({ dia: b.dataset.novo }, () => telaAgenda(el, _p, vivo));
    if (b.dataset.comp) {
      if (!podeEditar) return;
      return modalCompromisso(ag.compromissos.find(c => c.id === b.dataset.comp), () => telaAgenda(el, _p, vivo));
    }
    if (b.dataset.dia) { est.dia = b.dataset.dia; est.mes = est.dia.slice(0, 7); }
    if (b.dataset.mes) { const d = new Date(Date.UTC(y, m - 1 + Number(b.dataset.mes), 1)); est.mes = d.toISOString().slice(0, 7); }
    if (b.dataset.sem) { est.dia = somarDias(est.dia, Number(b.dataset.sem)); est.mes = est.dia.slice(0, 7); }
    if (b.dataset.vista) est.vista = b.dataset.vista;
    telaAgenda(el, _p, vivo);
  };
}

/** Novo compromisso ou edição. `base` pode trazer dia, tipo, order_id, item_id, client_id. */
export function modalCompromisso(base, depois) {
  const editando = !!base.id;
  const profs = sessao.config.usuarios;
  modal({
    title: editando ? 'Compromisso' : 'Agendar',
    body: `<div class="grid g2" style="gap:12px">
      <div class="field"><label for="c-tipo">Tipo</label><select class="in" id="c-tipo" ${editando ? 'disabled' : ''}>${Object.entries(TIPOS_AGENDA).map(([k, l]) => `<option value="${k}" ${(base.tipo || 'prova') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label for="c-dia">Dia</label><input class="in" type="date" id="c-dia" value="${base.dia || sessao.hoje}"></div>
      <div class="field"><label for="c-ini">Início</label><input class="in" type="time" id="c-ini" value="${base.hora_inicio || ''}"></div>
      <div class="field"><label for="c-fim">Fim</label><input class="in" type="time" id="c-fim" value="${base.hora_fim || ''}"></div>
      <div class="field" style="grid-column:1/-1"><label for="c-prof">Profissional</label><select class="in" id="c-prof">${opcoes(profs, base.profissional_id, '— nenhuma —')}</select></div>
      <div class="field" style="grid-column:1/-1"><label for="c-tit">Título (opcional)</label><input class="in" id="c-tit" value="${esc(base.titulo || '')}" placeholder="Gerado a partir da OS ou da cliente"></div>
      <div class="field" style="grid-column:1/-1"><label for="c-obs">Observações</label><input class="in" id="c-obs" value="${esc(base.observacoes || '')}"></div></div>
      ${base.order_id ? `<p class="ajuda">Vinculado à ${base.numero ? nOS(base.numero) : 'OS'}.</p>` : '<p class="ajuda">Para ligar a uma OS, agende pela tela da OS.</p>'}
      <div id="c-conf"></div>`,
    actions: [
      { label: 'Voltar' },
      ...(editando ? [{ label: 'Cancelar compromisso', cls: 'danger', fn: async () => {
        try { await api(`/agenda/compromissos/${base.id}`, { metodo: 'PATCH', corpo: { status: 'cancelado' } }); } catch (e) { toast(e.message, true); return false; }
        toast('Compromisso cancelado.'); depois();
      } }, { label: 'Realizado', cls: 'sec', fn: async () => {
        try { await api(`/agenda/compromissos/${base.id}`, { metodo: 'PATCH', corpo: { status: 'realizado' } }); } catch (e) { toast(e.message, true); return false; }
        toast('Marcado como realizado.'); depois();
      } }] : []),
      { label: 'Salvar', cls: 'pri', fn: async m => {
        const corpo = {
          tipo: $('#c-tipo', m).value, dia: $('#c-dia', m).value, hora_inicio: $('#c-ini', m).value || null, hora_fim: $('#c-fim', m).value || null,
          profissional_id: $('#c-prof', m).value || null, titulo: $('#c-tit', m).value.trim() || undefined, observacoes: $('#c-obs', m).value.trim(),
          order_id: base.order_id || null, item_id: base.item_id || null, client_id: base.client_id || null,
          excecao: $('#c-exc', m)?.value.trim() || undefined,
        };
        try {
          await api(editando ? `/agenda/compromissos/${base.id}` : '/agenda/compromissos', { metodo: editando ? 'PUT' : 'POST', corpo });
        } catch (e) {
          if (e.codigo === 'conflito_agenda') {
            $('#c-conf', m).innerHTML = `<div class="alert a-warn" style="margin-top:10px"><b>Conflitos:</b><br>${e.dados.conflitos.map(esc).join('<br>')}</div>
              ${e.dados.pode_excecao ? '<div class="field" style="margin-top:8px"><label for="c-exc">Justificativa para encaixar mesmo assim</label><input class="in" id="c-exc"></div>'
                : '<p class="ajuda">Escolha outro horário ou peça ao administrador para encaixar.</p>'}`;
            return false;
          }
          toast(e.message, true);
          return false;
        }
        toast('Agenda atualizada.');
        depois();
      } },
    ],
  });
}
