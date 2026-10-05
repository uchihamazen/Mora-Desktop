export const VIDEO_LIMITS = { MAX_VIDEO_BYTES: 100 * 1024 * 1024, MAX_VIDEO_SECONDS: 600, MAX_FRAMES: 8, FRAME_MAX_DIM: 1280, FRAME_QUALITY: 0.85, VIDEO_TYPES: ['video/mp4', 'video/quicktime', 'video/webm'] };

export function videoFileError({ mediaType, size, durationSeconds } = {}) {
  if (!VIDEO_LIMITS.VIDEO_TYPES.includes(mediaType)) return 'Attach an MP4, MOV, or WebM video.';
  if(size!==undefined && (!Number.isFinite(size)||size<0))return 'Invalid video size.';
  if (typeof size === 'number' && size > VIDEO_LIMITS.MAX_VIDEO_BYTES) return 'Keep videos to 100 MB.';
  if (durationSeconds === undefined) return null;
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return 'This video has no playable duration.';
  if (durationSeconds > VIDEO_LIMITS.MAX_VIDEO_SECONDS) return 'Keep videos to 10 minutes.';
  return null;
}

export function frameTimes(durationSeconds, max = VIDEO_LIMITS.MAX_FRAMES) {
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isInteger(max) || max<1 || max>VIDEO_LIMITS.MAX_FRAMES) return [];
  const step = durationSeconds / max;
  return Array.from({ length: max }, (_, index) => (index + 0.5) * step);
}

export function validateMediaSelection(files,{imageCount=0,imageBytes=0}={}){
  if(!Number.isInteger(imageCount)||imageCount<0||imageCount>20||!Number.isFinite(imageBytes)||imageBytes<0||imageBytes>20*1024*1024)throw Error('Invalid attachment budget.');
  if(!Array.isArray(files)||files.length>20)throw Error('Attach at most 20 images or video frames.');
  let bytes=0;
  return files.map(file=>{
    const mediaType=file.mediaType||({'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','webp':'image/webp','mp4':'video/mp4','mov':'video/quicktime','webm':'video/webm'}[String(file.name).split('.').at(-1).toLowerCase()]);
    if(!['image/png','image/jpeg','image/webp',...VIDEO_LIMITS.VIDEO_TYPES].includes(mediaType))throw Error('Use PNG, JPEG, WebP, MP4, MOV, or WebM.');
    if(!Number.isFinite(file.size)||file.size<=0)throw Error('Invalid media size.');
    const video=mediaType.startsWith('video/');
    if(video){const problem=videoFileError({mediaType,size:file.size});if(problem)throw Error(problem);}else{
      if(file.size>10*1024*1024)throw Error('Each image must be 10 MB or smaller.');
      imageBytes+=file.size;if(imageBytes>20*1024*1024)throw Error('Images must total 20 MB or less per message.');
    }
    bytes+=file.size;if(bytes>VIDEO_LIMITS.MAX_VIDEO_BYTES)throw Error('Keep selected media to 100 MB in total.');
    imageCount+=video?VIDEO_LIMITS.MAX_FRAMES:1;if(imageCount>20)throw Error('Attach at most 20 images or video frames.');
    return {...file,mediaType,name:String(file.name||'Attached media').slice(0,160)};
  });
}

export function videoContext(images){
  const clips=new Map();images.forEach((image,index)=>{if(!image.sourceVideo)return;const frames=clips.get(image.sourceVideo)||[];frames.push(`image ${index+1} at ${image.frameTime}s`);clips.set(image.sourceVideo,frames);});
  return [...clips].map(([name,frames])=>`Video ${name}: ${frames.join(', ')}. These are sampled frames; original video and audio are not included.`).join('\n');
}

/** Decode in the renderer; the original clip never reaches the model. */
export async function extractVideoFrames(video,{signal}={}){
  const controller=new AbortController(),el=document.createElement('video');let objectUrl,timer;
  const abort=()=>controller.abort(signal.reason);signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  const wait=(type,start)=>new Promise((resolve,reject)=>{
    let deadline;
    const cleanup=()=>{clearTimeout(deadline);el.removeEventListener(type,done);el.removeEventListener('error',failed);controller.signal.removeEventListener('abort',stopped);};
    const done=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(Error('This video could not be decoded. Try another MP4, MOV, or WebM clip.'));},stopped=()=>{cleanup();reject(controller.signal.reason);};
    if(controller.signal.aborted){stopped();return;}
    el.addEventListener(type,done,{once:true});el.addEventListener('error',failed,{once:true});controller.signal.addEventListener('abort',stopped,{once:true});
    deadline=setTimeout(failed,10000);try{start();}catch(error){cleanup();reject(error);}
  });
  try{
    controller.signal.throwIfAborted();
    const problem=videoFileError({mediaType:video.mediaType,size:video.size});if(problem)throw Error(problem);
    const bytes=video.file?null:(Uint8Array.fromBase64?Uint8Array.fromBase64(video.base64Data):Uint8Array.from(atob(video.base64Data),ch=>ch.charCodeAt(0)));
    objectUrl=URL.createObjectURL(video.file||new Blob([bytes],{type:video.mediaType}));
    timer=setTimeout(()=>controller.abort(Error('Video extraction timed out. Try a shorter clip.')),30000);
    el.muted=true;el.preload='auto';await wait('loadedmetadata',()=>{el.src=objectUrl;el.load();});
    const invalid=videoFileError({mediaType:video.mediaType,size:video.size,durationSeconds:el.duration});if(invalid)throw Error(invalid);
    if(!el.videoWidth||!el.videoHeight)throw Error('This clip has no video track.');
    const canvas=document.createElement('canvas'),scale=Math.min(1,VIDEO_LIMITS.FRAME_MAX_DIM/Math.max(el.videoWidth,el.videoHeight));
    canvas.width=Math.max(2,Math.round(el.videoWidth*scale));canvas.height=Math.max(2,Math.round(el.videoHeight*scale));
    const context=canvas.getContext('2d'),frames=[];
    for(const [frameIndex,time] of frameTimes(el.duration).entries()){
      controller.signal.throwIfAborted();
      const target=Math.min(time,Math.max(0,el.duration-0.05));
      if(el.currentTime!==target||el.readyState<2)await wait('seeked',()=>{el.currentTime=target;});
      controller.signal.throwIfAborted();context.drawImage(el,0,0,canvas.width,canvas.height);
      frames.push({mediaType:'image/jpeg',base64Data:canvas.toDataURL('image/jpeg',VIDEO_LIMITS.FRAME_QUALITY).split(',',2)[1],name:`${video.name} · frame ${frameIndex+1}/8`,sourceVideo:video.name,frameIndex,frameTime:Math.round(time*10)/10});
    }
    return frames;
  }finally{
    clearTimeout(timer);signal?.removeEventListener('abort',abort);el.pause();el.removeAttribute('src');el.load();if(objectUrl)URL.revokeObjectURL(objectUrl);
  }
}
