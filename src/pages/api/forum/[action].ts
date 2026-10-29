import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { db, one, run, replyLocation } from '../../../lib/db';
import { validateBody } from '../../../lib/content';
import { markdown } from '../../../lib/markdown';
import { inspectBody, attachPreviews } from '../../../lib/previews';
import { rateLimit } from '../../../lib/rate-limit';
import { refreshMembership } from '../../../lib/membership';
import { createAuth } from '../../../lib/auth';
import { readLimited } from '../../../lib/security';
import { isValidUsername } from '../../../lib/usernames';
import { avatarUrl, fetchAvatar } from '../../../lib/avatar';
const id = z.string().min(1).max(100);
export const POST: APIRoute = async ctx => {
  try {
    if (ctx.request.headers.get('origin')!==new URL(env.SITE_URL).origin) return Response.json({error:'Refresh this page and try again.'},{status:403});
    if (!ctx.request.headers.get('content-type')?.startsWith('application/json')) return Response.json({error:'Use a JSON request.'},{status:415});
    const user = ctx.locals.user;
    if (!user) return Response.json({error:'Sign in to continue.'},{status:401});
    if (user.suspended) return Response.json({error:'Your account is suspended.'},{status:403});
    const data = JSON.parse(new TextDecoder().decode(await readLimited(new Response(ctx.request.body),512000)));
    const action = ctx.params.action!;
    await rateLimit(`forum:${user.id}:${action}`,action==='preview'?15:action==='publish'?10:40);
    if (action==='membership') return Response.json({isCaledonMember:await refreshMembership(user.id,true)});
    if (action==='profile') {
      const input = z.object({name:z.string().trim().min(1).max(80),bio:z.string().max(300),image:z.string().trim().max(2048).nullable().optional()}).parse(data);
      if (input.image !== undefined) {
        const image = input.image ? avatarUrl(input.image) : null;
        if (image) await fetchAvatar(image);
        await run('UPDATE user SET name=?,bio=?,image=?,updated_at=? WHERE id=?',input.name,input.bio,image,Date.now(),user.id);
      } else await run('UPDATE user SET name=?,bio=?,updated_at=? WHERE id=?',input.name,input.bio,Date.now(),user.id);
      return Response.json({ok:true});
    }
    if (action==='onboarding') {
      const input = z.object({username:z.string().refine(isValidUsername,'Choose 1–30 letters, numbers, or underscores. Do not start with a number. System names are reserved.')}).parse(data);
      if (user.username) throw new Error('Your username is already set.');
      try { await run('UPDATE user SET username=?,display_username=?,updated_at=? WHERE id=? AND username IS NULL',input.username.toLowerCase(),input.username,Date.now(),user.id); }
      catch { throw new Error('That username is already taken. Choose another.'); }
      return Response.json({ok:true});
    }
    if (action==='email') {
      const input = z.object({email:z.email(),token:z.string().min(1)}).parse(data);
      return await createAuth().handler(new Request(new URL('/api/auth/change-email',env.SITE_URL),{method:'POST',headers:{'Content-Type':'application/json','origin':env.SITE_URL,'cookie':ctx.request.headers.get('cookie') || '','x-captcha-response':input.token},body:JSON.stringify({newEmail:input.email,callbackURL:'/verify'})}));
    }
    if (action==='read') { await run('UPDATE notifications SET read_at=? WHERE recipient_id=? AND read_at IS NULL',Date.now(),user.id); return Response.json({ok:true}); }
    if (!user.username) return Response.json({error:'Choose your username first.'},{status:403});
    if (!user.emailVerified) return Response.json({error:'Verify your email before interacting.'},{status:403});
    if (action==='preview') {
      const body = validateBody(data.body); const links = await inspectBody(body);
      return Response.json({html:await markdown(body,links),links});
    }
    if (action==='publish') {
      const body = validateBody(data.body); const parentId = data.parentId ? id.parse(data.parentId) : null;
      const parent = parentId ? await one<{id:string;root_id:string|null;author_id:string;deleted:number}>('SELECT id,root_id,author_id,deleted FROM posts WHERE id=?',parentId) : null;
      if (parentId && (!parent || parent.deleted)) throw new Error('This post is no longer available for replies.');
      const rootId = parent ? parent.root_id || parent.id : null;
      const postId = crypto.randomUUID(); const now = Date.now(); const links = await inspectBody(body);
      const statement = rootId
        ? db().prepare('INSERT INTO posts(id,author_id,root_id,parent_id,body,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM posts WHERE id=? AND locked=0) AND EXISTS(SELECT 1 FROM posts WHERE id=? AND deleted=0)').bind(postId,user.id,rootId,parentId,body,now,now,rootId,parentId)
        : db().prepare('INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES(?,?,?,?,?)').bind(postId,user.id,body,now,now);
      const statements=[statement,...links.map((p,i)=>db().prepare('INSERT OR IGNORE INTO post_links(post_id,preview_id,position) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM posts WHERE id=?)').bind(postId,p.id,i,postId))];
      if (parent && parent.author_id!==user.id) statements.push(db().prepare('INSERT OR IGNORE INTO notifications(id,recipient_id,actor_id,post_id,kind,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM posts WHERE id=?)').bind(crypto.randomUUID(),parent.author_id,user.id,postId,'reply',now,postId));
      const results=await db().batch(statements);if(!results[0].meta.changes)throw new Error('This thread is locked.');
      return Response.json({ok:true,id:postId,url:await replyLocation(postId)});
    }
    if (action==='edit' || action==='delete') {
      const postId = id.parse(data.id);
      const own = await one<{deleted:number}>('SELECT deleted FROM posts WHERE id=? AND author_id=?',postId,user.id);
      if (!own || own.deleted) return Response.json({error:'You cannot change this post.'},{status:403});
      if (action==='delete') {
        await db().batch([db().prepare("UPDATE posts SET body='',deleted=1,updated_at=? WHERE id=? AND author_id=?").bind(Date.now(),postId,user.id),db().prepare('DELETE FROM post_links WHERE post_id=?').bind(postId)]);
      } else {
        const body = validateBody(data.body); const links = await inspectBody(body);
        await run('UPDATE posts SET body=?,updated_at=? WHERE id=? AND author_id=? AND deleted=0',body,Date.now(),postId,user.id); await attachPreviews(postId,links);
      }
      return Response.json({ok:true,url:await replyLocation(postId)});
    }
    if (action==='like') {
      const input = z.object({id,liked:z.boolean()}).parse(data);
      const target = await one<{author_id:string;deleted:number}>('SELECT author_id,deleted FROM posts WHERE id=?',input.id);
      if (!target || target.deleted) throw new Error('This post is no longer available.');
      if (input.liked) {
        const statements = [db().prepare('INSERT OR IGNORE INTO likes(post_id,user_id,created_at) VALUES(?,?,?)').bind(input.id,user.id,Date.now())];
        if (target.author_id!==user.id) statements.push(db().prepare("INSERT OR IGNORE INTO notifications(id,recipient_id,actor_id,post_id,kind,created_at) VALUES(?,?,?,?,'like',?)").bind(crypto.randomUUID(),target.author_id,user.id,input.id,Date.now()));
        await db().batch(statements);
      } else await db().batch([db().prepare('DELETE FROM likes WHERE post_id=? AND user_id=?').bind(input.id,user.id),db().prepare("DELETE FROM notifications WHERE post_id=? AND actor_id=? AND kind='like'").bind(input.id,user.id)]);
      return Response.json({ok:true,liked:input.liked,...await one('SELECT COUNT(*) AS likes FROM likes WHERE post_id=?',input.id)});
    }
    if (action==='report') {
      const input = z.object({id,reason:z.string().trim().min(5).max(1000)}).parse(data);
      await run('INSERT OR IGNORE INTO reports(id,post_id,reporter_id,reason,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM posts WHERE id=? AND deleted=0)',crypto.randomUUID(),input.id,user.id,input.reason,Date.now(),input.id); return Response.json({ok:true});
    }
    if (action==='moderate') {
      if (user.role!=='admin') return Response.json({error:'Administrator access required.'},{status:403});
      const input = z.object({id,operation:z.enum(['delete','lock','unlock','suspend','restore','resolve'])}).parse(data);
      if (input.operation==='suspend' && input.id===user.id) throw new Error('You cannot suspend your own account.');
      const statements = [];
      if (input.operation==='delete') statements.push(db().prepare("UPDATE posts SET body='',deleted=1,updated_at=? WHERE id=?").bind(Date.now(),input.id),db().prepare('DELETE FROM post_links WHERE post_id=?').bind(input.id));
      if (input.operation==='lock' || input.operation==='unlock') statements.push(db().prepare('UPDATE posts SET locked=? WHERE id=? AND root_id IS NULL').bind(input.operation==='lock'?1:0,input.id));
      if (input.operation==='suspend' || input.operation==='restore') statements.push(db().prepare('UPDATE user SET suspended=? WHERE id=?').bind(input.operation==='suspend'?1:0,input.id));
      if (input.operation==='resolve') statements.push(db().prepare("UPDATE reports SET status='resolved' WHERE id=?").bind(input.id));
      statements.push(db().prepare('INSERT INTO moderation_actions(id,admin_id,action,target_id,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),user.id,input.operation,input.id,Date.now()));
      await db().batch(statements); return Response.json({ok:true});
    }
    return Response.json({error:'Action not found.'},{status:404});
  } catch(error) {
    if (error instanceof Response) return error;
    if (error instanceof z.ZodError) return Response.json({error:error.issues[0]?.message || 'Check your input.'},{status:400});
    if (error instanceof SyntaxError) return Response.json({error:'Invalid request.'},{status:400});
    const message = error instanceof Error ? error.message : '';
    if (/D1_|SQLITE|constraint|database|SQL/i.test(message)) { console.error('Forum database operation failed.'); return Response.json({error:'Unable to save your changes. Please try again.'},{status:500}); }
    return Response.json({error:message || 'Unable to complete this action.'},{status:400});
  }
};
