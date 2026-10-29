import { afterEach, beforeEach, expect, it } from 'vitest';
import { env, execute, resetDatabase, row, seedUser } from './runtime';
import { hashKey, issueKey } from '../src/lib/api-keys';
import { ALL as api } from '../src/pages/api/v1/[...path]';
import { ALL as keys } from '../src/pages/api/account/key';
import { POST as browser } from '../src/pages/api/forum/[action]';
import { openapi } from '../src/lib/openapi';
let alice:ReturnType<typeof seedUser>,bob:ReturnType<typeof seedUser>,token:string,bobToken:string;
beforeEach(async()=>{resetDatabase();env.AUTH_ENABLED='true';alice=seedUser();bob=seedUser('bob');token=(await issueKey(alice.id)).key;bobToken=(await issueKey(bob.id)).key;});
afterEach(()=>{env.AUTH_ENABLED='false';});
async function call(path:string,method='GET',data?:unknown,key:string|null=token) {
  return api({params:{path:path.split('?')[0]},locals:{user:alice},request:new Request(`http://localhost:4321/api/v1/${path}`,{method,headers:{...(key?{Authorization:`Bearer ${key}`}:{cookie:'session=cookie-is-not-api-auth'}),...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)})} as any);
}
async function manage(method='GET',data?:unknown,user:any=alice,origin='http://localhost:4321') {
  return keys({locals:{user},request:new Request('http://localhost:4321/api/account/key',{method,headers:{origin,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)})} as any);
}
async function publish(body='Hello',key=token,parentId?:string) {
  const response=await call('posts','POST',{body,...(parentId?{parentId}:{})},key);
  expect(response.status).toBe(201);
  return await response.json() as {id:string;url:string};
}
it('stores only a hash; settings returns metadata without the secret',async()=>{
  expect(token).toMatch(/^cfk_[a-f0-9]{64}$/);
  const stored=row('SELECT * FROM api_keys WHERE user_id=?',alice.id);
  expect(stored.key_hash).toBe(await hashKey(token));expect(JSON.stringify(stored)).not.toContain(token);
  const response=await manage();expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  const data=await response.json() as any;expect(data.key.prefix).toBe(token.slice(0,12));expect(data.key.lastUsedAt).toBeNull();expect(JSON.stringify(data)).not.toContain(token);
});
it('requires Bearer authentication, and current verified active user state',async()=>{
  expect((await call('me','GET',undefined,null)).status).toBe(401);
  expect((await call('me','GET',undefined,'cfk_'+'0'.repeat(64))).status).toBe(401);
  expect((await call('me')).status).toBe(200);expect(row('SELECT last_used_at FROM api_keys WHERE user_id=?',alice.id).last_used_at).toBeGreaterThan(0);
  execute('UPDATE user SET suspended=1 WHERE id=?',alice.id);expect((await call('me')).status).toBe(403);
  execute('UPDATE user SET suspended=0,email_verified=0 WHERE id=?',alice.id);expect((await call('me')).status).toBe(403);
  execute('UPDATE user SET email_verified=1,username=NULL WHERE id=?',alice.id);expect((await call('me')).status).toBe(403);
  env.AUTH_ENABLED='false';expect((await call('me')).status).toBe(503);
});
it('regenerates and revokes immediately, including overlapping key generation',async()=>{
  expect((await manage('POST',{operation:'generate'})).status).toBe(409);
  let response=await manage('POST',{operation:'regenerate'});expect(response.status).toBe(200);
  const replacement=(await response.json() as any).key;expect(replacement).not.toBe(token);
  expect((await call('me')).status).toBe(401);expect((await call('me','GET',undefined,replacement)).status).toBe(200);
  expect((await manage('DELETE')).status).toBe(200);expect((await call('me','GET',undefined,replacement)).status).toBe(401);
  const responses=await Promise.all([manage('POST',{operation:'generate'}),manage('POST',{operation:'generate'})]);
  expect(responses.map(r=>r.status).sort()).toEqual([200,409]);expect(row('SELECT COUNT(*) n FROM api_keys WHERE user_id=?',alice.id).n).toBe(1);
});
it('keeps exactly one usable key after concurrent regeneration',async()=>{
  const responses=await Promise.all([manage('POST',{operation:'regenerate'}),manage('POST',{operation:'regenerate'})]);
  const values=await Promise.all(responses.map(async r=>(await r.json() as any).key));
  const statuses=await Promise.all(values.map(async key=>(await call('me','GET',undefined,key)).status));
  expect(statuses.sort()).toEqual([200,401]);
});
it('protects key management with browser session, origin and fresh account state',async()=>{
  expect((await manage('POST',{operation:'regenerate'},null)).status).toBe(401);
  expect((await manage('POST',{operation:'regenerate'},alice,'https://evil.test')).status).toBe(403);
  for(const change of ['email_verified=0','suspended=1','username=NULL']){
    execute(`UPDATE user SET ${change} WHERE id=?`,alice.id);
    expect((await manage('POST',{operation:'regenerate'})).status).toBe(403);
    execute('UPDATE user SET email_verified=1,suspended=0,username=? WHERE id=?','alice',alice.id);
  }
  expect((await call('keys','POST',{})).status).toBe(404);
  expect((await call('moderate','POST',{})).status).toBe(404);
});
it('shares post rules, public IDs, reply permalinks and ownership with the website',async()=>{
  const root=await publish('😀'.repeat(25000));expect(root.url).toBe(`/p/${root.id}`);
  expect(root.id).toMatch(/^[1-9][0-9]{18}$/);
  const reply=await publish('Reply',bobToken,root.id);
  const post=await (await call(`posts/${reply.id}`)).json() as any;
  expect(post).toMatchObject({id:reply.id,parentId:root.id,rootId:root.id,body:'Reply'});expect(post.url).toContain(`#post-`);
  expect((await call('posts','POST',{body:'😀'.repeat(25001)})).status).toBe(400);
  expect((await call(`posts/${root.id}`,'PATCH',{body:'hijack'},bobToken)).status).toBe(403);
  const internal=row('SELECT post_id FROM post_addresses WHERE id=?',root.id).post_id;
  const edited=await browser({params:{action:'edit'},locals:{user:alice},request:new Request('http://localhost:4321/api/forum/edit',{method:'POST',headers:{origin:'http://localhost:4321','Content-Type':'application/json'},body:JSON.stringify({id:internal,body:'Edited in browser'})})} as any);
  expect(edited.ok).toBe(true);expect(await (await call(`posts/${root.id}`)).json()).toMatchObject({body:'Edited in browser'});
  execute('UPDATE posts SET locked=1 WHERE id=?',internal);
  expect((await call('posts','POST',{body:'blocked',parentId:root.id})).status).toBe(400);
  expect((await call(`posts/${root.id}`,'DELETE')).status).toBe(200);
  expect(await (await call(`posts/${root.id}`)).json()).toMatchObject({body:'',deleted:true});
});
it('round-trips 19-digit IDs without rounding and accepts legacy numeric parent inputs',async()=>{
  const p=await publish();execute('UPDATE post_addresses SET id=? WHERE id=?','9999999999999999999',p.id);
  expect(await (await call('posts/9999999999999999999')).json()).toMatchObject({id:'9999999999999999999',url:'/p/9999999999999999999'});
  const reply=await publish('Reply',bobToken,'9999999999999999999');
  expect(await (await call(`posts/${reply.id}`)).json()).toMatchObject({rootId:'9999999999999999999',parentId:'9999999999999999999'});
  expect((await call('posts','POST',{body:'Unsafe number',parentId:Number('9999999999999999999')})).status).toBe(400);
  execute('UPDATE post_addresses SET id=? WHERE id=?','7','9999999999999999999');
  expect((await call('posts','POST',{body:'Legacy reply',parentId:7})).status).toBe(201);
  expect(await (await call('posts/7')).json()).toMatchObject({id:'7',url:'/p/7'});
});
it('supports idempotent likes, private notifications, reports and read markers',async()=>{
  const p=await publish();
  for(let i=0;i<2;i++)expect((await call(`posts/${p.id}/like`,'PUT',undefined,bobToken)).status).toBe(200);
  const notifications=await (await call('notifications')).json() as any;expect(notifications.items).toHaveLength(1);expect(notifications.items[0]).toMatchObject({postId:p.id,kind:'like',actorUsername:'bob',readAt:null});
  expect(await (await call('notifications','GET',undefined,bobToken)).json()).toMatchObject({items:[]});
  expect((await call('notifications/read','POST')).status).toBe(200);expect(row('SELECT read_at FROM notifications').read_at).toBeGreaterThan(0);
  expect((await call(`posts/${p.id}/reports`,'POST',{reason:'Needs review'},bobToken)).status).toBe(200);expect(row('SELECT reporter_id FROM reports').reporter_id).toBe('bob');
  expect((await call(`posts/${p.id}/like`,'DELETE',undefined,bobToken)).status).toBe(200);expect(row('SELECT COUNT(*) n FROM likes').n).toBe(0);
});
it('supports partial profile updates without exposing private profile columns',async()=>{
  expect((await call('me','PATCH',{bio:'Updated bio'})).status).toBe(200);
  expect(row('SELECT name,bio FROM user WHERE id=?',alice.id)).toMatchObject({name:'alice',bio:'Updated bio'});
  expect((await call('me','PATCH',{role:'admin'})).status).toBe(400);
  const profile=await (await call('profiles/alice')).json() as any;
  expect(profile.bio).toBe('Updated bio');expect(profile).not.toHaveProperty('email');expect(profile).not.toHaveProperty('role');expect(profile).not.toHaveProperty('id');
});
it('paginates feed and profile activity, preserving reply order and missing-resource errors',async()=>{
  const p=await publish();
  for(let i=0;i<21;i++)execute('INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES(?,?,?,?,?)',`post${i}`,alice.id,`Post ${i}`,i,i);
  const page1=await (await call('posts')).json() as any, page2=await (await call('posts?page=2')).json() as any;
  expect(page1.items).toHaveLength(20);expect(page1.hasMore).toBe(true);expect(page2.items).toHaveLength(2);expect(page2.hasMore).toBe(false);
  const reply=await publish('reply',token,p.id);
  expect(await (await call('profiles/alice/posts?tab=replies')).json()).toMatchObject({items:[{id:reply.id}]});
  expect(await (await call(`posts/${p.id}/replies`)).json()).toMatchObject({items:[{id:reply.id}]});
  expect((await call('posts/999999')).status).toBe(404);expect((await call('profiles/missing')).status).toBe(404);expect((await call('posts','POST',{body:'reply',parentId:99999})).status).toBe(404);
});
it('enforces shared action limits and account-wide API limits with Retry-After',async()=>{
  execute('INSERT INTO rate_limits(key,count,reset_at) VALUES(?,?,?)','forum:alice:publish',10,Date.now()+60000);
  expect((await call('posts','POST',{body:'too fast'})).status).toBe(429);
  execute('INSERT OR REPLACE INTO rate_limits(key,count,reset_at) VALUES(?,?,?)','api:alice',60,Date.now()+60000);
  const response=await call('me');expect(response.status).toBe(429);expect(response.headers.get('Retry-After')).toBe('60');expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});
it('documents every API capability with Bearer security and typed responses',()=>{
  expect(openapi.openapi).toBe('3.1.0');expect(openapi.security).toEqual([{ApiKey:[]}]);
  expect(openapi.paths['/posts'].post.responses).toHaveProperty('201');
  for(const route of Object.values(openapi.paths))for(const [method,operation] of Object.entries(route))if(method!=='parameters')expect(operation).toHaveProperty('responses.401');
});
