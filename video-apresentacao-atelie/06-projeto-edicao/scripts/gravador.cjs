// Gravador das telas reais do sistema (Playwright + captura de quadros do Chromium via CDP).
// - Os quadros chegam quando a tela muda; cada um guarda o horário, e o FFmpeg monta um vídeo de 30 qps constantes.
// - Cursor e "câmera" (zoom suave) são camadas injetadas SÓ na página gravada; o sistema em si não é alterado.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24"><path d="M4 2.5l15 8.6-6.6 1.6 3.8 6.9-2.7 1.5-3.8-6.9L4.9 18z" fill="#1C1A21" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

const CAMADA = `(() => {
  if (window.__camada) return; window.__camada = true;
  const instalar = () => {
    if (document.getElementById('__cursor')) return;
    const st = document.createElement('style');
    st.textContent = \`
      #__cursor{position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.25))}
      .__ripple{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:3px solid #C92D6A;background:rgba(201,45,106,.18);z-index:2147483646;pointer-events:none;animation:__rp .6s ease-out forwards}
      @keyframes __rp{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
      .__realce{outline:3px solid rgba(201,45,106,.85)!important;outline-offset:3px;border-radius:10px;transition:outline-color .3s}
      body{transform-origin:0 0}
      ::-webkit-scrollbar{width:0!important;height:0!important}
      html{scrollbar-width:none}\`;
    document.documentElement.appendChild(st);
    const c = document.createElement('div'); c.id = '__cursor'; c.innerHTML = ${JSON.stringify(CURSOR_SVG)};
    document.documentElement.appendChild(c);
  };
  if (document.body) instalar(); else document.addEventListener('DOMContentLoaded', instalar);
})();`;

class Gravador {
  constructor({ largura = 1440, altura = 810, escala = 4 / 3, pasta, movel = false }) {
    Object.assign(this, { largura, altura, escala, pasta, movel });
    this.cursor = { x: largura * 0.6, y: altura * 0.55 };
  }
  async abrir() {
    // navegador em português: campos de data em DD/MM/AAAA, como a cliente vê
    this.browser = await chromium.launch({ args: ['--lang=pt-BR'], env: { ...process.env, LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' } });
    this.ctx = await this.browser.newContext({ viewport: { width: this.largura, height: this.altura }, deviceScaleFactor: this.escala,
      isMobile: this.movel, hasTouch: this.movel, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    await this.ctx.addInitScript(CAMADA);
    this.page = await this.ctx.newPage();
    this.page.setDefaultTimeout(9000);
    this.erros = [];
    this.page.on('pageerror', e => this.erros.push(e.message));
    this.cdp = await this.ctx.newCDPSession(this.page);
    return this.page;
  }
  /** Começa a gravar um trecho (clipe). */
  async iniciar(nome) {
    await this.page.evaluate(CAMADA);
    await this.page.evaluate(({ x, y }) => { const c = document.getElementById('__cursor'); if (c) c.style.transform = `translate(${x}px,${y}px)`; }, this.cursor);
    this.nome = nome;
    this.dir = path.join(this.pasta, 'quadros', nome);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.quadros = [];
    this.inicio = Date.now() / 1000;
    this.handler = async ({ data, metadata, sessionId }) => {
      const n = this.quadros.length;
      const arq = path.join(this.dir, String(n).padStart(6, '0') + '.jpg');
      fs.writeFileSync(arq, Buffer.from(data, 'base64'));
      this.quadros.push({ arq, t: metadata.timestamp });
      this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    };
    this.cdp.on('Page.screencastFrame', this.handler);
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 94, maxWidth: Math.round(this.largura * this.escala), maxHeight: Math.round(this.altura * this.escala), everyNthFrame: 1 });
    // força um primeiro quadro
    await this.page.evaluate(() => { document.documentElement.style.outline = '0px solid transparent'; });
    await this.esperar(150);
  }
  /** Para e gera clipes/<nome>.mp4 (30 qps). duracaoMin: segura o último quadro até essa duração. */
  async parar(duracaoMin = 0) {
    const fim = Date.now() / 1000;
    await this.cdp.send('Page.stopScreencast');
    this.cdp.off('Page.screencastFrame', this.handler);
    await new Promise(r => setTimeout(r, 300));
    const q = this.quadros.filter(x => fs.existsSync(x.arq));
    if (!q.length) throw new Error('nenhum quadro gravado em ' + this.nome);
    const t0 = q[0].t;
    let total = Math.max(fim - t0, duracaoMin);
    const linhas = [];
    q.forEach((x, i) => {
      const prox = i + 1 < q.length ? q[i + 1].t - t0 : total;
      const dur = Math.max(1 / 60, prox - (x.t - t0));
      linhas.push(`file '${x.arq}'`, `duration ${dur.toFixed(4)}`);
    });
    linhas.push(`file '${q[q.length - 1].arq}'`);
    const lista = path.join(this.dir, 'lista.txt');
    fs.writeFileSync(lista, linhas.join('\n'));
    const saida = path.join(this.pasta, 'clipes', this.nome + '.mp4');
    fs.mkdirSync(path.dirname(saida), { recursive: true });
    const W = Math.round(this.largura * this.escala), Hh = Math.round(this.altura * this.escala);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lista,
      '-vf', `scale=${W}:${Hh}:flags=lanczos,fps=30,format=yuv420p`, '-t', total.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', saida]);
    return { saida, duracao: total, quadros: q.length };
  }
  esperar(ms) { return new Promise(r => setTimeout(r, ms)); }

  /** Move o cursor até o elemento (ou ponto) com aceleração suave. */
  async mover(alvo, ms = 900) {
    let x, y;
    if (typeof alvo === 'string') {
      const el = this.page.locator(alvo).first();
      await el.scrollIntoViewIfNeeded().catch(() => {});
      const b = await el.boundingBox();
      if (!b) throw new Error('elemento não visível: ' + alvo);
      x = b.x + b.width / 2; y = b.y + b.height / 2;
    } else ({ x, y } = alvo);
    const de = { ...this.cursor };
    await this.page.evaluate(({ de, x, y, ms }) => new Promise(ok => {
      const c = document.getElementById('__cursor'); const t0 = performance.now();
      // curva levemente arqueada, como um movimento de mão
      const mx = (de.x + x) / 2 + (y - de.y) * 0.12, my = (de.y + y) / 2 - (x - de.x) * 0.06;
      const passo = agora => {
        let p = Math.min(1, (agora - t0) / ms); const e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        const cx = (1 - e) * (1 - e) * de.x + 2 * (1 - e) * e * mx + e * e * x, cy = (1 - e) * (1 - e) * de.y + 2 * (1 - e) * e * my + e * e * y;
        c.style.transform = `translate(${cx - 4}px,${cy - 3}px)`;
        if (p < 1) requestAnimationFrame(passo); else ok();
      };
      requestAnimationFrame(passo);
    }), { de, x, y, ms });
    this.cursor = { x, y };
    await this.page.mouse.move(x, y);
  }
  async clicar(alvo, { ms = 800, antes = 250, depois = 500 } = {}) {
    await this.mover(alvo, ms);
    await this.esperar(antes);
    await this.page.evaluate(({ x, y }) => { const r = document.createElement('div'); r.className = '__ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 700); }, this.cursor);
    await this.page.mouse.click(this.cursor.x, this.cursor.y);
    await this.esperar(depois);
  }
  /** Digita como uma pessoa (velocidade variável). */
  async digitar(alvo, texto, cps = 14) {
    await this.clicar(alvo, { depois: 200 });
    for (const ch of texto) { await this.page.keyboard.type(ch); await this.esperar(1000 / cps * (0.6 + Math.random() * 0.8)); }
  }
  /** Câmera: aproxima (escala) mantendo o ponto (x, y) da tela no centro; escala 1 volta ao normal. */
  async camera(escala = 1, alvo = null, ms = 1200) {
    let cx = this.largura / 2, cy = this.altura / 2;
    if (typeof alvo === 'string') {
      await this.page.evaluate(() => { document.body.style.transition = 'none'; document.body.style.transform = 'none'; });
      const b = await this.page.locator(alvo).first().boundingBox();
      if (b) { cx = b.x + b.width / 2; cy = b.y + b.height / 2; }
    } else if (alvo) ({ x: cx, y: cy } = alvo);
    let tx = this.largura / 2 - cx * escala, ty = this.altura / 2 - cy * escala;
    tx = Math.min(0, Math.max(this.largura - this.largura * escala, tx));
    ty = Math.min(0, Math.max(this.altura - this.altura * escala, ty));
    await this.page.evaluate(({ escala, tx, ty, ms }) => {
      document.body.style.transition = `transform ${ms}ms cubic-bezier(.45,.05,.25,1)`;
      document.body.style.transform = escala === 1 ? 'none' : `translate(${tx}px,${ty}px) scale(${escala})`;
    }, { escala, tx, ty, ms });
    await this.esperar(ms + 50);
    this.zoom = { escala, tx, ty };
  }
  async realcar(alvo, ligar = true) {
    await this.page.locator(alvo).first().evaluate((el, l) => el.classList.toggle('__realce', l), ligar).catch(() => {});
  }
  async rolar(px, ms = 900) {
    await this.page.evaluate(({ px, ms }) => new Promise(ok => {
      const y0 = scrollY, t0 = performance.now();
      const f = t => { const p = Math.min(1, (t - t0) / ms), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; scrollTo(0, y0 + px * e); p < 1 ? requestAnimationFrame(f) : ok(); };
      requestAnimationFrame(f);
    }), { px, ms });
  }
  async fechar() { await this.browser?.close(); }
}
module.exports = { Gravador };
