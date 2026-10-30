// Grava as cenas do comercial vertical (1080×1920) usando o layout REAL de celular do sistema (servidor demo isolado).
// Uso: node scripts/gravar-curto.cjs <pasta-de-trabalho> [cena...]
const { Gravador } = require('./gravador.cjs');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const BASE = 'http://127.0.0.1:8791';
const TRAB = process.argv[2];
const SO = process.argv.slice(3);
const dur = JSON.parse(fs.readFileSync(path.join(RAIZ, 'narracao/duracoes.json'), 'utf8'));
const ALVO = { v01: 8.4, v02: 10.6, v03: 12.6, v04: 13.6, v05: 10.6, v06: 8.4 };
const alvo = id => Math.max(ALVO[id], dur[id] + 1.6);

(async () => {
  // celular: 405×720 pontos × 8/3 = 1080×1920
  const g = new Gravador({ pasta: TRAB, largura: 405, altura: 720, escala: 8 / 3, movel: true });
  const p = await g.abrir();
  const ir = async hash => { await p.evaluate(h => { location.hash = h; }, hash); await p.waitForTimeout(900); await p.evaluate(() => scrollTo(0, 0)); };
  await p.goto(BASE + '/');
  await p.fill('#l-email', 'demo@atelie-jessica.demo');
  await p.fill('#l-senha', fs.readFileSync(path.join(RAIZ, '.demo-senha'), 'utf8'));
  await p.click('button[type=submit]');
  await p.waitForSelector('text=Resumo do ateliê hoje');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(RAIZ, 'cenas/img/celular-tela.png') });
  const quer = id => !SO.length || SO.includes(id);
  const cenas = {};

  async function cenaHtml(id, arquivo, extra = '') {
    const b = new Gravador({ pasta: TRAB, largura: 1080, altura: 1920, escala: 1 });
    const pg = await b.abrir();
    await pg.goto('file://' + path.join(RAIZ, 'cenas', arquivo) + extra);
    await pg.waitForTimeout(400); await pg.reload();
    await b.iniciar(id);
    await pg.evaluate(() => { const c = document.getElementById('__cursor'); if (c) c.style.display = 'none'; });
    await b.esperar(alvo(id) * 1000);
    cenas[id] = await b.parar(alvo(id));
    await b.fechar();
  }
  // no celular o "cursor" é um toque: círculo discreto em vez da seta
  await p.addStyleTag({ content: '#__cursor svg{display:none}#__cursor{width:34px;height:34px;border-radius:50%;background:rgba(28,26,33,.22);border:2px solid rgba(255,255,255,.9);margin:-14px 0 0 -14px}' });

  if (quer('v01')) await cenaHtml('v01', 'abertura-vertical.html');

  if (quer('v02')) {
    await ir('clientes');
    await g.iniciar('v02');
    await g.esperar(400);
    await g.digitar('#cl-q', 'Mariana', 10);
    await g.esperar(800);
    await g.clicar('#cl-tab tr:has-text("Mariana Souza"), a:has-text("Mariana Souza") >> nth=0');
    await g.esperar(1300);
    const url = fs.existsSync(path.join(TRAB, 'os-gravada.txt')) ? fs.readFileSync(path.join(TRAB, 'os-gravada.txt'), 'utf8') : null;
    const hash = url ? url.split('#')[1] : null;
    if (hash) { await p.evaluate(h => { location.hash = h; }, hash); await p.waitForSelector('h1:has-text("OS Nº")'); }
    await g.esperar(900);
    await g.rolar(560, 1700);
    await g.esperar(900);
    await g.rolar(700, 1700);
    await g.esperar(1400);
    cenas.v02 = await g.parar(alvo('v02'));
  }

  if (quer('v03')) {
    await ir('producao');
    await p.waitForSelector('.coluna');
    // posiciona no quadro, com os cartões da primeira coluna visíveis
    const y = await p.evaluate(() => document.querySelector('.coluna').getBoundingClientRect().top + scrollY - 70);
    await p.evaluate(y => scrollTo(0, y), y);
    await p.waitForTimeout(400);
    await g.iniciar('v03');
    await g.esperar(1200);
    const bt = p.locator('.coluna[data-coluna="aguardando"] .cartao [data-mover] >> nth=0');
    if (await bt.count()) { await g.clicar('.coluna[data-coluna="aguardando"] .cartao [data-mover] >> nth=0'); await g.esperar(1400); }
    await p.evaluate(() => { location.hash = 'agenda'; });
    await p.waitForSelector('[data-vista="dia"]');
    await p.evaluate(() => scrollTo(0, 0));
    await g.esperar(1300);
    await g.clicar('[data-vista="semana"]');
    await g.esperar(1200);
    await g.rolar(360, 1400);
    await g.esperar(1800);
    cenas.v03 = await g.parar(alvo('v03'));
  }

  if (quer('v04')) {
    await ir('estoque');
    await g.iniciar('v04');
    await g.esperar(1500);
    await g.rolar(300, 1200);
    await g.esperar(600);
    await p.evaluate(() => { location.hash = 'financeiro'; });
    await p.waitForSelector('text=Por forma de pagamento');
    await p.evaluate(() => scrollTo(0, 0));
    await g.esperar(1600);
    await g.rolar(460, 1500);
    await g.esperar(600);
    await p.evaluate(() => { location.hash = 'relatorios'; });
    await p.waitForSelector('#g-mensal svg', { timeout: 8000 }).catch(() => {});
    await p.evaluate(() => scrollTo(0, 0));
    await g.esperar(1300);
    await g.rolar(900, 2200);
    await g.esperar(1600);
    cenas.v04 = await g.parar(alvo('v04'));
  }

  if (quer('v05')) {
    await ir('inicio');
    await g.iniciar('v05');
    await g.esperar(300);
    await g.digitar('.busca-geral input', 'Gabriela', 11);
    await p.waitForSelector('.busca-res a[href^="#ordens/"]');
    await g.esperar(400);
    await g.clicar('.busca-res a[href^="#ordens/"] >> nth=0');
    await p.waitForSelector('[data-a="wa"]');
    await g.esperar(500);
    await g.clicar('[data-a="wa"]');
    await p.waitForSelector('#wa-txt');
    await g.esperar(2400);
    await g.clicar('#modal .mact button:has-text("Voltar"), #modal .mact .btn.ghost');
    await g.esperar(300);
    await g.clicar('a:has-text("Imprimir / PDF")');
    await p.waitForSelector('.a4');
    await g.esperar(2200);
    cenas.v05 = await g.parar(alvo('v05'));
  }

  if (quer('v06')) await cenaHtml('v06', 'encerramento.html', '?vertical=1&tag=' + encodeURIComponent('Seu ateliê, mais organizado e profissional.') + '&fim=' + (alvo('v06') - 1.4).toFixed(1) + 's');

  const arq = path.join(TRAB, 'cenas-curto.json');
  const antes = fs.existsSync(arq) ? JSON.parse(fs.readFileSync(arq, 'utf8')) : {};
  fs.writeFileSync(arq, JSON.stringify({ ...antes, ...cenas }, null, 1));
  console.log(Object.entries(cenas).map(([k, v]) => `${k}: ${v.duracao.toFixed(1)}s (${v.quadros} quadros)`).join('\n'));
  if (g.erros.length) console.log('ERROS JS:', g.erros);
  await g.fechar();
})().catch(e => { console.error(e); process.exit(1); });
