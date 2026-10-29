async function action(name:string,data:unknown){const r=await fetch(`/api/forum/${name}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await r.json() as any;if(!r.ok)throw new Error(result.error||'Please try again.');return result;}
document.addEventListener('click',async event=>{
 const button=(event.target as Element).closest<HTMLElement>('[data-like],[data-copy],[data-delete],[data-report],[data-video],[data-moderate],[data-read]');if(!button)return;
 const status=button.closest('article')?.querySelector<HTMLElement>('[data-post-status]');if(status)status.textContent='';
 try{
  if(button.dataset.video){const iframe=document.createElement('iframe');iframe.src=`https://www.youtube-nocookie.com/embed/${button.dataset.video}`;iframe.title=button.getAttribute('aria-label')||'YouTube video';iframe.className='video-frame';iframe.allow='encrypted-media; picture-in-picture; fullscreen';iframe.allowFullscreen=true;iframe.referrerPolicy='strict-origin-when-cross-origin';button.replaceWith(iframe);return;}
  if(button.dataset.copy){await navigator.clipboard.writeText(new URL(button.dataset.copy,location.origin).href);if(status)status.textContent='Link copied.';return;}
  if(button.dataset.like){if(button.dataset.signedIn!=='true'){location.assign('/login');return;}button.setAttribute('disabled','');const r=await action('like',{id:button.dataset.like,liked:button.getAttribute('aria-pressed')!=='true'});button.setAttribute('aria-pressed',String(r.liked));const span=button.querySelector('span');if(span)span.textContent=String(r.likes||'Like');const svg=button.querySelector('svg');svg?.setAttribute('fill',r.liked?'currentColor':'none');}
  if(button.dataset.delete&&confirm('Delete this post? Replies will remain visible.')){await action('delete',{id:button.dataset.delete});location.reload();}
  if(button.dataset.report){const reason=prompt('Why are you reporting this post? (5–1,000 characters)');if(reason){await action('report',{id:button.dataset.report,reason});if(status)status.textContent='Report sent. An administrator will review it.';}}
  if(button.dataset.moderate&&confirm(`${button.dataset.operation} this item?`)){await action('moderate',{id:button.dataset.moderate,operation:button.dataset.operation});location.reload();}
  if(button.hasAttribute('data-read')){await action('read',{});location.reload();}
 }catch(e){if(status)status.textContent=(e as Error).message;else alert((e as Error).message);}finally{button.removeAttribute('disabled');}
});
document.addEventListener('click',event=>{
 if(event.defaultPrevented||event.button!==0||!(event.target instanceof Element))return;
 if(event.target.closest('a,button,input,textarea,select,label,details,summary,iframe,video,audio,[contenteditable],[role="button"],[role="link"]'))return;
 if(window.getSelection()?.toString())return;
 const post=event.target.closest<HTMLElement>('[data-post-url]');
 const url=post?.dataset.postUrl;if(!url)return;
 if(event.ctrlKey||event.metaKey||event.shiftKey)window.open(url,'_blank','noopener');
 else location.assign(url);
});
document.addEventListener('error',event=>{const target=event.target;if(target instanceof HTMLImageElement&&target.src.includes('/api/media/')){const note=document.createElement('span');note.className='notice';note.textContent='Image unavailable. The original link is still available.';target.replaceWith(note);}},true);
