// Cabeçalho e aparência comuns a todos os documentos impressos (logo, cor e textos definidos em Configurações).
import { esc } from './ui.js';

export const urlLogo = a => (a.logo_versao ? `/api/config/logo?v=${encodeURIComponent(a.logo_versao)}` : null);

/** Atributo de estilo com a cor escolhida para os documentos. */
export const estiloDoc = a => `style="--doc-cor:${/^#[0-9a-f]{6}$/i.test(a.doc_cor || '') ? a.doc_cor : '#C92D6A'}"`;

/**
 * Cabeçalho do documento: logo + dados do ateliê à esquerda; tipo do documento, número e datas à direita.
 * direita: [[rótulo, valor], ...]
 */
export function cabecalhoDoc(a, titulo, numero, direita = []) {
  const logo = urlLogo(a);
  return `<div class="top doc-topo">
    <div class="doc-marca">${logo ? `<img class="doc-logo" src="${logo}" alt="${esc(a.nome)}">` : ''}
      <div><h2>${esc(a.nome)}</h2>${a.endereco ? `<div>${esc(a.endereco)}</div>` : ''}
        <div>${esc(a.telefone || '')}${a.documento ? ' · ' + esc(a.documento) : ''}</div>
        ${a.doc_cabecalho ? `<div class="doc-extra">${esc(a.doc_cabecalho)}</div>` : ''}</div></div>
    <div style="text-align:right"><div class="doc-titulo">${esc(titulo)}</div>
      ${numero ? `<div style="font-size:22px;font-weight:700" class="num">${esc(numero)}</div>` : ''}
      ${direita.map(([r, v]) => `<div>${esc(r)}: <b>${esc(v)}</b></div>`).join('')}</div></div>`;
}

export const assinaturaAtelie = a => esc(a.doc_assinatura || a.nome);
