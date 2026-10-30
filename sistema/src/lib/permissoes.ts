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
  'producao.ver', 'agenda.editar',
  'estoque.ver', 'estoque.movimentar', 'estoque.consumir', 'estoque.negativo', 'estoque.cadastrar',
  'pagar.ver', 'pagar.editar', 'relatorios.ver', 'auditoria.ver',
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
  'producao.ver', 'agenda.editar', 'estoque.ver', 'estoque.movimentar', 'estoque.consumir',
];

// Costureira: vê as peças atribuídas a ela, medidas e fotos; atualiza a produção. Sem valores.
const COSTUREIRA: Permissao[] = ['os.ver', 'medidas.ver', 'fotos.ver', 'fotos.enviar', 'producao.atualizar', 'agenda.ver',
  'producao.ver', 'estoque.ver', 'estoque.consumir'];

export function permissoesDo(papel: Papel): ReadonlySet<string> {
  if (papel === 'admin') return new Set(PERMISSOES);
  if (papel === 'atendente') return new Set(ATENDENTE);
  return new Set(COSTUREIRA);
}

/** Permissões que só o perfil Administrador tem (não podem ser dadas a outra pessoa: evitam escalada de acesso). */
export const SO_ADMIN: readonly Permissao[] = ['usuarios.gerenciar', 'config.editar', 'backup.gerenciar'];
export const AJUSTAVEIS = PERMISSOES.filter(p => !SO_ADMIN.includes(p));

/** Perfil + ajustes feitos pela administradora para a pessoa (concedida 1 dá, 0 tira). */
export function permissoesEfetivas(papel: Papel, ajustes: Array<{ permissao: string; concedida: number }>): ReadonlySet<string> {
  if (papel === 'admin') return new Set(PERMISSOES);
  const s = new Set(permissoesDo(papel));
  for (const a of ajustes) {
    if (!(AJUSTAVEIS as readonly string[]).includes(a.permissao)) continue;
    if (a.concedida) s.add(a.permissao); else s.delete(a.permissao);
  }
  return s;
}

/** Nomes das permissões para a tela de ajustes. */
export const ROTULOS: Record<Permissao, string> = {
  'clientes.ver': 'Ver clientes', 'clientes.editar': 'Cadastrar e editar clientes', 'clientes.exportar': 'Exportar dados da cliente (LGPD)',
  'clientes.anonimizar': 'Anonimizar cliente (LGPD)', 'medidas.ver': 'Ver medidas', 'medidas.editar': 'Registrar medidas',
  'os.ver': 'Ver ordens de serviço', 'os.editar': 'Abrir e editar OS', 'os.status': 'Mudar a situação da OS', 'os.cancelar': 'Cancelar OS',
  'os.alterar_preco': 'Alterar preço e dar desconto', 'os.financeiro.ver': 'Ver valores das OS',
  'producao.atualizar': 'Atualizar produção', 'producao.atribuir': 'Atribuir peças a profissionais', 'producao.ver': 'Ver quadro de produção',
  'fotos.ver': 'Ver fotos', 'fotos.enviar': 'Enviar fotos', 'fotos.excluir': 'Excluir fotos',
  'pagamentos.receber': 'Receber pagamentos', 'caixa.operar': 'Abrir e fechar caixa', 'caixa.reabrir': 'Reabrir caixa fechado',
  'financeiro.ver': 'Ver financeiro', 'financeiro.estornar': 'Estornar lançamentos', 'financeiro.lancar': 'Lançar entradas e saídas',
  'agenda.ver': 'Ver agenda', 'agenda.editar': 'Marcar compromissos', 'whatsapp.usar': 'Enviar mensagens pelo WhatsApp',
  'config.editar': 'Configurações do ateliê', 'usuarios.gerenciar': 'Gerenciar equipe', 'backup.gerenciar': 'Backups',
  'estoque.ver': 'Ver estoque', 'estoque.movimentar': 'Movimentar estoque', 'estoque.consumir': 'Lançar material usado na OS',
  'estoque.negativo': 'Autorizar estoque negativo', 'estoque.cadastrar': 'Cadastrar materiais',
  'pagar.ver': 'Ver contas a pagar', 'pagar.editar': 'Cadastrar e pagar contas', 'relatorios.ver': 'Ver relatórios', 'auditoria.ver': 'Ver auditoria',
};

export const PAPEIS: Record<Papel, string> = { admin: 'Administrador', atendente: 'Atendente', costureira: 'Costureira' };
