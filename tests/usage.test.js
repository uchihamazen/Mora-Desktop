import test from 'node:test';
import assert from 'node:assert/strict';
import { apiKeyFromAuthJson, authFileCandidates, resolveApiKey, resolveProbeModel, parseSubscriptionEvent, fetchUsage, summarizeUsage, formatResetIn } from '../src/usage.js';

test('apiKeyFromAuthJson extracts providers.meta.api_key', () => {
  assert.equal(apiKeyFromAuthJson(JSON.stringify({ providers: { meta: { api_key: 'k123' } } })), 'k123');
});

test('apiKeyFromAuthJson returns null when missing or malformed', () => {
  assert.equal(apiKeyFromAuthJson('{}'), null);
  assert.equal(apiKeyFromAuthJson('not json'), null);
  assert.equal(apiKeyFromAuthJson(JSON.stringify({ providers: { meta: { api_key: '' } } })), null);
});

test('authFileCandidates prefers MUSE_AUTH_PATH then ~/.config/muse/auth.json', () => {
  assert.deepEqual(authFileCandidates({ MUSE_AUTH_PATH: 'C:/a.json', HOME: '/h' }), ['C:/a.json', '/h/.config/muse/auth.json']);
  assert.deepEqual(authFileCandidates({ HOME: '/h' }), ['/h/.config/muse/auth.json']);
});

test('resolveApiKey prefers META_API_KEY env over files', async () => {
  const key = await resolveApiKey({ env: { META_API_KEY: 'env-key' }, readFile: async () => { throw new Error('must not read'); }, homedir: () => '/h' });
  assert.equal(key, 'env-key');
});

test('resolveApiKey falls back to the auth file', async () => {
  const key = await resolveApiKey({ env: {}, readFile: async () => JSON.stringify({ providers: { meta: { api_key: 'file-key' } } }), homedir: () => '/h' });
  assert.equal(key, 'file-key');
});

test('resolveApiKey returns null when signed out', async () => {
  const key = await resolveApiKey({ env: {}, readFile: async () => { const e = new Error('no'); e.code = 'ENOENT'; throw e; }, homedir: () => '/h' });
  assert.equal(key, null);
});

test('resolveProbeModel prefers env, then engine settings, then default', async () => {
  const readFile = async () => JSON.stringify({ model: 'file-model' });
  assert.equal(await resolveProbeModel({ env: { META_MUSE_MODEL: 'env-model' }, readFile, homedir: () => '/h' }), 'env-model');
  assert.equal(await resolveProbeModel({ env: {}, readFile, homedir: () => '/h' }), 'file-model');
  assert.equal(await resolveProbeModel({ env: {}, readFile: async () => { throw new Error('no'); }, homedir: () => '/h' }), 'muse-spark-1.3');
  assert.equal(await resolveProbeModel({ env: {}, readFile: async () => 'junk', homedir: () => '/h' }), 'muse-spark-1.3');
});

test('parseSubscriptionEvent returns the snapshot and skips other frames', () => {
  const line = 'data: {"type":"response.subscription_usage","subscription":{"tier":"t","weekly":{"resets_at":100,"used_percent":9},"window":{"resets_at":200,"used_percent":0,"window_duration_mins":300}}}';
  assert.deepEqual(parseSubscriptionEvent(line).weekly, { resets_at: 100, used_percent: 9 });
  assert.equal(parseSubscriptionEvent('data: {"type":"response.created"}'), null);
  assert.equal(parseSubscriptionEvent(': keep-alive'), null);
});

test('parseSubscriptionEvent skips placeholder frames without percents', () => {
  assert.equal(parseSubscriptionEvent('data: {"subscription":{"window":{}}}'), null);
});

function sseResponse(chunks, { status = 200 } = {}) {
  const enc = new TextEncoder();
  return {
    ok: status >= 200 && status < 300, status,
    text: async () => chunks.join(''),
    body: new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } }),
  };
}

test('fetchUsage normalizes the SSE snapshot (seconds to ms, string percents)', async () => {
  const res = sseResponse(['data: {"type":"response.created"}\n', 'data: {"type":"response.subscription_usage","subscription":{"tier":"t","weekly":{"resets_at":"1791158400","used_percent":"12.5"},"window":{"resets_at":"1791081331","used_percent":"34","window_duration_mins":"300"}}}\n']);
  const out = await fetchUsage({ apiKey: 'k', model: 'm', fetchImpl: async () => res });
  assert.equal(out.tier, 't');
  assert.deepEqual(out.weekly, { usedPercent: 12.5, resetsAtMs: 1791158400000 });
  assert.deepEqual(out.window, { usedPercent: 34, resetsAtMs: 1791081331000, windowDurationMins: 300 });
  assert.ok(Number.isInteger(out.observedAtMs));
});

test('fetchUsage sends a minimal ping probe', async () => {
  let url, init;
  const res = sseResponse(['data: {"subscription":{"weekly":{"resets_at":1,"used_percent":0},"window":{"resets_at":1,"used_percent":0,"window_duration_mins":300}}}\n']);
  await fetchUsage({ apiKey: 'k', model: 'mm', fetchImpl: async (u, i) => { url = u; init = i; return res; } });
  assert.equal(url, 'https://api.meta.ai/v1/responses');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(init.body), { model: 'mm', input: 'ping', stream: true, max_output_tokens: 16 });
});

test('fetchUsage throws on HTTP errors and empty streams', async () => {
  await assert.rejects(() => fetchUsage({ apiKey: 'k', model: 'm', fetchImpl: async () => sseResponse(['nope'], { status: 401 }) }), /401/);
  await assert.rejects(() => fetchUsage({ apiKey: 'k', model: 'm', fetchImpl: async () => sseResponse(['data: {"type":"x"}\n']) }), /subscription/i);
});

test('formatResetIn humanizes durations', () => {
  assert.equal(formatResetIn(3 * 3600000 + 12 * 60000), '3h 12m');
  assert.equal(formatResetIn(12 * 60000), '12m');
  assert.equal(formatResetIn(2 * 86400000 + 4 * 3600000), '2d 4h');
  assert.equal(formatResetIn(-1000), 'soon');
});

test('summarizeUsage computes remaining and reset labels', () => {
  const now = 1791066000000;
  const out = summarizeUsage({ tier: 't', window: { usedPercent: 34, resetsAtMs: now + 3 * 3600000 + 12 * 60000, windowDurationMins: 300 }, weekly: { usedPercent: 9, resetsAtMs: now + 2 * 86400000 }, observedAtMs: now }, now);
  assert.equal(out.window.remaining, 66);
  assert.equal(out.window.resetsIn, '3h 12m');
  assert.equal(out.weekly.remaining, 91);
  assert.equal(out.overQuota, false);
});

test('summarizeUsage flags over-quota windows', () => {
  const now = 1791066000000;
  const out = summarizeUsage({ tier: 't', window: { usedPercent: 105, resetsAtMs: now + 1000, windowDurationMins: 300 }, weekly: { usedPercent: 9, resetsAtMs: now + 1000 }, observedAtMs: now }, now);
  assert.equal(out.window.remaining, 0);
  assert.equal(out.overQuota, true);
});

test('unknown quota fields never become a zero-used snapshot',async()=>{
 const snapshot={window:{used_percent:null,resets_at:200,window_duration_mins:300},weekly:{used_percent:25,resets_at:300}};
 const out=await fetchUsage({apiKey:'k',model:'m',fetchImpl:async()=>sseResponse([`data: ${JSON.stringify({subscription:snapshot})}\n`])});
 assert.equal(out.window,null);assert.equal(summarizeUsage(out).window,null);assert.equal(summarizeUsage(out).weekly.remaining,75);
 for(const bad of [null,'',false,'  ',{},-1]){
  snapshot.weekly.used_percent=bad;
  assert.equal(parseSubscriptionEvent(`data: ${JSON.stringify({subscription:snapshot})}`),null);
 }
});
test('usage reads the final SSE event without a trailing newline and uses its window length',async()=>{
 const out=await fetchUsage({apiKey:'k',model:'m',fetchImpl:async()=>sseResponse(['data: {"subscription":{"window":{"used_percent":20,"resets_at":200,"window_duration_mins":120}}}'])});
 assert.equal(out.weekly,null);assert.equal(summarizeUsage(out).windowLabel,'2-hour window');
});
test('usage cancels and releases its reader when a stream fails or stalls',async()=>{
 let cancelled=0;
 const fetchImpl=async()=>({ok:true,body:new ReadableStream({cancel(){cancelled++;}})});
 await assert.rejects(fetchUsage({apiKey:'k',model:'m',fetchImpl,timeoutMs:15}),/timed out/);assert.equal(cancelled,1);
});
test('usage credentials respect the installed XDG config directory',async()=>{
 const files=[];const key=await resolveApiKey({env:{XDG_CONFIG_HOME:'/config'},homedir:()=>'/home',readFile:async file=>{files.push(file);return '{"providers":{"meta":{"api_key":"xdg-key"}}}';}});
 assert.equal(key,'xdg-key');assert.deepEqual(files,['/config/muse/auth.json']);
});

test('usage parses split and multiline SSE data while rejecting unbounded streams',async()=>{
 const out=await fetchUsage({apiKey:'k',model:'m',fetchImpl:async()=>sseResponse(['data: {"subscr','iption":{\r\ndata: "weekly":{"used_percent":40,"resets_at":300}}}\r\n\r\n'])});
 assert.equal(out.window,null);assert.equal(out.weekly.usedPercent,40);
 await assert.rejects(fetchUsage({apiKey:'k',model:'m',fetchImpl:async()=>sseResponse(['x'.repeat(1024*1024+1)])}),/size limit/);
});
