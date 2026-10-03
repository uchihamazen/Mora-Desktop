const {contextBridge,ipcRenderer}=require('electron');
const channel=process.argv.find(value=>value.startsWith('--mora-note-channel='))?.split('=')[1];
contextBridge.exposeInMainWorld('noteEditor',{state:()=>ipcRenderer.invoke(channel,'state'),save:note=>ipcRenderer.invoke(channel,'save',note),remove:()=>ipcRenderer.invoke(channel,'delete'),cancel:()=>ipcRenderer.invoke(channel,'cancel')});
