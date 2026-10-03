const editor=window.noteEditor,$=id=>document.getElementById(id);
const state=await editor.state();$('title').textContent=`Note ${state.number}`;$('source').textContent=state.sourceUrl;$('note').value=state.note;$('delete').hidden=!state.editing;$('note').focus();
$('note').oninput=()=>{$('error').textContent='';};
let busy=false;
async function act(action){if(busy)return;busy=true;for(const button of document.querySelectorAll('button'))button.disabled=true;try{await action();}catch(error){$('error').textContent=error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');busy=false;for(const button of document.querySelectorAll('button'))button.disabled=false;}}
$('save').onclick=()=>act(()=>editor.save($('note').value));$('delete').onclick=()=>act(()=>editor.remove());$('cancel').onclick=()=>editor.cancel();
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!busy)editor.cancel();if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();$('save').click();}});
