import type { Papel } from '../env';

/**
 * Permissões verificadas no servidor (o bloqueio de botões na tela é só conforto visual).
 * O administrador tem todas.
 */
export const PERMISSOES = [
  'clientes.ver', 'clientes.editar', 'clientes.exportar', 'clientes.anonimizar',
  'medidas.ver', 'medidas.editar',
  'os.ver', 'os.editar', 'os.status', 'os.cancelar', 'os.alterar_preco', 'os.financeiro.ver',
  'producao.atualizar', 'producao.atribuir',
  'fotos.ver', 'fotos.enviar', 'fotos.excluir',
  'pagamentos.receber', 'caixa.operar', 'caixa.reabrir', 'financeiro.ver', 'financeiro.estornar', 'financeiro.lancar',
  'agenda.ver', 'whatsapp.usar',
  'config.editar', 'usuarios.gerenciar', 'backup.gerenciar',
] as const;
export type Permissao = (typeof PERMISSOES)[number];

const ATENDENTE: Permissao[] = [
  'clientes.ver', 'clientes.editar',
  'medidas.ver', 'medidas.editar',
  'os.ver', 'os.editar', 'os.status', 'os.cancelar', 'os.financeiro.ver',
  'producao.atualizar', 'producao.atribuir',
  'fotos.ver', 'fotos.enviar',
  'pagamentos.receber', 'caixa.operar', 'financeiro.ver', 'financeiro.lancar',
  'agenda.ver', 'whatsapp.usar',
];

// Costureira: vê as peças atribuídas a ela, medidas e fotos; atualiza a produção. Sem valores.
const COSTUREIRA: Permissao[] = ['os.ver', 'medidas.ver', 'fotos.ver', 'fotos.enviar', 'producao.atualizar', 'agenda.ver'];

export function permissoesDo(papel: Papel): ReadonlySet<string> {
  if (papel === 'admin') return new Set(PERMISSOES);
  if (papel === 'atendente') return new Set(ATENDENTE);
  return new Set(COSTUREIRA);
}

export const PAPEIS: Record<Papel, string> = { admin: 'Administrador', atendente: 'Atendente', costureira: 'Costureira' };
