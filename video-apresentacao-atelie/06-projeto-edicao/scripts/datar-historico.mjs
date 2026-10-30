// Espalha as datas das OS de histórico da DEMONSTRAÇÃO pelos últimos meses (gera SQL para o banco local isolado).
import { readFileSync, writeFileSync } from 'node:fs';
const { H, historico, vivos } = JSON.parse(readFileSync(new URL('../.demo-historico.json', import.meta.url)));
const [A, M, D] = H.split('-').map(Number);
const iso = (a, m, d) => new Date(Date.UTC(a, m - 1, d)).toISOString().slice(0, 10);
const menos = (data, n) => { const [a, m, d] = data.split('-').map(Number); return iso(a, m, d - n); };
const q = s => `'${String(s).replace(/'/g, "''")}'`;
const sql = ['DROP TRIGGER IF EXISTS cm_sem_update;', 'DROP TRIGGER IF EXISTS cm_caixa_aberto;'];
const porMes = {};
for (const h of historico) {
  const i = (porMes[h.mes] = (porMes[h.mes] ?? -1) + 1);
  let dia = 1 + ((i * 11) % 27);
  if (h.mes === 0) dia = 1 + ((i * 11) % (D - 1));          // mês atual: só até ontem
  const entrega = iso(A, M - h.mes, dia);
  const abertura = menos(entrega, 6 + (i % 4));
  const t = `${entrega}T18:${String(10 + i).padStart(2, '0')}:00.000Z`;
  sql.push(`UPDATE orders SET aberta_em=${q(abertura)}, prazo=${q(entrega)}, entregue_em=${q(t)}, aprovada_em=${q(abertura + 'T15:00:00.000Z')}, criado_em=${q(abertura + 'T14:00:00.000Z')} WHERE id=${q(h.id)};`);
  sql.push(`UPDATE order_items SET finalizado_em=${q(menos(entrega, 1) + 'T19:00:00.000Z')}, iniciado_em=${q(menos(entrega, 2) + 'T13:00:00.000Z')} WHERE order_id=${q(h.id)};`);
  sql.push(`UPDATE cash_movements SET data=${q(entrega)}, criado_em=${q(t)} WHERE order_id=${q(h.id)};`);
  sql.push(`UPDATE order_status_history SET em=${q(t)} WHERE order_id=${q(h.id)};`);
}
// OS em andamento: abertas nos últimos dias; a da Juliana fica atrasada (prazo ontem)
const vivo = Object.values(vivos);
vivo.forEach((id, i) => sql.push(`UPDATE orders SET aberta_em=${q(menos(H, 1 + (i % 5)))}, criado_em=${q(menos(H, 1 + (i % 5)) + 'T13:00:00.000Z')} WHERE id=${q(id)};`));
sql.push(`UPDATE orders SET aberta_em=${q(menos(H, 7))}, prazo=${q(menos(H, 1))} WHERE id=${q(vivos['Juliana Costa'])};`);
// Prontas desde alguns dias (lembrete de retirada no Início)
sql.push(`UPDATE order_status_history SET em=${q(menos(H, 4) + 'T18:00:00.000Z')} WHERE order_id=${q(vivos['Gabriela Nunes'])} AND para='pronta';`);
// Clientes cadastradas ao longo dos meses
sql.push(`UPDATE clients SET criado_em = date(${q(H)}, '-' || (abs(random()) % 200 + 20) || ' days') || 'T14:00:00.000Z';`);
// despesas fixas de cada mês (aluguel, energia, material, pessoal, manutenção), para o resultado mensal
for (let m = 0; m <= 5; m++) {
  for (const [cat, v, desc, d] of [['fc-aluguel', 120000, 'Aluguel', 5], ['fc-contas', 21000 + m * 900, 'Energia e internet', 12], ['fc-material', 38000 + m * 3500, 'Tecidos e aviamentos', 18], ['fc-manutencao', 12000 + m * 2000, 'Manutenção das máquinas', 22]]) {
    if (m === 0 && d >= D) continue;
    sql.push(`INSERT INTO cash_movements (id, data, tipo, natureza, valor_centavos, forma_id, categoria_id, descricao, criado_em, unit_id)
      VALUES (lower(hex(randomblob(16))), ${q(iso(A, M - m, d))}, 'saida', 'avulso', ${v}, 'pm-pix', ${q(cat)}, ${q(desc)}, ${q(iso(A, M - m, d) + 'T15:00:00.000Z')}, 'u-matriz');`);
  }
}
sql.push(`CREATE TRIGGER cm_caixa_aberto BEFORE INSERT ON cash_movements
WHEN NOT EXISTS (SELECT 1 FROM cash_sessions WHERE data = NEW.data AND unit_id = NEW.unit_id AND fechado_em IS NULL)
BEGIN SELECT RAISE(ABORT, 'caixa_fechado'); END;`);
sql.push(`CREATE TRIGGER cm_sem_update BEFORE UPDATE OF data, tipo, natureza, valor_centavos, forma_id, categoria_id,
  order_id, client_id, estorno_de, idempotency_key, criado_em, criado_por, unit_id, payable_id ON cash_movements
BEGIN SELECT RAISE(ABORT, 'lancamento_imutavel'); END;`);
writeFileSync(process.argv[2], sql.join('\n') + '\n');
console.log(sql.length, 'comandos');
