// Grava as cenas do vídeo completo (1920×1080) navegando no sistema REAL (servidor demo isolado com dados fictícios).
// Uso: node scripts/gravar-completo.cjs <pasta-de-trabalho> [cena...]
const { Gravador } = require('./gravador.cjs');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const BASE = 'http://127.0.0.1:8791';
const TRAB = process.argv[2];
const SO = process.argv.slice(3);
const dur = JSON.parse(fs.readFileSync(path.join(RAIZ, 'narracao/duracoes.json'), 'utf8'));
// duração alvo de cada cena (segundos) — segue o roteiro (~3 min) e nunca fica menor que a fala + respiro
const ALVO = { 'c01-abertura': 12.6, 'c02-dashboard': 16.6, 'c03-clientes': 19.6, 'c04-ordem': 31.6, 'c05-producao': 22.6, 'c06-estoque': 22.6,
  'c07-financeiro': 23.6, 'c08-whatsapp': 17.6, 'c09-evolucao': 15.6, 'c10-encerramento': 10.6 };
const alvo = id => Math.max(ALVO[id], dur[id] + 2.4);

(async () => {
  const g = new Gravador({ pasta: TRAB });
  const p = await g.abrir();
  const ir = async hash => { await p.evaluate(h => { location.hash = h; }, hash); await p.waitForTimeout(900); };
  await p.goto(BASE + '/');
  await p.fill('#l-email', 'demo@atelie-jessica.demo');
  await p.fill('#l-senha', fs.readFileSync(path.join(RAIZ, '.demo-senha'), 'utf8'));
  await p.click('button[type=submit]');
  await p.waitForSelector('text=Resumo do ateliê hoje');
  await p.waitForTimeout(1500);
  const quer = id => !SO.length || SO.some(s => id.startsWith(s));
  const cenas = {};

  // imagens reais para as cenas de abertura/dispositivos
  fs.mkdirSync(path.join(RAIZ, 'cenas/img'), { recursive: true });
  await p.screenshot({ path: path.join(RAIZ, 'cenas/img/painel.png') });
  await p.screenshot({ path: path.join(RAIZ, 'cenas/img/painel-longo.png'), fullPage: true });

  // páginas da marca: desenhadas em 1920×1080 (pixels reais), gravadas sem escala
  async function cenaHtml(id, arquivo, extra = '') {
    const b = new Gravador({ pasta: TRAB, largura: 1920, altura: 1080, escala: 1 });
    const pg = await b.abrir();
    await pg.goto('file://' + path.join(RAIZ, 'cenas', arquivo) + extra);
    await pg.waitForTimeout(400);
    await pg.reload(); // reinicia as animações junto com a gravação
    await b.iniciar(id);
    await pg.evaluate(() => { const c = document.getElementById('__cursor'); if (c) c.style.display = 'none'; });
    await b.esperar(alvo(id) * 1000);
    cenas[id] = await b.parar(alvo(id));
    await b.fechar();
  }

  if (quer('c01')) await cenaHtml('c01-abertura', 'abertura.html');

  if (quer('c02')) {
    await ir('inicio'); await p.evaluate(() => scrollTo(0, 0));
    await g.iniciar('c02-dashboard');
    await g.esperar(700);
    await g.mover('.stat >> nth=0', 1000);
    await g.camera(1.38, '.stat >> nth=1', 1500);
    await g.mover('.stat >> nth=3', 1200);
    await g.esperar(1300);
    await g.camera(1.38, '.stat >> nth=5', 1500);
    await g.mover('.stat >> nth=5', 900);
    await g.esperar(1600);
    await g.camera(1, null, 1200);
    await g.rolar(520, 1600);
    await g.mover({ x: 720, y: 420 }, 900);
    await g.esperar(1800);
    await g.rolar(380, 1400);
    await g.esperar(1500);
    cenas['c02-dashboard'] = await g.parar(alvo('c02-dashboard'));
  }

  if (quer('c03')) {
    await ir('inicio'); await p.evaluate(() => scrollTo(0, 0));
    await g.iniciar('c03-clientes');
    await g.esperar(500);
    await g.clicar('#nav-side a[href="#clientes"]');
    await p.waitForSelector('#cl-q');
    await g.esperar(400);
    await g.digitar('#cl-q', 'Mariana', 13);
    await g.esperar(700);
    await g.clicar('#cl-tab tr:has-text("Mariana Souza")');
    await p.waitForSelector('[role=tab]:has-text("Medidas")');
    await g.esperar(900);
    await g.mover('.kv', 800);
    await g.esperar(500);
    await g.clicar('[role=tab]:has-text("Medidas")');
    await p.waitForSelector('#aba table');
    await g.esperar(500);
    await g.rolar(430, 1100);
    await g.mover('#aba table', 700);
    await g.camera(1.3, '#aba table', 1200);
    await g.esperar(2200);
    await g.camera(1, null, 900);
    await g.rolar(-430, 900);
    await g.clicar('[role=tab]:has-text("Ordens")', { depois: 300 });
    await g.rolar(380, 1000);
    await g.mover('#aba table', 700);
    await g.esperar(1000);
    cenas['c03-clientes'] = await g.parar(alvo('c03-clientes'));
  }

  if (quer('c04')) {
    await ir('ordens'); await p.evaluate(() => scrollTo(0, 0));
    await g.iniciar('c04-ordem');
    await g.esperar(500);
    await g.clicar('a:has-text("+ Nova OS"), button:has-text("+ Nova OS")');
    await p.waitForSelector('#f-cli-busca');
    await g.esperar(600);
    await g.digitar('#f-cli-busca', 'Mariana', 14);
    await p.waitForSelector('#cli-res a, #cli-res [role=option], #cli-res button', { timeout: 5000 }).catch(() => {});
    await g.esperar(700);
    await g.clicar('#cli-res >> text=Mariana Souza');
    await g.esperar(500);
    const prazo = await p.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 8); return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); });
    await g.clicar('#f-prazo', { depois: 200 });
    await p.fill('#f-prazo', prazo); await p.dispatchEvent('#f-prazo', 'change');
    await g.esperar(700);
    await g.digitar('#p-0-peca', 'Calça jeans', 16);
    await g.clicar('.peca[data-i="0"] select[data-s="service_id"]', { depois: 200 });
    await p.selectOption('.peca[data-i="0"] select[data-s="service_id"]', 'sv-barra-calca'); await g.esperar(500);
    await g.digitar('#p-0-desc', 'Barra 3 cm mais curta', 26);
    await p.selectOption('#p-0-resp', { label: 'Ana Paula' }).catch(() => {});
    await g.esperar(400);
    await g.clicar('[data-a="add-peca"]');
    await p.waitForSelector('#p-1-peca');
    await g.digitar('#p-1-peca', 'Vestido midi', 16);
    await g.clicar('.peca[data-i="1"] select[data-s="service_id"]', { depois: 200 });
    await p.selectOption('.peca[data-i="1"] select[data-s="service_id"]', 'sv-ajuste-cintura'); await g.esperar(500);
    await g.digitar('#p-1-desc', 'Ajustar 2 cm na cintura', 26);
    await p.selectOption('#p-1-resp', { label: 'Rosa Maria' }).catch(() => {});
    await g.esperar(500);
    await g.mover('#totais', 900);
    await g.camera(1.45, '#totais', 1200);
    await g.esperar(1300);
    await g.camera(1, null, 900);
    await g.clicar('button[data-a="salvar"] >> nth=-1');
    // confirmações possíveis (dia cheio, carga das costureiras)
    for (let i = 0; i < 3; i++) {
      const m = await p.waitForSelector('#modal:not([hidden]) .mact .btn.pri, h1:has-text("OS Nº")', { timeout: 6000 }).catch(() => null);
      if (!m) break;
      if (await p.$('h1:has-text("OS Nº")')) break;
      await g.clicar('#modal .mact .btn.pri');
    }
    await p.waitForSelector('h1:has-text("OS Nº")');
    await p.evaluate(() => scrollTo(0, 0));
    await g.esperar(800);
    await g.camera(1.4, 'h1', 1200);
    await g.esperar(1300);
    await g.camera(1, null, 900);
    const yf = await p.evaluate(() => { const h = [...document.querySelectorAll('h2')].find(x => x.textContent.trim() === 'Fotos'); return h ? h.getBoundingClientRect().top + scrollY - 260 : 900; });
    await g.rolar(yf, 2000);
    await g.mover('h2:has-text("Fotos")', 800);
    await g.esperar(1400);
    cenas['c04-ordem'] = await g.parar(alvo('c04-ordem'));
    fs.writeFileSync(path.join(TRAB, 'os-gravada.txt'), p.url());
  }

  if (quer('c05')) {
    await ir('inicio');
    await g.iniciar('c05-producao');
    await g.esperar(400);
    await g.clicar('#nav-side a[href="#producao"]');
    await p.waitForSelector('.coluna');
    await g.esperar(1200);
    await g.camera(1.3, '.coluna >> nth=1', 1500);
    await g.mover('.cartao.urgente, .coluna >> nth=1 >> .cartao >> nth=0', 1000);
    await g.esperar(1500);
    const mover = p.locator('.coluna[data-coluna="aguardando"] .cartao [data-mover] >> nth=0');
    if (await mover.count()) { await g.camera(1, null, 900); await g.clicar('.coluna[data-coluna="aguardando"] .cartao [data-mover] >> nth=0'); await g.esperar(1400); }
    await g.camera(1.3, '.coluna >> nth=2', 1500);
    await g.esperar(1600);
    await g.camera(1, null, 1000);
    await g.clicar('#nav-side a[href="#agenda"]');
    await p.waitForSelector('[data-vista="semana"]');
    await g.esperar(600);
    await g.clicar('[data-vista="semana"]');
    await g.esperar(1500);
    await g.camera(1.3, { x: 820, y: 430 }, 1500);
    await g.esperar(2200);
    await g.camera(1, null, 1000);
    cenas['c05-producao'] = await g.parar(alvo('c05-producao'));
  }

  if (quer('c06')) {
    await ir('inicio');
    await g.iniciar('c06-estoque');
    await g.esperar(400);
    await g.clicar('#nav-side a[href="#estoque"]');
    await p.waitForSelector('tr[data-href]');
    await g.esperar(1200);
    await g.camera(1.3, 'table', 1200);
    await g.mover('tr[data-href]:has-text("Zíper")', 800);
    await g.esperar(1200);
    await g.camera(1, null, 800);
    await g.clicar('tr[data-href]:has-text("Linho")');
    await p.waitForSelector('h2:has-text("Movimentações")');
    await g.esperar(900);
    await g.mover('h2:has-text("Movimentações")', 800);
    await g.esperar(1200);
    await g.clicar('#nav-side a[href="#servicos"]');
    await p.waitForSelector('[data-editar="sv-ajuste-festa"]');
    await g.esperar(700);
    await g.mover('[data-editar="sv-ajuste-festa"]', 900);
    await g.esperar(600);
    await g.clicar('[data-editar="sv-ajuste-festa"]');
    await p.waitForSelector('#cl-res');
    await g.esperar(600);
    await g.mover('#cl-res', 800);
    await g.camera(1.3, '#cl-res', 1200);
    await g.esperar(2200);
    await g.camera(1, null, 800);
    await g.clicar('#modal .mact button:has-text("Voltar")');
    await g.esperar(500);
    cenas['c06-estoque'] = await g.parar(alvo('c06-estoque'));
  }

  if (quer('c07')) {
    await ir('inicio');
    await g.iniciar('c07-financeiro');
    await g.esperar(400);
    await g.clicar('#nav-side a[href="#financeiro"]');
    await p.waitForSelector('text=Por forma de pagamento');
    await g.esperar(1200);
    await g.camera(1.3, '.grid.g4', 1400);
    await g.esperar(1800);
    await g.camera(1, null, 900);
    await g.clicar('[data-aba="receber"]');
    await g.esperar(1800);
    await g.clicar('[data-aba="pagar"]');
    await g.esperar(1800);
    await g.clicar('#nav-side a[href="#relatorios"]');
    await p.waitForSelector('#g-mensal svg', { timeout: 8000 }).catch(() => {});
    await g.esperar(1200);
    await g.mover('.stat >> nth=1', 900);
    await g.esperar(1000);
    const gr = p.locator('#g-mensal');
    await gr.scrollIntoViewIfNeeded();
    await g.esperar(600);
    const b = await gr.boundingBox();
    if (b) { await g.mover({ x: b.x + b.width * 0.55, y: b.y + b.height * 0.45 }, 1000); await g.esperar(700); await g.mover({ x: b.x + b.width * 0.85, y: b.y + b.height * 0.45 }, 1200); }
    await g.esperar(2200);
    cenas['c07-financeiro'] = await g.parar(alvo('c07-financeiro'));
  }

  if (quer('c08')) {
    await ir('inicio'); await p.evaluate(() => scrollTo(0, 0));
    await g.iniciar('c08-whatsapp');
    await g.esperar(400);
    await g.digitar('.busca-geral input', 'Gabriela', 15);
    await p.waitForSelector('.busca-res a[href^="#ordens/"]');
    await g.esperar(300);
    await g.clicar('.busca-res a[href^="#ordens/"] >> nth=0');
    await p.waitForSelector('[data-a="wa"]');
    await g.esperar(500);
    await g.clicar('[data-a="wa"]');
    await p.waitForSelector('#wa-txt');
    await g.camera(1.35, '#wa-txt', 1100);
    await g.esperar(2000);
    await g.camera(1, null, 800);
    await g.clicar('#modal .mact button:has-text("Voltar"), #modal .mact .btn.ghost');
    await g.esperar(500);
    await g.clicar('a:has-text("Imprimir / PDF")');
    await p.waitForSelector('.a4');
    await g.esperar(700);
    await g.camera(1.35, '.doc-topo', 1100);
    await g.esperar(1400);
    await g.camera(1, null, 800);
    await g.clicar('#nav-side a[href="#config"]', { depois: 300 });
    await g.clicar('[data-aba="documentos"]');
    await g.esperar(1500);
    cenas['c08-whatsapp'] = await g.parar(alvo('c08-whatsapp'));
  }

  if (quer('c09') || quer('c10')) {
    // telas do celular (iPhone) para a cena de dispositivos
    const m = new Gravador({ pasta: TRAB, largura: 390, altura: 844, escala: 3, movel: true });
    const mp = await m.abrir();
    await mp.goto(BASE + '/');
    await mp.fill('#l-email', 'demo@atelie-jessica.demo'); await mp.fill('#l-senha', fs.readFileSync(path.join(RAIZ, '.demo-senha'), 'utf8')); await mp.click('button[type=submit]');
    await mp.waitForSelector('text=Resumo do ateliê hoje'); await mp.waitForTimeout(1500);
    await mp.screenshot({ path: path.join(RAIZ, 'cenas/img/celular-longo.png'), fullPage: true });
    await m.fechar();
  }
  if (quer('c09')) await cenaHtml('c09-evolucao', 'dispositivos.html');
  if (quer('c10')) await cenaHtml('c10-encerramento', 'encerramento.html', '?fim=' + (alvo('c10-encerramento') - 1.6).toFixed(1) + 's');

  const arq = path.join(TRAB, 'cenas-completo.json');
  const ant = fs.existsSync(arq) ? JSON.parse(fs.readFileSync(arq, 'utf8')) : {};
  fs.writeFileSync(arq, JSON.stringify({ ...ant, ...cenas }, null, 1));
  console.log(Object.entries(cenas).map(([k, v]) => `${k}: ${v.duracao.toFixed(1)}s (${v.quadros} quadros)`).join('\n'));
  if (g.erros.length) console.log('ERROS JS:', g.erros);
  await g.fechar();
})().catch(e => { console.error(e); process.exit(1); });
