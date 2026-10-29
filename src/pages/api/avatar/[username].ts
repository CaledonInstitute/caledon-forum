import type { APIRoute } from 'astro';
import { one } from '../../../lib/db';
import { fetchAvatar } from '../../../lib/avatar';

export const GET: APIRoute = async ctx => {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const user = await one<{image:string|null}>('SELECT image FROM user WHERE username=?', ctx.params.username);
  if (!user?.image) return new Response('Image not found', { status:404, headers });
  try {
    const { bytes, type } = await fetchAvatar(user.image);
    return new Response(bytes.buffer as ArrayBuffer, { headers:{...headers, 'Content-Type':type} });
  } catch { return new Response('Image unavailable', { status:502, headers }); }
};
