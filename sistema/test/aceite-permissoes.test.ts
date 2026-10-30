import { beforeAll, describe, expect, it } from 'vitest';
import { abrirCaixa, admin, chamar, chave, cliente, criarOS, db, usuario } from './ajuda';

let adm: string;
beforeAll(async () => {
  adm = await admin();
  await abrirCaixa(adm);
});

const status = (cookie: string, id: string, corpo: Record<string, unknown>) => chamar(`/ordens/${id}/status`, { cookie, corpo });

describe('Permissões por pessoa', () => {
  it('administradora dá e tira permissões; as de administrador não podem ser dadas', async () => {
    const at = await usuario(adm, 'atendente');
    expect((await chamar('/relatorios', { cookie: at.cookie })).status).toBe(403);
    const perm = (await chamar(`/usuarios/${at.id}/permissoes`, { cookie: adm })).dados.permissoes as Array<{ id: string; ativa: boolean }>;
    const ativas = perm.filter(p => p.ativa).map(p => p.id);
    // dá Relatórios e tira Cancelar OS
    const novo = [...ativas.filter(p => p !== 'os.cancelar'), 'relatorios.ver'];
    expect((await chamar(`/usuarios/${at.id}/permissoes`, { cookie: adm, metodo: 'PUT', corpo: { permissoes: novo } })).dados.ajustes).toBe(2);
    expect((await chamar('/relatorios', { cookie: at.cookie })).status).toBe(200);
    const eu = (await chamar('/auth/eu', { cookie: at.cookie })).dados;
    expect(eu.permissoes).toContain('relatorios.ver');
    expect(eu.permissoes).not.toContain('os.cancelar');
    const os = await criarOS(adm, await cliente(adm), [{ peca: 'Saia', servicos: [{ descricao: 'Barra', valor: 3000 }] }]);
    expect((await status(at.cookie, os.id, { para: 'cancelada', motivo: 'teste' })).status).toBe(403);
    // não dá para conceder o que é só do administrador
    expect((await chamar(`/usuarios/${at.id}/permissoes`, { cookie: adm, metodo: 'PUT', corpo: { permissoes: [...novo, 'usuarios.gerenciar'] } })).status).toBe(422);
    // e a própria atendente não mexe em permissões
    expect((await chamar(`/usuarios/${at.id}/permissoes`, { cookie: at.cookie, metodo: 'PUT', corpo: { permissoes: [...novo, 'financeiro.estornar'] } })).status).toBe(403);
  });
});

describe('Aceite do orçamento e confirmação de entrega', () => {
  it('registra como a cliente aprovou, quem retirou e quem entregou', async () => {
    const cid = await cliente(adm, 'Cliente Aceite Teste');
    const os = await criarOS(adm, cid, [{ peca: 'Calça', servicos: [{ descricao: 'Barra', valor: 3000 }] }]);
    expect((await status(adm, os.id, { para: 'aguardando_aprovacao' })).status).toBe(200);
    const ap = (await status(adm, os.id, { para: 'aprovada', aprovacao_meio: 'whatsapp' })).dados;
    expect(ap.aprovacao_meio).toBe('whatsapp');
    expect(ap.aprovada_em).toBeTruthy();
    expect(ap.aprovada_por_nome).toBe('Jessica');
    const it = ap.itens[0];
    await chamar(`/ordens/${os.id}/itens/${it.id}`, { cookie: adm, metodo: 'PATCH', corpo: { status_producao: 'finalizado' } });
    await chamar(`/ordens/${os.id}/pagamentos`, { cookie: adm, chave: chave(), corpo: { valor_centavos: 3000, forma_id: 'pm-pix' } });
    const ent = (await status(adm, os.id, { para: 'entregue', retirado_por: 'Irmã da cliente' })).dados;
    expect(ent.status).toBe('entregue');
    expect(ent.retirado_por_nome).toBe('Irmã da cliente');
    expect(ent.entregue_por_nome).toBe('Jessica');
    // sem informar, quem retira é a própria cliente
    const os2 = await criarOS(adm, cid, [{ peca: 'Blusa', servicos: [{ descricao: 'Ajuste', valor: 1000 }] }]);
    const ap2 = (await status(adm, os2.id, { para: 'aprovada' })).dados;
    expect(ap2.aprovacao_meio).toBe('presencial');
    await chamar(`/ordens/${os2.id}/itens/${ap2.itens[0].id}`, { cookie: adm, metodo: 'PATCH', corpo: { status_producao: 'finalizado' } });
    const e2 = (await status(adm, os2.id, { para: 'entregue', confirmar_saldo_pendente: true })).dados;
    expect(e2.retirado_por_nome).toBe('Cliente Aceite Teste');
  });
});

describe('Cenário H — cancelamento', () => {
  it('cancela compromissos, devolve material, some da produção e não vira venda', async () => {
    const cid = await cliente(adm);
    const os = await criarOS(adm, cid, [{ peca: 'Vestido', servicos: [{ descricao: 'Ajuste', valor: 30000 }] }]);
    const ap = (await status(adm, os.id, { para: 'aprovada' })).dados;
    // material: compra de 10 m e consumo de 1,5 m nesta OS
    const m = (await chamar('/estoque/materiais', { cookie: adm, corpo: { codigo: `C${chave().slice(-6)}`, nome: 'Cetim', categoria: 'tecido', unidade: 'm' } })).dados;
    await chamar('/estoque/movimentos', { cookie: adm, chave: chave(), corpo: { material_id: m.id, tipo: 'compra', quantidade: 10, custo_unitario_centavos: 2000 } });
    expect((await chamar('/estoque/consumos', { cookie: adm, chave: chave(), corpo: { order_id: os.id, item_id: ap.itens[0].id, material_id: m.id, quantidade: 1.5 } })).status).toBe(201);
    // prova marcada
    const prova = await chamar('/agenda/compromissos', { cookie: adm, corpo: { tipo: 'prova', dia: '2030-03-10', hora_inicio: '10:00', hora_fim: '10:30', order_id: os.id, client_id: cid } });
    expect(prova.status).toBe(201);
    // com sinal pago, não cancela (precisa estornar antes)
    const pg = await chamar(`/ordens/${os.id}/pagamentos`, { cookie: adm, chave: chave(), corpo: { valor_centavos: 10000, forma_id: 'pm-dinheiro' } });
    expect(pg.status).toBe(201);
    expect((await status(adm, os.id, { para: 'cancelada', motivo: 'desistiu' })).dados.codigo).toBe('os_com_pagamento');
    const mov = await db().prepare('SELECT id FROM cash_movements WHERE order_id = ?').bind(os.id).first<{ id: string }>();
    expect((await chamar(`/financeiro/lancamentos/${mov!.id}/estorno`, { cookie: adm, chave: chave(), corpo: { motivo: 'cliente desistiu' } })).status).toBe(201);
    const c = await status(adm, os.id, { para: 'cancelada', motivo: 'Cliente desistiu', devolver_materiais: true });
    expect(c.status).toBe(200);
    expect(c.dados.status).toBe('cancelada');
    // agenda: prova desmarcada
    const ag = await db().prepare('SELECT status FROM appointments WHERE order_id = ?').bind(os.id).first<{ status: string }>();
    expect(ag!.status).toBe('cancelado');
    // estoque: 1,5 m voltou (saldo 10)
    const sal = await db().prepare('SELECT quantidade FROM materials WHERE id = ?').bind(m.id).first<{ quantidade: number }>();
    expect(sal!.quantidade).toBe(10);
    // produção: a peça não aparece mais no quadro
    const quadro = (await chamar('/producao', { cookie: adm })).dados;
    expect(quadro.pecas.some((p: any) => p.order_id === os.id)).toBe(false);
    // financeiro: pago líquido zero e não entra como faturamento nem como a receber
    const tot = await db().prepare('SELECT total, pago FROM vw_order_totals WHERE order_id = ?').bind(os.id).first<{ total: number; pago: number }>();
    expect(tot!.pago).toBe(0);
    const rel = (await chamar('/relatorios', { cookie: adm })).dados;
    expect(rel.situacao.find((x: any) => x.status === 'cancelada')?.n).toBeGreaterThanOrEqual(1);
    const receber = (await chamar('/financeiro/receber', { cookie: adm })).dados;
    expect(receber.ordens.some((o: any) => o.id === os.id)).toBe(false);
    // histórico preservado
    const hist = await db().prepare("SELECT COUNT(*) AS n FROM order_status_history WHERE order_id = ? AND para = 'cancelada'").bind(os.id).first<{ n: number }>();
    expect(hist!.n).toBe(1);
  });
});

describe('Origem da cliente e filtros dos relatórios', () => {
  it('grava a origem e conta nos relatórios; filtros respondem', async () => {
    const r = await chamar('/clientes', { cookie: adm, corpo: { nome: `Cliente Insta ${chave()}`, origem: 'instagram', confirmar_duplicado: true } });
    expect(r.status).toBe(201);
    await criarOS(adm, r.dados.id, [{ peca: 'Calça', servicos: [{ descricao: 'Barra', valor: 2000 }] }]);
    const rel = (await chamar('/relatorios', { cookie: adm })).dados;
    expect(rel.origens.find((x: any) => x.origem === 'instagram')?.n).toBeGreaterThanOrEqual(1);
    expect(rel.filtros.categorias.length).toBeGreaterThan(0);
    const filtrado = await chamar(`/relatorios?categoria=${rel.filtros.categorias[0].id}&profissional=inexistente`, { cookie: adm });
    expect(filtrado.status).toBe(200);
    expect(filtrado.dados.produtividade).toEqual([]);
    expect((await chamar('/clientes', { cookie: adm, corpo: { nome: 'Origem inválida', origem: 'tiktok', confirmar_duplicado: true } })).status).toBe(422);
  });
});
