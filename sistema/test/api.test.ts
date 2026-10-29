import { beforeAll, describe, expect, it } from 'vitest';
import { abrirCaixa, admin, chamar, chave, cliente, cookieDe, criarOS, db, hojeSP, SENHA, usuario } from './ajuda';

let adm: string;
beforeAll(async () => {
  adm = await admin();
  await abrirCaixa(adm);
});

describe('login e sessão', () => {
  it('exige login nas rotas internas', async () => {
    const r = await chamar('/clientes');
    expect(r.status).toBe(401);
    expect(r.dados.mensagem).toMatch(/Entre/);
  });

  it('não permite configurar de novo nem com token errado', async () => {
    const r = await chamar('/auth/configurar', { corpo: { token: 'errado', nome: 'Xavier', email: 'x@x.com', senha: SENHA } });
    expect(r.status).toBe(403);
  });

  it('bloqueia após 5 senhas erradas', async () => {
    const email = `bloq${chave().toLowerCase()}@teste.com`;
    await chamar('/usuarios', { cookie: adm, corpo: { nome: 'Bloqueio', email, papel: 'atendente', senha: SENHA } });
    for (let i = 0; i < 5; i++) expect((await chamar('/auth/entrar', { corpo: { email, senha: 'errada-errada' } })).status).toBe(401);
    const r = await chamar('/auth/entrar', { corpo: { email, senha: SENHA } });
    expect(r.status).toBe(429);
  });

  it('o cookie de sessão é HttpOnly, Secure e SameSite=Strict, e a senha não fica em texto', async () => {
    const email = `cook${chave().toLowerCase()}@teste.com`;
    await chamar('/usuarios', { cookie: adm, corpo: { nome: 'Cookie', email, papel: 'atendente', senha: SENHA } });
    const r = await chamar('/auth/entrar', { corpo: { email, senha: SENHA } });
    const sc = r.r.headers.get('Set-Cookie')!;
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/Secure/i);
    expect(sc).toMatch(/SameSite=Strict/i);
    const u = await db().prepare('SELECT senha_hash FROM users WHERE email = ?').bind(email).first<{ senha_hash: string }>();
    expect(u!.senha_hash).toMatch(/^pbkdf2\$100000\$/);
    expect(u!.senha_hash).not.toContain(SENHA);
    const sair = await chamar('/auth/sair', { cookie: cookieDe(r.r), corpo: {} });
    expect(sair.status).toBe(200);
    expect((await chamar('/auth/eu', { cookie: cookieDe(r.r) })).status).toBe(401);
  });

  it('bloqueia requisição vinda de outro site (CSRF)', async () => {
    const r = await chamar('/clientes', { cookie: adm, corpo: { nome: 'Ataque' }, origem: 'https://site-malicioso.com' });
    expect(r.status).toBe(403);
  });
});

describe('Teste 1 — persistência', () => {
  it('cliente e OS continuam salvas após sair e entrar de novo', async () => {
    const cid = await cliente(adm, 'Persistente da Silva', '11987650001');
    const os = await criarOS(adm, cid, [{ peca: 'Calça', servicos: [{ descricao: 'Barra', valor: 2500 }] }]);
    const novoLogin = await admin();
    const r = await chamar(`/ordens/${os.id}`, { cookie: novoLogin });
    expect(r.status).toBe(200);
    expect(r.dados.cliente.nome).toBe('Persistente da Silva');
    expect(r.dados.itens[0].peca).toBe('Calça');
    expect(r.dados.total).toBe(2500);
    const c = await chamar(`/clientes/${cid}`, { cookie: novoLogin });
    expect(c.dados.cliente.criado_em).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('clientes', () => {
  it('avisa sobre possível duplicidade (mesmo telefone ou nome)', async () => {
    await cliente(adm, 'Mariana Duplicada', '11987650002');
    const r = await chamar('/clientes', { cookie: adm, corpo: { nome: 'Outra Pessoa', telefone: '(11) 98765-0002' } });
    expect(r.status).toBe(409);
    expect(r.dados.codigo).toBe('possivel_duplicado');
    expect(r.dados.candidatos[0].nome).toBe('Mariana Duplicada');
    const r2 = await chamar('/clientes', { cookie: adm, corpo: { nome: 'mariana duplicada' } });
    expect(r2.status).toBe(409);
  });

  it('recusa telefone inválido e busca sem acento', async () => {
    const r = await chamar('/clientes', { cookie: adm, corpo: { nome: 'Sem Telefone Bom', telefone: '123' } });
    expect(r.status).toBe(422);
    await cliente(adm, 'Sônia Araújo');
    const b = await chamar('/clientes?q=sonia%20araujo', { cookie: adm });
    expect(b.dados.clientes.some((c: any) => c.nome === 'Sônia Araújo')).toBe(true);
  });
});

describe('Teste 2 — pagamento acima do saldo (erro 1)', () => {
  it('bloqueia R$ 250 numa OS de R$ 25', async () => {
    const cid = await cliente(adm);
    const os = await criarOS(adm, cid, [{ peca: 'Calça', servicos: [{ descricao: 'Barra', valor: 2500 }] }]);
    const r = await chamar(`/ordens/${os.id}/pagamentos`, { cookie: adm, chave: chave(), corpo: { valor_centavos: 25000, forma_id: 'pm-pix' } });
    expect(r.status).toBe(422);
    expect(r.dados.codigo).toBe('pagamento_excede_saldo');
    expect(r.dados.saldo).toBe(2500);
    expect(r.dados.mensagem).toContain('R$ 25,00');
    const d = await chamar(`/ordens/${os.id}`, { cookie: adm });
    expect(d.dados.pago).toBe(0);
  });

  it('a trava do banco também impede o excesso, mesmo sem passar pela API', async () => {
    const cid = await cliente(adm);
    const os = await criarOS(adm, cid, [{ peca: 'Saia', servicos: [{ descricao: 'Barra', valor: 2500 }] }]);
    await expect(db().prepare(
      `INSERT INTO cash_movements (id, data, tipo, natureza, valor_centavos, forma_id, categoria_id, descricao, order_id, criado_em)
       VALUES ('x-excesso', ?, 'entrada', 'recebimento_os', 25000, 'pm-pix', 'fc-servicos', 'teste', ?, '2026-01-01')`,
    ).bind(hojeSP(), os.id).run()).rejects.toThrow(/pagamento_excede_saldo/);
  });

  it('com escolha explícita, o excedente vira crédito da cliente e aparece no financeiro', async () => {
    const cid = await cliente(adm);
    const os = await criarOS(adm, cid, [{ peca: 'Calça', servicos: [{ descricao: 'Barra', valor: 2500 }] }]);
    const r = await chamar(`/ordens/${os.id}/pagamentos`, { cookie: adm, chave: chave(), corpo: { valor_centavos: 25000, forma_id: 'pm-dinheiro', excedente: 'credito' } });
    expect(r.status).toBe(201);
    const d = await chamar(`/ordens/${os.id}`, { cookie: adm });
    expect(d.dados.pago).toBe(2500);
    expect(d.dados.saldo).toBe(0);
    expect(d.dados.credito_cliente).toBe(22500);
    const c = await chamar(`/clientes/${cid}`, { cookie: adm });
    expect(c.dados.credito).toBe(22500);
    // os R$ 250 entraram na gaveta: 25 da OS + 225 de crédito
    const caixa = await chamar('/caixa', { cookie: adm });
    const descr = caixa.dados.lancamentos.filter((l: any) => l.order_id === os.id || l.descricao.includes(`${String(os.numero).padStart(4, '0')}`)).map((l: any) => l.valor_centavos);
    expect(descr.sort((a: number, b: number) => a - b)).toEqual([2500, 22500]);
    // o crédito pode pagar outra OS
    const os2 = await criarOS(adm, cid, [{ peca: 'Vestido', servicos: [{ descricao: 'Ajuste', valor: 10000 }] }]);
    const p2 = await chamar(`/ordens/${os2.id}/pagamentos`, { cookie: adm, chave: chave(), corpo: { valor_centavos: 10000, forma_id: 'pm-credito-cliente' } });
    expect(p2.status).toBe(201);
    expect((await chamar(`/clientes/${cid}`, { cookie: adm })).dados.credito).toBe(12500);
    // e não se usa mais crédito do que existe
    const os3 = await criarOS(adm, cid, [{ peca: 'Blusa', servicos: [{ descricao: 'Ajuste', valor: 20000 }] }]);
    const p3 = await chamar(`/ordens/${os3.id}/pagamentos`, { cookie: adm, chave: chave(), corpo: { valor_centavos: 20000, forma_id: 'pm-credito-cliente' } });
    expect(p3.status).toBe(422);
    expect(p3.dados.codigo).toBe('credito_insuficiente');
  });
});

describe('Teste 3 — quantidade inválida (erro 2)', () => {
  it('recusa zero, negativo, vazio e fração em unidades', async () => {
    const cid = await cliente(adm);
    for (const quantidade of [0, -1, null, 1.5]) {
      const r = await chamar('/ordens', {
        cookie: adm, chave: chave(),
        corpo: { client_id: cid, prazo: hojeSP(), confirmar_lotado: true, itens: [{ peca: 'Calça', servicos: [{ descricao: 'Barra', unidade: 'un', quantidade, valor_unitario_centavos: 1000 }] }] },
      });
      expect(r.status, `quantidade ${quantidade}`).toBe(422);
    }
  });
  it('aceita metros fracionados', async () => {
    const cid = await cliente(adm);
    const os = await criarOS(adm, cid, [{ peca: 'Cortina', servicos: [{ descricao: 'Barra de cortina', valor: 1000, quantidade: 2.5, unidade: 'm' }] }]);
    expect((await chamar(`/ordens/${os.id}`, { cookie: adm })).dados.total).toBe(2500);
  });
  it('o banco também recusa quantidade zero', async () => {
    await expect(db().prepare(
      `INSERT INTO order_item_services (id, item_id, descricao, unidade, quantidade, valor_unitario_centavos, subtotal_centavos)
       VALUES ('q0', 'nada', 'x', 'un', 0, 100, 0)`,
    ).run()).rejects.toThrow();
  });
});

describe('Teste 5 — várias peças na mesma OS', () => {
  it('soma os valores e acompanha a produção de cada peça', async () => {
    const cid = await cliente(adm, 'Mariana Multipla');
    const os = await criarOS(adm, cid, [
      { peca: 'Calça jeans', servicos: [{ descricao: 'Fazer barra', valor: 2500 }] },
      { peca: 'Vestido', servicos: [{ descricao: 'Ajustar cintura', valor: 4000 }, { descricao: 'Barra', valor: 3000 }] },
      { peca: 'Camisa', servicos: [{ descricao: 'Trocar botão', valor: 500, quantidade: 3 }] },
    ], { desconto_centavos: 500 });
    let d = (await chamar(`/ordens/${os.id}`, { cookie: adm })).dados;
    expect(d.itens).toHaveLength(3);
    expect(d.itens.map((i: any) => i.codigo)).toEqual([`${os.numero}-1`, `${os.numero}-2`, `${os.numero}-3`]);
    expect(d.soma_itens).toBe(2500 + 7000 + 1500);
    expect(d.total).toBe(10500);
    expect(d.status).toBe('recebida');

    // produção só anda depois de aprovada
    const cedo = await chamar(`/ordens/${os.id}/itens/${d.itens[0].id}`, { cookie: adm, metodo: 'PATCH', corpo: { status_producao: 'em_execucao' } });
    expect(cedo.status).toBe(409);
    d = (await chamar(`/ordens/${os.id}/status`, { cookie: adm, corpo: { para: 'aprovada' } })).dados;
    expect(d.status).toBe('aprovada');

    const patch = (i: number, s: string) => chamar(`/ordens/${os.id}/itens/${d.itens[i].id}`, { cookie: adm, metodo: 'PATCH', corpo: { status_producao: s } });
    expect((await patch(0, 'em_execucao')).dados.status).toBe('em_producao');
    expect((await patch(1, 'aguardando_prova')).dados.status).toBe('aguardando_prova');
    await patch(0, 'finalizado');
    await patch(1, 'finalizado');
    expect((await patch(2, 'finalizado')).dados.status).toBe('pronta');

    // entregar com saldo pede confirmação
    const sem = await chamar(`/ordens/${os.id}/status`, { cookie: adm, corpo: { para: 'entregue' } });
    expect(sem.status).toBe(409);
    expect(sem.dados.codigo).toBe('saldo_pendente');
    const ok = await chamar(`/ordens/${os.id}/status`, { cookie: adm, corpo: { para: 'entregue', confirmar_saldo_pendente: true } });
    expect(ok.dados.status).toBe('entregue');
    expect(ok.dados.historico.length).toBeGreaterThanOrEqual(5);

    // OS entregue não é mais editada
    const ed = await chamar(`/ordens/${os.id}`, { cookie: adm, metodo: 'PUT', corpo: { client_id: cid, prazo: hojeSP(), versao: ok.dados.versao, itens: [{ peca: 'X', servicos: [{ descricao: 'Y', quantidade: 1, valor_unitario_centavos: 1 }] }] } });
    expect(ed.status).toBe(409);
  });

  it('edição concorrente com versão antiga é recusada', async () => {
    const cid = await cliente(adm);
    const os = await criarOS(adm, cid, [{ peca: 'Saia', servicos: [{ descricao: 'Barra', valor: 2000 }] }]);
    const d = (await chamar(`/ordens/${os.id}`, { cookie: adm })).dados;
    const corpo = (obs: string) => ({ client_id: cid, prazo: d.prazo, versao: d.versao, observacoes: obs, confirmar_lotado: true,
      itens: d.itens.map((i: any) => ({ id: i.id, peca: i.peca, servicos: i.servicos.map((s: any) => ({ id: s.id, descricao: s.descricao, unidade: s.unidade, quantidade: s.quantidade, valor_unitario_centavos: s.valor_unitario_centavos })) })) });
    const a = await chamar(`/ordens/${os.id}`, { cookie: adm, metodo: 'PUT', corpo: corpo('primeira') });
    expect(a.status).toBe(200);
    const b = await chamar(`/ordens/${os.id}`, { cookie: adm, metodo: 'PUT', corpo: corpo('segunda') });
    expect(b.status).toBe(409);
    expect(b.dados.codigo).toBe('versao_desatualizada');
  });

  it('não deixa o total ficar menor que o já pago', async () => {
    const cid = await cliente(adm);
    const os = await criarOS(adm, cid, [{ peca: 'Calça', servicos: [{ descricao: 'Barra', valor: 3000 }] }]);
    await chamar(`/ordens/${os.id}/pagamentos`, { cookie: adm, chave: chave(), corpo: { valor_centavos: 3000, forma_id: 'pm-pix' } });
    const d = (await chamar(`/ordens/${os.id}`, { cookie: adm })).dados;
    const r = await chamar(`/ordens/${os.id}`, { cookie: adm, metodo: 'PUT', corpo: { client_id: cid, prazo: d.prazo, versao: d.versao, desconto_centavos: 1000, confirmar_lotado: true,
      itens: [{ id: d.itens[0].id, peca: 'Calça', servicos: [{ id: d.itens[0].servicos[0].id, descricao: 'Barra', quantidade: 1, valor_unitario_centavos: 3000 }] }] } });
    expect(r.status).toBe(422);
    expect(r.dados.codigo).toBe('total_menor_que_pago');
  });
});

describe('Teste 10 — R$ 300 recebidos em duas vezes', () => {
  it('saldo termina em zero, sem duplicidade', async () => {
    const cid = await cliente(adm);
    const os = await criarOS(adm, cid, [{ peca: 'Vestido', servicos: [{ descricao: 'Ajuste', valor: 30000 }] }]);
    const k1 = chave();
    const p1 = await chamar(`/ordens/${os.id}/pagamentos`, { cookie: adm, chave: k1, corpo: { valor_centavos: 10000, forma_id: 'pm-pix' } });
    expect(p1.status).toBe(201);
    // repetir o mesmo clique (mesma chave) não registra de novo
    const rep = await chamar(`/ordens/${os.id}/pagamentos`, { cookie: adm, chave: k1, corpo: { valor_centavos: 10000, forma_id: 'pm-pix' } });
    expect(rep.dados.repetido).toBe(true);
    const p2 = await chamar(`/ordens/${os.id}/pagamentos`, { cookie: adm, chave: chave(), corpo: { valor_centavos: 20000, forma_id: 'pm-dinheiro' } });
    expect(p2.status).toBe(201);
    const d = (await chamar(`/ordens/${os.id}`, { cookie: adm })).dados;
    expect(d.pagamentos).toHaveLength(2);
    expect(d.pago).toBe(30000);
    expect(d.saldo).toBe(0);
    const extra = await chamar(`/ordens/${os.id}/pagamentos`, { cookie: adm, chave: chave(), corpo: { valor_centavos: 1, forma_id: 'pm-pix' } });
    expect(extra.status).toBe(422);
  });
});

describe('Teste 11 — estorno', () => {
  it('atualiza caixa, saldo da OS e histórico; não estorna duas vezes', async () => {
    const cid = await cliente(adm);
    const os = await criarOS(adm, cid, [{ peca: 'Calça', servicos: [{ descricao: 'Barra', valor: 5000 }] }]);
    await chamar(`/ordens/${os.id}/pagamentos`, { cookie: adm, chave: chave(), corpo: { valor_centavos: 5000, forma_id: 'pm-dinheiro' } });
    const antes = (await chamar('/caixa', { cookie: adm })).dados;
    const pag = (await chamar(`/ordens/${os.id}`, { cookie: adm })).dados.pagamentos[0];
    const e = await chamar(`/financeiro/lancamentos/${pag.id}/estorno`, { cookie: adm, chave: chave(), corpo: { motivo: 'valor lançado errado' } });
    expect(e.status).toBe(201);
    const d = (await chamar(`/ordens/${os.id}`, { cookie: adm })).dados;
    expect(d.pago).toBe(0);
    expect(d.saldo).toBe(5000);
    expect(d.pagamentos).toHaveLength(2);
    expect(d.pagamentos[0].estornado_por).toBeTruthy();
    const depois = (await chamar('/caixa', { cookie: adm })).dados;
    expect(depois.dinheiro_esperado).toBe(antes.dinheiro_esperado - 5000);
    const de2 = await chamar(`/financeiro/lancamentos/${pag.id}/estorno`, { cookie: adm, chave: chave(), corpo: { motivo: 'de novo' } });
    expect(de2.status).toBe(409);
    // o original continua no banco e não pode ser apagado
    await expect(db().prepare('DELETE FROM cash_movements WHERE id = ?').bind(pag.id).run()).rejects.toThrow(/lancamento_imutavel/);
    await expect(db().prepare('UPDATE cash_movements SET valor_centavos = 1 WHERE id = ?').bind(pag.id).run()).rejects.toThrow(/lancamento_imutavel/);
    // depois do estorno a OS pode ser cancelada
    const canc = await chamar(`/ordens/${os.id}/status`, { cookie: adm, corpo: { para: 'cancelada', motivo: 'desistiu' } });
    expect(canc.dados.status).toBe('cancelada');
  });

  it('não cancela OS com pagamento', async () => {
    const cid = await cliente(adm);
    const os = await criarOS(adm, cid, [{ peca: 'Calça', servicos: [{ descricao: 'Barra', valor: 5000 }] }]);
    await chamar(`/ordens/${os.id}/pagamentos`, { cookie: adm, chave: chave(), corpo: { valor_centavos: 1000, forma_id: 'pm-pix' } });
    const r = await chamar(`/ordens/${os.id}/status`, { cookie: adm, corpo: { para: 'cancelada', motivo: 'teste' } });
    expect(r.status).toBe(409);
    expect(r.dados.codigo).toBe('os_com_pagamento');
  });
});

describe('caixa', () => {
  it('caixa fechado não aceita lançamentos; reabrir fica registrado', async () => {
    const cid = await cliente(adm);
    const os = await criarOS(adm, cid, [{ peca: 'Calça', servicos: [{ descricao: 'Barra', valor: 5000 }] }]);
    const cx = (await chamar('/caixa', { cookie: adm })).dados;
    const f = await chamar('/caixa/fechar', { cookie: adm, corpo: { contado_centavos: cx.dinheiro_esperado - 500 } });
    expect(f.status).toBe(200);
    expect(f.dados.diferenca).toBe(-500);
    const p = await chamar(`/ordens/${os.id}/pagamentos`, { cookie: adm, chave: chave(), corpo: { valor_centavos: 1000, forma_id: 'pm-pix' } });
    expect(p.status).toBe(409);
    expect(p.dados.codigo).toBe('caixa_fechado');
    const r = await chamar('/caixa/reabrir', { cookie: adm, corpo: { motivo: 'faltou lançar um Pix' } });
    expect(r.status).toBe(200);
    const aud = await db().prepare("SELECT dados FROM audit_logs WHERE acao = 'reabrir' ORDER BY em DESC").first<{ dados: string }>();
    expect(JSON.parse(aud!.dados).motivo).toBe('faltou lançar um Pix');
    expect((await chamar(`/ordens/${os.id}/pagamentos`, { cookie: adm, chave: chave(), corpo: { valor_centavos: 1000, forma_id: 'pm-pix' } })).status).toBe(201);
  });
});

describe('Teste 6 — medidas', () => {
  it('nova medição não apaga a anterior', async () => {
    const cid = await cliente(adm);
    const f = await chamar(`/clientes/${cid}/medidas`, { cookie: adm, corpo: { titulo: 'Medidas corporais' } });
    expect(f.status).toBe(201);
    const v1 = await chamar(`/medidas/${f.dados.id}/versoes`, { cookie: adm, corpo: { medido_em: '2026-01-10', valores: { 'mf-busto': 90, 'mf-cintura': 70.5 }, observacoes: 'gosta de folga' } });
    expect(v1.status).toBe(201);
    const v2 = await chamar(`/medidas/${f.dados.id}/versoes`, { cookie: adm, corpo: { medido_em: hojeSP(), valores: { 'mf-busto': 92, 'mf-cintura': 72 } } });
    expect(v2.status).toBe(201);
    const l = (await chamar(`/clientes/${cid}/medidas`, { cookie: adm })).dados;
    const versoes = l.fichas[0].versoes;
    expect(versoes).toHaveLength(2);
    expect(versoes[0].valores['mf-busto']).toBe(92);
    expect(versoes[1].valores['mf-busto']).toBe(90);
    expect(versoes[1].valores['mf-cintura']).toBe(70.5);
    expect(versoes[1].observacoes).toBe('gosta de folga');
    await expect(db().prepare('DELETE FROM measurement_versions WHERE id = ?').bind(v1.dados.id).run()).rejects.toThrow(/medida_imutavel/);
  });
  it('recusa medida zero, futura ou ficha vazia', async () => {
    const cid = await cliente(adm);
    const f = await chamar(`/clientes/${cid}/medidas`, { cookie: adm, corpo: { titulo: 'Vestido de festa' } });
    expect((await chamar(`/medidas/${f.dados.id}/versoes`, { cookie: adm, corpo: { medido_em: hojeSP(), valores: { 'mf-busto': 0 } } })).status).toBe(422);
    expect((await chamar(`/medidas/${f.dados.id}/versoes`, { cookie: adm, corpo: { medido_em: '2099-01-01', valores: { 'mf-busto': 80 } } })).status).toBe(422);
    expect((await chamar(`/medidas/${f.dados.id}/versoes`, { cookie: adm, corpo: { medido_em: hojeSP(), valores: {} } })).status).toBe(422);
  });
});

describe('Teste 7 — fotos', () => {
  const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 4, 5]);
  it('guarda a foto, exige login e recusa arquivo que não é imagem', async () => {
    const cid = await cliente(adm);
    const os = await criarOS(adm, cid, [{ peca: 'Vestido', servicos: [{ descricao: 'Ajuste', valor: 1000 }] }]);
    const fd = new FormData();
    fd.append('arquivo', new File([jpeg()], 'foto.jpg', { type: 'image/jpeg' }));
    fd.append('categoria', 'entrada');
    const up = await chamar(`/ordens/${os.id}/fotos`, { cookie: adm, form: fd });
    expect(up.status).toBe(201);
    const d = (await chamar(`/ordens/${os.id}`, { cookie: adm })).dados;
    expect(d.fotos).toHaveLength(1);
    const img = await chamar(`/fotos/${up.dados.id}`, { cookie: adm });
    expect(img.status).toBe(200);
    expect(img.r.headers.get('Content-Type')).toBe('image/jpeg');
    expect(img.r.headers.get('Cache-Control')).toContain('private');
    expect(new Uint8Array(await img.r.arrayBuffer())).toEqual(jpeg());
    expect((await chamar(`/fotos/${up.dados.id}`)).status).toBe(401);
    const falso = new FormData();
    falso.append('arquivo', new File(['<script>alert(1)</script>'], 'x.jpg', { type: 'image/jpeg' }));
    expect((await chamar(`/ordens/${os.id}/fotos`, { cookie: adm, form: falso })).status).toBe(415);
  });
});

describe('Teste 12 — permissões', () => {
  it('costureira não vê valores nem mexe no financeiro', async () => {
    const cos = await usuario(adm, 'costureira');
    const cid = await cliente(adm);
    const os = await criarOS(adm, cid, [{ peca: 'Calça', servicos: [{ descricao: 'Barra', valor: 5000 }] }]);
    // sem peça atribuída, ela não enxerga a OS
    expect((await chamar(`/ordens/${os.id}`, { cookie: cos.cookie })).status).toBe(404);
    const d = (await chamar(`/ordens/${os.id}`, { cookie: adm })).dados;
    await chamar(`/ordens/${os.id}/itens/${d.itens[0].id}`, { cookie: adm, metodo: 'PATCH', corpo: { responsavel_id: cos.id } });
    const vista = await chamar(`/ordens/${os.id}`, { cookie: cos.cookie });
    expect(vista.status).toBe(200);
    expect(vista.dados.total).toBeUndefined();
    expect(vista.dados.saldo).toBeUndefined();
    expect(vista.dados.pagamentos).toEqual([]);
    expect(vista.dados.itens[0].servicos[0].valor_unitario_centavos).toBeUndefined();
    expect(vista.dados.cliente.telefone).toBeUndefined();
    expect((await chamar('/caixa', { cookie: cos.cookie })).status).toBe(403);
    expect((await chamar('/clientes', { cookie: cos.cookie })).status).toBe(403);
    expect((await chamar(`/ordens/${os.id}/pagamentos`, { cookie: cos.cookie, chave: chave(), corpo: { valor_centavos: 100, forma_id: 'pm-pix' } })).status).toBe(403);
    expect((await chamar('/financeiro/lancamentos', { cookie: cos.cookie, chave: chave(), corpo: { natureza: 'sangria', valor_centavos: 100, descricao: 'x' } })).status).toBe(403);
    // mas atualiza a produção da peça dela (depois de aprovada)
    await chamar(`/ordens/${os.id}/status`, { cookie: adm, corpo: { para: 'aprovada' } });
    const p = await chamar(`/ordens/${os.id}/itens/${d.itens[0].id}`, { cookie: cos.cookie, metodo: 'PATCH', corpo: { status_producao: 'em_execucao' } });
    expect(p.status).toBe(200);
    expect(p.dados.status).toBe('em_producao');
    expect(p.dados.total).toBeUndefined();
    // e não pode se reatribuir peças
    expect((await chamar(`/ordens/${os.id}/itens/${d.itens[0].id}`, { cookie: cos.cookie, metodo: 'PATCH', corpo: { responsavel_id: null } })).status).toBe(403);
  });

  it('atendente usa preço do catálogo, mas não altera preço nem estorna', async () => {
    const at = await usuario(adm, 'atendente');
    await chamar('/config/servicos/sv-barra-calca', { cookie: adm, metodo: 'PUT', corpo: { categoria_id: 'sc-ajustes', nome: 'Barra de calça', preco_centavos: 2500, tempo_min: 30 } });
    const cid = await cliente(at.cookie);
    const base = { client_id: cid, prazo: hojeSP(), confirmar_lotado: true };
    const ok = await chamar('/ordens', { cookie: at.cookie, chave: chave(), corpo: { ...base, itens: [{ peca: 'Calça', servicos: [{ service_id: 'sv-barra-calca', descricao: 'Barra de calça', quantidade: 1, valor_unitario_centavos: 2500 }] }] } });
    expect(ok.status).toBe(201);
    const caro = await chamar('/ordens', { cookie: at.cookie, chave: chave(), corpo: { ...base, itens: [{ peca: 'Calça', servicos: [{ service_id: 'sv-barra-calca', descricao: 'Barra', quantidade: 1, valor_unitario_centavos: 100 }] }] } });
    expect(caro.status).toBe(403);
    const desc = await chamar('/ordens', { cookie: at.cookie, chave: chave(), corpo: { ...base, desconto_centavos: 500, itens: [{ peca: 'Calça', servicos: [{ service_id: 'sv-barra-calca', descricao: 'Barra', quantidade: 1, valor_unitario_centavos: 2500 }] }] } });
    expect(desc.status).toBe(403);
    await chamar(`/ordens/${ok.dados.id}/pagamentos`, { cookie: at.cookie, chave: chave(), corpo: { valor_centavos: 2500, forma_id: 'pm-pix' } });
    const pag = (await chamar(`/ordens/${ok.dados.id}`, { cookie: at.cookie })).dados.pagamentos[0];
    expect((await chamar(`/financeiro/lancamentos/${pag.id}/estorno`, { cookie: at.cookie, chave: chave(), corpo: { motivo: 'teste' } })).status).toBe(403);
    expect((await chamar('/usuarios', { cookie: at.cookie })).status).toBe(403);
    expect((await chamar('/config/atelie', { cookie: at.cookie, metodo: 'PATCH', corpo: {} })).status).toBe(403);
  });
});

describe('Teste 16 — concorrência e cliques repetidos', () => {
  it('dois pagamentos simultâneos não ultrapassam o saldo', async () => {
    const cid = await cliente(adm);
    const os = await criarOS(adm, cid, [{ peca: 'Calça', servicos: [{ descricao: 'Barra', valor: 10000 }] }]);
    const rs = await Promise.all([1, 2, 3].map(() =>
      chamar(`/ordens/${os.id}/pagamentos`, { cookie: adm, chave: chave(), corpo: { valor_centavos: 6000, forma_id: 'pm-pix' } })));
    expect(rs.filter(r => r.status === 201)).toHaveLength(1);
    expect((await chamar(`/ordens/${os.id}`, { cookie: adm })).dados.pago).toBe(6000);
  });

  it('o mesmo clique repetido várias vezes cria uma OS só', async () => {
    const cid = await cliente(adm);
    const k = chave();
    const corpo = { client_id: cid, prazo: hojeSP(), confirmar_lotado: true, itens: [{ peca: 'Calça', servicos: [{ descricao: 'Barra', quantidade: 1, valor_unitario_centavos: 1000 }] }] };
    const rs = await Promise.all([1, 2, 3].map(() => chamar('/ordens', { cookie: adm, chave: k, corpo })));
    const ids = new Set(rs.map(r => r.dados.id));
    expect(ids.size).toBe(1);
    const n = await db().prepare('SELECT COUNT(*) AS n FROM orders WHERE client_id = ?').bind(cid).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it('números de OS nunca se repetem com criação simultânea', async () => {
    const cid = await cliente(adm);
    const rs = await Promise.all(Array.from({ length: 5 }, () => criarOS(adm, cid, [{ peca: 'Saia', servicos: [{ descricao: 'Barra', valor: 1000 }] }])));
    expect(new Set(rs.map(r => r.numero)).size).toBe(5);
  });
});

describe('agenda e capacidade', () => {
  it('pede confirmação quando o dia está lotado', async () => {
    const cid = await cliente(adm);
    const dia = '2030-05-10';
    const corpo = (extra = {}) => ({ client_id: cid, prazo: dia, ...extra, itens: [{ peca: 'Calça', servicos: [{ descricao: 'Barra', quantidade: 1, valor_unitario_centavos: 1000 }] }] });
    for (let i = 0; i < 6; i++) expect((await chamar('/ordens', { cookie: adm, chave: chave(), corpo: corpo() })).status).toBe(201);
    const lot = await chamar('/ordens', { cookie: adm, chave: chave(), corpo: corpo() });
    expect(lot.status).toBe(409);
    expect(lot.dados.codigo).toBe('dia_lotado');
    expect((await chamar('/ordens', { cookie: adm, chave: chave(), corpo: corpo({ confirmar_lotado: true }) })).status).toBe(201);
    const ag = await chamar(`/agenda?de=${dia}&ate=${dia}`, { cookie: adm });
    expect(ag.dados.ocupacao[0].qtd).toBe(7);
  });
});

describe('backup', () => {
  it('gera arquivo compactado com todas as tabelas', async () => {
    const r = await chamar('/admin/backup', { cookie: adm, corpo: {} });
    expect(r.status).toBe(200);
    expect(r.dados.chave).toMatch(/^backups\/\d{4}-\d{2}-\d{2}\/atelie-.*\.json\.gz$/);
    const l = await chamar('/admin/backups', { cookie: adm });
    expect(l.dados.backups.length).toBeGreaterThan(0);
  });
});
