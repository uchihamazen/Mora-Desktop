export const projectPathFor = session => session.projectPath === null ? null : session.projectPath || session.workspace;
export const projectKey = value => value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();

export function groupConversations(sessions, projects = []) {
  const groups = new Map([[null, {projectPath:null, sessions:[]}]]);
  for (const projectPath of [...projects, ...sessions.map(projectPathFor)]) {
    const key = projectPath === null ? null : projectKey(projectPath);
    if (!groups.has(key)) groups.set(key, {projectPath, sessions:[]});
  }
  for (const session of sessions) {
    const projectPath = projectPathFor(session);
    groups.get(projectPath === null ? null : projectKey(projectPath)).sessions.push(session);
  }
  return [...groups.values()];
}
