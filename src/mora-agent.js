import {randomUUID} from 'node:crypto';
import {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {AIMessage} from '@langchain/core/messages';
import {convertToOpenAITool} from '@langchain/core/utils/function_calling';
import {createAgent} from 'langchain';
import {createAsyncSubAgentMiddleware} from 'deepagents';

const role=type=>({human:'user',ai:'assistant',tool:'tool',system:'system'})[type]||type;

/** Adapts native Muse decisions to LangChain's model/tool interface. */
export class MuseChatModel extends BaseChatModel {
  constructor({decide}){super({});if(typeof decide!=='function')throw Error('Muse decision connector is required.');this.decide=decide;}
  _llmType(){return 'muse-native';}
  get callKeys(){return [...super.callKeys,'tools'];}
  bindTools(tools,options={}){return this.withConfig({...options,tools:tools.map(tool=>convertToOpenAITool(tool))});}
  async _generate(messages,options){
    const tools=options.tools||[];
    const input=messages.map(message=>({role:role(message.getType()),content:message.content,...(message.tool_calls?.length?{tool_calls:message.tool_calls}:{}),...(message.tool_call_id?{tool_call_id:message.tool_call_id}:{})}));
    let decision,calls;
    for(let attempt=0;attempt<2;attempt++){
      decision=await this.decide({messages:input,tools,signal:options.signal});
      try{calls=this.parseDecision(decision,tools);break;}
      catch(error){if(attempt||options.signal?.aborted)throw error;input.push({role:'system',content:`Your previous structured decision was invalid: ${error.message}. Correct only its formatting. Each arguments value must be one valid JSON object encoded as a JSON string. Preserve the same requested operation; no tool was executed from that invalid decision.`});}
    }
    const message=new AIMessage({content:decision.message,tool_calls:calls});
    return {generations:[{text:decision.message,message}]};
  }
  parseDecision(decision,tools){
    if(!decision||typeof decision.message!=='string'||!Array.isArray(decision.tool_calls)||decision.tool_calls.length>3)throw Error('Muse returned an invalid supervisor decision.');
    const names=new Set(tools.map(tool=>tool.function.name));
    return decision.tool_calls.map(call=>{
      if(!names.has(call.name))throw Error('Muse requested an unavailable tool.');
      let args;try{args=JSON.parse(call.arguments);}catch{throw Error('Muse returned invalid tool arguments.');}
      if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Muse returned invalid tool arguments.');
      return {id:randomUUID(),name:call.name,args,type:'tool_call'};
    });
  }
}

export function createMoraAgent({model,backend,tools=[],systemPrompt=''}){
  const middleware=createAsyncSubAgentMiddleware({asyncSubAgents:[{name:'coder',description:'Implement and verify an assigned project task in an isolated source workspace. Use clear non-overlapping file ownership; related edits belong in one task.',graphId:'mora-worker',url:backend.url,headers:{authorization:`Bearer ${backend.token}`}}]});
  return createAgent({model,tools,middleware:[middleware],systemPrompt});
}
