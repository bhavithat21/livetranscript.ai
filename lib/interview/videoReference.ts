export const REFERENCE_VIDEO='https://www.youtube.com/watch?v=ZE_YEn-okfk'
export function youtubeReference(value:string):{id:string;url:string;embed:string} {
  const url=new URL(value)
  if(url.protocol!=='https:'||url.username||url.password||url.port) throw new Error('Use a public HTTPS YouTube watch or share link.')
  const host=url.hostname.toLowerCase(),parts=url.pathname.split('/').filter(Boolean)
  let id:string|null=null
  if(host==='youtu.be'&&parts.length===1) id=parts[0]
  if(['youtube.com','www.youtube.com','m.youtube.com'].includes(host)) {
    if(url.pathname==='/watch') id=url.searchParams.get('v')
    else if(parts.length===2&&['embed','shorts'].includes(parts[0])) id=parts[1]
  }
  if(!id||!/^[-_a-zA-Z0-9]{11}$/.test(id)) throw new Error('Enter a valid YouTube video link, not a playlist or another website.')
  return {id,url:`https://www.youtube.com/watch?v=${id}`,embed:`https://www.youtube-nocookie.com/embed/${id}?autoplay=0`}
}
