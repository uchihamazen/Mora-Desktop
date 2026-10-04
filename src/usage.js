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
  if (home) files.push(`${home}/.config/muse/auth.json`);
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
      const model = JSON.parse(await readFile(`${home}/.config/muse/settings.json`, 'utf8'))?.model;
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
  const windowUsed = Number(sub.window?.used_percent);
  const weeklyUsed = Number(sub.weekly?.used_percent);
  if (!Number.isFinite(windowUsed) && !Number.isFinite(weeklyUsed)) return null; // Placeholder frame.
  return sub;
}

function toNumber(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Usage snapshot has an invalid ${name}.`);
  return n;
}

export async function fetchUsage({ apiKey, model, fetchImpl = fetch, timeoutMs = USAGE_TIMEOUT_MS } = {}) {
  if (!apiKey) throw new Error('Sign in to Muse to see usage.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(USAGE_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: 'ping', stream: true, max_output_tokens: 16 }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Usage request failed (${res.status}).`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', snapshot = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const found = parseSubscriptionEvent(buffer.slice(0, index).trim());
        buffer = buffer.slice(index + 1);
        if (found) { snapshot = found; break; }
      }
      if (snapshot) break;
    }
    try { await reader.cancel(); } catch {}
    if (!snapshot) throw new Error('Subscription snapshot missing from the response.');
    return {
      tier: typeof snapshot.tier === 'string' ? snapshot.tier : '',
      window: {
        usedPercent: toNumber(snapshot.window.used_percent, 'window percent'),
        resetsAtMs: toNumber(snapshot.window.resets_at, 'window reset') * 1000,
        windowDurationMins: toNumber(snapshot.window.window_duration_mins ?? 300, 'window length'),
      },
      weekly: {
        usedPercent: toNumber(snapshot.weekly.used_percent, 'weekly percent'),
        resetsAtMs: toNumber(snapshot.weekly.resets_at, 'weekly reset') * 1000,
      },
      observedAtMs: Date.now(),
    };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Usage request timed out.');
    throw error;
  } finally { clearTimeout(timer); }
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
    const used = Math.max(0, part.usedPercent);
    return { usedPercent: part.usedPercent, remaining: Math.max(0, Math.round(100 - used)), resetsIn: formatResetIn(part.resetsAtMs - nowMs), barPercent: Math.min(100, used) };
  };
  const window = block(payload.window), weekly = block(payload.weekly);
  return {
    tier: payload.tier, window, weekly,
    observedAtMs: payload.observedAtMs,
    overQuota: payload.window.usedPercent > 100 || payload.weekly.usedPercent > 100,
  };
}
