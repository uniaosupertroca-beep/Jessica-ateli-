// Regras puras do Ateliê Jessica, usadas pelo navegador e pelo servidor (Worker).
// Nada aqui acessa rede, banco ou DOM: só cálculos e textos.

export const FUSO = 'America/Sao_Paulo';

/* ---------------- datas (fuso de São Paulo) ---------------- */

const fmtISO = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Data de hoje em São Paulo, no formato AAAA-MM-DD. */
export function hoje(agora = new Date()) {
  return fmtISO.format(agora);
}

export function dataValida(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function somarDias(iso, n) {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** 2026-10-29 → 29/10/2026 */
export function dataBR(iso) {
  if (!iso) return '—';
  const s = String(iso).slice(0, 10);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

/** Instante ISO (UTC) → data AAAA-MM-DD em São Paulo. */
export function dataDoInstante(isoInstante) {
  return hoje(new Date(isoInstante));
}

/* ---------------- dinheiro (sempre centavos inteiros) ---------------- */

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** 2500 → "R$ 25,00" (espaço normal, não o não-separável do Intl). */
export function brl(centavos) {
  return fmtBRL.format((Number(centavos) || 0) / 100).replace(/ /g, ' ');
}

/** Converte texto digitado ("25", "25,5", "1.234,56", "R$ 10,00") em centavos. Retorna null se inválido. */
export function lerValor(texto) {
  let s = String(texto ?? '').trim().replace(/R\$\s?/i, '').replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** Centavos → texto para campo de edição: 2550 → "25,50". */
export function valorParaCampo(centavos) {
  return ((Number(centavos) || 0) / 100).toFixed(2).replace('.', ',');
}

/* ---------------- quantidades ---------------- */

export const UNIDADES = { un: 'unidade', m: 'metro', cm: 'centímetro', h: 'hora' };

/** Lê a quantidade digitada. Retorna número > 0 ou null. Unidade "un" exige inteiro. */
export function lerQuantidade(texto, unidade = 'un') {
  const s = String(texto ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const q = Number(s);
  if (!(q > 0) || q > 100000) return null;
  if (unidade === 'un' && !Number.isInteger(q)) return null;
  return q;
}

export function quantidadeValida(q, unidade = 'un') {
  return typeof q === 'number' && Number.isFinite(q) && q > 0 && q <= 100000 && (unidade !== 'un' || Number.isInteger(q));
}

export function subtotal(quantidade, valorUnitarioCentavos) {
  return Math.round(quantidade * valorUnitarioCentavos);
}

/* ---------------- telefone e WhatsApp ---------------- */

/**
 * Normaliza um telefone brasileiro. Aceita "(11) 98765-4321", "+55 11 98765 4321", "011987654321"...
 * Retorna { valido, digitos, motivo }. `digitos` tem DDD + número, sem o 55.
 */
export function normalizarTelefone(texto) {
  let d = String(texto ?? '').replace(/\D/g, '');
  if (!d) return { valido: false, digitos: '', motivo: 'Telefone não informado.' };
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length >= 11 && d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length !== 10 && d.length !== 11) return { valido: false, digitos: d, motivo: 'O telefone precisa ter DDD + número (10 ou 11 dígitos).' };
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99 || d[1] === '0') return { valido: false, digitos: d, motivo: 'DDD inválido.' };
  if (d.length === 11 && d[2] !== '9') return { valido: false, digitos: d, motivo: 'Celular com 11 dígitos deve começar com 9 após o DDD.' };
  return { valido: true, digitos: d, motivo: '' };
}

export function formatarTelefone(digitos) {
  const d = String(digitos ?? '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

/** Número usado para WhatsApp: o campo WhatsApp, ou o telefone se o WhatsApp estiver vazio. */
export function numeroWhatsApp(cliente) {
  if (!cliente) return null;
  const n = normalizarTelefone(cliente.whatsapp || cliente.telefone);
  return n.valido ? n.digitos : null;
}

/** Link wa.me com texto. Retorna null quando o telefone não é válido (nunca gera link quebrado). */
export function linkWhatsApp(telefone, texto = '') {
  const n = normalizarTelefone(telefone);
  if (!n.valido) return null;
  const q = texto ? `?text=${encodeURIComponent(texto)}` : '';
  return `https://wa.me/55${n.digitos}${q}`;
}

/* ---------------- mensagens ---------------- */

export const ORIGENS_CLIENTE = {
  indicacao: 'Indicação', instagram: 'Instagram', facebook: 'Facebook', google: 'Google', whatsapp: 'WhatsApp',
  passou_na_frente: 'Passou na frente', cliente_antiga: 'Já era cliente', outro: 'Outro',
};

export const MODELOS_MENSAGEM = {
  recebimento: 'Confirmação de recebimento',
  orcamento: 'Envio de orçamento',
  aprovacao: 'Solicitação de aprovação',
  prova: 'Agendamento de prova',
  lembrete_prova: 'Lembrete de prova',
  pronta: 'Aviso de peça pronta',
  retirada: 'Lembrete de retirada',
  agradecimento: 'Agradecimento após a entrega',
};

function primeiroNome(nome) {
  return String(nome ?? '').trim().split(/\s+/)[0] || '';
}

const MASCULINAS = new Set(['vestido', 'blazer', 'terno', 'casaco', 'paletó', 'palete', 'uniforme', 'short', 'shorts', 'macacão',
  'conjunto', 'quimono', 'kimono', 'robe', 'sobretudo', 'colete', 'top', 'body', 'suéter', 'moletom', 'lençol', 'edredom',
  'avental', 'jaleco', 'cropped', 'biquíni', 'maiô', 'pijama', 'tapete', 'forro', 'traje']);

/** Descreve as peças para a mensagem: { texto: "sua calça jeans", fem, plural }. */
export function descreverPecas(pecas) {
  const p = [...new Set((pecas || []).map(x => String(x).trim().toLowerCase()).filter(Boolean))];
  if (!p.length) return { texto: 'sua peça', fem: true, plural: false };
  if (p.length === 1) {
    const fem = !MASCULINAS.has(p[0].split(/\s+/)[0]);
    return { texto: `${fem ? 'sua' : 'seu'} ${p[0]}`, fem, plural: false };
  }
  return { texto: `suas peças (${p.slice(0, -1).join(', ')} e ${p[p.length - 1]})`, fem: true, plural: true };
}

const maiuscula = s => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Monta o texto de uma mensagem a partir dos dados reais da OS.
 * dados: { atelie, cliente, numero, pecas: string[], total, saldo, prazo, dataProva? }
 */
export function montarMensagem(modelo, dados) {
  const nome = primeiroNome(dados.cliente);
  const os = `OS nº ${String(dados.numero).padStart(4, '0')}`;
  const d = descreverPecas(dados.pecas);
  const pecas = d.texto;
  const pronta = d.plural ? 'estão prontas' : d.fem ? 'está pronta' : 'está pronto';
  const espera = d.plural ? 'estão esperando' : 'está esperando';
  const at = dados.atelie || 'Ateliê Jessica';
  const saldo = Number(dados.saldo) || 0;
  const frase = saldo > 0 ? ` O saldo pendente é de ${brl(saldo)}.` : ' Está tudo pago.';
  switch (modelo) {
    case 'recebimento':
      return `Olá, ${nome}! Recebemos ${pecas} no ${at} (${os}). A previsão de entrega é ${dataBR(dados.prazo)}. Qualquer dúvida, é só chamar!`;
    case 'orcamento':
      return `Olá, ${nome}! Segue o orçamento da ${os} no ${at}: total de ${brl(dados.total)}, com entrega prevista para ${dataBR(dados.prazo)}.`;
    case 'aprovacao':
      return `Olá, ${nome}! O orçamento da ${os} ficou em ${brl(dados.total)}. Podemos seguir com o serviço? Responda esta mensagem para aprovar.`;
    case 'prova':
      return `Olá, ${nome}! ${maiuscula(pecas)} (${os}) já ${d.plural ? 'podem ser provadas' : d.fem ? 'pode ser provada' : 'pode ser provado'} no ${at}.${dados.dataProva ? ` Sugerimos ${dataBR(dados.dataProva)}.` : ''} Qual o melhor dia e horário para você?`;
    case 'lembrete_prova':
      return `Olá, ${nome}! Lembrete: sua prova no ${at} está marcada para ${dataBR(dados.dataProva)}${dados.horaProva ? ` às ${dados.horaProva}` : ''} (${os}). Até lá!`;
    case 'pronta':
      return `Olá, ${nome}! ${maiuscula(pecas)} referente à ${os} ${pronta} para retirada no ${at}.${frase} Aguardamos você!`;
    case 'retirada':
      return `Olá, ${nome}! Lembrete: ${pecas} (${os}) ${espera} por você no ${at}.${frase}`;
    case 'agradecimento':
      return `Olá, ${nome}! Obrigada por escolher o ${at}. Esperamos que tenha gostado do resultado. Até a próxima!`;
    default:
      throw new Error('Modelo de mensagem desconhecido: ' + modelo);
  }
}

/* ---------------- status da OS e produção ---------------- */

export const STATUS_OS = {
  recebida: 'Recebida',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovada: 'Aprovada',
  em_producao: 'Em produção',
  aguardando_prova: 'Aguardando prova',
  ajustes_finais: 'Ajustes finais',
  pronta: 'Pronta',
  entregue: 'Entregue',
  pausada: 'Pausada',
  cancelada: 'Cancelada',
};

export const STATUS_PRODUCAO = {
  aguardando: 'Aguardando início',
  em_execucao: 'Em execução',
  aguardando_prova: 'Aguardando prova',
  ajustes_finais: 'Ajustes finais',
  finalizado: 'Finalizado',
};

/** Status em que a situação da OS é calculada a partir das peças. */
export const STATUS_DE_PRODUCAO = ['aprovada', 'em_producao', 'aguardando_prova', 'ajustes_finais', 'pronta'];
export const STATUS_FINAIS = ['entregue', 'cancelada'];
/** Fluxo exibido na tela (linha do tempo). */
export const FLUXO_OS = ['recebida', 'aguardando_aprovacao', 'aprovada', 'em_producao', 'aguardando_prova', 'ajustes_finais', 'pronta', 'entregue'];

/**
 * Situação da OS calculada a partir das peças (vale quando a OS já foi aprovada):
 *   todas finalizadas → pronta; alguma aguardando prova → aguardando_prova (depende da cliente);
 *   alguma em ajustes finais → ajustes_finais; alguma iniciada → em_producao; nenhuma iniciada → aprovada.
 * Esta regra é espelhada em SQL no servidor (src/lib/status.ts).
 */
export function derivarStatusProducao(statusPecas) {
  if (!statusPecas.length) return 'aprovada';
  if (statusPecas.every(s => s === 'finalizado')) return 'pronta';
  if (statusPecas.includes('aguardando_prova')) return 'aguardando_prova';
  if (statusPecas.includes('ajustes_finais')) return 'ajustes_finais';
  if (statusPecas.some(s => s === 'em_execucao' || s === 'finalizado')) return 'em_producao';
  return 'aprovada';
}

/** Mudanças de status que a pessoa pode pedir manualmente (as de produção são calculadas). */
export function transicoesManuais(status) {
  switch (status) {
    case 'recebida': return ['aguardando_aprovacao', 'aprovada', 'pausada', 'cancelada'];
    case 'aguardando_aprovacao': return ['aprovada', 'recebida', 'pausada', 'cancelada'];
    case 'aprovada': return ['aguardando_aprovacao', 'pausada', 'cancelada'];
    case 'em_producao':
    case 'aguardando_prova':
    case 'ajustes_finais': return ['pausada', 'cancelada'];
    case 'pronta': return ['entregue', 'pausada', 'cancelada'];
    case 'pausada': return ['retomar', 'cancelada'];
    default: return [];
  }
}

/** Totais da OS em centavos. servicos: [{quantidade, valor_unitario_centavos}] */
export function calcularTotais(servicos, descontoCentavos, pagoCentavos) {
  const soma = servicos.reduce((s, x) => s + subtotal(x.quantidade, x.valor_unitario_centavos), 0);
  const total = soma - (descontoCentavos || 0);
  const pago = pagoCentavos || 0;
  return { soma, total, pago, saldo: total - pago };
}

/** Situação de ocupação de um dia na agenda. */
export function situacaoDia(qtd, capacidade, limiteQuaseCheio) {
  if (qtd >= capacidade) return 'lotado';
  if (qtd >= limiteQuaseCheio) return 'quase';
  return 'livre';
}

/* ---------------- produção ---------------- */

export const COLUNAS_KANBAN = ['aguardando', 'em_execucao', 'aguardando_prova', 'ajustes_finais', 'finalizado'];

/** Minutos → "1 h 30 min". */
export function duracao(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Minutos inteiros entre dois instantes ISO (mínimo 0). */
export function minutosEntre(inicioIso, fimIso) {
  return Math.max(0, Math.round((new Date(fimIso).getTime() - new Date(inicioIso).getTime()) / 60000));
}

/* ---------------- preço sugerido ---------------- */

/**
 * Calculadora de preço sugerido (o administrador decide o preço final):
 *   custo direto = tempo × custo por hora + materiais
 *   custo total  = custo direto × (1 + despesas indiretas %)
 *   preço        = custo total × (1 + margem %)
 * Retorna centavos, arredondado para cima em múltiplos de R$ 0,50.
 */
export function precoSugerido({ tempoMin = 0, custoHoraCentavos = 0, materiaisCentavos = 0, indiretasPct = 0, margemPct = 0 }) {
  const direto = (tempoMin / 60) * custoHoraCentavos + materiaisCentavos;
  const total = direto * (1 + indiretasPct / 100);
  const preco = total * (1 + margemPct / 100);
  return { direto: Math.round(direto), total: Math.round(total), preco: Math.ceil(preco / 50) * 50 };
}

/* ---------------- agenda ---------------- */

export const TIPOS_AGENDA = {
  prova: 'Prova', entrega: 'Entrega', retirada: 'Retirada', recebimento: 'Recebimento de encomenda',
  atendimento: 'Atendimento', prazo_producao: 'Prazo de produção', ausencia: 'Ausência de profissional',
};

/** Dia da semana (0 = domingo) de uma data AAAA-MM-DD. */
export function diaDaSemana(iso) {
  return new Date(iso + 'T12:00:00Z').getUTCDay();
}

/** Dois horários (HH:MM) se sobrepõem? Sem horário = dia todo. */
export function horariosConflitam(a, b) {
  const ai = a.hora_inicio || '00:00', af = a.hora_fim || a.hora_inicio || '23:59';
  const bi = b.hora_inicio || '00:00', bf = b.hora_fim || b.hora_inicio || '23:59';
  if (!a.hora_fim && a.hora_inicio && !b.hora_fim && b.hora_inicio) return a.hora_inicio === b.hora_inicio;
  return ai < bf && bi < af;
}

/** Situação da carga de trabalho do dia em minutos. */
export function situacaoCarga(demandaMin, capacidadeMin) {
  if (capacidadeMin <= 0) return demandaMin > 0 ? 'lotado' : 'livre';
  const p = demandaMin / capacidadeMin;
  return p > 1 ? 'lotado' : p >= 0.8 ? 'quase' : 'livre';
}

/* ---------------- estoque ---------------- */

export const CATEGORIAS_MATERIAL = {
  tecido: 'Tecidos', linha: 'Linhas', ziper: 'Zíperes', botao: 'Botões', elastico: 'Elásticos',
  entretela: 'Entretelas', agulha: 'Agulhas', aviamento: 'Aviamentos', outro: 'Outros materiais',
};
export const UNIDADES_ESTOQUE = { un: 'unidade', m: 'metro', cm: 'centímetro', pct: 'pacote', rolo: 'rolo', kg: 'quilo', g: 'grama', cx: 'caixa' };
export const TIPOS_MOVIMENTO = { compra: 'Entrada por compra', consumo: 'Consumo em OS', devolucao: 'Devolução', perda: 'Perda', ajuste: 'Ajuste de inventário', reversao: 'Reversão', transferencia: 'Transferência entre unidades' };

/** Soma quantidades fracionadas sem erro de arredondamento (3 casas). */
export function somarQtd(a, b) {
  return Math.round((a + b) * 1000) / 1000;
}

/** Converte valores de um relatório em CSV (separador ;, compatível com Excel em português). */
export function paraCSV(colunas, linhas) {
  const cel = v => {
    let t = v === null || v === undefined ? '' : String(v);
    // Evita que um texto como "=HYPERLINK(...)" vire fórmula ao abrir no Excel (números negativos ficam como estão).
    if (/^[=+\-@\t\r]/.test(t) && !/^-?\d[\d.,]*$/.test(t)) t = "'" + t;
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [colunas.map(c => cel(c.titulo)).join(';'), ...linhas.map(l => colunas.map(c => cel(c.valor(l))).join(';'))].join('\r\n');
}
