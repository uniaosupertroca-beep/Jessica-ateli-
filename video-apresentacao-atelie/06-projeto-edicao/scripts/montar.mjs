// Monta o vídeo final com FFmpeg: clipes + transições suaves + narração + trilha (abaixa sob a voz) + títulos e legendas.
// Uso: node scripts/montar.mjs <completo|curto> <pasta-de-trabalho> <saida.mp4>
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { gerar } from './legendas.mjs';

const [versao, TRAB, SAIDA] = process.argv.slice(2);
const RAIZ = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const rot = JSON.parse(readFileSync(path.join(RAIZ, 'roteiro.json'), 'utf8'))[versao];
const dur = JSON.parse(readFileSync(path.join(RAIZ, 'narracao/duracoes.json'), 'utf8'));
const cenas = JSON.parse(readFileSync(path.join(TRAB, `cenas-${versao}.json`), 'utf8'));
const H = versao === 'completo';
const W = H ? 1920 : 1080, Hh = H ? 1080 : 1920;
const T = H ? 0.7 : 0.5;          // duração das transições
const OFS = H ? 0.9 : 0.5;        // a fala começa um pouco depois da cena aparecer
// leve aceleração de algumas gravações (digitação e navegação), para o ritmo ficar perto do roteiro
const VELOCIDADE = { 'c03-clientes': 1.1, 'c04-ordem': 1.2, 'c05-producao': 1.12, 'c06-estoque': 1.12, 'c07-financeiro': 1.12, 'c08-whatsapp': 1.15, v02: 1.15, v05: 1.3 };
const vel = id => VELOCIDADE[id] || 1;
const sonda = f => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

// 1) linha do tempo
const linha = [];
let t = 0;
rot.forEach((c, i) => {
  const clipe = cenas[c.id]?.saida;
  if (!clipe || !existsSync(clipe)) throw new Error('falta o clipe da cena ' + c.id);
  const d = sonda(clipe) / vel(c.id);
  const ehMarca = /abertura|encerramento|v01|v06/.test(c.id);
  linha.push({ id: c.id, clipe, inicio: t, duracao: d, demo: !ehMarca,
    narracao: { texto: c.texto, offset: c.id === 'c01-abertura' ? 1.4 : OFS, duracao: dur[c.id] },
    ...(!ehMarca && c.titulo ? { titulo: c.titulo } : {}),
    ...(!H && c.titulo ? { titulo: c.titulo, tituloIni: 0.3, tituloFim: Math.min(d - 0.4, 4.2) } : {}) });
  t += d - (i < rot.length - 1 ? T : 0);
});
const total = t;
for (const c of linha) if (c.narracao.offset + c.narracao.duracao > c.duracao - 0.2) console.warn('⚠ fala passa do fim da cena', c.id);
mkdirSync(path.join(TRAB, 'saida'), { recursive: true });
const arqLinha = path.join(TRAB, `linha-${versao}.json`);
writeFileSync(arqLinha, JSON.stringify({ linha, total }, null, 1));
const srt = path.join(TRAB, `legendas-${versao}.srt`), ass = path.join(TRAB, `legendas-${versao}.ass`);
gerar(linha, H ? 'h' : 'v', total, srt, ass);

// 2) filtros
const ent = [];
linha.forEach(c => ent.push('-i', c.clipe));
linha.forEach(c => ent.push('-i', path.join(RAIZ, 'narracao', c.id + '.wav')));
ent.push('-i', path.join(RAIZ, 'trilha', H ? 'trilha-completa.wav' : 'trilha-curta.wav'));
const n = linha.length;
const f = [];
linha.forEach((c, i) => f.push(`[${i}:v]setpts=(PTS-STARTPTS)/${vel(c.id)},settb=AVTB,fps=30,format=yuv420p,scale=${W}:${Hh}:flags=lanczos,setsar=1[v${i}]`));
let ant = 'v0', acum = linha[0].duracao;
for (let i = 1; i < n; i++) {
  const off = (acum - T).toFixed(3);
  const tipo = /abertura|encerramento|v01|v06/.test(linha[i].id) || /abertura|v01/.test(linha[i - 1].id) ? 'fade' : 'smoothleft';
  f.push(`[${ant}][v${i}]xfade=transition=${H ? tipo : 'fade'}:duration=${T}:offset=${off}[x${i}]`);
  ant = `x${i}`; acum = acum - T + linha[i].duracao;
}
const fontes = path.join(RAIZ, 'fontes', 'estatica');
f.push(`[${ant}]ass='${ass}':fontsdir='${fontes}',fade=t=in:st=0:d=0.6,fade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2[vout]`);
// narração: cada fala no seu tempo
linha.forEach((c, i) => {
  const ms = Math.round((c.inicio + c.narracao.offset) * 1000);
  f.push(`[${n + i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms},apad[n${i}]`);
});
f.push(`${linha.map((_, i) => `[n${i}]`).join('')}amix=inputs=${n}:normalize=0:duration=longest,atrim=0:${total.toFixed(3)},volume=1.0[voz]`);
f.push(`[voz]asplit=2[voz1][vozsc]`);
f.push(`[${2 * n}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(3)},volume=${H ? 0.1 : 0.13},afade=t=out:st=${(total - 3).toFixed(2)}:d=3[mus]`);
// trilha abaixa sozinha quando há voz (sidechain)
f.push(`[mus][vozsc]sidechaincompress=threshold=0.012:ratio=9:attack=120:release=900:makeup=1[musd]`);
f.push(`[voz1][musd]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5:LRA=9[aout]`);
writeFileSync(path.join(TRAB, `filtro-${versao}.txt`), f.join(';\n'));

execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-stats', ...ent, '-filter_complex_script', path.join(TRAB, `filtro-${versao}.txt`),
  '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'slow', '-crf', H ? '21' : '22', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-t', total.toFixed(3), SAIDA], { stdio: 'inherit' });
console.log('ok', SAIDA, total.toFixed(1) + 's');
copyFileSync(srt, SAIDA.replace(/\.mp4$/, '.srt'));
