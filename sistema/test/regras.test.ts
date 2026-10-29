import { describe, expect, it } from 'vitest';
import {
  brl, calcularTotais, dataBR, derivarStatusProducao, hoje, lerQuantidade, lerValor, linkWhatsApp, montarMensagem,
  normalizarTelefone, numeroWhatsApp, somarDias, transicoesManuais,
} from '../public/js/regras.js';

describe('datas no fuso de São Paulo (erro 3: data fixa)', () => {
  it('usa a data real, no fuso America/Sao_Paulo', () => {
    // 02:30 UTC de 30/10 ainda é 29/10 em São Paulo (UTC-3)
    expect(hoje(new Date('2026-10-30T02:30:00Z'))).toBe('2026-10-29');
    expect(hoje(new Date('2026-10-30T03:30:00Z'))).toBe('2026-10-30');
    expect(hoje()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('formata DD/MM/AAAA, com ano (erro 5)', () => {
    expect(dataBR('2022-03-07')).toBe('07/03/2022');
    expect(dataBR('2022-03-07T15:00:00Z')).toBe('07/03/2022');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('dinheiro', () => {
  it('formata R$ 0,00', () => {
    expect(brl(2500)).toBe('R$ 25,00');
    expect(brl(123456)).toBe('R$ 1.234,56');
  });
  it('lê valores digitados', () => {
    expect(lerValor('25')).toBe(2500);
    expect(lerValor('25,5')).toBe(2550);
    expect(lerValor('1.234,56')).toBe(123456);
    expect(lerValor('R$ 10,00')).toBe(1000);
    expect(lerValor('abc')).toBeNull();
    expect(lerValor('')).toBeNull();
    expect(lerValor('-5')).toBeNull();
  });
});

describe('quantidade (erro 2)', () => {
  it('rejeita vazio, zero, negativo e fração em unidades', () => {
    for (const v of ['', '0', '-1', 'abc', '1,5', '0,0']) expect(lerQuantidade(v, 'un')).toBeNull();
    expect(lerQuantidade('3', 'un')).toBe(3);
  });
  it('aceita decimal positivo para metros', () => {
    expect(lerQuantidade('1,5', 'm')).toBe(1.5);
    expect(lerQuantidade('0', 'm')).toBeNull();
  });
});

describe('telefone e WhatsApp (erro 4)', () => {
  it('normaliza números brasileiros', () => {
    expect(normalizarTelefone('(11) 98765-4321')).toMatchObject({ valido: true, digitos: '11987654321' });
    expect(normalizarTelefone('+55 11 98765-4321')).toMatchObject({ valido: true, digitos: '11987654321' });
    expect(normalizarTelefone('011 98765-4321')).toMatchObject({ valido: true, digitos: '11987654321' });
    expect(normalizarTelefone('(11) 3456-7890')).toMatchObject({ valido: true, digitos: '1134567890' });
  });
  it('recusa telefone vazio ou inválido e nunca gera link quebrado', () => {
    expect(normalizarTelefone('').valido).toBe(false);
    expect(normalizarTelefone('12345').valido).toBe(false);
    expect(normalizarTelefone('(11) 88765-4321').valido).toBe(false); // celular com 11 dígitos sem o 9
    expect(linkWhatsApp('')).toBeNull();
    expect(linkWhatsApp(null)).toBeNull();
    expect(linkWhatsApp('55')).toBeNull();
    expect(numeroWhatsApp({ telefone: null, whatsapp: null })).toBeNull();
  });
  it('gera o link com o texto codificado', () => {
    const l = linkWhatsApp('11987654321', 'Olá, Mariana! R$ 25,00');
    expect(l).toBe('https://wa.me/5511987654321?text=Ol%C3%A1%2C%20Mariana!%20R%24%2025%2C00');
  });
  it('usa o WhatsApp se houver, senão o telefone', () => {
    expect(numeroWhatsApp({ telefone: '11987654321', whatsapp: '' })).toBe('11987654321');
    expect(numeroWhatsApp({ telefone: '11987654321', whatsapp: '21991234567' })).toBe('21991234567');
  });
  it('monta a mensagem de peça pronta com os dados reais', () => {
    const t = montarMensagem('pronta', { cliente: 'Mariana Souza', numero: 142, pecas: ['Calça'], saldo: 2500, total: 5000, prazo: '2026-11-02', atelie: 'Ateliê Jessica' });
    expect(t).toBe('Olá, Mariana! Sua calça referente à OS nº 0142 está pronta para retirada no Ateliê Jessica. O saldo pendente é de R$ 25,00. Aguardamos você!');
    expect(montarMensagem('pronta', { cliente: 'Ana', numero: 7, pecas: ['Vestido'], saldo: 0 })).toContain('Seu vestido referente à OS nº 0007 está pronto');
    expect(montarMensagem('pronta', { cliente: 'Ana', numero: 7, pecas: ['Calça', 'Vestido'], saldo: 0 })).toContain('estão prontas');
  });
});

describe('totais e status', () => {
  it('soma várias peças e serviços com desconto', () => {
    const t = calcularTotais([
      { quantidade: 1, valor_unitario_centavos: 2500 },
      { quantidade: 2, valor_unitario_centavos: 1000 },
      { quantidade: 1.5, valor_unitario_centavos: 3333 },
    ], 500, 1000);
    expect(t).toEqual({ soma: 2500 + 2000 + 5000, total: 9000, pago: 1000, saldo: 8000 });
  });
  it('calcula a situação da OS pelas peças', () => {
    expect(derivarStatusProducao(['aguardando', 'aguardando'])).toBe('aprovada');
    expect(derivarStatusProducao(['em_execucao', 'aguardando'])).toBe('em_producao');
    expect(derivarStatusProducao(['finalizado', 'aguardando'])).toBe('em_producao');
    expect(derivarStatusProducao(['finalizado', 'aguardando_prova'])).toBe('aguardando_prova');
    expect(derivarStatusProducao(['ajustes_finais', 'em_execucao'])).toBe('ajustes_finais');
    expect(derivarStatusProducao(['finalizado', 'finalizado'])).toBe('pronta');
  });
  it('não permite pular etapas manualmente', () => {
    expect(transicoesManuais('recebida')).not.toContain('entregue');
    expect(transicoesManuais('pronta')).toContain('entregue');
    expect(transicoesManuais('entregue')).toEqual([]);
  });
});
