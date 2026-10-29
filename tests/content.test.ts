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
 it('removes scripts and unsafe links',async()=>{const html=await markdown('<script>alert(1)</script>\n\n[bad](javascript:alert)\n\n**hello**');expect(html).not.toContain('<script');expect(html).not.toContain('javascript:');expect(html).toContain('<strong>hello</strong>');});
 it('does not discover links in code',()=>expect(extractUrls('`https://a.com`\n\n```\nhttps://b.com\n```\n\nhttps://c.com')).toEqual(['https://c.com']));
 it('only renders validated images, with proxy URLs',async()=>{const p:any={id:'image',url:'https://images.host.test/a.png',kind:'image'};const html=await markdown(p.url,[p]);expect(html).toContain('/api/media/image');expect(html).toContain('loading="lazy"');expect(await markdown('![bad](https://bad.com/a.svg)')).not.toContain('<img');});
 it('keeps explicitly labelled image links as links',async()=>{const p:any={id:'image',url:'https://images.host.test/a.png',kind:'image'};expect(await markdown(`[open](${p.url})`,[p])).not.toContain('<img');});
 it('renders validated Discord image links beside captions and other links',async()=>{
  const url='https://media.discordapp.net/attachments/123/456/photo.jpg?ex=ffffffff&is=abcdef&hm=test&=&format=webp&width=576&height=1024';
  const p:any={id:'discord-image',url,kind:'image'};
  for(const body of [`Caption\n${url}`,`Caption [${url}](${url})`,`Caption\n${url}\nhttps://github.com`]){
   const html=await markdown(body,[p]);expect(html).toContain('<img');expect(html).toContain('/api/media/discord-image');expect(html).toContain('Caption');
  }
  expect(await markdown(`Caption [open image](${url})`,[p])).not.toContain('<img');
 });
 it('matches validated images after URL normalization and fragment removal',async()=>{
  const p:any={id:'normalized-image',url:'https://images.host.test/a.png',kind:'image'};
  expect(await markdown('![Image](https://images.host.test/a.png#preview)',[p])).toContain('/api/media/normalized-image');
 });
 it('adds UGC link attributes',async()=>expect(await markdown('[source](https://github.com)')).toContain('ugc nofollow noopener'));
});
describe('remote fetch policy',()=>{
 for(const url of ['http://github.com','https://localhost','https://127.0.0.1','https://169.254.169.254','https://10.0.0.1','https://[::1]','https://0x7f000001','https://2130706433','https://user:pass@github.com','https://github.com:8443','https://service.internal'])it(`rejects ${url}`,()=>expect(()=>publicUrl(url)).toThrow());
 it('allows HTTPS query strings',()=>expect(publicUrl('https://images.unsplash.com/a.png?w=800').search).toBe('?w=800'));
 it('rechecks redirected addresses',async()=>{const f=async()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1'}});await expect(safeFetch('https://github.com','text/html',f as any)).rejects.toThrow();});
 it('limits redirects',async()=>{let calls=0;const f=async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://github.com/a'}});};await expect(safeFetch('https://github.com','text/html',f as any)).rejects.toThrow('redirects');expect(calls).toBe(4);});
 it('retries any public URL once on 403 with a browser-compatible User-Agent',async()=>{
  const url='https://images.unsplash.com/photo.jpg?signature=keep-this&size=800';const calls:{url:string;headers:Headers}[]=[];
  const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{calls.push({url:String(input),headers:new Headers(init?.headers)});return calls.length===1?new Response('Forbidden',{status:403}):new Response('image',{headers:{'Content-Type':'image/jpeg'}});};
  expect((await safeFetch(url,'image/jpeg',fetcher)).status).toBe(200);expect(calls.map(c=>c.url)).toEqual([url,url]);
  expect(calls[0].headers.get('User-Agent')).toContain('CaledonForum');expect(calls[1].headers.get('User-Agent')).toBe('Mozilla/5.0');expect(calls[1].headers.get('Accept')).toBe('image/jpeg');
  expect(calls[1].headers.has('Cookie')).toBe(false);expect(calls[1].headers.has('Authorization')).toBe(false);
 });
 it('bounds generic 403 retries and does not retry other error statuses',async()=>{
  for(const status of [403,404,429,500]){let calls=0;const fetcher=async()=>{calls++;return new Response('Unavailable',{status});};await expect(safeFetch('https://images.unsplash.com/a.jpg','image/jpeg',fetcher)).rejects.toThrow('unavailable');expect(calls).toBe(status===403?2:1);}
 });
 it('validates redirects returned by the generic 403 retry',async()=>{
  let calls=0;const fetcher=async()=>{calls++;return calls===1?new Response('Forbidden',{status:403}):new Response(null,{status:302,headers:{Location:'https://127.0.0.1/private'}});};
  await expect(safeFetch('https://images.unsplash.com/a.jpg','image/jpeg',fetcher)).rejects.toThrow('not public');expect(calls).toBe(2);
 });
 it('limits streaming responses',async()=>await expect(readLimited(new Response('123456'),5)).rejects.toThrow('large'));
 it('rejects SVG and false raster signatures',()=>{expect(rasterType(new TextEncoder().encode('<svg/>'),'image/svg+xml')).toBe(false);expect(rasterType(new TextEncoder().encode('<script>'),'image/png')).toBe(false);});
 it('normalizes YouTube URL variants',()=>{for(const url of ['https://youtu.be/dQw4w9WgXcQ','https://www.youtube.com/watch?v=dQw4w9WgXcQ','https://youtube.com/shorts/dQw4w9WgXcQ'])expect(youtubeId(url)).toBe('dQw4w9WgXcQ');expect(youtubeId('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ')).toBeNull();});
});

describe('HTML, syntax highlighting and LaTeX',()=>{
 it('preserves safe HTML formatting while removing active content',async()=>{
  const html=await markdown('<details open><summary>Details</summary><p><strong>Hello</strong><br>world</p></details>\n\n<table><tr><td>Cell</td></tr></table><iframe src="https://evil.com"></iframe><script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">bad</a><p style="color:red" onmouseover="alert(1)">text</p>');
  expect(html).toContain('<details open>');expect(html).toContain('<summary>Details</summary>');expect(html).toContain('<td>Cell</td>');
  for(const unsafe of ['<script','<iframe','onclick','onmouseover','javascript:','style='])expect(html).not.toContain(unsafe);
 });
 it('discovers HTML links and proxies only validated HTML images',async()=>{
  const url='https://images.host.test/a.png';const preview:any={id:'html-image',url,kind:'image'};
  const body=`<a href="https://github.com">Source</a><img src="${url}" onerror="alert(1)">`;
  expect(extractUrls(body)).toEqual(['https://github.com',url]);
  const html=await markdown(body,[preview]);expect(html).toContain('/api/media/html-image');expect(html).not.toContain('onerror');
  expect(await markdown(body)).not.toContain('<img');
  expect(extractUrls('```html\n<a href="https://evil.com">example</a>\n```')).toEqual([]);
 });
 it('highlights declared languages and aliases, leaving unknown and unlabelled code readable',async()=>{
  for(const language of ['python','javascript','js','rust']){
   const html=await markdown('```'+language+'\n'+(language==='python'?'def hello(): return 42':'const answer = 42;')+'\n```');
   expect(html).toContain('hljs');expect(html).toContain(`data-language="${language}"`);
  }
  for(const language of ['','unknown-language']){
   const html=await markdown('```'+language+'\n<script>alert(1)</script>\n```');expect(html).toMatch(/(?:&lt;|&#x3C;)script>/);expect(html).not.toContain('<script>');expect(html).not.toContain('hljs-');
  }
 });
 it('renders inline and display math, including accessible MathML',async()=>{
  const html=await markdown('Energy $E = mc^2$\n\n$$\n\\frac{1}{3}\n$$');
  expect(html).toContain('class="katex"');expect(html).toContain('katex-display');expect(html).toContain('<math');expect(html).toContain('<mfrac>');
 });
 it('bounds malformed math and refuses trusted HTML commands',async()=>{
  for(const input of ['$\\badcommand{x}$','$\\href{javascript:alert(1)}{click}$','$\\htmlClass{evil}{x}$']){
   const html=await markdown(input);expect(html).not.toContain('href="javascript:');expect(html).not.toContain('class="evil"');expect(html).not.toContain('<script');
  }
  expect(await markdown('`$x$`\n\n```latex\n$x$\n```')).not.toContain('class="katex"');
 });
});
