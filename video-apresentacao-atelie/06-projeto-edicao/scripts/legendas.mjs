// Gera legendas (.srt) e o arquivo de títulos/legendas estilizado (.ass) a partir do roteiro e da linha do tempo.
// A narração é dividida em frases curtas; cada frase recebe um tempo proporcional ao seu tamanho dentro da fala.
import { readFileSync, writeFileSync } from 'node:fs';

/** Quebra o texto em blocos de no máximo ~2 linhas, preferindo pontuação. */
export function blocos(texto, max = 74) {
  const partes = texto.match(/[^,.:;!?]+[,.:;!?]?/g).map(s => s.trim()).filter(Boolean);
  const out = [];
  let atual = '';
  for (const p of partes) {
    if (!atual) atual = p;
    else if ((atual + ' ' + p).length <= max && !/[.!?]$/.test(atual)) atual += ' ' + p;
    else { out.push(atual); atual = p; }
  }
  if (atual) out.push(atual);
  // blocos longos demais: divide por palavras
  return out.flatMap(b => {
    if (b.length <= max) return [b];
    const ws = b.split(' '); const meio = Math.ceil(ws.length / 2);
    return [ws.slice(0, meio).join(' '), ws.slice(meio).join(' ')];
  });
}

/** Distribui o tempo da fala entre os blocos (pausas em vírgula/ponto contam um pouco). */
export function cronometrar(texto, inicio, duracao) {
  const bs = blocos(texto);
  const peso = b => b.length + (/[.!?]$/.test(b) ? 14 : /[,;:]$/.test(b) ? 6 : 0);
  const total = bs.reduce((s, b) => s + peso(b), 0);
  let t = inicio;
  const util = duracao - 0.2;
  return bs.map(b => { const d = util * peso(b) / total; const r = { ini: t, fim: t + d - 0.05, texto: b.replace(/[,;:]$/, '') }; t += d; return r; });
}

const hms = (s, sep) => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${x.toFixed(3).padStart(6, '0').replace('.', sep)}`; };
const assT = s => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return `${h}:${String(m).padStart(2, '0')}:${x.toFixed(2).padStart(5, '0')}`; };

/** Quebra em 2 linhas equilibradas para a tela. */
function duasLinhas(t, max) {
  if (t.length <= max) return [t];
  const ws = t.split(' '); let melhor = null;
  for (let i = 1; i < ws.length; i++) { const a = ws.slice(0, i).join(' '), b = ws.slice(i).join(' '); const d = Math.abs(a.length - b.length); if (!melhor || d < melhor.d) melhor = { a, b, d }; }
  return [melhor.a, melhor.b];
}

/**
 * linha: [{ inicio, narracao: {texto, offset, duracao}, titulo?, sub? }]
 * formato: 'h' (1920×1080) ou 'v' (1080×1920)
 */
export function gerar(linha, formato, total, saidaSrt, saidaAss) {
  const H = formato === 'h';
  const W = H ? 1920 : 1080, Hh = H ? 1080 : 1920;
  const cap = [];
  for (const c of linha) if (c.narracao) cap.push(...cronometrar(c.narracao.texto, c.inicio + c.narracao.offset, c.narracao.duracao));
  writeFileSync(saidaSrt, cap.map((c, i) => `${i + 1}\n${hms(c.ini, ',')} --> ${hms(c.fim, ',')}\n${duasLinhas(c.texto, H ? 42 : 30).join('\n')}\n`).join('\n'));

  const est = H
    ? { leg: 46, legMv: 54, tit: 50, titM: 400, titMv: 40, marca: 22 }
    : { leg: 56, legMv: 470, tit: 74, titM: 60, titMv: 150, marca: 26 };
  const ass = [`[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${Hh}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Legenda,Figtree Legenda,${est.leg},&H00FFFFFF,&H00FFFFFF,&H30211A1C,&H30211A1C,0,0,0,0,100,100,0,0,4,${H ? 16 : 18},0,2,80,80,${est.legMv},1
Style: Titulo,Bricolage Titulo,${est.tit},${H ? '&H00211A1C' : '&H006A2DC9'},&H00FFFFFF,&H0AFFFFFF,&H0AFFFFFF,0,0,0,0,100,100,0,0,3,${H ? 22 : 26},0,${H ? 7 : 8},${est.titM},${est.titM},${est.titMv},1
Style: Barra,Figtree,10,&H006A2DC9,&H006A2DC9,&H006A2DC9,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Aviso,Figtree Texto,${est.marca},&H40655A5E,&H00FFFFFF,&H40FFFFFF,&H00000000,0,0,0,0,100,100,0,0,3,6,0,9,30,30,24,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`];
  for (const c of cap) ass.push(`Dialogue: 2,${assT(c.ini)},${assT(c.fim)},Legenda,,0,0,0,,{\\fad(120,120)}${duasLinhas(c.texto, H ? 42 : 30).join('\\N')}`);
  for (const c of linha) {
    if (!c.titulo) continue;
    const ini = c.inicio + (c.tituloIni ?? 0.5), fim = c.inicio + (c.tituloFim ?? 5.8);
    const anim = H ? `{\\fad(400,400)\\move(${est.titM - 30},${est.titMv},${est.titM},${est.titMv},0,500)}` : `{\\fad(400,400)}`;
    ass.push(`Dialogue: 3,${assT(ini)},${assT(fim)},Titulo,,0,0,0,,${H ? anim : anim}${c.titulo}`);
    if (H) ass.push(`Dialogue: 4,${assT(ini)},${assT(fim)},Barra,,0,0,0,,{\\fad(400,400)\\pos(${est.titM - 30},${est.titMv - 20})\\p1}m 0 0 l 8 0 8 ${est.tit + 40} 0 ${est.tit + 40}{\\p0}`);
  }
  // aviso discreto nas cenas com telas do sistema
  for (const c of linha) if (c.demo) ass.push(`Dialogue: 1,${assT(c.inicio + 0.3)},${assT(c.inicio + c.duracao - 0.3)},Aviso,,0,0,0,,{\\fad(300,300)}Demonstração com dados fictícios`);
  writeFileSync(saidaAss, ass.join('\n') + '\n');
  return cap;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , arqLinha, formato, srt, assArq] = process.argv;
  const { linha, total } = JSON.parse(readFileSync(arqLinha, 'utf8'));
  const cap = gerar(linha, formato, total, srt, assArq);
  console.log(cap.length, 'legendas');
}
