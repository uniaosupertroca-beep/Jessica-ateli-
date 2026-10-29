import { Hono } from 'hono';
import type { AppEnv, Env } from './env';
import { exigirLogin } from './lib/auth';
import { ErroApp, traduzirErroBanco } from './lib/erros';
import { exigir, ip } from './lib/util';
import { gerarBackup } from './backup';
import { rotasAuth } from './rotas/auth';
import { rotasUsuarios } from './rotas/usuarios';
import { rotasConfig } from './rotas/config';
import { rotasClientes } from './rotas/clientes';
import { rotasMedidas } from './rotas/medidas';
import { rotasOrdens } from './rotas/ordens';
import { rotasFinanceiro } from './rotas/financeiro';
import { rotasFotos } from './rotas/fotos';
import { rotasPainel } from './rotas/painel';
import { rotasProducao } from './rotas/producao';
import { rotasAgenda } from './rotas/agenda';
import { rotasEstoque } from './rotas/estoque';
import { rotasPagar } from './rotas/pagar';
import { rotasRelatorios } from './rotas/relatorios';
import { rotasBusca } from './rotas/busca';

const app = new Hono<AppEnv>();
const api = new Hono<AppEnv>();

/* Cabeçalhos de segurança e proteção contra requisições de outros sites (CSRF). */
api.use('*', async (c, next) => {
  const metodo = c.req.method;
  if (metodo !== 'GET' && metodo !== 'HEAD') {
    const origem = c.req.header('Origin');
    if (origem && new URL(origem).host !== new URL(c.req.url).host)
      throw new ErroApp(403, 'origem_invalida', 'Requisição bloqueada por segurança.');
    const tipo = c.req.header('Content-Type') || '';
    if (metodo !== 'DELETE' && !tipo.startsWith('application/json') && !tipo.startsWith('multipart/form-data'))
      throw new ErroApp(415, 'tipo_invalido', 'Formato de requisição não aceito.');
  }
  if (c.env.LIMITE_API) {
    const { success } = await c.env.LIMITE_API.limit({ key: ip(c) });
    if (!success) throw new ErroApp(429, 'limite', 'Muitas requisições seguidas. Aguarde um instante.');
  }
  await next();
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
});

api.route('/auth', rotasAuth);

/* Daqui para baixo, tudo exige login. */
api.use('*', exigirLogin);
api.route('/usuarios', rotasUsuarios);
api.route('/config', rotasConfig);
api.route('/clientes', rotasClientes);
api.route('/ordens', rotasOrdens);
api.route('/', rotasMedidas);
api.route('/', rotasFinanceiro);
api.route('/', rotasFotos);
api.route('/', rotasPainel);
api.route('/', rotasProducao);
api.route('/', rotasAgenda);
api.route('/', rotasEstoque);
api.route('/', rotasPagar);
api.route('/', rotasRelatorios);
api.route('/', rotasBusca);

api.post('/admin/backup', async c => {
  exigir(c, 'backup.gerenciar');
  return c.json(await gerarBackup(c.env));
});
api.get('/admin/backups', async c => {
  exigir(c, 'backup.gerenciar');
  const lista = await c.env.BACKUPS.list({ prefix: 'backups/' });
  return c.json({ backups: lista.objects.map(o => ({ chave: o.key, tamanho: o.size, criado_em: o.uploaded })).reverse() });
});

// Qualquer endereço /api desconhecido responde 404 em JSON (nunca a página do sistema).
api.all('*', c => c.json({ codigo: 'nao_encontrado', mensagem: 'Endereço da API não encontrado.' }, 404));

app.route('/api', api);

app.onError((e, c) => {
  const erro = e instanceof ErroApp ? e : traduzirErroBanco(e);
  if (erro) return c.json({ codigo: erro.codigo, mensagem: erro.message, ...erro.extra }, erro.status);
  console.error('erro inesperado', e);
  return c.json({ codigo: 'erro_interno', mensagem: 'Algo deu errado. Tente novamente; se continuar, avise o administrador.' }, 500);
});

// Qualquer outra rota é atendida pelos arquivos estáticos (o Worker só roda primeiro em /api/*).
app.all('*', c => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_evento: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(gerarBackup(env).then(r => console.log('backup gerado', r)));
  },
} satisfies ExportedHandler<Env>;
