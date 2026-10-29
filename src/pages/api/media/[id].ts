import type { APIRoute } from 'astro';
import { one } from '../../../lib/db';
import { safeFetch,readLimited,rasterType } from '../../../lib/security';
export const GET: APIRoute = async ctx => {
  const preview = await one<{image:string|null}>(`SELECT image FROM link_previews WHERE id=? AND (EXISTS(SELECT 1 FROM post_links pl JOIN posts p ON p.id=pl.post_id WHERE pl.preview_id=link_previews.id AND p.deleted=0) OR ?=1)`,ctx.params.id,ctx.locals.user?1:0);
  if (!preview?.image) return new Response('Image not found',{status:404});
  try {
    const response = await safeFetch(preview.image,'image/avif,image/webp,image/png,image/jpeg,image/gif');
    const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const bytes = await readLimited(response,10*1024*1024);
    if (!rasterType(bytes,type)) throw new Error('Unsupported image.');
    return new Response(bytes.buffer as ArrayBuffer,{headers:{'Content-Type':type,'Cache-Control':ctx.locals.user?'private, max-age=3600':'public, max-age=3600','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"}});
  } catch { return new Response('Image unavailable',{status:502}); }
};
