import {validateDraft} from './work.js';

export function changeAnnotation(draft,{action,capture,id}) {
  const images=[...draft.images];
  const noteId=capture?.annotationRef?.id || id,index=images.findIndex(image=>image.annotationRef?.id===noteId);
  if(action==='delete') {if(index<0)throw Error('Choose a saved note.');images.splice(index,1);}
  else if(action==='save') {
    if(!capture?.annotationRef || typeof capture.note!=='string' || !capture.note.trim() || capture.note.length>4000)throw Error('Write a note of up to 4,000 characters.');
    if(index<0)images.push(capture);else images[index]=capture;
  }else throw Error('Choose a note action.');
  return validateDraft({...draft,images});
}
