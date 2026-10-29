import {spawn} from 'node:child_process';
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config','tests/wrangler.jsonc','--port','8789','--log-level','error'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{output+=d;});
let success=false;
try{
 let ready=false;
 for(let attempt=0;attempt<40;attempt++){try{await fetch('http://localhost:8789/');ready=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}
 if(!ready)throw new Error(`Worker did not start. ${output}`);
 const response=await fetch('http://localhost:8789/run');const result=await response.json();
 for(const test of result.passed||[])console.log(`PASS ${test}`);
 if(!response.ok)throw new Error(result.error||output);
 success=true;
}catch(error){console.error(error.message);process.exitCode=1;}
finally{
 if(process.platform==='win32')await new Promise(resolve=>{const stop=spawn('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});stop.on('exit',resolve);});else child.kill('SIGTERM');
 if(success)console.log('Worker/D1 authentication and posting regression checks passed.');
}
