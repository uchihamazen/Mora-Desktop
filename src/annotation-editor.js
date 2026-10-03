import {BrowserWindow,ipcMain,screen} from 'electron';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Notes stay in Mora's trusted window. Only marker numbers enter the web page.
export function openAnnotationEditor(parent,{capture,number,point,onChange}) {
  const channel=`mora-note-${randomUUID()}`,area=screen.getDisplayNearestPoint(point).workArea;
  const width=Math.min(360,area.width),height=Math.min(300,area.height);
  const window=new BrowserWindow({parent,modal:true,show:false,frame:false,resizable:false,skipTaskbar:true,width,height,x:Math.round(Math.max(area.x,Math.min(area.x+area.width-width,point.x))),y:Math.round(Math.max(area.y,Math.min(area.y+area.height-height,point.y))),webPreferences:{preload:fileURLToPath(new URL('./annotation-editor-preload.cjs',import.meta.url)),additionalArguments:[`--mora-note-channel=${channel}`],nodeIntegration:false,contextIsolation:true,sandbox:true}});
  const initial={note:capture.note || '',number,editing:!!capture.saved,sourceUrl:capture.sourceUrl};
  let busy=false,finish;const done=new Promise(resolve=>{finish=resolve;});
  ipcMain.handle(channel,async(event,action,note)=>{
    if(event.sender!==window.webContents || event.senderFrame!==window.webContents.mainFrame)throw Error('Invalid annotation editor.');
    if(action==='state')return initial;
    if(action==='cancel'){window.close();return;}
    if(busy)throw Error('Saving this note.');
    if(action==='save' && (typeof note!=='string' || !note.trim() || note.length>4000))throw Error('Write a note of up to 4,000 characters.');
    if(!['save','delete'].includes(action) || action==='delete'&&!initial.editing)throw Error('Choose a note action.');
    busy=true;
    try{await onChange({action,capture:{...capture,note},id:capture.annotationRef.id});if(!window.isDestroyed())window.close();}
    finally{busy=false;}
  });
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.once('closed',()=>{ipcMain.removeHandler(channel);finish();});
  window.once('ready-to-show',()=>{window.show();window.focus();});
  window.loadFile(fileURLToPath(new URL('./annotation-editor.html',import.meta.url))).catch(()=>window.close());
  return {done,close:()=>{if(!window.isDestroyed())window.close();}};
}
