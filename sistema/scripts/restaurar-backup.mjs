#!/usr/bin/env node
// Converte um backup (.json.gz) gerado pelo sistema em um arquivo SQL para restaurar
// num banco NOVO e VAZIO (com as migrations já aplicadas). Nunca rode contra produção sem
// conferir antes num ambiente isolado — veja docs/BACKUP-E-RESTAURACAO.md.
//
// Uso: node scripts/restaurar-backup.mjs <backup.json.gz> <saida.sql>
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [arquivo, saida] = process.argv.slice(2);
if (!arquivo || !saida) {
  console.error('Uso: node scripts/restaurar-backup.mjs <backup.json.gz> <saida.sql>');
  process.exit(1);
}
const backup = JSON.parse(gunzipSync(readFileSync(arquivo)).toString('utf8'));
if (backup.formato !== 'atelie-jessica-backup-v1') throw new Error('Arquivo não é um backup do Ateliê Jessica.');

// Travas de inserção que dependem da ordem dos acontecimentos: são removidas durante a carga
// e recriadas no fim, exatamente como estão nas migrations.
const TRAVAS = ['cm_caixa_aberto', 'cm_sem_excesso', 'cm_os_cancelada', 'cm_estorno_valido', 'cc_sem_negativo', 'item_com_foto',
  'sm_sem_negativo', 'sm_reversao_valida', 'sm_atualiza_saldo', 'mat_saldo_protegido', 'units_sem_delete'];
const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const sqlMigrations = readdirSync(pasta).filter(f => f.endsWith('.sql')).sort().map(f => readFileSync(join(pasta, f), 'utf8')).join('\n');
// Vale a definição mais recente (migrations posteriores recriam algumas travas, ex.: caixa por unidade).
const definicoes = TRAVAS.map(nome => {
  const m = [...sqlMigrations.matchAll(new RegExp(`CREATE TRIGGER ${nome}\\b[\\s\\S]*?END;`, 'g'))].at(-1);
  if (!m) throw new Error('Trava não encontrada nas migrations: ' + nome);
  return m[0];
});

const val = v => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const linhas = ['-- Restauração gerada em ' + new Date().toISOString() + ' a partir de backup de ' + backup.gerado_em];
linhas.push(...TRAVAS.map(t => `DROP TRIGGER IF EXISTS ${t};`));
// Dados iniciais das migrations são substituídos pelos do backup.
for (const t of ['system_settings', 'payment_methods', 'finance_categories', 'measurement_fields', 'service_catalog', 'service_categories'])
  linhas.push(`DELETE FROM ${t};`);
// Backups com unidades substituem a "Matriz" criada pela migration; os antigos ficam com ela.
if (backup.tabelas.units) linhas.push('DELETE FROM user_units;', 'DELETE FROM units;');
let total = 0;
for (const [tabela, registros] of Object.entries(backup.tabelas)) {
  for (const r of registros) {
    const reg = { ...r };
    // Caixas entram abertos e são fechados no fim (a trava de caixa fechado bloquearia a carga).
    if (tabela === 'cash_sessions') { reg.fechado_em = null; reg.fechado_por = null; reg.contado_centavos = null; }
    // O saldo e o custo médio do material são copiados como estavam (o gatilho que os recalcula fica desligado na carga).
    const cols = Object.keys(reg);
    linhas.push(`INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(c => val(reg[c])).join(', ')});`);
    total++;
  }
}
for (const s of backup.tabelas.cash_sessions || [])
  if (s.fechado_em) linhas.push(`UPDATE cash_sessions SET fechado_em = ${val(s.fechado_em)}, fechado_por = ${val(s.fechado_por)}, contado_centavos = ${val(s.contado_centavos)} WHERE id = ${val(s.id)};`);
linhas.push(...definicoes);
writeFileSync(saida, linhas.join('\n') + '\n');
console.log(`${total} registros de ${Object.keys(backup.tabelas).length} tabelas → ${saida}`);
