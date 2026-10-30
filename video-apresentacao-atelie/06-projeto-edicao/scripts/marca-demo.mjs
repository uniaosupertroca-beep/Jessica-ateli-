// Coloca o ícone do app como logo dos documentos da DEMONSTRAÇÃO e preenche os textos dos documentos.
import { readFileSync } from 'node:fs';
const BASE = process.argv[2] || 'http://127.0.0.1:8791';
const senha = readFileSync(new URL('../.demo-senha', import.meta.url), 'utf8');
let r = await fetch(BASE + '/api/auth/entrar', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ email: 'demo@atelie-jessica.demo', senha }) });
const cookie = r.headers.get('set-cookie').match(/__Host-sid=[^;]+/)[0];
const fd = new FormData();
fd.append('arquivo', new Blob([readFileSync(new URL('../../../sistema/public/icones/icone-512.png', import.meta.url))], { type: 'image/png' }), 'logo.png');
r = await fetch(BASE + '/api/config/logo', { method: 'POST', headers: { Cookie: cookie, Origin: BASE }, body: fd });
console.log('logo', r.status);
r = await fetch(BASE + '/api/config/documentos', { method: 'PATCH', headers: { Cookie: cookie, Origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify({
  doc_cor: '#C92D6A', doc_cabecalho: '@ateliejessica · seg a sex, 9h às 18h', rodape_os: 'Peças não retiradas em até 90 dias poderão ser doadas. Confira a peça na retirada.',
  doc_termos_orcamento: 'Pagamento de 50% na aprovação e o restante na retirada.', doc_validade_orcamento_dias: 7,
  doc_texto_retirada: 'Declaro que retirei as peças abaixo em perfeito estado.', doc_assinatura: 'Ateliê Jessica', doc_logo_etiqueta: true, doc_mostrar_telefone_cliente: true }) });
console.log('documentos', r.status);
