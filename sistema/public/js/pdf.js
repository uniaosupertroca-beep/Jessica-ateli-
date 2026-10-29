// Baixa um documento (OS, orçamento, comprovantes, etiquetas) direto como arquivo PDF.
// A biblioteca (html2pdf: html2canvas + jsPDF) fica no próprio sistema e só é carregada no primeiro uso.
let carregando;
function biblioteca() {
  carregando ??= new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = '/vendor/html2pdf.bundle.min.js';
    s.onload = () => ok(window.html2pdf);
    s.onerror = () => { carregando = null; falha(new Error('Não foi possível preparar o PDF. Verifique a internet e tente de novo.')); };
    document.head.appendChild(s);
  });
  return carregando;
}

/** Nome de arquivo sem acentos nem símbolos: "OS-0012-orcamento-maria-silva.pdf". */
export function nomeArquivo(...partes) {
  return partes.filter(Boolean).join('-').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().replace(/^os-/, 'OS-') + '.pdf';
}

/** Gera e baixa o PDF do elemento. formato: 'a4' ou [largura, altura] em mm (etiqueta térmica). */
export async function baixarPDF(elemento, arquivo, formato = 'a4') {
  const html2pdf = await biblioteca();
  const termica = Array.isArray(formato);
  elemento.classList.add('gerando-pdf');
  try {
  await html2pdf().set({
    margin: termica ? 0 : 8,
    filename: arquivo,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'mm', format: formato, orientation: termica && formato[0] > formato[1] ? 'landscape' : 'portrait' },
    pagebreak: { mode: ['css', 'legacy'], avoid: ['.etiqueta', 'tr', '.ass', '.box'] },
  }).from(elemento).save();
  } finally { elemento.classList.remove('gerando-pdf'); }
}
