import type { ZodError } from 'zod';

/** Erro com mensagem pronta para a pessoa ler (sempre em português). */
export class ErroApp extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500,
    public codigo: string,
    mensagem: string,
    public extra?: Record<string, unknown>,
  ) {
    super(mensagem);
  }
}

export const naoEncontrado = (o = 'Registro') => new ErroApp(404, 'nao_encontrado', `${o} não encontrado.`);
export const semPermissao = () => new ErroApp(403, 'sem_permissao', 'Você não tem permissão para fazer isso.');

/** Mensagens das travas do banco (triggers e restrições) traduzidas para a pessoa. */
const ERROS_BANCO: Array<[RegExp, ErroApp['status'], string, string]> = [
  [/caixa_fechado/, 409, 'caixa_fechado', 'O caixa de hoje não está aberto. Abra o caixa para registrar valores.'],
  [/pagamento_excede_saldo/, 422, 'pagamento_excede_saldo', 'O valor é maior que o saldo devido desta OS.'],
  [/os_cancelada/, 409, 'os_cancelada', 'Esta OS está cancelada e não recebe pagamentos.'],
  [/estorno_invalido/, 409, 'estorno_invalido', 'Este lançamento não pode ser estornado.'],
  [/credito_insuficiente/, 422, 'credito_insuficiente', 'A cliente não tem crédito suficiente.'],
  [/lancamento_imutavel/, 409, 'lancamento_imutavel', 'Lançamentos financeiros não podem ser alterados nem apagados. Use o estorno.'],
  [/total_menor_que_pago/, 422, 'total_menor_que_pago', 'O total da OS ficaria menor que o valor já pago. Estorne o pagamento antes de reduzir o valor.'],
  [/versao_desatualizada/, 409, 'versao_desatualizada', 'Esta OS foi alterada em outro aparelho. Recarregue a página e tente de novo.'],
  [/saldo_mudou/, 409, 'saldo_mudou', 'O saldo da OS mudou enquanto você registrava. Confira e tente de novo.'],
  [/os_bloqueada/, 409, 'os_bloqueada', 'OS entregue ou cancelada não pode ser alterada.'],
  [/os_com_pagamento/, 409, 'os_com_pagamento', 'Esta OS tem pagamentos. Estorne os pagamentos antes de cancelar.'],
  [/peca_com_fotos/, 409, 'peca_com_fotos', 'Esta peça tem fotos e não pode ser removida.'],
  [/medida_imutavel/, 409, 'medida_imutavel', 'Medidas registradas não são alteradas. Registre uma nova medição.'],
  [/registro_protegido|caixa_imutavel/, 409, 'registro_protegido', 'Este registro não pode ser apagado.'],
  [/UNIQUE constraint failed: cash_movements\.estorno_de/, 409, 'ja_estornado', 'Este lançamento já foi estornado.'],
  [/UNIQUE constraint failed: cash_sessions\.data/, 409, 'caixa_ja_existe', 'O caixa de hoje já foi aberto.'],
  [/UNIQUE constraint failed: users\.email/, 409, 'email_em_uso', 'Já existe um usuário com este e-mail.'],
  [/UNIQUE constraint failed: (service_catalog|service_categories|measurement_fields|payment_methods|finance_categories)/, 409, 'nome_em_uso', 'Já existe um cadastro com este nome.'],
  [/FOREIGN KEY constraint failed/, 422, 'referencia_invalida', 'Um dos registros informados não existe.'],
  [/CHECK constraint failed/, 422, 'dados_invalidos', 'Algum valor informado é inválido.'],
];

export function traduzirErroBanco(e: unknown): ErroApp | null {
  const msg = e instanceof Error ? e.message : String(e);
  for (const [re, status, codigo, texto] of ERROS_BANCO) if (re.test(msg)) return new ErroApp(status, codigo, texto);
  return null;
}

export function erroValidacao(e: ZodError): ErroApp {
  const i = e.issues[0];
  const campo = i?.path?.length ? String(i.path.join('.')) : '';
  return new ErroApp(422, 'dados_invalidos', i?.message || 'Dados inválidos.', { campo });
}
