import {readFile,mkdir,writeFile} from 'node:fs/promises';
// Satori 0.63.2 bundles HarfBuzz's browser bootstrap. Adapt its documented
// instantiateWasm hook to a statically compiled Worker module (no runtime eval).
const source=await readFile('node_modules/satori/dist/standalone.js','utf8');
const call='cf().then(e=>{A(af(e))},g)';
if(!source.includes(call))throw new Error('Satori bootstrap changed. Review the Worker adapter before upgrading.');
if(!source.includes('VA=new WebAssembly.Module(kA)'))throw new Error('HarfBuzz callback adapter changed.');
const patched=source.replace(/\/\/# sourceMappingURL=.*$/m,'').replaceAll('self.location.href',"'https://caledon-forum.invalid/'").replace(call,'cf({instantiateWasm(imports,receive){const instance=new WebAssembly.Instance(__caledonHarfbuzz,imports);queueMicrotask(()=>receive(instance,__caledonHarfbuzz));return instance.exports;}}).then(e=>{A(af(e))},g)').replace('VA=new WebAssembly.Module(kA)','VA=BA==="vi"?__caledonCallbackVi:(()=>{throw new Error("Unsupported HarfBuzz callback signature")})()');
await mkdir('.astro',{recursive:true});
// Static trampoline for HarfBuzz's free(void*) callback. Workers prohibit
// Emscripten's usual runtime compilation of this import/export bridge.
async function writeChanged(path,contents){const bytes=Buffer.from(contents);try{if((await readFile(path)).equals(bytes))return;}catch{}await writeFile(path,bytes);}
await writeChanged('.astro/callback-vi.wasm',Uint8Array.of(0,97,115,109,1,0,0,0,1,5,1,96,1,127,0,2,7,1,1,101,1,102,0,0,7,5,1,1,102,0,0));
await writeChanged('.astro/satori-worker.mjs',`// Generated from satori (MPL-2.0); source and licenses remain in node_modules.\nimport __caledonHarfbuzz from 'harfbuzzjs/hb.wasm?module';\nimport __caledonCallbackVi from './callback-vi.wasm?module';\n${patched}`);
console.log('Prepared Satori for statically compiled Worker WASM.');
