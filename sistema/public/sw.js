// Service worker do Ateliê Jessica.
// - Guarda só os arquivos da interface (HTML, CSS, JS, ícones) para abrir rápido e funcionar como app.
// - NUNCA guarda respostas da API (/api/*): dados de clientes, fotos e valores ficam só no servidor.
// - Sempre tenta a rede primeiro; o cache só é usado sem internet.
// - Uma versão nova fica "esperando" até a pessoa tocar em "Atualizar" (atualização controlada).
const VERSAO = 'atelie-v8';
const ESSENCIAIS = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/api.js', '/js/ui.js', '/js/regras.js', '/js/busca.js', '/js/graficos.js', '/js/documento.js', '/js/pdf.js',
  '/manifest.webmanifest', '/icones/icone-192.png', '/icones/icone.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ESSENCIAIS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('message', e => {
  if (e.data === 'atualizar') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return; // API: direto na rede, sem cache
  e.respondWith((async () => {
    try {
      const r = await fetch(e.request);
      if (r.ok && r.type === 'basic') {
        const c = await caches.open(VERSAO);
        c.put(e.request.mode === 'navigate' ? '/index.html' : e.request, r.clone());
      }
      return r;
    } catch {
      const c = await caches.open(VERSAO);
      return (await c.match(e.request.mode === 'navigate' ? '/index.html' : e.request)) || Response.error();
    }
  })());
});
