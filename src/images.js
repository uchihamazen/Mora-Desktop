export function stitchImageParts(text,streaming=false) {
  text=String(text || '');const parts=[];let cursor=0;
  const pattern=/!?\[([^\]\n]*)\]\((https:\/\/[^\s()<>"`]+)\)|\(?<?(https:\/\/[^\s()<>"`\]]+)>?\)?/g;
  for(const match of text.matchAll(pattern)) {
    const raw=match[2] || match[3],candidate=raw.replace(/[.,;!]+$/,'');let url;
    try{url=new URL(candidate);}catch{continue;}
    if(url.protocol!=='https:' || url.hostname!=='lh3.googleusercontent.com' || url.port || url.username || url.password || !/^\/aida(?:-public)?\/[^/]+/.test(url.pathname))continue;
    if(streaming && match.index+match[0].length===text.length && !/[)>]$/.test(match[0]))continue;
    if(match.index>cursor)parts.push({type:'text',text:text.slice(cursor,match.index)});
    parts.push({type:'image',url:url.href,alt:match[1] || 'Stitch design'});
    if(candidate!==raw)parts.push({type:'text',text:raw.slice(candidate.length)});
    cursor=match.index+match[0].length;
  }
  if(cursor<text.length)parts.push({type:'text',text:text.slice(cursor)});
  return parts;
}

export function validateImages(images = []) {
  if (!Array.isArray(images) || images.length > 20) throw new Error('Attach at most 20 images.');
  let total = 0;
  return images.map(image => {
    const { mediaType, base64Data } = image || {};
    if (typeof base64Data !== 'string' || !base64Data.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data) || base64Data.length % 4 !== 0) throw new Error('Invalid base64 image.');
    if (base64Data.length > Math.ceil(10 * 1024 * 1024 / 3) * 4) throw new Error('Each image must be 10 MB or smaller.');
    const bytes = Buffer.from(base64Data, 'base64');
    if (bytes.toString('base64') !== base64Data) throw new Error('Invalid base64 image.');
    if (bytes.length > 10 * 1024 * 1024) throw new Error('Each image must be 10 MB or smaller.');
    total += bytes.length;
    if (total > 20 * 1024 * 1024) throw new Error('Images must total 20 MB or less per message.');
    const valid = mediaType === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      || mediaType === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      || mediaType === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) throw new Error('Image format does not match its content. Use PNG, JPEG, or WebP.');
    return { type: 'image', mediaType, base64Data };
  });
}
