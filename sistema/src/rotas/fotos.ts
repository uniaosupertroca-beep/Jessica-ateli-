import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { auditoria } from '../lib/auditoria';
import { ErroApp, naoEncontrado } from '../lib/erros';
import { agora, exigir, uuid } from '../lib/util';
import { osVisivel } from './ordens';

export const rotasFotos = new Hono<AppEnv>();

const TAMANHO_MAX = 8 * 1024 * 1024;
const CATEGORIAS = ['entrada', 'defeito', 'referencia', 'durante', 'concluida'];

/** Confere a assinatura do arquivo (não confia só no tipo declarado pelo navegador). */
function tipoReal(b: Uint8Array): { mime: string; ext: string } | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return { mime: 'image/webp', ext: 'webp' };
  return null;
}

rotasFotos.post('/ordens/:id/fotos', async c => {
  exigir(c, 'fotos.enviar');
  const orderId = c.req.param('id');
  await osVisivel(c, orderId);
  const tamanhoDeclarado = Number(c.req.header('Content-Length') || 0);
  if (tamanhoDeclarado > TAMANHO_MAX + 64 * 1024) throw new ErroApp(413, 'arquivo_grande', 'A foto passa de 8 MB.');
  const corpo = await c.req.parseBody();
  const arquivo = corpo['arquivo'];
  const categoria = String(corpo['categoria'] || 'entrada');
  const itemId = corpo['item_id'] ? String(corpo['item_id']) : null;
  const legenda = String(corpo['legenda'] || '').slice(0, 200);
  if (!(arquivo instanceof File)) throw new ErroApp(422, 'sem_arquivo', 'Escolha uma foto.');
  if (!CATEGORIAS.includes(categoria)) throw new ErroApp(422, 'categoria_invalida', 'Tipo de foto inválido.');
  if (arquivo.size > TAMANHO_MAX) throw new ErroApp(413, 'arquivo_grande', 'A foto passa de 8 MB.');
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const tipo = tipoReal(bytes);
  if (!tipo) throw new ErroApp(415, 'formato_invalido', 'Envie uma foto JPG, PNG ou WebP.');
  if (itemId) {
    const ok = await c.env.DB.prepare('SELECT 1 FROM order_items WHERE id = ? AND order_id = ?').bind(itemId, orderId).first();
    if (!ok) throw new ErroApp(422, 'peca_invalida', 'A peça escolhida não pertence a esta OS.');
  }
  const id = uuid();
  const chave = `os/${orderId}/${id}.${tipo.ext}`;
  await c.env.FOTOS.put(chave, bytes, { httpMetadata: { contentType: tipo.mime } });
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO order_photos (id, order_id, item_id, categoria, r2_key, content_type, tamanho, legenda, criado_em, criado_por)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id, orderId, itemId, categoria, chave, tipo.mime, bytes.length, legenda, agora(), c.get('usuario').id),
      auditoria(c, 'enviar_foto', 'order_photos', id, { order_id: orderId, categoria }),
    ]);
  } catch (e) {
    await c.env.FOTOS.delete(chave); // não deixa arquivo órfão no R2
    throw e;
  }
  return c.json({ id }, 201);
});

/** Entrega a imagem somente para quem está logado e pode ver a OS. Nunca é pública. */
rotasFotos.get('/fotos/:id', async c => {
  exigir(c, 'fotos.ver');
  const f = await c.env.DB.prepare('SELECT order_id, r2_key, content_type FROM order_photos WHERE id = ? AND excluida_em IS NULL')
    .bind(c.req.param('id')).first<{ order_id: string; r2_key: string; content_type: string }>();
  if (!f) throw naoEncontrado('Foto');
  await osVisivel(c, f.order_id);
  const obj = await c.env.FOTOS.get(f.r2_key);
  if (!obj) throw naoEncontrado('Foto');
  return new Response(obj.body, {
    headers: {
      'Content-Type': f.content_type,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
});

rotasFotos.delete('/fotos/:id', async c => {
  exigir(c, 'fotos.excluir');
  const id = c.req.param('id');
  const f = await c.env.DB.prepare('SELECT r2_key FROM order_photos WHERE id = ? AND excluida_em IS NULL').bind(id).first<{ r2_key: string }>();
  if (!f) throw naoEncontrado('Foto');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE order_photos SET excluida_em = ?, excluida_por = ? WHERE id = ?').bind(agora(), c.get('usuario').id, id),
    auditoria(c, 'excluir_foto', 'order_photos', id),
  ]);
  await c.env.FOTOS.delete(f.r2_key);
  return c.json({ ok: true });
});
