export default function UserAvatar({name='',username,image,large=false}:{name?:string;username?:string|null;image?:string|null;large?:boolean}) {
  return <span className={`avatar${large?' large':''}`} aria-hidden="true">
    {name.trim().slice(0,1).toUpperCase() || 'C'}
    {image && username && <img key={`${username}:${image}`} ref={el=>{if(el?.complete && el.naturalWidth)el.style.opacity='1';}} src={`/api/avatar/${encodeURIComponent(username)}`} alt="" width={large?76:42} height={large?76:42} loading="lazy" referrerPolicy="no-referrer" style={{opacity:0}} onLoad={e=>{e.currentTarget.style.opacity='1';}} onError={e=>{e.currentTarget.style.opacity='0';}}/>}
  </span>;
}
