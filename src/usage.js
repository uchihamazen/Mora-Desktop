export const USAGE_API_URL = 'https://api.meta.ai/v1/responses';
export const USAGE_TIMEOUT_MS = 30000;

export function apiKeyFromAuthJson(text) {
  try {
    const key = JSON.parse(text)?.providers?.meta?.api_key;
    return typeof key === 'string' && key ? key : null;
  } catch { return null; }
}

export function authFileCandidates(env = {}) {
  const files = [];
  if (env.MUSE_AUTH_PATH) files.push(env.MUSE_AUTH_PATH);
  const home = env.HOME || env.USERPROFILE;
  if (env.XDG_CONFIG_HOME || home) files.push(`${env.XDG_CONFIG_HOME || `${home}/.config`}/muse/auth.json`);
  return files;
}

export async function resolveApiKey({ env = process.env, readFile, homedir } = {}) {
  if (env.META_API_KEY) return env.META_API_KEY;
  const home = homedir ? homedir() : (env.HOME || env.USERPROFILE);
  for (const file of authFileCandidates({ ...env, HOME: home })) {
    try { const key = apiKeyFromAuthJson(await readFile(file, 'utf8')); if (key) return key; }
    catch { /* Try the next candidate. */ }
  }
  return null;
}

export async function resolveProbeModel({ env = process.env, readFile, homedir } = {}) {
  if (env.META_MUSE_MODEL) return env.META_MUSE_MODEL;
  const home = homedir ? homedir() : (env.HOME || env.USERPROFILE);
  if (home) {
    try {
      const model = JSON.parse(await readFile(`${env.XDG_CONFIG_HOME || `${home}/.config`}/muse/settings.json`, 'utf8'))?.model;
      if (typeof model === 'string' && model) return model;
    } catch { /* Fall through to the default. */ }
  }
  return 'muse-spark-1.3';
}

export function parseSubscriptionEvent(line) {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  let event;
  try { event = JSON.parse(payload); } catch { return null; }
  const sub = event.subscription || event.response?.subscription || event.data?.subscription;
  if (!sub) return null;
  return normalizeBlock(sub.window,true) || normalizeBlock(sub.weekly) ? sub : null;
}

function number(value) {
  if(typeof value!=='number' && (typeof value!=='string'||!value.trim()))return null;
  const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;
}
function normalizeBlock(part,window=false){
  const usedPercent=number(part?.used_percent),reset=number(part?.resets_at);
  if(usedPercent===null||reset===null||reset<=0||reset>8640000000000)return null;
  const result={usedPercent,resetsAtMs:reset*1000};
  if(window){const duration=number(part.window_duration_mins);result.windowDurationMins=duration>0?duration:null;}
  return result;
}

export async function fetchUsage({ apiKey, model, fetchImpl = fetch, timeoutMs = USAGE_TIMEOUT_MS } = {}) {
  if (!apiKey) throw new Error('Sign in to Muse to see usage.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let reader;
  const cancel=()=>reader?.cancel().catch(()=>{});
  ctrl.signal.addEventListener('abort',cancel,{once:true});
  try {
    const res = await fetchImpl(USAGE_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: 'ping', stream: true, max_output_tokens: 16 }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Usage request failed (${res.status}).`);
    if(!res.body)throw Error('Subscription snapshot missing from the response.');
    reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', snapshot = null,received=0,dataLines=[];
    const consume=line=>{
      const found=parseSubscriptionEvent(line);if(found){snapshot=found;return;}
      if(line.startsWith('data:'))dataLines.push(line.slice(5).trim());
      else if(!line){snapshot=parseSubscriptionEvent('data: '+dataLines.join('\n'));dataLines=[];}
    };
    for (;;) {
      const { done, value } = await reader.read();
      if(ctrl.signal.aborted)throw new DOMException('Timed out','AbortError');
      if (done) {buffer+=decoder.decode();consume(buffer.trim());if(!snapshot)consume('');break;}
      received+=value.byteLength;if(received>1024*1024)throw Error('Usage response exceeds the size limit.');
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        consume(buffer.slice(0, index).trim());
        buffer = buffer.slice(index + 1);
        if (snapshot) break;
      }
      if (snapshot) break;
    }
    if (!snapshot) throw new Error('Subscription snapshot missing from the response.');
    return {
      tier: typeof snapshot.tier === 'string' ? snapshot.tier : '',
      window: normalizeBlock(snapshot.window,true),
      weekly: normalizeBlock(snapshot.weekly),
      observedAtMs: Date.now(),
    };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Usage request timed out.');
    throw error;
  } finally { clearTimeout(timer);ctrl.signal.removeEventListener('abort',cancel);if(reader){try{await reader.cancel();}catch{}reader.releaseLock();} }
}

export function formatResetIn(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'soon';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}

export function summarizeUsage(payload, nowMs = Date.now()) {
  const block = part => {
    if(!part||!Number.isFinite(part.usedPercent)||part.usedPercent<0)return null;
    const used = Math.max(0, part.usedPercent);
    const remaining=Math.max(0, Math.round(100 - used));
    return { usedPercent: part.usedPercent, remaining, resetsIn: formatResetIn(part.resetsAtMs - nowMs), barPercent: remaining };
  };
  const window = block(payload.window), weekly = block(payload.weekly);
  return {
    tier: payload.tier, window, weekly,windowLabel:payload.window?.windowDurationMins?`${payload.window.windowDurationMins%60===0?`${payload.window.windowDurationMins/60}-hour`:`${payload.window.windowDurationMins}-minute`} window`:'Current window',
    observedAtMs: payload.observedAtMs,
    overQuota: payload.window?.usedPercent > 100 || payload.weekly?.usedPercent > 100,
  };
}
