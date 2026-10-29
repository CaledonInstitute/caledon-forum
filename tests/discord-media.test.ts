import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {resetDatabase,seedUser,execute} from './runtime';
import {safeFetch} from '../src/lib/security';
import {fetchAvatar} from '../src/lib/avatar';
import {inspectLink,attachPreviews} from '../src/lib/previews';
import {markdown} from '../src/lib/markdown';
import {GET as media} from '../src/pages/api/media/[id]';
const url='https://media.discordapp.net/attachments/123456/987654/photo.jpg?ex=ffffffff&is=abcdef&hm=test-signature&=&format=webp&width=576&height=1024';
const original=url.replace('media.discordapp.net','cdn.discordapp.com');
const jpeg=new Uint8Array([255,216,255,225,0,16]);
beforeEach(resetDatabase);afterEach(()=>vi.unstubAllGlobals());
function discordFetch(){
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input)===url?new Response('Forbidden',{status:403}):new Response(jpeg,{headers:{'Content-Type':'image/jpeg'}}));
 vi.stubGlobal('fetch',fetcher);return fetcher;
}
it('uses the original Discord CDN when the resize proxy returns 403, preserving signed parameters',async()=>{
 const fetcher=discordFetch();const response=await safeFetch(url);
 expect(response.status).toBe(200);expect(fetcher.mock.calls.map(([u])=>String(u))).toEqual([url,original]);
});
it('renders Discord images in previews and published posts and validates them for avatars/covers',async()=>{
 const fetcher=discordFetch();const preview=await inspectLink(url);expect(preview).toMatchObject({kind:'image',image:url});
 const html=await markdown(`Caption\n${url}`,[preview!]);expect(html).toContain(`/api/media/${preview!.id}`);
 const user=seedUser();execute('INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES(?,?,?,?,?)','discord-post',user.id,url,1,1);await attachPreviews('discord-post',[preview!]);
 const response=await media({params:{id:preview!.id},locals:{user:null}} as any);expect(response.status).toBe(200);expect(response.headers.get('Content-Type')).toBe('image/jpeg');
 expect((await fetchAvatar(url)).type).toBe('image/jpeg');expect((await fetchAvatar(url,'Cover photo')).type).toBe('image/jpeg');
 expect(fetcher.mock.calls.filter(([u])=>String(u)===original)).toHaveLength(4);
});
it('never rewrites other hosts or non-attachment paths during the generic retry',async()=>{
 for(const candidate of [url.replace('media.discordapp.net','media.discordapp.net.attacker.com'),url.replace('/attachments/','/external/')]){
  const fetcher=vi.fn(async(_input:RequestInfo|URL)=>new Response('Forbidden',{status:403}));await expect(safeFetch(candidate,'image/*',fetcher)).rejects.toThrow('unavailable');expect(fetcher.mock.calls.map(([u])=>String(u))).toEqual([candidate,candidate]);
 }
});
it('keeps rejecting inaccessible/expired attachments and unsafe CDN redirects',async()=>{
 const unavailable=vi.fn(async()=>new Response('Forbidden',{status:403}));await expect(safeFetch(url,'image/*',unavailable)).rejects.toThrow('unavailable');expect(unavailable).toHaveBeenCalledTimes(3);
 const redirect=vi.fn(async(input:RequestInfo|URL)=>String(input)===url?new Response('Forbidden',{status:403}):new Response(null,{status:302,headers:{Location:'https://127.0.0.1/private'}}));
 await expect(safeFetch(url,'image/*',redirect)).rejects.toThrow('not public');expect(redirect).toHaveBeenCalledTimes(2);
});
it('does not accept non-image content from the fallback CDN',async()=>{
 vi.stubGlobal('fetch',async(input:RequestInfo|URL)=>String(input)===url?new Response('Forbidden',{status:403}):new Response('<svg/>',{headers:{'Content-Type':'image/jpeg'}}));
 expect(await inspectLink(url)).toBeNull();await expect(fetchAvatar(url)).rejects.toThrow('JPEG, PNG, GIF, or WebP');
});
