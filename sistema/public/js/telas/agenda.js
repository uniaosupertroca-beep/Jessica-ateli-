import { api, sessao } from '../api.js';
import { $, dataBR, esc } from '../ui.js';
import { situacaoDia, somarDias } from '../regras.js';
import { linhaOS } from './inicio.js';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DIAS_L = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const est = { mes: null, dia: null, vista: 'mes' };

const diaDaSemana = iso => new Date(iso + 'T12:00:00Z').getUTCDay();

export async function telaAgenda(el, _p, vivo) {
  est.mes ??= sessao.hoje.slice(0, 7);
  est.dia ??= sessao.hoje;
  const [y, m] = est.mes.split('-').map(Number);
  const primeiro = `${est.mes}-01`;
  const inicio = est.vista === 'mes' ? somarDias(primeiro, -diaDaSemana(primeiro)) : somarDias(est.dia, -diaDaSemana(est.dia));
  const fim = somarDias(inicio, est.vista === 'mes' ? 41 : 6);
  const ag = await api(`/agenda?de=${inicio}&ate=${fim}`);
  if (!vivo()) return;
  const cap = ag.capacidade;
  const ocup = Object.fromEntries(ag.ocupacao.map(o => [o.prazo, o.qtd]));
  const doDia = d => ag.ordens.filter(o => o.prazo === d);
  const sit = d => situacaoDia(ocup[d] || 0, cap, ag.limite_quase_cheio);
  const pinos = n => `<span class="pins s-${situacaoDia(n, cap, ag.limite_quase_cheio)}" aria-hidden="true">${Array.from({ length: Math.min(cap, 12) }, (_, i) => `<i class="${i < n ? 'f' : ''}"></i>`).join('')}</span>`;
  let corpo = '';
  if (est.vista === 'mes') {
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = somarDias(inicio, i);
      const n = ocup[d] || 0;
      cells += `<button type="button" class="day ${d.slice(0, 7) !== est.mes ? 'out' : ''} ${d === ag.hoje ? 'hoje' : ''} ${d === est.dia ? 'sel' : ''} ${n && sit(d) === 'lotado' ? 'lotado' : ''}" data-dia="${d}" aria-label="${dataBR(d)}: ${n} entregas">
        <span class="dn">${+d.slice(8)}</span>${n ? `${pinos(n)}<span class="cnt s-${sit(d)}">${n}/${cap}${n > cap ? ' · encaixe' : ''}</span>` : ''}</button>`;
    }
    const lista = doDia(est.dia);
    const n = ocup[est.dia] || 0;
    corpo = `<div class="grid s21">
      <div class="panel"><div class="panel-h"><button class="btn sm" data-mes="-1" aria-label="Mês anterior">‹</button><h2 style="text-transform:capitalize">${MESES[m - 1]} ${y}</h2><button class="btn sm" data-mes="1" aria-label="Próximo mês">›</button></div>
        <div class="cal">${DIAS.map(d => `<span class="dow">${d}</span>`).join('')}${cells}</div>
        <div class="row muted" style="font-size:.82rem;gap:16px"><span><span class="pins s-livre"><i class="f"></i></span> livre</span><span><span class="pins s-quase"><i class="f"></i></span> quase cheio</span><span><span class="pins s-lotado"><i class="f"></i></span> lotado</span></div></div>
      <div class="panel"><div class="panel-h"><h2>${DIAS_L[diaDaSemana(est.dia)]}, ${dataBR(est.dia)}</h2><span class="pill p-${{ livre: 'ok', quase: 'warn', lotado: 'crit' }[sit(est.dia)]}">${n}/${cap}</span></div>
        <div class="list">${lista.map(o => linhaOS(o, o.tempo_min ? `${Math.round(o.tempo_min / 6) / 10} h previstas` : '')).join('') || '<div class="empty">Nenhuma entrega neste dia.</div>'}</div>
        ${sessao.pode('os.editar') && est.dia >= ag.hoje ? `<a class="btn pri" href="#ordens/nova">+ Nova OS</a>` : ''}</div></div>`;
  } else {
    corpo = `<div class="panel-h"><button class="btn sm" data-sem="-7">‹ Semana anterior</button><b>${dataBR(inicio)} a ${dataBR(fim)}</b><button class="btn sm" data-sem="7">Próxima semana ›</button></div>
      <div class="grid g2">${Array.from({ length: 7 }, (_, i) => {
        const d = somarDias(inicio, i);
        const n = ocup[d] || 0;
        return `<div class="panel" style="padding:14px"><div class="panel-h"><h3>${DIAS_L[i]}, ${dataBR(d)}</h3><span class="row">${pinos(n)}<span class="num s-${sit(d)}" style="font-weight:600">${n}/${cap}</span></span></div>
          <div class="list">${doDia(d).map(o => linhaOS(o)).join('') || '<div class="empty">Dia livre.</div>'}</div></div>`;
      }).join('')}</div>`;
  }
  el.innerHTML = `<div class="head"><div><h1>Agenda de entregas</h1><p>Capacidade de ${cap} entregas por dia (amarelo a partir de ${ag.limite_quase_cheio}). A capacidade por horas de trabalho e as provas entram na próxima fase.</p></div>
      <div class="tabs" style="border:none"><button class="${est.vista === 'mes' ? 'on' : ''}" data-vista="mes">Mês</button><button class="${est.vista === 'semana' ? 'on' : ''}" data-vista="semana">Semana</button></div></div>${corpo}`;
  el.onclick = e => {
    const b = e.target.closest('[data-dia],[data-mes],[data-sem],[data-vista]');
    if (!b) return;
    if (b.dataset.dia) { est.dia = b.dataset.dia; est.mes = est.dia.slice(0, 7); }
    if (b.dataset.mes) { const d = new Date(Date.UTC(y, m - 1 + Number(b.dataset.mes), 1)); est.mes = d.toISOString().slice(0, 7); }
    if (b.dataset.sem) { est.dia = somarDias(est.dia, Number(b.dataset.sem)); est.mes = est.dia.slice(0, 7); }
    if (b.dataset.vista) est.vista = b.dataset.vista;
    telaAgenda(el, _p, vivo);
  };
}
