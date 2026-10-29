import { env } from 'cloudflare:workers';
import sql from '../migrations/0001_forum.sql';
import addressesSql from '../migrations/0002_public_post_addresses.sql';
import coverSql from '../migrations/0003_profile_cover.sql';
import keysSql from '../migrations/0004_api_keys.sql';
import { createAuth } from '../src/lib/auth';
import { POST as forum } from '../src/pages/api/forum/[action]';
import { issueKey } from '../src/lib/api-keys';
import { ALL as api } from '../src/pages/api/v1/[...path]';
import { ALL as authGateway } from '../src/pages/api/auth/[...all]';
export default {async fetch(request:Request){
 if(new URL(request.url).pathname!=='/run')return new Response(null,{status:404});
 const nativeFetch=globalThis.fetch;let verifyUrl='';const passed:string[]=[];
 const check=(value:unknown,label:string)=>{if(!value)throw new Error(label);passed.push(label);};
 try{
  const signingKeys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk={...await crypto.subtle.exportKey('jwk',signingKeys.publicKey),kid:'test-google-key',alg:'RS256',use:'sig'};
  const base64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const encode=(value:unknown)=>base64(new TextEncoder().encode(JSON.stringify(value)));
  let googleJwt='';
  // This isolate is test-only. Production never contains this transport stub.
  globalThis.fetch=async(input:any,options?:RequestInit)=>{
   const url=String(input instanceof Request?input.url:input);
   if(url.startsWith('https://api.resend.com/')){const data=JSON.parse(String(options?.body));verifyUrl=data.text.match(/https?:\/\/\S+/)?.[0]||'';return Response.json({id:'mail-test'});}
   if(url.includes('challenges.cloudflare.com/turnstile/'))return Response.json({success:true,hostname:'localhost'});
   if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'test-google-access',id_token:googleJwt,token_type:'Bearer',expires_in:3600,scope:'openid email profile'});
   if(url==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});
   return nativeFetch(input,options);
  };
  const table=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user'").first();if(!table)await env.DB.exec(sql);
  const addresses=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='post_addresses'").first();if(!addresses)await env.DB.exec(addressesSql.replace(/^--.*$/gm,'').trim());
  const columns=await env.DB.prepare('PRAGMA table_info(user)').all<{name:string}>();if(!columns.results.some(c=>c.name==='cover_image'))await env.DB.exec(coverSql.replace(/^--.*$/gm,'').trim());
  const keysTable=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'").first();if(!keysTable)await env.DB.exec(keysSql.replace(/\s+/g,' ').trim());
  await env.DB.batch(['api_keys','notifications','post_links','likes','reports','moderation_actions','post_addresses','posts','memberships','session','account','verification','user','rate_limits','link_previews'].map(t=>env.DB.prepare(`DELETE FROM ${t}`)));
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
  response=await call('sign-up/email',{username:'z',name:'Short username',email:'short@caledon.test',password:'A-real-test-password-123',callbackURL:'/verify'});
  check(response.ok,'Registration accepts a one-character username');
  response=await call('sign-up/email',{username:'1z',name:'Invalid username',email:'invalid@caledon.test',password:'A-real-test-password-123',callbackURL:'/verify'});
  check(!response.ok,'Registration rejects usernames starting with a number');
  // Exercise Google's real OAuth state, signed ID token validation, and D1 linking
  // with test-only token/JWKS transports. No production provider calls are made.
  const oauth=async(email:string,subject:string,linkCookie='',invalidState=false)=>{
    const initiated=await call(linkCookie?'link-social':'sign-in/social',{provider:'google',callbackURL:'/onboarding',errorCallbackURL:'/login'},linkCookie);
    check(initiated.ok,'Google OAuth initiation');
    const authorization=new URL((await initiated.json() as any).url);
    check(authorization.searchParams.get('redirect_uri')==='http://localhost:8789/api/auth/callback/google','Google callback URI');
    const now=Math.floor(Date.now()/1000);
    const payload={iss:'https://accounts.google.com',aud:'test-google',sub:subject,email,email_verified:true,name:'Google Test',iat:now,exp:now+3600,...(authorization.searchParams.get('nonce')?{nonce:authorization.searchParams.get('nonce')}:{})};
    const unsigned=`${encode({alg:'RS256',kid:'test-google-key',typ:'JWT'})}.${encode(payload)}`;
    googleJwt=`${unsigned}.${base64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',signingKeys.privateKey,new TextEncoder().encode(unsigned))))}`;
    const stateCookie=initiated.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
    return auth.handler(new Request(`http://localhost:8789/api/auth/callback/google?code=test-code&state=${encodeURIComponent(invalidState?'invalid-test-state':authorization.searchParams.get('state')!)}`,{headers:{origin:'http://localhost:8789',cookie:[linkCookie,stateCookie].filter(Boolean).join('; ')}}));
  };
  response=await oauth('google-new@caledon.test','new-google-subject');
  check(response.status===302 && response.headers.get('location')?.endsWith('/onboarding'),'Google new-user onboarding redirect');
  const googleCookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const googleSession=await auth.api.getSession({headers:new Headers({cookie:googleCookie})});
  check(!!googleSession && googleSession.user.emailVerified && !googleSession.user.username,'Verified Google user awaits username');
  response=await oauth('forged@caledon.test','forged-google-subject','',true);
  check(response.headers.get('location')?.includes('error='),'Google rejects invalid OAuth state');
  check(!await env.DB.prepare("SELECT id FROM user WHERE email='forged@caledon.test'").first(),'Invalid OAuth state creates no account');
  response=await oauth('researcher@caledon.test','existing-google-subject');
  check(response.headers.get('location')?.includes('account_not_linked'),'Google does not implicitly merge an existing email');
  // Password reset revoked the earlier browser cookie; use a fresh session for linking.
  response=await call('sign-in/username',{username:'researcher',password:'A-new-test-password-456'});
  const existingCookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  response=await oauth('researcher@caledon.test','existing-google-subject',existingCookie);
  check(response.status===302 && !response.headers.get('location')?.includes('error='),'Explicit Google linking succeeds');
  const linked=await env.DB.prepare("SELECT user_id FROM account WHERE provider_id='google' AND account_id='existing-google-subject'").first<{user_id:string}>();
  check(linked?.user_id===user.id,'Google links to the authenticated existing user');
  const unlink=async(viewer:any,providerId:string)=>authGateway({params:{all:'unlink-account'},locals:{user:viewer},request:new Request('http://localhost:8789/api/auth/unlink-account',{method:'POST',headers:{origin:'http://localhost:8789','Content-Type':'application/json'},body:JSON.stringify({providerId})})} as any);
  check((await unlink(user,'google')).ok,'Worker/D1 explicitly disconnects Google');
  check((await unlink({...user,id:googleSession!.user.id},'google')).status===400,'Worker/D1 protects the last social login');
  const key=await issueKey(user.id);
  const apiCall=(token:string)=>api({params:{path:'me'},locals:{user:null},request:new Request('http://localhost:8789/api/v1/me',{headers:{Authorization:`Bearer ${token}`}})} as any);
  response=await apiCall(key.key);check(response.ok,'Worker/D1 Bearer key authentication');
  const replacement=await issueKey(user.id,true);
  check((await apiCall(key.key)).status===401,'Worker rejects rotated key');
  check((await apiCall(replacement.key)).ok,'Worker accepts regenerated key');
  return Response.json({passed});
 }catch(error){return Response.json({passed,error:error instanceof Error?error.message:'Worker test failed'},{status:500});}
 finally{globalThis.fetch=nativeFetch;}
}};
