import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditoria } from '../lib/auditoria';
import { ErroApp, naoEncontrado } from '../lib/erros';
import { agora, exigir, hoje, lerCorpo, uuid, zData } from '../lib/util';
import { lerConfigAtelie } from './config';
import { diaDaSemana, horariosConflitam, somarDias, TIPOS_AGENDA } from '../../public/js/regras.js';

export const rotasAgenda = new Hono<AppEnv>();

type Prof = { id: string; nome: string; capacidade_min_dia: number; dias_trabalho: string };

/**
 * Capacidade e carga por dia, em minutos:
 *  - capacidade = soma da capacidade diária das profissionais que trabalham naquele dia da semana e não estão ausentes;
 *  - demanda    = tempo previsto dos serviços das peças não finalizadas cujo prazo (da peça ou da OS) cai naquele dia.
 * Provas são contadas à parte (capacidade de atendimento, não de produção).
 */
export async function cargaPorDia(db: D1Database, de: string, ate: string) {
  const [profs, ausencias, demanda, provas] = await Promise.all([
    db.prepare('SELECT id, nome, capacidade_min_dia, dias_trabalho FROM users WHERE ativo = 1 AND capacidade_min_dia > 0').all<Prof>(),
    db.prepare("SELECT dia, profissional_id FROM appointments WHERE tipo = 'ausencia' AND status = 'agendado' AND dia BETWEEN ? AND ?").bind(de, ate)
      .all<{ dia: string; profissional_id: string }>(),
    db.prepare(
      `SELECT COALESCE(i.prazo, o.prazo) AS dia, i.responsavel_id, SUM(s.tempo_min) AS minutos
       FROM order_item_services s JOIN order_items i ON i.id = s.item_id JOIN orders o ON o.id = i.order_id
       WHERE o.status NOT IN ('entregue','cancelada') AND i.status_producao <> 'finalizado'
         AND COALESCE(i.prazo, o.prazo) BETWEEN ? AND ? GROUP BY 1, 2`,
    ).bind(de, ate).all<{ dia: string; responsavel_id: string | null; minutos: number }>(),
    db.prepare("SELECT dia, COUNT(*) AS qtd FROM appointments WHERE tipo = 'prova' AND status = 'agendado' AND dia BETWEEN ? AND ? GROUP BY dia")
      .bind(de, ate).all<{ dia: string; qtd: number }>(),
  ]);
  const dias: Record<string, { capacidade_min: number; demanda_min: number; provas: number; ausentes: string[]; por_profissional: Record<string, { capacidade_min: number; demanda_min: number }> }> = {};
  for (let d = de; d <= ate; d = somarDias(d, 1)) {
    const sem = String(diaDaSemana(d));
    const ausentes = ausencias.results.filter(a => a.dia === d).map(a => a.profissional_id);
    const por: Record<string, { capacidade_min: number; demanda_min: number }> = {};
    let cap = 0;
    for (const p of profs.results) {
      const c = p.dias_trabalho.includes(sem) && !ausentes.includes(p.id) ? p.capacidade_min_dia : 0;
      por[p.id] = { capacidade_min: c, demanda_min: 0 };
      cap += c;
    }
    let dem = 0;
    for (const x of demanda.results.filter(x => x.dia === d)) {
      dem += x.minutos;
      if (x.responsavel_id && por[x.responsavel_id]) por[x.responsavel_id].demanda_min += x.minutos;
    }
    dias[d] = { capacidade_min: cap, demanda_min: dem, provas: provas.results.find(p => p.dia === d)?.qtd ?? 0, ausentes, por_profissional: por };
  }
  return { dias, profissionais: profs.results.map(p => ({ id: p.id, nome: p.nome, capacidade_min_dia: p.capacidade_min_dia, dias_trabalho: p.dias_trabalho })) };
}

rotasAgenda.get('/agenda', async c => {
  exigir(c, 'agenda.ver');
  const de = c.req.query('de') || hoje();
  const ate = c.req.query('ate') || somarDias(de, 41);
  if (!zData.safeParse(de).success || !zData.safeParse(ate).success || ate < de || somarDias(de, 92) < ate)
    throw new ErroApp(422, 'dados_invalidos', 'Período da agenda inválido.');
  const cfg = await lerConfigAtelie(c.env.DB);
  const u = c.get('usuario');
  const costureira = u.papel === 'costureira';
  const vis = costureira ? 'AND (o.responsavel_id = ? OR EXISTS (SELECT 1 FROM order_items vi WHERE vi.order_id = o.id AND vi.responsavel_id = ?))' : '';
  const [ordens, ocupacao, compromissos, carga] = await Promise.all([
    c.env.DB.prepare(
      `SELECT o.id, o.numero, o.prazo, o.status, c.nome AS cliente,
         (SELECT GROUP_CONCAT(peca, ', ') FROM (SELECT peca FROM order_items WHERE order_id = o.id ORDER BY posicao)) AS pecas,
         (SELECT COALESCE(SUM(s.tempo_min), 0) FROM order_item_services s JOIN order_items i ON i.id = s.item_id WHERE i.order_id = o.id) AS tempo_min
       FROM orders o JOIN clients c ON c.id = o.client_id
       WHERE o.prazo BETWEEN ? AND ? AND o.status <> 'cancelada' ${vis} ORDER BY o.prazo, o.numero`,
    ).bind(de, ate, ...(costureira ? [u.id, u.id] : [])).all(),
    c.env.DB.prepare("SELECT prazo, COUNT(*) AS qtd FROM orders WHERE prazo BETWEEN ? AND ? AND status <> 'cancelada' GROUP BY prazo").bind(de, ate).all(),
    c.env.DB.prepare(
      `SELECT a.id, a.tipo, a.titulo, a.dia, a.hora_inicio, a.hora_fim, a.status, a.observacoes, a.excecao, a.order_id, a.item_id, a.client_id,
         a.profissional_id, u.nome AS profissional, c.nome AS cliente, o.numero
       FROM appointments a LEFT JOIN users u ON u.id = a.profissional_id LEFT JOIN clients c ON c.id = a.client_id LEFT JOIN orders o ON o.id = a.order_id
       WHERE a.dia BETWEEN ? AND ? AND a.status <> 'cancelado' ${costureira ? 'AND (a.profissional_id = ? OR a.profissional_id IS NULL)' : ''}
       ORDER BY a.dia, COALESCE(a.hora_inicio, '00:00')`,
    ).bind(de, ate, ...(costureira ? [u.id] : [])).all(),
    cargaPorDia(c.env.DB, de, ate),
  ]);
  return c.json({
    de, ate, hoje: hoje(), capacidade: cfg.capacidade_diaria, limite_quase_cheio: cfg.limite_quase_cheio,
    capacidade_provas_dia: cfg.capacidade_provas_dia, horario_inicio: cfg.horario_inicio, horario_fim: cfg.horario_fim,
    ordens: ordens.results, ocupacao: ocupacao.results, compromissos: compromissos.results, carga: carga.dias, profissionais: carga.profissionais,
  });
});

const zHora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido (use HH:MM).');
const zCompromisso = z.object({
  tipo: z.enum(Object.keys(TIPOS_AGENDA) as [string, ...string[]], { error: 'Tipo de compromisso inválido.' }),
  titulo: z.string().trim().max(160).optional(),
  dia: zData,
  hora_inicio: zHora.optional().nullable().or(z.literal('').transform(() => null)),
  hora_fim: zHora.optional().nullable().or(z.literal('').transform(() => null)),
  order_id: z.string().max(64).optional().nullable(),
  item_id: z.string().max(64).optional().nullable(),
  client_id: z.string().max(64).optional().nullable(),
  profissional_id: z.string().max(64).optional().nullable(),
  observacoes: z.string().trim().max(1000).default(''),
  excecao: z.string().trim().max(300).optional().nullable(),
}).refine(x => !x.hora_fim || !x.hora_inicio || x.hora_fim > x.hora_inicio, { message: 'O horário final deve ser depois do inicial.', path: ['hora_fim'] })
  .refine(x => x.tipo !== 'ausencia' || !!x.profissional_id, { message: 'Escolha a profissional ausente.', path: ['profissional_id'] });

type Compromisso = z.infer<typeof zCompromisso>;

/** Conflitos: mesma profissional no mesmo horário, ausência da profissional, provas acima da capacidade do dia. */
async function conflitos(c: Context<AppEnv>, d: Compromisso, ignorarId: string | null) {
  const db = c.env.DB;
  const cfg = await lerConfigAtelie(db);
  const { results: doDia } = await db.prepare(
    `SELECT a.id, a.tipo, a.titulo, a.hora_inicio, a.hora_fim, a.profissional_id, u.nome AS profissional FROM appointments a
     LEFT JOIN users u ON u.id = a.profissional_id WHERE a.dia = ? AND a.status = 'agendado' AND a.id IS NOT ?`,
  ).bind(d.dia, ignorarId).all<{ id: string; tipo: string; titulo: string; hora_inicio: string | null; hora_fim: string | null; profissional_id: string | null; profissional: string | null }>();
  const avisos: string[] = [];
  if (d.profissional_id) {
    for (const a of doDia) {
      if (a.profissional_id !== d.profissional_id) continue;
      if (a.tipo === 'ausencia' && d.tipo !== 'ausencia') avisos.push(`${a.profissional} está ausente neste dia.`);
      else if (d.tipo === 'ausencia' && a.tipo !== 'ausencia') avisos.push(`${a.profissional} já tem "${a.titulo}" neste dia.`);
      else if (a.tipo !== 'ausencia' && horariosConflitam(a, d)) avisos.push(`${a.profissional} já tem "${a.titulo}" ${a.hora_inicio ? 'às ' + a.hora_inicio : 'neste dia'}.`);
    }
  }
  if (d.tipo === 'prova') {
    const provas = doDia.filter(a => a.tipo === 'prova');
    if (provas.length >= cfg.capacidade_provas_dia) avisos.push(`O dia já tem ${provas.length} provas (limite ${cfg.capacidade_provas_dia}).`);
    if (d.hora_inicio && provas.some(a => horariosConflitam(a, d))) avisos.push(`Já existe outra prova às ${d.hora_inicio}.`);
    if (d.hora_inicio && (d.hora_inicio < cfg.horario_inicio || d.hora_inicio >= cfg.horario_fim))
      avisos.push(`Fora do horário de funcionamento (${cfg.horario_inicio}–${cfg.horario_fim}).`);
  }
  if (d.dia < hoje()) avisos.push('A data já passou.');
  return [...new Set(avisos)];
}

async function prepararCompromisso(c: Context<AppEnv>, d: Compromisso) {
  const db = c.env.DB;
  if (d.order_id) {
    const os = await db.prepare('SELECT client_id, numero FROM orders WHERE id = ?').bind(d.order_id).first<{ client_id: string; numero: number }>();
    if (!os) throw new ErroApp(422, 'os_invalida', 'OS não encontrada.');
    d.client_id = os.client_id;
    if (d.item_id) {
      const it = await db.prepare('SELECT 1 FROM order_items WHERE id = ? AND order_id = ?').bind(d.item_id, d.order_id).first();
      if (!it) throw new ErroApp(422, 'peca_invalida', 'A peça não pertence a esta OS.');
    }
    d.titulo ||= `${TIPOS_AGENDA[d.tipo as keyof typeof TIPOS_AGENDA]} · OS nº ${String(os.numero).padStart(4, '0')}`;
  } else if (d.item_id) throw new ErroApp(422, 'dados_invalidos', 'Informe a OS da peça.');
  if (d.client_id) {
    const cl = await db.prepare('SELECT nome FROM clients WHERE id = ?').bind(d.client_id).first<{ nome: string }>();
    if (!cl) throw new ErroApp(422, 'cliente_invalida', 'Cliente não encontrada.');
    d.titulo ||= `${TIPOS_AGENDA[d.tipo as keyof typeof TIPOS_AGENDA]} · ${cl.nome}`;
  }
  if (d.profissional_id) {
    const p = await db.prepare('SELECT nome FROM users WHERE id = ? AND ativo = 1').bind(d.profissional_id).first<{ nome: string }>();
    if (!p) throw new ErroApp(422, 'responsavel_invalido', 'Profissional inválida ou inativa.');
    if (d.tipo === 'ausencia') d.titulo ||= `Ausência · ${p.nome}`;
  }
  d.titulo ||= TIPOS_AGENDA[d.tipo as keyof typeof TIPOS_AGENDA];
  const avisos = await conflitos(c, d, null);
  if (avisos.length) {
    // Só o administrador encaixa um compromisso com conflito, e precisa justificar.
    if (!d.excecao) throw new ErroApp(409, 'conflito_agenda', 'Há conflitos neste horário.', { conflitos: avisos, pode_excecao: c.get('usuario').papel === 'admin' });
    if (c.get('usuario').papel !== 'admin') throw new ErroApp(403, 'excecao_restrita', 'Somente o administrador pode encaixar um compromisso com conflito.');
  }
  return avisos;
}

rotasAgenda.post('/agenda/compromissos', async c => {
  exigir(c, 'agenda.editar');
  const d = await lerCorpo(c, zCompromisso);
  const avisos = await prepararCompromisso(c, d);
  const id = uuid();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO appointments (id, tipo, titulo, dia, hora_inicio, hora_fim, client_id, order_id, item_id, profissional_id, observacoes,
        excecao, criado_em, criado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, d.tipo, d.titulo, d.dia, d.hora_inicio ?? null, d.hora_fim ?? null, d.client_id ?? null, d.order_id ?? null, d.item_id ?? null,
        d.profissional_id ?? null, d.observacoes, avisos.length ? `${d.excecao} — conflitos: ${avisos.join(' ')}` : null, agora(), c.get('usuario').id),
    auditoria(c, 'agendar', 'appointments', id, { tipo: d.tipo, dia: d.dia, excecao: d.excecao }),
  ]);
  return c.json({ id }, 201);
});

rotasAgenda.put('/agenda/compromissos/:id', async c => {
  exigir(c, 'agenda.editar');
  const id = c.req.param('id');
  const d = await lerCorpo(c, zCompromisso);
  const atual = await c.env.DB.prepare('SELECT status FROM appointments WHERE id = ?').bind(id).first();
  if (!atual) throw naoEncontrado('Compromisso');
  const avisos = await (async () => {
    const av = await conflitos(c, d, id);
    if (av.length && !d.excecao) throw new ErroApp(409, 'conflito_agenda', 'Há conflitos neste horário.', { conflitos: av, pode_excecao: c.get('usuario').papel === 'admin' });
    if (av.length && c.get('usuario').papel !== 'admin') throw new ErroApp(403, 'excecao_restrita', 'Somente o administrador pode encaixar um compromisso com conflito.');
    return av;
  })();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE appointments SET dia = ?, hora_inicio = ?, hora_fim = ?, profissional_id = ?, observacoes = ?, titulo = COALESCE(?, titulo),
        excecao = ?, atualizado_em = ? WHERE id = ?`)
      .bind(d.dia, d.hora_inicio ?? null, d.hora_fim ?? null, d.profissional_id ?? null, d.observacoes, d.titulo || null,
        avisos.length ? `${d.excecao} — conflitos: ${avisos.join(' ')}` : null, agora(), id),
    auditoria(c, 'reagendar', 'appointments', id, { dia: d.dia, hora: d.hora_inicio }),
  ]);
  return c.json({ ok: true });
});

rotasAgenda.patch('/agenda/compromissos/:id', async c => {
  exigir(c, 'agenda.editar');
  const id = c.req.param('id');
  const { status } = await lerCorpo(c, z.object({ status: z.enum(['agendado', 'realizado', 'cancelado', 'faltou']) }));
  const [r] = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE appointments SET status = ?, atualizado_em = ? WHERE id = ?').bind(status, agora(), id),
    auditoria(c, 'status_compromisso', 'appointments', id, { status }),
  ]);
  if (!r.meta.changes) throw naoEncontrado('Compromisso');
  return c.json({ ok: true });
});
