// Gráficos em SVG, sem bibliotecas. Seguem o guia de visualização:
// marcas finas, cantos de 4 px ancorados na base, 2 px de espaço entre barras, grade discreta,
// um eixo só, legenda para 2+ séries com rótulo direto, dica (tooltip) ao passar o dedo/mouse
// e ao focar pelo teclado, e cores por função (série única = cor da marca; séries = paleta validada).

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/** Valores "redondos" para o eixo (0 até o máximo, 3 a 5 marcas). */
function marcas(max) {
  if (max <= 0) return [0, 1];
  const passoBruto = max / 4;
  const pot = 10 ** Math.floor(Math.log10(passoBruto));
  const passo = [1, 2, 2.5, 5, 10].map(m => m * pot).find(p => p >= passoBruto);
  const r = [];
  for (let v = 0; v <= max + passo * 0.001; v += passo) r.push(v);
  if (r[r.length - 1] < max) r.push(r[r.length - 1] + passo);
  return r;
}

function dica(container) {
  let t = container.querySelector('.graf-dica');
  if (!t) {
    t = document.createElement('div');
    t.className = 'graf-dica';
    t.hidden = true;
    container.append(t);
  }
  return {
    mostrar(x, y, titulo, linhas) {
      t.replaceChildren();
      const h = document.createElement('div');
      h.className = 'graf-dica-t';
      h.textContent = titulo;
      t.append(h);
      for (const l of linhas) {
        const row = document.createElement('div');
        row.className = 'graf-dica-l';
        if (l.cor) {
          const k = document.createElement('i');
          k.style.background = l.cor;
          row.append(k);
        }
        const v = document.createElement('b');
        v.textContent = l.valor;
        row.append(v);
        if (l.nome) row.append(document.createTextNode(' ' + l.nome));
        t.append(row);
      }
      t.hidden = false;
      const cw = container.clientWidth;
      const tw = t.offsetWidth;
      t.style.left = `${Math.max(0, Math.min(cw - tw, x - tw / 2))}px`;
      t.style.top = `${Math.max(0, y - t.offsetHeight - 10)}px`;
    },
    esconder() { t.hidden = true; },
  };
}

/**
 * Barras verticais de uma série (ex.: recebimentos por dia).
 * dados: [{ rotulo, rotuloCurto?, valor }]; fmt formata valores; mostrarCada: rótulo do eixo X a cada N barras.
 */
export function barras(container, dados, { fmt = String, fmtEixo = fmt, altura = 200, mostrarCada = 1, nome = '' } = {}) {
  container.classList.add('graf');
  container.querySelector('svg')?.remove();
  const largura = Math.max(280, container.clientWidth || 600);
  const m = { t: 10, r: 8, b: 26, l: 64 };
  const w = largura - m.l - m.r;
  const h = altura - m.t - m.b;
  const max = Math.max(0, ...dados.map(d => d.valor));
  const ticks = marcas(max);
  const topo = ticks[ticks.length - 1] || 1;
  const svg = el('svg', { viewBox: `0 0 ${largura} ${altura}`, width: '100%', height: altura, role: 'img', 'aria-label': nome });
  const y = v => m.t + h - (v / topo) * h;
  for (const t of ticks) {
    svg.append(el('line', { x1: m.l, x2: largura - m.r, y1: y(t), y2: y(t), class: 'graf-grade' }));
    const tx = el('text', { x: m.l - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'graf-eixo' });
    tx.textContent = fmtEixo(t);
    svg.append(tx);
  }
  const banda = w / Math.max(1, dados.length);
  const larg = Math.max(2, Math.min(28, banda - 2)); // 2 px de espaço entre barras
  const tip = dica(container);
  dados.forEach((d, i) => {
    const x = m.l + i * banda + (banda - larg) / 2;
    const alto = Math.max(0, m.t + h - y(Math.max(0, d.valor)));
    const r = Math.min(4, larg / 2, alto);
    if (alto > 0) {
      // canto arredondado só no topo; a base fica reta, encostada no eixo
      svg.append(el('path', {
        class: 'graf-barra',
        d: `M${x},${m.t + h} V${m.t + h - alto + r} Q${x},${m.t + h - alto} ${x + r},${m.t + h - alto} H${x + larg - r} Q${x + larg},${m.t + h - alto} ${x + larg},${m.t + h - alto + r} V${m.t + h} Z`,
      }));
    }
    const alvo = el('rect', { x: m.l + i * banda, y: m.t, width: banda, height: h, fill: 'transparent', tabindex: 0, 'aria-label': `${d.rotulo}: ${fmt(d.valor)}` });
    const mostrar = () => tip.mostrar(m.l + i * banda + banda / 2, y(Math.max(0, d.valor)), d.rotulo, [{ valor: fmt(d.valor) }]);
    alvo.addEventListener('pointermove', mostrar);
    alvo.addEventListener('focus', mostrar);
    alvo.addEventListener('pointerleave', () => tip.esconder());
    alvo.addEventListener('blur', () => tip.esconder());
    svg.append(alvo);
    if (i % mostrarCada === 0 || i === dados.length - 1) {
      const tx = el('text', { x: m.l + i * banda + banda / 2, y: altura - 8, 'text-anchor': 'middle', class: 'graf-eixo' });
      tx.textContent = d.rotuloCurto ?? d.rotulo;
      svg.append(tx);
    }
  });
  svg.append(el('line', { x1: m.l, x2: largura - m.r, y1: m.t + h, y2: m.t + h, class: 'graf-base' }));
  container.prepend(svg);
}

/**
 * Linhas (ex.: evolução mensal). series: [{ nome, classe: 'serie-1'..'serie-3', valores: number[] }], rotulos: string[] (eixo X).
 * Legenda acima e rótulo direto no fim de cada linha; dica com todas as séries no ponto do cursor.
 */
export function linhas(container, rotulos, series, { fmt = String, fmtEixo = fmt, altura = 240, nome = '' } = {}) {
  container.classList.add('graf');
  container.querySelector('svg')?.remove();
  container.querySelector('.graf-legenda')?.remove();
  const largura = Math.max(300, container.clientWidth || 640);
  const m = { t: 12, r: 96, b: 26, l: 64 };
  const w = largura - m.l - m.r;
  const h = altura - m.t - m.b;
  const todos = series.flatMap(s => s.valores);
  const min = Math.min(0, ...todos);
  const ticks = marcas(Math.max(0, ...todos));
  const topo = ticks[ticks.length - 1] || 1;
  const base = min < 0 ? min : 0;
  const y = v => m.t + h - ((v - base) / (topo - base)) * h;
  const x = i => m.l + (rotulos.length === 1 ? w / 2 : (i / (rotulos.length - 1)) * w);
  const svg = el('svg', { viewBox: `0 0 ${largura} ${altura}`, width: '100%', height: altura, role: 'img', 'aria-label': nome });
  for (const t of ticks) {
    svg.append(el('line', { x1: m.l, x2: m.l + w, y1: y(t), y2: y(t), class: 'graf-grade' }));
    const tx = el('text', { x: m.l - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'graf-eixo' });
    tx.textContent = fmtEixo(t);
    svg.append(tx);
  }
  if (base < 0) svg.append(el('line', { x1: m.l, x2: m.l + w, y1: y(0), y2: y(0), class: 'graf-base' }));
  const passoRot = Math.ceil(rotulos.length / Math.max(2, Math.floor(w / 70)));
  rotulos.forEach((r, i) => {
    if (i % passoRot && i !== rotulos.length - 1) return;
    const tx = el('text', { x: x(i), y: altura - 8, 'text-anchor': 'middle', class: 'graf-eixo' });
    tx.textContent = r;
    svg.append(tx);
  });
  // Rótulos diretos no fim, afastados para não se sobreporem.
  const finais = series.map(s => ({ s, y: y(s.valores[s.valores.length - 1] ?? 0) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < finais.length; i++) if (finais[i].y - finais[i - 1].y < 14) finais[i].y = finais[i - 1].y + 14;
  for (const s of series) {
    const d = s.valores.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
    svg.append(el('path', { d, class: `graf-linha ${s.classe}` }));
    s.valores.forEach((v, i) => svg.append(el('circle', { cx: x(i), cy: y(v), r: rotulos.length > 18 ? 0 : 4, class: `graf-ponto ${s.classe}` })));
    const f = finais.find(z => z.s === s);
    const tx = el('text', { x: m.l + w + 8, y: f.y + 4, class: 'graf-rotulo' });
    tx.textContent = s.nome;
    svg.append(tx);
  }
  // Camada de interação: linha vertical que encontra o mês mais próximo.
  const guia = el('line', { y1: m.t, y2: m.t + h, class: 'graf-guia', visibility: 'hidden' });
  svg.append(guia);
  const tip = dica(container);
  const area = el('rect', { x: m.l, y: m.t, width: w, height: h, fill: 'transparent', tabindex: 0, 'aria-label': `${nome}: use as setas para ver cada ponto` });
  let atual = rotulos.length - 1;
  const mostrar = i => {
    atual = i;
    guia.setAttribute('x1', x(i));
    guia.setAttribute('x2', x(i));
    guia.setAttribute('visibility', 'visible');
    const cores = series.map(s => getComputedStyle(container).getPropertyValue(`--${s.classe}`).trim());
    tip.mostrar(x(i), m.t + 10, rotulos[i], series.map((s, k) => ({ cor: cores[k], valor: fmt(s.valores[i]), nome: s.nome })));
  };
  area.addEventListener('pointermove', e => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * largura;
    mostrar(Math.max(0, Math.min(rotulos.length - 1, Math.round(((px - m.l) / w) * (rotulos.length - 1)))));
  });
  area.addEventListener('focus', () => mostrar(atual));
  area.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') mostrar(Math.max(0, atual - 1));
    if (e.key === 'ArrowRight') mostrar(Math.min(rotulos.length - 1, atual + 1));
  });
  const sair = () => { guia.setAttribute('visibility', 'hidden'); tip.esconder(); };
  area.addEventListener('pointerleave', sair);
  area.addEventListener('blur', sair);
  svg.append(area);
  const leg = document.createElement('div');
  leg.className = 'graf-legenda';
  for (const s of series) {
    const item = document.createElement('span');
    const k = document.createElement('i');
    k.className = s.classe;
    item.append(k, document.createTextNode(s.nome));
    leg.append(item);
  }
  container.prepend(leg, svg);
}

/** Barras horizontais de uma série (categorias). itens: [{ rotulo, valor }]. Valor escrito ao lado, em cor de texto. */
export function barrasH(container, itens, { fmt = String, nome = '' } = {}) {
  container.classList.add('graf');
  container.replaceChildren();
  if (!itens.length) {
    container.innerHTML = '<div class="empty">Nada no período.</div>';
    return;
  }
  const max = Math.max(...itens.map(i => Math.abs(i.valor)), 1);
  const lista = document.createElement('div');
  lista.className = 'graf-h';
  lista.setAttribute('role', 'list');
  lista.setAttribute('aria-label', nome);
  for (const it of itens) {
    const row = document.createElement('div');
    row.className = 'graf-h-l';
    row.setAttribute('role', 'listitem');
    const r = document.createElement('span');
    r.textContent = it.rotulo;
    const v = document.createElement('span');
    v.className = 'num';
    v.textContent = fmt(it.valor);
    const bar = document.createElement('div');
    bar.className = 'graf-h-trilho';
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(1, (Math.abs(it.valor) / max) * 100)}%`;
    bar.append(fill);
    row.append(r, v, bar);
    lista.append(row);
  }
  container.append(lista);
}
