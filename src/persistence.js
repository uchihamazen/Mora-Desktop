import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export function profilePath(appData, env = process.env) {
  const testDirectory = env.MUSE_DESKTOP_TEST_USER_DATA;
  if (testDirectory && !path.isAbsolute(testDirectory)) throw new Error('Test profile must be an absolute path.');
  // Keep the original profile path so rebranding preserves existing chats and settings.
  return testDirectory || path.join(appData, 'Muse Desktop');
}

function conversations(value) {
  if (!value || !Array.isArray(value.sessions) || !value.sessions.every(s => s && typeof s.sessionId === 'string' && typeof s.workspace === 'string')) throw new Error('Invalid conversation index.');
  if (value.projects !== undefined && (!Array.isArray(value.projects) || !value.projects.every(p => typeof p === 'string' && path.isAbsolute(p)))) throw new Error('Invalid saved projects.');
  const sessions=value.sessions.map(session=>{
    const normalized={...session};
    for(const key of ['pinned','archived','customTitle','unread'])if(key in normalized)normalized[key]=normalized[key]===true;
    return normalized;
  });
  return { sessions, lastSessionId: typeof value.lastSessionId === 'string' ? value.lastSessionId : null, ...(value.projects === undefined ? {} : {projects:value.projects}) };
}

export async function loadConversations(directory, legacy) {
  let damaged = false;
  // Backup is committed first, so it is never older than the primary copy.
  for (const name of ['conversations.backup.json', 'conversations.json']) {
    try { return conversations(JSON.parse(await readFile(path.join(directory, name), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') damaged = true; }
  }
  if (damaged) throw new Error('The conversation index could not be read. Saved files were preserved; restore its backup before continuing.');
  return conversations({ sessions: legacy.sessions || [], lastSessionId: legacy.lastSessionId, projects: legacy.projects });
}

export async function saveConversations(directory, value) {
  const snapshot = JSON.stringify(conversations(value), null, 2);
  // Both copies contain the latest state, including explicit deletions.
  for (const name of ['conversations.backup.json', 'conversations.json']) {
    const filename = path.join(directory, name);
    await writeFile(`${filename}.tmp`, snapshot);
    await rename(`${filename}.tmp`, filename);
  }
}
