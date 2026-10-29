import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditoria } from '../lib/auditoria';
import { ErroApp, naoEncontrado } from '../lib/erros';
import { agora, exigir, lerCorpo, pode, uuid, zCentavos } from '../lib/util';

export const rotasConfig = new Hono<AppEnv>();

export async function lerConfigAtelie(db: D1Database) {
  const r = (await db.prepare(`SELECT nome, telefone, endereco, documento, rodape_os, capacidade_diaria, limite_quase_cheio, custo_hora_centavos,
      despesas_indiretas_pct, margem_pct, capacidade_provas_dia, horario_inicio, horario_fim, logo_key, doc_cor, doc_cabecalho, doc_termos_orcamento,
      doc_validade_orcamento_dias, doc_texto_retirada, doc_assinatura, doc_logo_etiqueta, doc_mostrar_telefone_cliente FROM system_settings WHERE id = 1`)
    .first<{ nome: string; telefone: string; endereco: string; documento: string; rodape_os: string; capacidade_diaria: number; limite_quase_cheio: number;
      custo_hora_centavos: number; despesas_indiretas_pct: number; margem_pct: number; capacidade_provas_dia: number; horario_inicio: string; horario_fim: string;
      logo_key: string | null; doc_cor: string; doc_cabecalho: string; doc_termos_orcamento: string; doc_validade_orcamento_dias: number;
      doc_texto_retirada: string; doc_assinatura: string; doc_logo_etiqueta: number; doc_mostrar_telefone_cliente: number }>())!;
  // A chave interna do arquivo não sai do servidor; a tela recebe só uma "versão" para o cache da imagem.
  const { logo_key, ...resto } = r;
  return { ...resto, logo_versao: logo_key ? logo_key.split('/').pop()!.split('.')[0] : null };
}

export type DadosUnidade = { id: string; nome: string; sigla: string; endereco: string; telefone: string; documento: string; capacidade_diaria: number;
  limite_quase_cheio: number; capacidade_provas_dia: number; horario_inicio: string; horario_fim: string; ativo: number };

export async function lerUnidade(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM units WHERE id = ?').bind(id).first<DadosUnidade>();
}

/**
 * Capacidade usada na agenda: da unidade escolhida, ou a soma das unidades (visão "todas").
 */
export async function capacidadeAgenda(db: D1Database, ids: string[]) {
  const { results } = await db.prepare(`SELECT * FROM units WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<DadosUnidade>();
  if (results.length === 1) return results[0];
  return {
    capacidade_diaria: results.reduce((s, u) => s + u.capacidade_diaria, 0) || 1,
    limite_quase_cheio: results.reduce((s, u) => s + u.limite_quase_cheio, 0) || 1,
    capacidade_provas_dia: results.reduce((s, u) => s + u.capacidade_provas_dia, 0) || 1,
    horario_inicio: results.map(u => u.horario_inicio).sort()[0] ?? '09:00',
    horario_fim: results.map(u => u.horario_fim).sort().pop() ?? '18:00',
  };
}

/* ---------- unidades (filiais) ---------- */
const zUnidade = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da unidade.').max(80),
  sigla: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,5}$/, 'Sigla de 2 a 5 letras ou números (ex.: CEN).'),
  endereco: z.string().trim().max(200).default(''),
  telefone: z.string().trim().max(40).default(''),
  documento: z.string().trim().max(30).default(''),
  capacidade_diaria: z.number().int().min(1).max(200).default(6),
  limite_quase_cheio: z.number().int().min(1).max(200).default(5),
  capacidade_provas_dia: z.number().int().min(1).max(100).default(8),
  horario_inicio: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.').default('09:00'),
  horario_fim: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.').default('18:00'),
  ativo: z.boolean().default(true),
}).refine(x => x.limite_quase_cheio <= x.capacidade_diaria, { message: '"Quase cheio" não pode ser maior que a capacidade.', path: ['limite_quase_cheio'] })
  .refine(x => x.horario_fim > x.horario_inicio, { message: 'O horário de fechamento deve ser depois da abertura.', path: ['horario_fim'] });

function erroNomeUnidade(e: unknown): never {
  if (/UNIQUE constraint failed: units\.(nome|sigla)/.test(String(e))) throw new ErroApp(409, 'unidade_em_uso', 'Já existe unidade com este nome ou sigla.');
  throw e;
}

rotasConfig.post('/unidades', async c => {
  exigir(c, 'config.editar');
  const d = await lerCorpo(c, zUnidade);
  const id = uuid();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO units (id, nome, sigla, endereco, telefone, documento, capacidade_diaria, limite_quase_cheio, capacidade_provas_dia,
          horario_inicio, horario_fim, ativo, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id, d.nome, d.sigla, d.endereco, d.telefone, d.documento, d.capacidade_diaria, d.limite_quase_cheio, d.capacidade_provas_dia,
          d.horario_inicio, d.horario_fim, d.ativo ? 1 : 0, agora()),
      // Administradoras já enxergam todas; o vínculo deixa a lista de equipe coerente.
      c.env.DB.prepare("INSERT OR IGNORE INTO user_units (user_id, unit_id) SELECT id, ? FROM users WHERE papel = 'admin'").bind(id),
      auditoria(c, 'criar', 'units', id, d),
    ]);
  } catch (e) { erroNomeUnidade(e); }
  return c.json({ id }, 201);
});

rotasConfig.put('/unidades/:id', async c => {
  exigir(c, 'config.editar');
  const id = c.req.param('id');
  const d = await lerCorpo(c, zUnidade);
  if (!d.ativo) {
    const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM units WHERE ativo = 1 AND id <> ?').bind(id).first<{ n: number }>();
    if (!n?.n) throw new ErroApp(409, 'ultima_unidade', 'É preciso manter pelo menos uma unidade ativa.');
  }
  try {
    const [r] = await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE units SET nome=?, sigla=?, endereco=?, telefone=?, documento=?, capacidade_diaria=?, limite_quase_cheio=?, capacidade_provas_dia=?,
          horario_inicio=?, horario_fim=?, ativo=?, atualizado_em=? WHERE id = ?`)
        .bind(d.nome, d.sigla, d.endereco, d.telefone, d.documento, d.capacidade_diaria, d.limite_quase_cheio, d.capacidade_provas_dia,
          d.horario_inicio, d.horario_fim, d.ativo ? 1 : 0, agora(), id),
      auditoria(c, 'editar', 'units', id, d),
    ]);
    if (!r.meta.changes) throw naoEncontrado('Unidade');
  } catch (e) { erroNomeUnidade(e); }
  return c.json({ ok: true });
});

/* ---------- logo do ateliê (guardado no R2 privado; só quem está logado vê) ---------- */
const TIPOS_LOGO: Array<[(b: Uint8Array) => boolean, string, string]> = [
  [b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, 'image/png', 'png'],
  [b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, 'image/jpeg', 'jpg'],
  [b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45, 'image/webp', 'webp'],
];

rotasConfig.post('/logo', async c => {
  exigir(c, 'config.editar');
  const corpo = await c.req.parseBody();
  const arq = corpo['arquivo'];
  if (!(arq instanceof File)) throw new ErroApp(422, 'sem_arquivo', 'Escolha a imagem do logo.');
  if (arq.size > 2 * 1024 * 1024) throw new ErroApp(413, 'arquivo_grande', 'O logo passa de 2 MB.');
  const bytes = new Uint8Array(await arq.arrayBuffer());
  const tipo = TIPOS_LOGO.find(([t]) => t(bytes));
  if (!tipo) throw new ErroApp(415, 'formato_invalido', 'Envie o logo em PNG, JPG ou WebP.');
  const antigo = await c.env.DB.prepare('SELECT logo_key FROM system_settings WHERE id = 1').first<{ logo_key: string | null }>();
  const chave = `marca/logo-${uuid()}.${tipo[2]}`;
  await c.env.FOTOS.put(chave, bytes, { httpMetadata: { contentType: tipo[1] } });
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE system_settings SET logo_key = ?, logo_tipo = ?, atualizado_em = ? WHERE id = 1').bind(chave, tipo[1], agora()),
    auditoria(c, 'enviar_logo', 'system_settings', '1', { tamanho: bytes.length }),
  ]);
  if (antigo?.logo_key) await c.env.FOTOS.delete(antigo.logo_key);
  return c.json({ ok: true }, 201);
});

rotasConfig.delete('/logo', async c => {
  exigir(c, 'config.editar');
  const antigo = await c.env.DB.prepare('SELECT logo_key FROM system_settings WHERE id = 1').first<{ logo_key: string | null }>();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE system_settings SET logo_key = NULL, logo_tipo = NULL, atualizado_em = ? WHERE id = 1').bind(agora()),
    auditoria(c, 'remover_logo', 'system_settings', '1'),
  ]);
  if (antigo?.logo_key) await c.env.FOTOS.delete(antigo.logo_key);
  return c.json({ ok: true });
});

rotasConfig.get('/logo', async c => {
  const r = await c.env.DB.prepare('SELECT logo_key, logo_tipo FROM system_settings WHERE id = 1').first<{ logo_key: string | null; logo_tipo: string }>();
  const obj = r?.logo_key ? await c.env.FOTOS.get(r.logo_key) : null;
  if (!obj) throw naoEncontrado('Logo');
  return new Response(obj.body, {
    headers: { 'Content-Type': r!.logo_tipo, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" },
  });
});

/* ---------- textos e aparência dos documentos ---------- */
rotasConfig.patch('/documentos', async c => {
  exigir(c, 'config.editar');
  const d = await lerCorpo(c, z.object({
    doc_cor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida.'),
    doc_cabecalho: z.string().trim().max(300).default(''),
    rodape_os: z.string().trim().max(1500).default(''),
    doc_termos_orcamento: z.string().trim().max(1500).default(''),
    doc_validade_orcamento_dias: z.number().int().min(1, 'Validade mínima de 1 dia.').max(365),
    doc_texto_retirada: z.string().trim().max(800).default(''),
    doc_assinatura: z.string().trim().max(120).default(''),
    doc_logo_etiqueta: z.boolean().default(true),
    doc_mostrar_telefone_cliente: z.boolean().default(true),
  }));
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE system_settings SET doc_cor = ?, doc_cabecalho = ?, rodape_os = ?, doc_termos_orcamento = ?, doc_validade_orcamento_dias = ?,
        doc_texto_retirada = ?, doc_assinatura = ?, doc_logo_etiqueta = ?, doc_mostrar_telefone_cliente = ?, atualizado_em = ? WHERE id = 1`)
      .bind(d.doc_cor, d.doc_cabecalho, d.rodape_os, d.doc_termos_orcamento, d.doc_validade_orcamento_dias, d.doc_texto_retirada, d.doc_assinatura,
        d.doc_logo_etiqueta ? 1 : 0, d.doc_mostrar_telefone_cliente ? 1 : 0, agora()),
    auditoria(c, 'editar_documentos', 'system_settings', '1', d),
  ]);
  return c.json({ ok: true });
});

/** Tudo o que as telas precisam para montar formulários. */
rotasConfig.get('/', async c => {
  const db = c.env.DB;
  const verValores = pode(c, 'os.financeiro.ver');
  const [unidades, atelie, formas, catsFin, campos, catsServ, servicos, usuarios] = await Promise.all([
    pode(c, 'config.editar') ? db.prepare('SELECT * FROM units ORDER BY ativo DESC, nome').all() : db.prepare(
      `SELECT * FROM units WHERE id IN (${c.get('unidades').map(() => '?').join(',')}) ORDER BY nome`).bind(...c.get('unidades')).all(),
    lerConfigAtelie(db),
    db.prepare('SELECT id, nome, eh_dinheiro, eh_credito_cliente, ativo FROM payment_methods ORDER BY ordem, nome').all(),
    db.prepare('SELECT id, nome, tipo, sistema, ativo FROM finance_categories ORDER BY tipo, nome').all(),
    db.prepare('SELECT id, nome, unidade, ordem, ativo FROM measurement_fields ORDER BY ordem, nome').all(),
    db.prepare('SELECT id, nome, ordem, ativo FROM service_categories ORDER BY ordem, nome').all(),
    db.prepare(`SELECT id, categoria_id, nome, descricao, unidade, preco_centavos, tempo_min, custo_mao_obra_centavos, ativo
                FROM service_catalog ORDER BY nome`).all(),
    db.prepare(`SELECT id, nome, papel, capacidade_min_dia, (SELECT GROUP_CONCAT(unit_id) FROM user_units WHERE user_id = users.id) AS unidades
                FROM users WHERE ativo = 1 ORDER BY nome`).all<Record<string, unknown> & { unidades: string | null }>(),
  ]);
  const serv = verValores ? servicos.results : servicos.results.map(s => ({ ...s, preco_centavos: undefined, custo_mao_obra_centavos: undefined }));
  return c.json({
    unidades: unidades.results, atelie, formas_pagamento: formas.results, categorias_financeiras: catsFin.results, campos_medida: campos.results,
    categorias_servico: catsServ.results, servicos: serv,
    usuarios: usuarios.results.map(u => ({ ...u, unidades: u.unidades ? u.unidades.split(',') : [] })),
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
