import {MspClient} from './msp.js';

export function accountState(value) {
  if(typeof value?.credentialRequired!=='boolean')return {status:'unknown',message:'Account status unavailable. Sign in through Muse Code and reconnect.'};
  if(!value.credentialRequired)return {status:'ready',message:'Provider ready'};
  if(value.state==='accountLogin')return {status:'signedIn',message:'Signed in to Muse'};
  if(['envKey','apiKey'].includes(value.state))return {status:'apiKey',message:value.state==='envKey'?'Using an environment API key':'Using a saved API key'};
  if(value.state==='loggedOut')return {status:'required',message:'Sign in to Muse to start building.'};
  return {status:'unknown',message:'Account status unavailable. Sign in through Muse Code and reconnect.'};
}
export function verificationURL(value) {
  const url=new URL(value);
  if(url.protocol!=='https:' || url.hostname!=='auth.meta.com' || url.port || url.username || url.password)throw new Error('Muse returned an unexpected sign-in address. Use muse login in your terminal.');
  return url;
}
const outcomes={denied:'Sign-in was declined. Try again when ready.',expired:'The sign-in code expired. Start again.',cancelled:'Sign-in cancelled.',failed:'Sign-in failed. Try again or use muse login in your terminal.'};
export class AccountLogin {
  constructor(onChange,{clientFactory=()=>new MspClient(),openExternal}={}) {this.onChange=onChange;this.clientFactory=clientFactory;this.openExternal=openExternal;}
  async start(options) {
    if(this.client)throw new Error('A sign-in is already in progress.');
    const client=this.client=this.clientFactory();
    this.onChange({status:'pending',message:'Starting Meta sign-in…'});
    client.on('notification',(method,params)=>{
      if(this.client!==client)return;
      if(method==='account/loginCompleted')this.finish(params.outcome==='granted'?{status:'signedIn',message:'Signed in to Muse'}:{status:'required',message:outcomes[params.outcome] || outcomes.failed}).catch(()=>{});
    });
    client.on('disconnected',()=>{if(this.client===client)this.finish({status:'required',message:outcomes.failed}).catch(()=>{});});
    this.timer=setTimeout(()=>this.cancel('expired').catch(()=>{}),5*60*1000);
    try {
      await client.connect({...options,experimentalApi:true});
      if(this.client!==client)return;
      const result=await client.request('account/loginStart',{type:'deviceCode'});
      if(this.client!==client)return;
      const url=verificationURL(result.verificationUrl);
      if(typeof result.userCode!=='string' || !/^[A-Za-z0-9 -]{1,64}$/.test(result.userCode))throw new Error('Invalid login code.');
      this.onChange({status:'pending',message:'Approve this code in your browser.',userCode:result.userCode,verificationUrl:url.href});
      await this.openExternal(url.href);
    } catch {
      if(this.client===client)await this.finish({status:'required',message:outcomes.failed});
    }
  }
  async finish(state) {
    const client=this.client;this.client=null;clearTimeout(this.timer);
    this.onChange(state);await client?.close();
  }
  async cancel(outcome='cancelled') {
    const client=this.client;if(!client)return;
    this.client=null;clearTimeout(this.timer);
    this.onChange({status:'required',message:outcomes[outcome] || outcomes.cancelled});
    if(client.connected){client.timeoutMs=2000;await client.request('account/loginCancel').catch(()=>{});}
    await client.close();
  }
}
