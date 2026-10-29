import {beforeEach,it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {resetDatabase,seedUser,execute,row} from './runtime';
import {isValidUsername,isReservedUsername} from '../src/lib/usernames';
import {publicPost,replyLocation} from '../src/lib/db';
import {POST} from '../src/pages/api/forum/[action]';
beforeEach(resetDatabase);
it('reserves system usernames case-insensitively',()=>{
 for(const name of ['settings','ADMIN','search','register','api','thread','constructor','__proto__'])expect(isReservedUsername(name)).toBe(true);
 expect(isValidUsername('andika')).toBe(true);expect(isValidUsername('qa_caledon')).toBe(true);expect(isValidUsername('AdMiN')).toBe(false);
});
it('rejects reserved names in GitHub onboarding',async()=>{
 const user=seedUser();execute('UPDATE user SET username=NULL WHERE id=?',user.id);user.username=null as any;
 const response=await POST({params:{action:'onboarding'},locals:{user},request:new Request('http://localhost:4321/api/forum/onboarding',{method:'POST',headers:{origin:'http://localhost:4321','Content-Type':'application/json'},body:JSON.stringify({username:'AdMiN'})})} as any);
 expect(response.status).toBe(400);expect(row('SELECT username FROM user WHERE id=?',user.id).username).toBeNull();
});
it('automatically allocates stable public integer addresses and rejects UUID URLs',async()=>{
 const user=seedUser();for(const id of ['first-uuid','second-uuid'])execute('INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES(?,?,?,?,?)',id,user.id,'hello',1,1);
 const first=row('SELECT id FROM post_addresses WHERE post_id=?','first-uuid').id;
 expect(await replyLocation('first-uuid')).toBe(`/p/${first}`);expect((await publicPost(String(first)))?.id).toBe('first-uuid');expect(await publicPost('first-uuid')).toBeNull();
 execute('DELETE FROM posts WHERE id=?','first-uuid');execute('INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES(?,?,?,?,?)','third-uuid',user.id,'hello',1,1);
 expect(row('SELECT id FROM post_addresses WHERE post_id=?','third-uuid').id).toBeGreaterThan(first);
 expect(await publicPost('0')).toBeNull();expect(await publicPost('9007199254740992')).toBeNull();
});
it('backfills existing posts without changing reply and like relations',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec(readFileSync(new URL('../migrations/0001_forum.sql',import.meta.url),'utf8'));
 db.exec("INSERT INTO user(id,name,email,created_at,updated_at) VALUES('u','User','u@test.com',1,1); INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES('root','u','Root',1,1); INSERT INTO posts(id,author_id,root_id,parent_id,body,created_at,updated_at) VALUES('reply','u','root','root','Reply',2,2); INSERT INTO likes(post_id,user_id,created_at) VALUES('reply','u',2);");
 db.exec(readFileSync(new URL('../migrations/0002_public_post_addresses.sql',import.meta.url),'utf8'));
 expect(db.prepare('SELECT COUNT(*) n FROM post_addresses').get()).toMatchObject({n:2});expect(db.prepare("SELECT root_id,parent_id FROM posts WHERE id='reply'").get()).toMatchObject({root_id:'root',parent_id:'root'});expect(db.prepare('SELECT post_id FROM likes').get()).toMatchObject({post_id:'reply'});
 }finally{db.close();}
});
