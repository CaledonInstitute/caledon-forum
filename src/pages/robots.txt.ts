import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
export const GET: APIRoute = () => new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml',env.SITE_URL).href}\n`,{headers:{'Content-Type':'text/plain; charset=utf-8'}});
