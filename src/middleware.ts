import { defineMiddleware } from 'astro:middleware';
import { authReady, createAuth } from './lib/auth';
import { one } from './lib/db';
import { refreshMembership } from './lib/membership';
import type { Viewer } from './lib/types';
export const onRequest = defineMiddleware(async (ctx,next)=>{
  ctx.locals.user = null;
  const bearerRoute=ctx.url.pathname==='/api/v1'||ctx.url.pathname.startsWith('/api/v1/');
  if (!bearerRoute && authReady() && ctx.request.headers.has('cookie')) {
    const session = await createAuth().api.getSession({headers:ctx.request.headers});
    if (session) {
      ctx.locals.user = await one<Viewer>('SELECT id,username,name,email_verified AS emailVerified,image,cover_image AS coverImage,bio,role,suspended FROM user WHERE id=?',session.user.id);
      if (!ctx.url.pathname.startsWith('/api/auth/')) await refreshMembership(session.user.id);
    }
  }
  const original = await next();
  const response = new Response(original.body,original);
  response.headers.set('X-Content-Type-Options','nosniff');
  response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  if (ctx.url.pathname.startsWith('/api/') || ['/settings','/notifications','/admin','/login','/register','/verify','/forgot-password','/reset-password','/onboarding','/search'].some(p=>ctx.url.pathname===p)) response.headers.set('X-Robots-Tag','noindex');
  if (ctx.locals.user || bearerRoute || ctx.url.pathname.startsWith('/api/account/') || ctx.url.pathname.startsWith('/api/auth/') || ['/settings','/notifications','/admin'].includes(ctx.url.pathname)) response.headers.set('Cache-Control','private, no-store');
  return response;
});
