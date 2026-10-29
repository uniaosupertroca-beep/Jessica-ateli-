export interface Env {
  DB: D1Database;
  FOTOS: R2Bucket;
  BACKUPS: R2Bucket;
  ASSETS: Fetcher;
  AMBIENTE: string;
  BACKUP_RETENCAO_DIAS: string;
  /** Segredo usado só para criar o primeiro administrador (wrangler secret put SETUP_TOKEN). */
  SETUP_TOKEN?: string;
  /** Limite de requisições por IP (binding de Rate Limiting da Cloudflare). */
  LIMITE_API?: RateLimit;
}

export type Papel = 'admin' | 'atendente' | 'costureira';

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  login: string | null;
  papel: Papel;
  trocar_senha: number;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { usuario: Usuario; perms: ReadonlySet<string>; sessaoId: string; unidades: string[]; unidade: string | null };
};
