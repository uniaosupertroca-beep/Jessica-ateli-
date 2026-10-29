import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditoria } from '../lib/auditoria';
import { ErroApp, naoEncontrado } from '../lib/erros';
import { agora, exigir, lerCorpo, pode, uuid, zCentavos } from '../lib/util';

export const rotasConfig = new Hono<AppEnv>();

export async function lerConfigAtelie(db: D1Database) {
  return (await db.prepare(`SELECT nome, telefone, endereco, documento, rodape_os, capacidade_diaria, limite_quase_cheio, custo_hora_centavos,
      despesas_indiretas_pct, margem_pct, capacidade_provas_dia, horario_inicio, horario_fim FROM system_settings WHERE id = 1`)
    .first<{ nome: string; telefone: string; endereco: string; documento: string; rodape_os: string; capacidade_diaria: number; limite_quase_cheio: number;
      custo_hora_centavos: number; despesas_indiretas_pct: number; margem_pct: number; capacidade_provas_dia: number; horario_inicio: string; horario_fim: string }>())!;
}

/** Tudo o que as telas precisam para montar formulários. */
rotasConfig.get('/', async c => {
  const db = c.env.DB;
  const verValores = pode(c, 'os.financeiro.ver');
  const [atelie, formas, catsFin, campos, catsServ, servicos, usuarios] = await Promise.all([
    lerConfigAtelie(db),
    db.prepare('SELECT id, nome, eh_dinheiro, eh_credito_cliente, ativo FROM payment_methods ORDER BY ordem, nome').all(),
    db.prepare('SELECT id, nome, tipo, sistema, ativo FROM finance_categories ORDER BY tipo, nome').all(),
    db.prepare('SELECT id, nome, unidade, ordem, ativo FROM measurement_fields ORDER BY ordem, nome').all(),
    db.prepare('SELECT id, nome, ordem, ativo FROM service_categories ORDER BY ordem, nome').all(),
    db.prepare(`SELECT id, categoria_id, nome, descricao, unidade, preco_centavos, tempo_min, custo_mao_obra_centavos, ativo
                FROM service_catalog ORDER BY nome`).all(),
    db.prepare("SELECT id, nome, papel, capacidade_min_dia FROM users WHERE ativo = 1 ORDER BY nome").all(),
  ]);
  const serv = verValores ? servicos.results : servicos.results.map(s => ({ ...s, preco_centavos: undefined, custo_mao_obra_centavos: undefined }));
  return c.json({
    atelie, formas_pagamento: formas.results, categorias_financeiras: catsFin.results, campos_medida: campos.results,
    categorias_servico: catsServ.results, servicos: serv, usuarios: usuarios.results,
  });
});

rotasConfig.patch('/atelie', async c => {
  exigir(c, 'config.editar');
  const d = await lerCorpo(c, z.object({
    nome: z.string().trim().min(2, 'Informe o nome do ateliê.').max(120),
    telefone: z.string().trim().max(40),
    endereco: z.string().trim().max(200),
    documento: z.string().trim().max(30),
    rodape_os: z.string().trim().max(1000),
    capacidade_diaria: z.number().int().min(1, 'Capacidade mínima de 1.').max(200),
    limite_quase_cheio: z.number().int().min(1).max(200),
    custo_hora_centavos: zCentavos.default(0),
    despesas_indiretas_pct: z.number().min(0).max(500).default(0),
    margem_pct: z.number().min(0).max(1000).default(0),
    capacidade_provas_dia: z.number().int().min(1).max(100).default(8),
    horario_inicio: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.').default('09:00'),
    horario_fim: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.').default('18:00'),
  }).refine(x => x.horario_fim > x.horario_inicio, { message: 'O horário de fechamento deve ser depois da abertura.', path: ['horario_fim'] }).refine(x => x.limite_quase_cheio <= x.capacidade_diaria, { message: '"Quase cheio" não pode ser maior que a capacidade.', path: ['limite_quase_cheio'] }));
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE system_settings SET nome=?, telefone=?, endereco=?, documento=?, rodape_os=?, capacidade_diaria=?,
        limite_quase_cheio=?, custo_hora_centavos=?, despesas_indiretas_pct=?, margem_pct=?, capacidade_provas_dia=?, horario_inicio=?, horario_fim=?,
        atualizado_em=? WHERE id = 1`)
      .bind(d.nome, d.telefone, d.endereco, d.documento, d.rodape_os, d.capacidade_diaria, d.limite_quase_cheio, d.custo_hora_centavos,
        d.despesas_indiretas_pct, d.margem_pct, d.capacidade_provas_dia, d.horario_inicio, d.horario_fim, agora()),
    auditoria(c, 'editar', 'system_settings', '1', d),
  ]);
  return c.json({ ok: true });
});

/* ---------- catálogo de serviços ---------- */
const zServico = z.object({
  categoria_id: z.string().min(1, 'Escolha a categoria.'),
  nome: z.string().trim().min(2, 'Informe o nome do serviço.').max(120),
  descricao: z.string().trim().max(500).default(''),
  unidade: z.enum(['un', 'm', 'cm', 'h']).default('un'),
  preco_centavos: zCentavos.default(0),
  tempo_min: z.number().int().min(0).max(100000).default(0),
  custo_mao_obra_centavos: zCentavos.default(0),
  ativo: z.boolean().default(true),
});

rotasConfig.post('/servicos', async c => {
  exigir(c, 'config.editar');
  const d = await lerCorpo(c, zServico);
  const id = uuid();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO service_catalog (id, categoria_id, nome, descricao, unidade, preco_centavos, tempo_min,
        custo_mao_obra_centavos, ativo, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, d.categoria_id, d.nome, d.descricao, d.unidade, d.preco_centavos, d.tempo_min, d.custo_mao_obra_centavos, d.ativo ? 1 : 0, agora()),
    auditoria(c, 'criar', 'service_catalog', id, d),
  ]);
  return c.json({ id }, 201);
});

rotasConfig.put('/servicos/:id', async c => {
  exigir(c, 'config.editar');
  const id = c.req.param('id');
  const d = await lerCorpo(c, zServico);
  const [r] = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE service_catalog SET categoria_id=?, nome=?, descricao=?, unidade=?, preco_centavos=?, tempo_min=?,
        custo_mao_obra_centavos=?, ativo=?, atualizado_em=? WHERE id = ?`)
      .bind(d.categoria_id, d.nome, d.descricao, d.unidade, d.preco_centavos, d.tempo_min, d.custo_mao_obra_centavos, d.ativo ? 1 : 0, agora(), id),
    auditoria(c, 'editar', 'service_catalog', id, d),
  ]);
  if (!r.meta.changes) throw naoEncontrado('Serviço');
  return c.json({ ok: true });
});

/* ---------- cadastros simples (nome + ativo) ---------- */
type Cadastro = { tabela: string; extra?: z.ZodRawShape; colunasExtra?: string[] };
const CADASTROS: Record<string, Cadastro> = {
  'categorias-servico': { tabela: 'service_categories' },
  'campos-medida': { tabela: 'measurement_fields' },
  'formas-pagamento': { tabela: 'payment_methods', extra: { eh_dinheiro: z.boolean().default(false) }, colunasExtra: ['eh_dinheiro'] },
  'categorias-financeiras': { tabela: 'finance_categories', extra: { tipo: z.enum(['entrada', 'saida']) }, colunasExtra: ['tipo'] },
};

for (const [rota, cad] of Object.entries(CADASTROS)) {
  rotasConfig.post(`/${rota}`, async c => {
    exigir(c, 'config.editar');
    const d = await lerCorpo(c, z.object({ nome: z.string().trim().min(2, 'Informe o nome.').max(80), ...(cad.extra ?? {}) }));
    const id = uuid();
    const cols = ['id', 'nome', ...(cad.colunasExtra ?? [])];
    const vals = [id, d.nome, ...(cad.colunasExtra ?? []).map(k => {
      const v = (d as Record<string, unknown>)[k];
      return typeof v === 'boolean' ? (v ? 1 : 0) : v;
    })];
    if (cad.tabela === 'measurement_fields' || cad.tabela === 'service_categories' || cad.tabela === 'payment_methods') {
      cols.push('ordem');
      vals.push(Date.now() % 1_000_000);
    }
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO ${cad.tabela} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(...vals),
      auditoria(c, 'criar', cad.tabela, id, d),
    ]);
    return c.json({ id }, 201);
  });

  rotasConfig.patch(`/${rota}/:id`, async c => {
    exigir(c, 'config.editar');
    const id = c.req.param('id');
    const d = await lerCorpo(c, z.object({ nome: z.string().trim().min(2).max(80).optional(), ativo: z.boolean().optional() }));
    if (cad.tabela === 'finance_categories' || cad.tabela === 'payment_methods') {
      const sis = await c.env.DB.prepare(
        cad.tabela === 'finance_categories' ? 'SELECT sistema AS s FROM finance_categories WHERE id = ?' : 'SELECT eh_credito_cliente AS s FROM payment_methods WHERE id = ?',
      ).bind(id).first<{ s: number }>();
      if (sis?.s) throw new ErroApp(409, 'item_do_sistema', 'Este item é usado pelo sistema e não pode ser alterado.');
    }
    const [r] = await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE ${cad.tabela} SET nome = COALESCE(?, nome), ativo = COALESCE(?, ativo) WHERE id = ?`)
        .bind(d.nome ?? null, d.ativo === undefined ? null : d.ativo ? 1 : 0, id),
      auditoria(c, 'editar', cad.tabela, id, d),
    ]);
    if (!r.meta.changes) throw naoEncontrado();
    return c.json({ ok: true });
  });
}
