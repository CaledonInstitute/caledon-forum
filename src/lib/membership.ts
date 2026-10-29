import { env } from 'cloudflare:workers';
import { symmetricDecrypt } from 'better-auth/crypto';
import { one, run } from './db';
const inflight = new Map<string,Promise<boolean>>();
export async function refreshMembership(userId: string, force = false): Promise<boolean> {
  if (inflight.has(userId)) return inflight.get(userId)!;
  const task = refresh(userId,force).finally(()=>inflight.delete(userId)); inflight.set(userId,task); return task;
}
async function refresh(userId: string, force: boolean) {
  const account = await one<{account_id:string;access_token:string|null}>('SELECT account_id,access_token FROM account WHERE user_id=? AND provider_id=?',userId,'github');
  if (!account) { await run('DELETE FROM memberships WHERE user_id=?',userId); return false; }
  const previous = await one<{state:string;checked_at:number;retry_after:number}>('SELECT state,checked_at,retry_after FROM memberships WHERE user_id=?',userId);
  if (!force && previous && (previous.checked_at>Date.now()-86400000 || previous.retry_after>Date.now())) return previous.state==='active' && previous.checked_at>Date.now()-86400000;
  try {
    if (!account.access_token || !env.BETTER_AUTH_SECRET) throw new Error('Reconnect GitHub to verify membership.');
    const token = await symmetricDecrypt({key:env.BETTER_AUTH_SECRET,data:account.access_token});
    const response = await fetch('https://api.github.com/user/memberships/orgs/CaledonInstitute',{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','User-Agent':'CaledonForum'},signal:AbortSignal.timeout(5000)});
    if (!response.ok && response.status!==404) throw new Error('Membership could not be checked.');
    const info = response.ok ? await response.json() as {state:string} : {state:'none'};
    const state = info.state==='active' ? 'active' : 'none';
    await run('INSERT INTO memberships(user_id,github_id,state,checked_at,retry_after) VALUES(?,?,?,?,0) ON CONFLICT(user_id) DO UPDATE SET github_id=excluded.github_id,state=excluded.state,checked_at=excluded.checked_at,retry_after=0',userId,account.account_id,state,Date.now());
    return state==='active';
  } catch {
    await run('INSERT INTO memberships(user_id,github_id,state,checked_at,retry_after) VALUES(?,?,?,0,?) ON CONFLICT(user_id) DO UPDATE SET retry_after=excluded.retry_after',userId,account.account_id,'unknown',Date.now()+300000);
    if (force) throw new Error('Unable to verify membership. Check GitHub access and try again.'); return false;
  }
}
