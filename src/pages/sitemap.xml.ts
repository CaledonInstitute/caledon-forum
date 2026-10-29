import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { all } from '../lib/db';
const escape=(s:string)=>s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
export const GET: APIRoute = async () => {
  const entries=await all<{path:string;modified:number}>(`SELECT '/p/'||pa.id AS path,MAX(p.updated_at,COALESCE((SELECT MAX(r.updated_at) FROM posts r WHERE r.root_id=p.id),p.updated_at)) AS modified FROM posts p JOIN post_addresses pa ON pa.post_id=p.id WHERE p.root_id IS NULL AND (p.deleted=0 OR EXISTS(SELECT 1 FROM posts r WHERE r.root_id=p.id AND r.deleted=0)) UNION ALL SELECT '/'||username AS path,updated_at AS modified FROM user WHERE username IS NOT NULL ORDER BY modified DESC LIMIT 45000`);
  const items=[{path:'/',modified:0},{path:'/rules',modified:0},{path:'/privacy',modified:0},...entries];
  const xml=items.map(p=>`<url><loc>${escape(new URL(p.path,env.SITE_URL).href)}</loc>${p.modified?`<lastmod>${new Date(p.modified).toISOString()}</lastmod>`:''}</url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${xml}</urlset>`,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=300'}});
};
