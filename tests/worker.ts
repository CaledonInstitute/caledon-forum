import { env } from 'cloudflare:workers';
import sql from '../migrations/0001_forum.sql';
import addressesSql from '../migrations/0002_public_post_addresses.sql';
import { createAuth } from '../src/lib/auth';
import { POST as forum } from '../src/pages/api/forum/[action]';
export default {async fetch(request:Request){
 if(new URL(request.url).pathname!=='/run')return new Response(null,{status:404});
 const nativeFetch=globalThis.fetch;let verifyUrl='';const passed:string[]=[];
 const check=(value:unknown,label:string)=>{if(!value)throw new Error(label);passed.push(label);};
 try{
  // This isolate is test-only. Production never contains this transport stub.
  globalThis.fetch=async(input:any,options?:RequestInit)=>{
   const url=String(input instanceof Request?input.url:input);
   if(url.startsWith('https://api.resend.com/')){const data=JSON.parse(String(options?.body));verifyUrl=data.text.match(/https?:\/\/\S+/)?.[0]||'';return Response.json({id:'mail-test'});}
   if(url.includes('challenges.cloudflare.com/turnstile/'))return Response.json({success:true,hostname:'localhost'});
   return nativeFetch(input,options);
  };
  const table=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user'").first();if(!table)await env.DB.exec(sql);
  const addresses=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='post_addresses'").first();if(!addresses)await env.DB.exec(addressesSql.replace(/^--.*$/gm,'').trim());
  await env.DB.batch(['notifications','post_links','likes','reports','moderation_actions','post_addresses','posts','memberships','session','account','verification','user','rate_limits','link_previews'].map(t=>env.DB.prepare(`DELETE FROM ${t}`)));
  const auth=createAuth();
  const call=(path:string,body:any,cookie='')=>auth.handler(new Request(`http://localhost:8789/api/auth/${path}`,{method:'POST',headers:{'Content-Type':'application/json',origin:'http://localhost:8789',cookie,'x-captcha-response':'test'},body:JSON.stringify(body)}));
  let response=await call('sign-up/email',{username:'researcher',name:'Researcher',email:'researcher@caledon.test',password:'A-real-test-password-123',callbackURL:'/verify'});
  const signup=await response.json() as any;check(response.ok,`Worker registration: ${response.status}`);check(!!verifyUrl,'Verification email dispatched');
  response=await auth.handler(new Request(verifyUrl,{headers:{origin:'http://localhost:8789'}}));check(response.status<400,'Email verification works');
  response=await call('sign-in/username',{username:'researcher',password:'wrong-password'});check(!response.ok,'Wrong password rejected');
  response=await call('sign-in/username',{username:'researcher',password:'A-real-test-password-123'});
  check(response.ok,'Worker username login');
  const cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');const session=await auth.api.getSession({headers:new Headers({cookie})});check(!!session,'Signed session read from D1');
  const user={...signup.user,username:'researcher',emailVerified:true,role:'user',suspended:false};
  const mutate=async(action:string,data:any)=>forum({params:{action},locals:{user},request:new Request(`http://localhost:8789/api/forum/${action}`,{method:'POST',headers:{'Content-Type':'application/json',origin:'http://localhost:8789'},body:JSON.stringify(data)})} as any);
  response=await mutate('publish',{body:'😀'.repeat(25000)});const post=await response.json() as any;check(response.ok,'25,000-character post in Workers');
  check(/^\/p\/[1-9][0-9]*$/.test(post.url),'Public post address is an integer');
  const id=post.id;response=await mutate('publish',{body:'x'.repeat(25000),parentId:id});check(response.ok,'25,000-character reply in Workers');
  response=await mutate('publish',{body:'x'.repeat(25001)});check(response.status===400,'Worker rejects oversized posts');
  response=await call('request-password-reset',{email:'researcher@caledon.test',redirectTo:'/reset-password'});check(response.ok,'Password reset email dispatched');
  const resetToken=new URL(verifyUrl).pathname.split('/').pop();
  response=await call('reset-password',{token:resetToken,newPassword:'A-new-test-password-456'});check(response.ok,'Password reset works');
  response=await call('reset-password',{token:resetToken,newPassword:'Another-test-password-789'});check(!response.ok,'Reset token cannot be reused');
  response=await call('sign-in/username',{username:'researcher',password:'A-new-test-password-456'});check(response.ok,'New password works');
  return Response.json({passed});
 }catch(error){return Response.json({passed,error:error instanceof Error?error.message:'Worker test failed'},{status:500});}
 finally{globalThis.fetch=nativeFetch;}
}};
