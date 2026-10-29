import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { createAuth } from '../../../lib/auth';
import { readLimited } from '../../../lib/security';
import { rateLimit } from '../../../lib/rate-limit';
import { forumAction } from '../../../lib/forum-service';
import { forumError } from '../../../lib/forum-errors';
export const POST: APIRoute = async ctx => {
  try {
    if (ctx.request.headers.get('origin')!==new URL(env.SITE_URL).origin) return Response.json({error:'Refresh this page and try again.'},{status:403});
    if (!ctx.request.headers.get('content-type')?.startsWith('application/json')) return Response.json({error:'Use a JSON request.'},{status:415});
    const user=ctx.locals.user;
    if (!user) return Response.json({error:'Sign in to continue.'},{status:401});
    if (user.suspended) return Response.json({error:'Your account is suspended.'},{status:403});
    const data=JSON.parse(new TextDecoder().decode(await readLimited(new Response(ctx.request.body),512000)));
    const action=ctx.params.action!;
    await rateLimit(`forum:${user.id}:${action}`,action==='preview'?15:action==='publish'?10:40);
    if (action==='email') {
      const input = z.object({email:z.email(),token:z.string().min(1)}).parse(data);
      return await createAuth().handler(new Request(new URL('/api/auth/change-email',env.SITE_URL),{method:'POST',headers:{'Content-Type':'application/json','origin':env.SITE_URL,'cookie':ctx.request.headers.get('cookie') || '','x-captcha-response':input.token},body:JSON.stringify({newEmail:input.email,callbackURL:'/verify'})}));
    }
    return await forumAction(user,action,data);
  } catch(error) { return forumError(error); }
};
