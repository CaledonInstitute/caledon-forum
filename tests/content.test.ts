import { describe,it,expect } from 'vitest';
import { validateBody,countCharacters,threadTitle,youtubeId } from '../src/lib/content';
import { markdown,extractUrls } from '../src/lib/markdown';
import { publicUrl,safeFetch,readLimited,rasterType } from '../src/lib/security';
describe('25,000 Unicode code points',()=>{
 for(const length of [24999,25000])it(`accepts ${length} characters`,()=>expect(countCharacters(validateBody('😀'.repeat(length)))).toBe(length));
 it('rejects 25,001 characters and blank posts',()=>{expect(()=>validateBody('😀'.repeat(25001))).toThrow('25,000');expect(()=>validateBody('  ')).toThrow();});
 it('uses link metadata for URL-only thread titles',()=>expect(threadTitle('https://youtube.com/watch?v=dQw4w9WgXcQ','An interesting talk')).toBe('An interesting talk'));
});
describe('Markdown',()=>{
 it('removes HTML, scripts and unsafe links',async()=>{const html=await markdown('<script>alert(1)</script>\n\n[bad](javascript:alert)\n\n**hello**');expect(html).not.toContain('<script');expect(html).not.toContain('javascript:');expect(html).toContain('<strong>hello</strong>');});
 it('does not discover links in code',()=>expect(extractUrls('`https://a.com`\n\n```\nhttps://b.com\n```\n\nhttps://c.com')).toEqual(['https://c.com']));
 it('only renders validated images, with proxy URLs',async()=>{const p:any={id:'image',url:'https://images.host.test/a.png',kind:'image'};const html=await markdown(p.url,[p]);expect(html).toContain('/api/media/image');expect(html).toContain('loading="lazy"');expect(await markdown('![bad](https://bad.com/a.svg)')).not.toContain('<img');});
 it('keeps explicitly labelled image links as links',async()=>{const p:any={id:'image',url:'https://images.host.test/a.png',kind:'image'};expect(await markdown(`[open](${p.url})`,[p])).not.toContain('<img');});
 it('adds UGC link attributes',async()=>expect(await markdown('[source](https://github.com)')).toContain('ugc nofollow noopener'));
});
describe('remote fetch policy',()=>{
 for(const url of ['http://github.com','https://localhost','https://127.0.0.1','https://169.254.169.254','https://10.0.0.1','https://[::1]','https://0x7f000001','https://2130706433','https://user:pass@github.com','https://github.com:8443','https://service.internal'])it(`rejects ${url}`,()=>expect(()=>publicUrl(url)).toThrow());
 it('allows HTTPS query strings',()=>expect(publicUrl('https://images.unsplash.com/a.png?w=800').search).toBe('?w=800'));
 it('rechecks redirected addresses',async()=>{const f=async()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1'}});await expect(safeFetch('https://github.com','text/html',f as any)).rejects.toThrow();});
 it('limits redirects',async()=>{let calls=0;const f=async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://github.com/a'}});};await expect(safeFetch('https://github.com','text/html',f as any)).rejects.toThrow('redirects');expect(calls).toBe(4);});
 it('limits streaming responses',async()=>await expect(readLimited(new Response('123456'),5)).rejects.toThrow('large'));
 it('rejects SVG and false raster signatures',()=>{expect(rasterType(new TextEncoder().encode('<svg/>'),'image/svg+xml')).toBe(false);expect(rasterType(new TextEncoder().encode('<script>'),'image/png')).toBe(false);});
 it('normalizes YouTube URL variants',()=>{for(const url of ['https://youtu.be/dQw4w9WgXcQ','https://www.youtube.com/watch?v=dQw4w9WgXcQ','https://youtube.com/shorts/dQw4w9WgXcQ'])expect(youtubeId(url)).toBe('dQw4w9WgXcQ');expect(youtubeId('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ')).toBeNull();});
});
