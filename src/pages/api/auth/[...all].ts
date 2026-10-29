import type { APIRoute } from 'astro';
import { authReady, createAuth } from '../../../lib/auth';
import { rateLimit } from '../../../lib/rate-limit';
import { run } from '../../../lib/db';
// OAuth tokens and email sign-in are deliberately not exposed as browser capabilities.
const allowed = new Set(['/sign-in/social','/sign-in/username','/sign-up/email','/request-password-reset','/reset-password','/send-verification-email','/verify-email','/link-social','/unlink-account','/change-password','/sign-out','/get-session','/callback/github','/list-accounts']);
export const ALL: APIRoute = async ctx => {
  if (!authReady()) return Response.json({message:'Sign-in is not available yet. Please check back soon.'},{status:503});
  const route = '/'+(ctx.params.all || '').replace(/\/+$/,'');
  if (!allowed.has(route) && !(ctx.request.method==='GET' && /^\/reset-password\/[A-Za-z0-9_-]+$/.test(route))) return Response.json({message:'This action is unavailable.'},{status:404});
  try {
    if (ctx.request.method==='POST') {
      await rateLimit(`auth:${ctx.request.headers.get('cf-connecting-ip') || 'local'}:${route}`,route.includes('sign-in')?10:5,600000);
      if (ctx.locals.user?.suspended && route!=='/sign-out') return Response.json({message:'This account is suspended.'},{status:403});
    }
    const response = await createAuth().handler(ctx.request);
    if (route==='/unlink-account' && response.ok && ctx.locals.user) await run('DELETE FROM memberships WHERE user_id=?',ctx.locals.user.id);
    if (route==='/callback/github' && response.status<400) {
      // Invalidate any cached status; the redirected page verifies the current linked identity.
      if (ctx.locals.user) await run('UPDATE memberships SET checked_at=0,retry_after=0 WHERE user_id=?',ctx.locals.user.id);
    }
    return response;
  } catch(error) { if (error instanceof Response) return error; return Response.json({message:'Unable to complete sign-in. Please try again.'},{status:500}); }
};
