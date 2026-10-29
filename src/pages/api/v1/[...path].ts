import type { APIRoute } from 'astro';
import { z } from 'zod';
import { authenticateKey } from '../../../lib/api-keys';
import { all, one, posts, publicPost, replyLocation } from '../../../lib/db';
import { PAGE_SIZE, pageNumber } from '../../../lib/content';
import { forumAction } from '../../../lib/forum-service';
import { forumError } from '../../../lib/forum-errors';
import { rateLimit } from '../../../lib/rate-limit';
import { readLimited } from '../../../lib/security';
import type { ForumPost } from '../../../lib/types';

async function serializePost(p: ForumPost) {
  const relation=await one<{rootId:number|null;parentId:number|null}>('SELECT r.id AS rootId,a.id AS parentId FROM posts p LEFT JOIN post_addresses r ON r.post_id=p.root_id LEFT JOIN post_addresses a ON a.post_id=p.parent_id WHERE p.id=?',p.id);
  return {id:p.publicId,rootId:relation?.rootId??null,parentId:relation?.parentId??null,body:p.deleted?'':p.body,createdAt:p.createdAt,updatedAt:p.updatedAt,deleted:!!p.deleted,locked:!!p.locked,author:{username:p.username,name:p.name,image:p.image,isCaledonMember:!!p.isCaledonMember},likes:p.likes,replies:p.replies,liked:!!p.liked,url:await replyLocation(p.id)};
}
async function profile(username: string) {
  const p=await one(`SELECT u.username,u.name,u.image,u.cover_image AS coverImage,u.bio,u.created_at AS createdAt,CASE WHEN m.state='active' AND m.checked_at>? AND EXISTS(SELECT 1 FROM account WHERE user_id=u.id AND provider_id='github') THEN 1 ELSE 0 END AS isCaledonMember FROM user u LEFT JOIN memberships m ON m.user_id=u.id WHERE u.username=? COLLATE NOCASE`,Date.now()-86400000,username);
  if (!p) throw Response.json({error:'Profile not found.'},{status:404});
  return {...p,isCaledonMember:!!p.isCaledonMember};
}
const jsonBody=async(request:Request) => {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw Response.json({error:'Use a JSON request.'},{status:415});
  const parsed=JSON.parse(new TextDecoder().decode(await readLimited(new Response(request.body),512000)));
  return z.record(z.string(),z.unknown()).parse(parsed);
};
export const ALL: APIRoute = async ctx => {
  let response: Response;
  try {
    const user=await authenticateKey(ctx.request);
    await rateLimit(`api:${user.id}`,60);
    const path=(ctx.params.path||'').split('/'), method=ctx.request.method, url=new URL(ctx.request.url), page=pageNumber(url);
    const list=async(where:string,args:unknown[],order?:string)=>{
      const result=await posts(where,args,user.id,order,page);
      return Response.json({items:await Promise.all(result.slice(0,PAGE_SIZE).map(serializePost)),page,hasMore:result.length>PAGE_SIZE});
    };
    const act=async(action:string,data:unknown)=>{
      await rateLimit(`forum:${user.id}:${action}`,action==='publish'?10:40);
      return forumAction(user,action,data);
    };
    const handle=async():Promise<Response>=>{
      if (path.length===1 && path[0]==='me') {
        if (method==='GET') return Response.json(user);
        if (method==='PATCH') {
          const input=z.object({name:z.string().trim().min(1).max(80).optional(),bio:z.string().max(300).optional(),image:z.string().max(2048).nullable().optional(),coverImage:z.string().max(2048).nullable().optional()}).strict().parse(await jsonBody(ctx.request));
          return act('profile',{name:user.name,bio:user.bio,...input});
        }
      }
      if (path[0]==='profiles' && path[1]) {
        if (path.length===2 && method==='GET') return Response.json(await profile(path[1]));
        if (path.length===3 && path[2]==='posts' && method==='GET') {
          await profile(path[1]);
          const tab=z.enum(['posts','replies']).parse(url.searchParams.get('tab')||'posts');
          return list(`u.username=? COLLATE NOCASE AND p.deleted=0 AND p.root_id IS ${tab==='replies'?'NOT ':''}NULL`,[path[1]]);
        }
      }
      if (path[0]==='posts') {
        if (path.length===1) {
          if (method==='GET') return list('p.root_id IS NULL AND (p.deleted=0 OR EXISTS(SELECT 1 FROM posts r WHERE r.root_id=p.id AND r.deleted=0))',[]);
          if (method==='POST') {
            const input=z.object({body:z.string(),parentId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional()}).strict().parse(await jsonBody(ctx.request));
            const parent=input.parentId?await publicPost(String(input.parentId),user.id):null;
            if (input.parentId && (!parent || parent.deleted)) throw Response.json({error:'Parent post not found.'},{status:404});
            const result=await act('publish',{body:input.body,parentId:parent?.id});
            if (!result.ok) return result;
            const created=await result.json() as {id:string;url:string};
            const address=await one<{id:number}>('SELECT id FROM post_addresses WHERE post_id=?',created.id);
            return Response.json({id:address!.id,url:created.url},{status:201});
          }
        }
        if (path[1] && path.length<=3) {
          const p=await publicPost(path[1],user.id);
          if (!p) throw Response.json({error:'Post not found.'},{status:404});
          if (path.length===2 && method==='GET') return Response.json(await serializePost(p));
          if (path.length===3 && path[2]==='replies' && method==='GET') return list('p.root_id=?',[p.rootId||p.id],'p.created_at ASC,p.id ASC');
          if (path.length===2 && method==='PATCH') {
            const input=z.object({body:z.string()}).strict().parse(await jsonBody(ctx.request));
            return act('edit',{id:p.id,...input});
          }
          if (path.length===2 && method==='DELETE') return act('delete',{id:p.id});
          if (path.length===3 && path[2]==='like' && ['PUT','DELETE'].includes(method)) return act('like',{id:p.id,liked:method==='PUT'});
          if (path.length===3 && path[2]==='reports' && method==='POST') {
            const input=z.object({reason:z.string().trim().min(5).max(1000)}).strict().parse(await jsonBody(ctx.request));
            return act('report',{id:p.id,...input});
          }
        }
      }
      if (path.length===1 && path[0]==='notifications' && method==='GET') {
        const rows=await all<{id:string;kind:string;postId:number;post_id:string;createdAt:number;readAt:number|null;actorUsername:string}>(`SELECT n.id,n.kind,a.id AS postId,n.post_id,n.created_at AS createdAt,n.read_at AS readAt,u.username AS actorUsername FROM notifications n JOIN posts p ON p.id=n.post_id JOIN post_addresses a ON a.post_id=p.id JOIN user u ON u.id=n.actor_id WHERE n.recipient_id=? AND p.deleted=0 ORDER BY n.created_at DESC,n.id DESC LIMIT ? OFFSET ?`,user.id,PAGE_SIZE+1,(page-1)*PAGE_SIZE);
        return Response.json({items:await Promise.all(rows.slice(0,PAGE_SIZE).map(async({post_id,...n})=>({...n,url:await replyLocation(post_id)}))),page,hasMore:rows.length>PAGE_SIZE});
      }
      if (path.length===2 && path[0]==='notifications' && path[1]==='read' && method==='POST') return act('read',{});
      return Response.json({error:'Endpoint or method not found.'},{status:404});
    };
    response=await handle();
  } catch(error) { response=forumError(error); }
  response.headers.set('Cache-Control','private, no-store');
  return response;
};
