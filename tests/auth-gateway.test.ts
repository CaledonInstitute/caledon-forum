import {beforeEach,afterEach,it,expect} from 'vitest';
import {env,resetDatabase} from './runtime';
import {ALL} from '../src/pages/api/auth/[...all]';
beforeEach(()=>{resetDatabase();env.AUTH_ENABLED='true';env.TURNSTILE_SECRET_KEY='test-only';});
afterEach(()=>{env.AUTH_ENABLED='false';delete env.TURNSTILE_SECRET_KEY;});
async function request(path:string){return ALL({params:{all:path},locals:{user:null},request:new Request(`http://localhost:4321/api/auth/${path}`,{method:'POST',headers:{origin:'http://localhost:4321','Content-Type':'application/json'},body:'{}'})} as any);}
for(const path of ['get-access-token','get-access-token/','refresh-token','sign-in/email','update-user','change-email'])it(`blocks browser capability ${path}`,async()=>expect((await request(path)).status).toBe(404));
it('fails closed when authentication is disabled',async()=>{env.AUTH_ENABLED='false';expect((await request('sign-in/username')).status).toBe(503);});
