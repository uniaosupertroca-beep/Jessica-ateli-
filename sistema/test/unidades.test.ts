import { beforeAll, describe, expect, it } from 'vitest';
import { admin, chamar, chave, cliente, cookieDe, criarOS, db, SENHA } from './ajuda';

// Várias unidades: a Matriz (criada pela migration) e uma filial nova.
let adm: string;
const MAT = 'u-matriz';
let FIL: string;

async function pessoaDaUnidade(papel: 'atendente' | 'costureira', unidades: string[]) {
  const email = `${papel}${chave().toLowerCase()}@teste.com`;
  const c = await chamar('/usuarios', { cookie: adm, corpo: { nome: `Pessoa ${papel}`, email, papel, senha: SENHA, unidades } });
  if (c.status !== 201) throw new Error('criar usuário falhou ' + JSON.stringify(c.dados));
  const cookie = cookieDe((await chamar('/auth/entrar', { corpo: { email, senha: SENHA } })).r);
  await chamar('/auth/senha', { cookie, corpo: { atual: SENHA, nova: SENHA + '-nova' } });
  return cookie;
}

beforeAll(async () => {
  adm = await admin();
  const r = await chamar('/config/unidades', { cookie: adm, corpo: { nome: 'Filial Centro', sigla: 'cen', capacidade_diaria: 3, limite_quase_cheio: 2 } });
  expect(r.status).toBe(201);
  FIL = r.dados.id;
  for (const u of [MAT, FIL]) await chamar('/caixa/abrir', { cookie: adm, unidade: u, corpo: { saldo_inicial_centavos: 0 } });
});

describe('Unidades (filiais)', () => {
  it('migration preserva a Matriz e liga a administradora a todas', async () => {
    const eu = (await chamar('/auth/eu', { cookie: adm })).dados;
    expect(eu.unidades.map((u: any) => u.sigla).sort()).toEqual(['CEN', 'MAT']);
    const sig = await db().prepare("SELECT sigla FROM units WHERE id = 'u-matriz'").first<{ sigla: string }>();
    expect(sig!.sigla).toBe('MAT');
    expect((await chamar('/config/unidades', { cookie: adm, corpo: { nome: 'Outra', sigla: 'CEN' } })).status).toBe(409);
  });

  it('com "todas" escolhido, registrar pede a unidade', async () => {
    const cid = await cliente(adm);
    const r = await chamar('/ordens', { cookie: adm, chave: chave(), corpo: { client_id: cid, prazo: '2030-01-10', itens: [{ peca: 'Calça', servicos: [{ descricao: 'Barra', quantidade: 1, unidade: 'un', valor_unitario_centavos: 2000 }] }] } });
    expect(r.status).toBe(422);
    expect(r.dados.codigo).toBe('escolha_unidade');
  });

  it('atendente de uma unidade não vê nem altera OS da outra', async () => {
    const cid = await cliente(adm);
    const osMat = (await chamar('/ordens', { cookie: adm, unidade: MAT, chave: chave(), corpo: { client_id: cid, prazo: '2030-01-10', confirmar_lotado: true, itens: [{ peca: 'Vestido azul', servicos: [{ descricao: 'Ajuste', quantidade: 1, unidade: 'un', valor_unitario_centavos: 5000 }] }] } })).dados;
    const atFil = await pessoaDaUnidade('atendente', [FIL]);
    expect((await chamar(`/ordens/${osMat.id}`, { cookie: atFil })).status).toBe(404);
    const lista = (await chamar('/ordens?status=todas', { cookie: atFil })).dados;
    expect(JSON.stringify(lista)).not.toContain(osMat.id);
    expect((await chamar(`/ordens/${osMat.id}/status`, { cookie: atFil, corpo: { para: 'aprovada' } })).status).toBe(404);
    expect((await chamar(`/ordens/${osMat.id}/pagamentos`, { cookie: atFil, chave: chave(), corpo: { valor_centavos: 100, forma_id: 'pm-dinheiro' } })).status).toBe(404);
    // pede uma unidade que não é dela: fica na dela
    expect((await chamar(`/ordens/${osMat.id}`, { cookie: atFil, unidade: MAT })).status).toBe(404);
    // busca geral também respeita a unidade (o cliente é compartilhado)
    const b = (await chamar('/busca?q=vestido azul', { cookie: atFil })).dados;
    expect(b.pecas.length).toBe(0);
    const bAdm = (await chamar('/busca?q=vestido azul', { cookie: adm })).dados;
    expect(bAdm.pecas.length).toBeGreaterThan(0);
    // a OS da filial é criada na filial sem precisar escolher (só uma unidade)
    await chamar('/config/servicos/sv-barra-calca', { cookie: adm, metodo: 'PUT', corpo: { categoria_id: 'sc-ajustes', nome: 'Barra de calça', preco_centavos: 2500, tempo_min: 30 } });
    const osFil = (await chamar('/ordens', { cookie: atFil, chave: chave(), corpo: { client_id: cid, prazo: '2030-01-10', confirmar_lotado: true, itens: [{ peca: 'Calça', servicos: [{ service_id: 'sv-barra-calca', descricao: 'Barra de calça', quantidade: 1, valor_unitario_centavos: 2500 }] }] } }));
    expect(osFil.status).toBe(201);
    const u = await db().prepare('SELECT unit_id FROM orders WHERE id = ?').bind(osFil.dados.id).first<{ unit_id: string }>();
    expect(u!.unit_id).toBe(FIL);
  });

  it('caixa é separado por unidade', async () => {
    const cid = await cliente(adm);
    const os = await criarOSNa(MAT, cid, 3000);
    const p = await chamar(`/ordens/${os.id}/pagamentos`, { cookie: adm, unidade: MAT, chave: chave(), corpo: { valor_centavos: 3000, forma_id: 'pm-dinheiro' } });
    expect(p.status).toBe(201);
    const cMat = (await chamar('/caixa', { cookie: adm, unidade: MAT })).dados;
    const cFil = (await chamar('/caixa', { cookie: adm, unidade: FIL })).dados;
    expect(cMat.lancamentos.some((l: any) => l.order_id === os.id)).toBe(true);
    expect(cFil.lancamentos.some((l: any) => l.order_id === os.id)).toBe(false);
    const todas = (await chamar('/caixa', { cookie: adm })).dados;
    expect(todas.por_unidade.map((x: any) => x.sigla).sort()).toEqual(['CEN', 'MAT']);
    // fechar o caixa da filial não fecha o da matriz
    const sessaoFil = await db().prepare("SELECT id FROM cash_sessions WHERE unit_id = ? AND fechado_em IS NULL").bind(FIL).first();
    expect(sessaoFil).toBeTruthy();
    const relFil = (await chamar('/relatorios', { cookie: adm, unidade: FIL })).dados;
    const relMat = (await chamar('/relatorios', { cookie: adm, unidade: MAT })).dados;
    expect(relMat.atual.recebido).toBeGreaterThanOrEqual(3000);
    expect(relFil.atual.recebido).toBe(0);
    const relTodas = (await chamar('/relatorios', { cookie: adm })).dados;
    expect(relTodas.por_unidade.length).toBe(2);
  });

  it('estoque tem saldo por unidade e transferência entre unidades', async () => {
    const m = (await chamar('/estoque/materiais', { cookie: adm, corpo: { codigo: `L${chave().slice(-5)}`, nome: 'Linha branca', categoria: 'linha', unidade: 'un' } })).dados;
    const compra = await chamar('/estoque/movimentos', { cookie: adm, unidade: MAT, chave: chave(), corpo: { material_id: m.id, tipo: 'compra', quantidade: 10, custo_unitario_centavos: 100 } });
    expect(compra.status).toBe(201);
    const saldo = async (u: string) => (await chamar('/estoque/materiais', { cookie: adm, unidade: u })).dados.materiais.find((x: any) => x.id === m.id);
    expect((await saldo(MAT)).quantidade).toBe(10);
    expect((await saldo(FIL)).quantidade).toBe(0);
    // a filial não pode gastar o que está na matriz
    const perda = await chamar('/estoque/movimentos', { cookie: adm, unidade: FIL, chave: chave(), corpo: { material_id: m.id, tipo: 'perda', quantidade: 1, motivo: 'teste' } });
    expect(perda.dados.codigo).toBe('estoque_insuficiente');
    const k = chave();
    const t = await chamar('/estoque/transferencias', { cookie: adm, unidade: MAT, chave: k, corpo: { material_id: m.id, para_unit_id: FIL, quantidade: 4 } });
    expect(t.status).toBe(201);
    expect((await chamar('/estoque/transferencias', { cookie: adm, unidade: MAT, chave: k, corpo: { material_id: m.id, para_unit_id: FIL, quantidade: 4 } })).dados.repetido).toBe(true);
    expect((await saldo(MAT)).quantidade).toBe(6);
    expect((await saldo(FIL)).quantidade).toBe(4);
    expect((await saldo(FIL)).quantidade_total).toBe(10);
    // não transfere mais do que tem
    expect((await chamar('/estoque/transferencias', { cookie: adm, unidade: FIL, chave: chave(), corpo: { material_id: m.id, para_unit_id: MAT, quantidade: 5 } })).dados.codigo).toBe('estoque_insuficiente');
  });

  it('capacidade da agenda é da unidade', async () => {
    const ag = (await chamar('/agenda?de=2030-02-01&ate=2030-02-01', { cookie: adm, unidade: FIL })).dados;
    expect(ag.capacidade).toBe(3);
    expect((await chamar('/agenda?de=2030-02-01&ate=2030-02-01', { cookie: adm, unidade: MAT })).dados.capacidade).not.toBe(3);
  });
});

async function criarOSNa(unidade: string, cid: string, valor: number) {
  const r = await chamar('/ordens', { cookie: adm, unidade, chave: chave(), corpo: { client_id: cid, prazo: '2030-01-10', confirmar_lotado: true, itens: [{ peca: 'Blusa', servicos: [{ descricao: 'Ajuste', quantidade: 1, unidade: 'un', valor_unitario_centavos: valor }] }] } });
  if (r.status !== 201) throw new Error('OS falhou ' + JSON.stringify(r.dados));
  return r.dados as { id: string };
}
