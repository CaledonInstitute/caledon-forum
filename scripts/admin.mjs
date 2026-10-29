import {spawnSync} from 'node:child_process';
const userId=process.argv[2];const remote=process.argv.includes('--remote');
if(!userId||!/^[A-Za-z0-9_-]{1,100}$/.test(userId)){console.error('Usage: node scripts/admin.mjs USER_ID [--remote]');process.exit(1);}
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','caledon-forum-db',remote?'--remote':'--local','--command',`UPDATE user SET role='admin' WHERE id='${userId}'; SELECT id,username,role FROM user WHERE id='${userId}';`],{stdio:'inherit',windowsHide:true});process.exitCode=result.status||0;
