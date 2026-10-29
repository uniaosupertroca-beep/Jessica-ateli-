import { beforeAll, describe, expect, it } from 'vitest';
import { abrirCaixa, admin, chamar, chave, cliente, criarOS, db, hojeSP, usuario } from './ajuda';

let adm: string;
beforeAll(async () => {
  adm = await admin();
  await abrirCaixa(adm);
});

const somar = (iso: string, n: number) => {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};

async function osAprovada(cid: string, pecas = 1, extra: Record<string, unknown> = {}) {
  const os = await criarOS(adm, cid, Array.from({ length: pecas }, (_, i) => ({ peca: `Peça ${i + 1}`, servicos: [{ descricao: 'Ajuste', valor: 5000 }] })), extra);
  const d = (await chamar(`/ordens/${os.id}/status`, { cookie: adm, corpo: { para: 'aprovada' } })).dados;
  return { ...os, itens: d.itens as Array<{ id: string; codigo: string }> };
}

describe('Produção (Kanban, tempos, retrabalho)', () => {
  it('registra início, fim, retrabalho e mostra no quadro', async () => {
    const cid = await cliente(adm);
    const os = await osAprovada(cid);
    const it = os.itens[0];
    const patch = (corpo: Record<string, unknown>) => chamar(`/ordens/${os.id}/itens/${it.id}?resposta=curta`, { cookie: adm, metodo: 'PATCH', corpo });
    expect((await patch({ status_producao: 'em_execucao', urgente: true })).dados.status_os).toBe('em_producao');
    let item: any = await db().prepare('SELECT iniciado_em, urgente FROM order_items WHERE id = ?').bind(it.id).first();
    expect(item!.iniciado_em).toBeTruthy();
    expect(item!.urgente).toBe(1);
    expect((await patch({ status_producao: 'finalizado' })).dados.status_os).toBe('pronta');
    await patch({ status_producao: 'ajustes_finais', tempo_manual_min: 25, obs_interna: 'refazer bainha' });
    item = await db().prepare('SELECT * FROM order_items WHERE id = ?').bind(it.id).first();
    expect(item.retrabalhos).toBe(1);
    expect(item.tempo_real_min).toBe(25);
    expect(item.obs_interna).toBe('refazer bainha');
    const ev = (await chamar(`/producao/${it.id}/eventos`, { cookie: adm })).dados.eventos.map((e: any) => e.tipo);
    expect(ev).toEqual(expect.arrayContaining(['inicio', 'fim', 'retrabalho', 'tempo', 'observacao', 'urgencia']));
    const quadro = (await chamar('/producao?urgentes=1', { cookie: adm })).dados;
    expect(quadro.pecas.some((p: any) => p.id === it.id && p.status_producao === 'ajustes_finais')).toBe(true);
    // mudança com a etapa desatualizada é recusada (evita somar tempo duas vezes)
    await patch({ status_producao: 'em_execucao' });
    const r = await Promise.all([patch({ status_producao: 'finalizado' }), patch({ status_producao: 'finalizado' })]);
    expect(r.every(x => x.status === 200 || x.status === 409)).toBe(true);
    // o tempo do período foi somado uma vez só
    const fins = await db().prepare("SELECT COUNT(*) AS n FROM production_events WHERE item_id = ? AND tipo = 'fim'").bind(it.id).first<{ n: number }>();
    expect(fins!.n).toBe(2);
  });

  it('costureira vê as peças dela e as livres, e pode assumir uma livre', async () => {
    const cos = await usuario(adm, 'costureira');
    const outra = await usuario(adm, 'costureira');
    const cid = await cliente(adm);
    const os = await osAprovada(cid, 2);
    await chamar(`/ordens/${os.id}/itens/${os.itens[0].id}`, { cookie: adm, metodo: 'PATCH', corpo: { responsavel_id: outra.id } });
    const q = (await chamar('/producao', { cookie: cos.cookie })).dados.pecas.filter((p: any) => p.order_id === os.id);
    expect(q.map((p: any) => p.id)).toEqual([os.itens[1].id]);
    const a = await chamar(`/ordens/${os.id}/itens/${os.itens[1].id}?resposta=curta`, { cookie: cos.cookie, metodo: 'PATCH', corpo: { assumir: true } });
    expect(a.status).toBe(200);
    const b = await chamar(`/ordens/${os.id}/itens/${os.itens[0].id}?resposta=curta`, { cookie: cos.cookie, metodo: 'PATCH', corpo: { assumir: true } });
    expect(b.status).toBe(409);
    expect((await chamar(`/ordens/${os.id}/itens/${os.itens[1].id}`, { cookie: cos.cookie, metodo: 'PATCH', corpo: { urgente: true } })).status).toBe(403);
  });
});

describe('busca da OS pelo nome da cliente e da peça', () => {
  it('acha por cliente, por peça (com ou sem acento) e pelas duas palavras juntas', async () => {
    const cid = await cliente(adm, 'Débora Quintanilha');
    const os = await criarOS(adm, cid, [{ peca: 'Calça de linho', servicos: [{ descricao: 'Barra', valor: 1000 }] }, { peca: 'Vestido longo', servicos: [{ descricao: 'Ajuste', valor: 1000 }] }]);
    const outra = await criarOS(adm, await cliente(adm, 'Débora Ramos'), [{ peca: 'Saia', servicos: [{ descricao: 'Barra', valor: 1000 }] }]);
    const ids = async (q: string) => (await chamar('/ordens?status=todas&q=' + encodeURIComponent(q), { cookie: adm })).dados.ordens.map((o: any) => o.id);
    expect(await ids('quintanilha')).toEqual([os.id]);
    expect(await ids('debora')).toEqual(expect.arrayContaining([os.id, outra.id]));
    expect(await ids('calça de linho')).toContain(os.id);
    expect(await ids('calca')).toContain(os.id);
    expect(await ids('débora vestido')).toEqual([os.id]);
    expect(await ids('débora saia')).toEqual([outra.id]);
    expect(await ids(String(os.numero))).toContain(os.id);
    // a rota antiga do QR Code não existe mais
    expect((await chamar('/pecas/1-1', { cookie: adm })).status).toBe(404);
  });
});

describe('Teste 8 — agenda com provas, conflitos e capacidade por horas', () => {
  it('detecta conflito de horário e só o administrador encaixa com justificativa', async () => {
    const at = await usuario(adm, 'atendente');
    const cos = await usuario(adm, 'costureira');
    const cid = await cliente(adm);
    const os = await osAprovada(cid);
    const dia = somar(hojeSP(), 5);
    const prova = { tipo: 'prova', dia, hora_inicio: '14:00', hora_fim: '14:30', order_id: os.id, profissional_id: cos.id };
    expect((await chamar('/agenda/compromissos', { cookie: at.cookie, corpo: prova })).status).toBe(201);
    const conf = await chamar('/agenda/compromissos', { cookie: at.cookie, corpo: { ...prova, hora_inicio: '14:15', hora_fim: '14:45' } });
    expect(conf.status).toBe(409);
    expect(conf.dados.codigo).toBe('conflito_agenda');
    expect(conf.dados.conflitos.join(' ')).toMatch(/14:00/);
    expect((await chamar('/agenda/compromissos', { cookie: at.cookie, corpo: { ...prova, hora_inicio: '14:15', excecao: 'cliente só pode nesse horário' } })).status).toBe(403);
    expect((await chamar('/agenda/compromissos', { cookie: adm, corpo: { ...prova, hora_inicio: '14:15', hora_fim: '14:45', excecao: 'cliente só pode nesse horário' } })).status).toBe(201);
    // ausência: conflita com compromissos dela
    expect((await chamar('/agenda/compromissos', { cookie: at.cookie, corpo: { tipo: 'ausencia', dia, profissional_id: cos.id } })).status).toBe(409);
    const ag = (await chamar(`/agenda?de=${dia}&ate=${dia}`, { cookie: adm })).dados;
    expect(ag.compromissos.filter((x: any) => x.tipo === 'prova')).toHaveLength(2);
    expect(ag.carga[dia].provas).toBe(2);
    const det = (await chamar(`/ordens/${os.id}`, { cookie: adm })).dados;
    expect(det.compromissos).toHaveLength(2);
  });

  it('avisa quando a OS passa da capacidade em horas do dia', async () => {
    const cos = await usuario(adm, 'costureira');
    await db().prepare('UPDATE users SET capacidade_min_dia = 0').run();
    await db().prepare("UPDATE users SET capacidade_min_dia = 120, dias_trabalho = '0123456' WHERE id = ?").bind(cos.id).run();
    const cid = await cliente(adm);
    const dia = somar(hojeSP(), 20);
    const corpo = (min: number, extra = {}) => ({ client_id: cid, prazo: dia, ...extra,
      itens: [{ peca: 'Vestido', servicos: [{ descricao: 'Ajuste complexo', quantidade: 1, valor_unitario_centavos: 1000, tempo_min: min }] }] });
    expect((await chamar('/ordens', { cookie: adm, chave: chave(), corpo: corpo(90) })).status).toBe(201);
    const r = await chamar('/ordens', { cookie: adm, chave: chave(), corpo: corpo(60) });
    expect(r.status).toBe(409);
    expect(r.dados.codigo).toBe('dia_lotado');
    expect(r.dados.mensagem).toMatch(/capacidade de 2 h/);
    expect((await chamar('/ordens', { cookie: adm, chave: chave(), corpo: corpo(60, { confirmar_lotado: true }) })).status).toBe(201);
    // ausência zera a capacidade dela no dia
    await chamar('/agenda/compromissos', { cookie: adm, corpo: { tipo: 'ausencia', dia: somar(dia, 1), profissional_id: cos.id } });
    const ag = (await chamar(`/agenda?de=${dia}&ate=${somar(dia, 1)}`, { cookie: adm })).dados;
    expect(ag.carga[dia]).toMatchObject({ capacidade_min: 120, demanda_min: 150 });
    expect(ag.carga[somar(dia, 1)].capacidade_min).toBe(0);
    await db().prepare('UPDATE users SET capacidade_min_dia = 0').run();
  });
});

describe('Teste 9 — estoque', () => {
  async function material(nome = 'Tecido ' + chave(), unidade = 'm') {
    const r = await chamar('/estoque/materiais', { cookie: adm, corpo: { codigo: chave().slice(0, 20), nome, categoria: 'tecido', unidade, estoque_minimo: 2 } });
    expect(r.status).toBe(201);
    return r.dados.id as string;
  }
  const saldo = async (id: string) => (await db().prepare('SELECT quantidade, custo_medio_centavos FROM materials WHERE id = ?').bind(id).first<any>())!;

  it('compra 10 m, consome 1,5 m e fica com 8,5 m; não fica negativo; reversão devolve', async () => {
    const mid = await material();
    expect((await chamar('/estoque/movimentos', { cookie: adm, chave: chave(), corpo: { material_id: mid, tipo: 'compra', quantidade: 10, custo_unitario_centavos: 2000 } })).status).toBe(201);
    const cid = await cliente(adm);
    const os = await osAprovada(cid);
    const k = chave();
    const consumo = { order_id: os.id, item_id: os.itens[0].id, material_id: mid, quantidade: 1.5 };
    expect((await chamar('/estoque/consumos', { cookie: adm, chave: k, corpo: consumo })).status).toBe(201);
    expect((await chamar('/estoque/consumos', { cookie: adm, chave: k, corpo: consumo })).dados.repetido).toBe(true);
    expect((await saldo(mid)).quantidade).toBe(8.5);
    const muito = await chamar('/estoque/consumos', { cookie: adm, chave: chave(), corpo: { ...consumo, quantidade: 9 } });
    expect(muito.status).toBe(422);
    expect(muito.dados.codigo).toBe('estoque_insuficiente');
    const det = (await chamar(`/ordens/${os.id}`, { cookie: adm })).dados;
    expect(det.materiais).toHaveLength(1);
    expect(det.materiais[0].custo_unitario_centavos).toBe(2000);
    const mov = det.materiais[0].id;
    expect((await chamar(`/estoque/movimentos/${mov}/reverter`, { cookie: adm, chave: chave(), corpo: { motivo: 'lançado errado' } })).status).toBe(201);
    expect((await saldo(mid)).quantidade).toBe(10);
    expect((await chamar(`/estoque/movimentos/${mov}/reverter`, { cookie: adm, chave: chave(), corpo: { motivo: 'de novo' } })).status).toBe(409);
    // o saldo só muda por movimentação
    await expect(db().prepare('UPDATE materials SET quantidade = 99 WHERE id = ?').bind(mid).run()).rejects.toThrow(/saldo_protegido/);
    await expect(db().prepare('DELETE FROM stock_movements WHERE id = ?').bind(mov).run()).rejects.toThrow(/movimento_imutavel/);
  });

  it('custo médio ponderado, perda, ajuste de inventário e negativo só com autorização', async () => {
    const mid = await material('Botão ' + chave(), 'un');
    await chamar('/estoque/movimentos', { cookie: adm, chave: chave(), corpo: { material_id: mid, tipo: 'compra', quantidade: 10, custo_unitario_centavos: 2000 } });
    await chamar('/estoque/movimentos', { cookie: adm, chave: chave(), corpo: { material_id: mid, tipo: 'compra', quantidade: 10, custo_unitario_centavos: 3000 } });
    expect(await saldo(mid)).toMatchObject({ quantidade: 20, custo_medio_centavos: 2500 });
    expect((await chamar('/estoque/movimentos', { cookie: adm, chave: chave(), corpo: { material_id: mid, tipo: 'perda', quantidade: 2 } })).status).toBe(422); // sem motivo
    await chamar('/estoque/movimentos', { cookie: adm, chave: chave(), corpo: { material_id: mid, tipo: 'perda', quantidade: 2, motivo: 'quebrou' } });
    await chamar('/estoque/movimentos', { cookie: adm, chave: chave(), corpo: { material_id: mid, tipo: 'ajuste', contado: 15, motivo: 'inventário' } });
    expect((await saldo(mid)).quantidade).toBe(15);
    const at = await usuario(adm, 'atendente');
    expect((await chamar('/estoque/movimentos', { cookie: at.cookie, chave: chave(), corpo: { material_id: mid, tipo: 'perda', quantidade: 20, motivo: 'x', autorizar_negativo: true } })).status).toBe(403);
    expect((await chamar('/estoque/movimentos', { cookie: adm, chave: chave(), corpo: { material_id: mid, tipo: 'perda', quantidade: 20, motivo: 'x', autorizar_negativo: true } })).status).toBe(201);
    expect((await saldo(mid)).quantidade).toBe(-5);
  });

  it('consumos simultâneos não deixam o saldo negativo', async () => {
    const mid = await material();
    await chamar('/estoque/movimentos', { cookie: adm, chave: chave(), corpo: { material_id: mid, tipo: 'compra', quantidade: 10, custo_unitario_centavos: 100 } });
    const cid = await cliente(adm);
    const os = await osAprovada(cid);
    const rs = await Promise.all([1, 2, 3].map(() => chamar('/estoque/consumos', { cookie: adm, chave: chave(), corpo: { order_id: os.id, material_id: mid, quantidade: 4 } })));
    expect(rs.filter(r => r.status === 201)).toHaveLength(2);
    expect((await saldo(mid)).quantidade).toBe(2);
    const baixo = (await chamar('/estoque/materiais?baixo=1', { cookie: adm })).dados.materiais;
    expect(baixo.some((m: any) => m.id === mid)).toBe(true);
  });

  it('costureira lança consumo só nas OS dela e não vê custo', async () => {
    const cos = await usuario(adm, 'costureira');
    const mid = await material();
    await chamar('/estoque/movimentos', { cookie: adm, chave: chave(), corpo: { material_id: mid, tipo: 'compra', quantidade: 5, custo_unitario_centavos: 100 } });
    const cid = await cliente(adm);
    const os = await osAprovada(cid);
    expect((await chamar('/estoque/consumos', { cookie: cos.cookie, chave: chave(), corpo: { order_id: os.id, material_id: mid, quantidade: 1 } })).status).toBe(404);
    await chamar(`/ordens/${os.id}/itens/${os.itens[0].id}`, { cookie: adm, metodo: 'PATCH', corpo: { responsavel_id: cos.id } });
    expect((await chamar('/estoque/consumos', { cookie: cos.cookie, chave: chave(), corpo: { order_id: os.id, material_id: mid, quantidade: 1 } })).status).toBe(201);
    const lista = (await chamar('/estoque/materiais', { cookie: cos.cookie })).dados.materiais;
    expect(lista.find((m: any) => m.id === mid).custo_medio_centavos).toBeUndefined();
    expect((await chamar('/estoque/movimentos', { cookie: cos.cookie, chave: chave(), corpo: { material_id: mid, tipo: 'compra', quantidade: 1 } })).status).toBe(403);
  });
});

describe('contas a pagar', () => {
  it('compra gera conta; pagar vira saída no caixa; estorno reabre; não paga duas vezes', async () => {
    const mid = (await chamar('/estoque/materiais', { cookie: adm, corpo: { codigo: chave().slice(0, 20), nome: 'Linha', categoria: 'linha', unidade: 'un' } })).dados.id;
    const r = await chamar('/estoque/movimentos', { cookie: adm, chave: chave(), corpo: { material_id: mid, tipo: 'compra', quantidade: 4, custo_unitario_centavos: 750, pagamento: 'conta', vencimento: hojeSP(), documento: 'NF 123' } });
    expect(r.status).toBe(201);
    const contas = (await chamar('/pagar', { cookie: adm })).dados.contas;
    const conta = contas.find((x: any) => x.descricao.includes('NF 123'));
    expect(conta.valor_centavos).toBe(3000);
    const antes = (await chamar('/caixa', { cookie: adm })).dados.saidas;
    const k = chave();
    expect((await chamar(`/pagar/${conta.id}/pagar`, { cookie: adm, chave: k, corpo: { forma_id: 'pm-pix' } })).status).toBe(201);
    expect((await chamar(`/pagar/${conta.id}/pagar`, { cookie: adm, chave: k, corpo: { forma_id: 'pm-pix' } })).dados.repetido).toBe(true);
    expect((await chamar(`/pagar/${conta.id}/pagar`, { cookie: adm, chave: chave(), corpo: { forma_id: 'pm-pix' } })).status).toBe(409);
    expect((await chamar('/caixa', { cookie: adm })).dados.saidas).toBe(antes + 3000);
    const paga = (await chamar('/pagar?status=pagas', { cookie: adm })).dados.contas.find((x: any) => x.id === conta.id);
    expect(paga.status).toBe('paga');
    expect((await chamar(`/financeiro/lancamentos/${paga.movimento_id}/estorno`, { cookie: adm, chave: chave(), corpo: { motivo: 'pago errado' } })).status).toBe(201);
    expect((await chamar('/pagar', { cookie: adm })).dados.contas.find((x: any) => x.id === conta.id).status).toBe('aberta');
  });

  it('parcela em meses e só administradora acessa', async () => {
    const r = await chamar('/pagar', { cookie: adm, corpo: { descricao: 'Máquina reta', categoria_id: 'fc-manutencao', valor_centavos: 100000, vencimento: '2030-01-31', parcelas: 3 } });
    expect(r.status).toBe(201);
    const ps = await db().prepare('SELECT valor_centavos, vencimento FROM payables WHERE id IN (?,?,?) ORDER BY vencimento').bind(...r.dados.ids).all<any>();
    expect(ps.results.map(p => p.vencimento)).toEqual(['2030-01-31', '2030-02-28', '2030-03-31']);
    expect(ps.results.reduce((s, p) => s + p.valor_centavos, 0)).toBe(100000);
    const at = await usuario(adm, 'atendente');
    expect((await chamar('/pagar', { cookie: at.cookie })).status).toBe(403);
    expect((await chamar('/relatorios', { cookie: at.cookie })).status).toBe(403);
  });
});

describe('relatórios e painel usam os mesmos números', () => {
  it('faturamento, recebido, despesas e lucro estimado', async () => {
    await db().prepare("UPDATE system_settings SET custo_hora_centavos = 6000").run();
    const cid = await cliente(adm);
    const os = await criarOS(adm, cid, [{ peca: 'Calça', servicos: [{ descricao: 'Barra', valor: 10000 }] }]);
    await db().prepare("UPDATE order_item_services SET tempo_min = 30 WHERE item_id IN (SELECT id FROM order_items WHERE order_id = ?)").bind(os.id).run();
    await chamar(`/ordens/${os.id}/pagamentos`, { cookie: adm, chave: chave(), corpo: { valor_centavos: 10000, forma_id: 'pm-pix' } });
    const it = (await chamar(`/ordens/${os.id}/status`, { cookie: adm, corpo: { para: 'aprovada' } })).dados.itens[0];
    await chamar(`/ordens/${os.id}/itens/${it.id}`, { cookie: adm, metodo: 'PATCH', corpo: { status_producao: 'finalizado' } });
    const antes = (await chamar(`/relatorios?de=${hojeSP()}&ate=${hojeSP()}`, { cookie: adm })).dados.atual;
    await chamar(`/ordens/${os.id}/status`, { cookie: adm, corpo: { para: 'entregue' } });
    const rel = (await chamar(`/relatorios?de=${hojeSP()}&ate=${hojeSP()}`, { cookie: adm })).dados;
    expect(rel.atual.faturamento - antes.faturamento).toBe(10000);
    expect(rel.atual.os_entregues - antes.os_entregues).toBe(1);
    expect(rel.atual.mao_obra_estimada - antes.mao_obra_estimada).toBe(3000);
    const ini = (await chamar('/inicio', { cookie: adm })).dados.financeiro;
    expect(ini.recebido_mes).toBeGreaterThanOrEqual(rel.atual.recebido);
    expect(rel.servicos.find((s: any) => s.servico === 'Barra')).toBeTruthy();
    expect(rel.mensal.length).toBeGreaterThan(0);
    await db().prepare("UPDATE system_settings SET custo_hora_centavos = 0").run();
  });
});

describe('pesquisa geral e auditoria', () => {
  it('acha cliente, OS e peça; auditoria só para administradora', async () => {
    const cid = await cliente(adm, 'Zuleica Pesquisável');
    const os = await osAprovada(cid);
    const b = (await chamar('/busca?q=zuleica', { cookie: adm })).dados;
    expect(b.clientes[0].nome).toBe('Zuleica Pesquisável');
    expect(b.ordens.some((o: any) => o.id === os.id)).toBe(true);
    expect((await chamar(`/busca?q=${os.itens[0].codigo}`, { cookie: adm })).dados.pecas[0].codigo).toBe(os.itens[0].codigo);
    expect((await chamar('/auditoria?entidade=orders', { cookie: adm })).dados.registros.length).toBeGreaterThan(0);
    const at = await usuario(adm, 'atendente');
    expect((await chamar('/auditoria', { cookie: at.cookie })).status).toBe(403);
  });
});

describe('documentos personalizados e logo', () => {
  const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);
  it('guarda o logo no sistema, só mostra para quem está logado e troca sem deixar arquivo velho', async () => {
    const fd = new FormData();
    fd.append('arquivo', new File([png()], 'logo.png', { type: 'image/png' }));
    expect((await chamar('/config/logo', { cookie: adm, form: fd })).status).toBe(201);
    const cfg = (await chamar('/config', { cookie: adm })).dados.atelie;
    expect(cfg.logo_versao).toBeTruthy();
    expect(cfg.logo_key).toBeUndefined(); // a chave interna não sai do servidor
    const img = await chamar('/config/logo', { cookie: adm });
    expect(img.status).toBe(200);
    expect(img.r.headers.get('Content-Type')).toBe('image/png');
    expect(img.r.headers.get('Cache-Control')).toContain('private');
    expect((await chamar('/config/logo')).status).toBe(401);
    const svg = new FormData();
    svg.append('arquivo', new File(['<svg onload="alert(1)"/>'], 'x.svg', { type: 'image/svg+xml' }));
    expect((await chamar('/config/logo', { cookie: adm, form: svg })).status).toBe(415);
    const fd2 = new FormData();
    fd2.append('arquivo', new File([png()], 'logo2.png', { type: 'image/png' }));
    await chamar('/config/logo', { cookie: adm, form: fd2 });
    const { env } = await import('cloudflare:workers');
    const lista = await (env as unknown as { FOTOS: R2Bucket }).FOTOS.list({ prefix: 'marca/' });
    expect(lista.objects).toHaveLength(1);
    expect((await chamar('/config/logo', { cookie: adm, metodo: 'DELETE' })).status).toBe(200);
    expect((await chamar('/config/logo', { cookie: adm })).status).toBe(404);
  });

  it('salva cor e textos; recusa cor inválida; só administradora altera', async () => {
    const corpo = { doc_cor: '#1A5D8F', doc_cabecalho: '@ateliejessica', rodape_os: 'Termos', doc_termos_orcamento: 'Condições', doc_validade_orcamento_dias: 15,
      doc_texto_retirada: 'Retirei e conferi.', doc_assinatura: 'Jessica Lima', doc_logo_etiqueta: false, doc_mostrar_telefone_cliente: false };
    expect((await chamar('/config/documentos', { cookie: adm, metodo: 'PATCH', corpo })).status).toBe(200);
    const a = (await chamar('/config', { cookie: adm })).dados.atelie;
    expect(a).toMatchObject({ doc_cor: '#1A5D8F', doc_validade_orcamento_dias: 15, doc_assinatura: 'Jessica Lima', doc_logo_etiqueta: 0 });
    expect((await chamar('/config/documentos', { cookie: adm, metodo: 'PATCH', corpo: { ...corpo, doc_cor: 'red;background:url(x)' } })).status).toBe(422);
    const at = await usuario(adm, 'atendente');
    expect((await chamar('/config/documentos', { cookie: at.cookie, metodo: 'PATCH', corpo })).status).toBe(403);
    expect((await chamar('/config/logo', { cookie: at.cookie })).status).toBe(404); // vê o logo (se houver), não altera
  });
});
