import type { Env } from './env';

/**
 * Tabelas copiadas no backup, na ordem em que devem ser restauradas (pais antes de filhos).
 * Sessões e tentativas de login ficam de fora: são temporárias e contêm dados de acesso.
 */
export const TABELAS_BACKUP = [
  'users', 'units', 'user_units', 'user_permissions', 'system_settings', 'payment_methods', 'finance_categories', 'measurement_fields', 'service_categories', 'service_catalog',
  'clients', 'orders', 'order_items', 'order_item_services', 'order_status_history', 'order_photos',
  'client_measurements', 'measurement_versions', 'measurement_values',
  'suppliers', 'materials', 'purchases', 'payables',
  'cash_sessions', 'cash_movements', 'customer_credits', 'stock_movements', 'production_events', 'appointments', 'message_logs', 'audit_logs',
] as const;

const POR_PAGINA = 500;

async function gzip(texto: string) {
  const fluxo = new Blob([texto]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

/** Gera um backup lógico (JSON compactado) no bucket de backups e aplica a retenção. */
export async function gerarBackup(env: Env, agora = new Date()) {
  const tabelas: Record<string, unknown[]> = {};
  for (const t of TABELAS_BACKUP) {
    const linhas: unknown[] = [];
    for (let off = 0; ; off += POR_PAGINA) {
      const { results } = await env.DB.prepare(`SELECT * FROM ${t} ORDER BY rowid LIMIT ? OFFSET ?`).bind(POR_PAGINA, off).all();
      linhas.push(...results);
      if (results.length < POR_PAGINA) break;
    }
    tabelas[t] = linhas;
  }
  const migrations = await env.DB.prepare('SELECT name FROM d1_migrations ORDER BY id').all<{ name: string }>()
    .then(r => r.results.map(m => m.name)).catch(() => []);
  const conteudo = JSON.stringify({ formato: 'atelie-jessica-backup-v1', gerado_em: agora.toISOString(), ambiente: env.AMBIENTE, migrations, tabelas });
  const chave = `backups/${agora.toISOString().slice(0, 10)}/atelie-${agora.toISOString().replace(/[:.]/g, '-')}.json.gz`;
  const bytes = await gzip(conteudo);
  await env.BACKUPS.put(chave, bytes, {
    httpMetadata: { contentType: 'application/gzip' },
    customMetadata: { linhas: String(Object.values(tabelas).reduce((s, l) => s + l.length, 0)) },
  });
  const removidos = await aplicarRetencao(env, agora);
  return { chave, tamanho: bytes.length, removidos };
}

export async function aplicarRetencao(env: Env, agora = new Date()) {
  const dias = Math.max(1, Number(env.BACKUP_RETENCAO_DIAS) || 30);
  const limite = new Date(agora.getTime() - dias * 86400_000);
  const apagar: string[] = [];
  let cursor: string | undefined;
  do {
    const lista = await env.BACKUPS.list({ prefix: 'backups/', cursor });
    for (const o of lista.objects) if (o.uploaded < limite) apagar.push(o.key);
    cursor = lista.truncated ? lista.cursor : undefined;
  } while (cursor);
  // Nunca apaga o último backup existente, mesmo que esteja velho.
  const { objects: todos } = await env.BACKUPS.list({ prefix: 'backups/' });
  if (apagar.length && apagar.length >= todos.length) apagar.pop();
  if (apagar.length) await env.BACKUPS.delete(apagar);
  return apagar.length;
}
