const BASE = '';

export const getTasks = (p) =>
  fetch(`${BASE}/api/tasks?projectPath=${encodeURIComponent(p)}`).then(r => r.json());

export const createTask = (projectPath, { title, description, status }) =>
  fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath, title, description, status }),
  }).then(r => r.json());

export const updateTask = (projectPath, id, updates) =>
  fetch(`${BASE}/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath, ...updates }),
  }).then(r => r.json());

export const archiveTask = (projectPath, id) =>
  fetch(`${BASE}/api/tasks/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath }),
  });

export const deleteTask = (projectPath, id) =>
  fetch(`${BASE}/api/tasks/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath, noArchive: true }),
  });

export const createWorktree = (projectPath, taskId) =>
  fetch(`${BASE}/api/worktree/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath, taskId }),
  }).then(r => r.json());

export const createTerminal = (cwd, command, message, taskId, projectPath) =>
  fetch(`${BASE}/api/terminal/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, command, message, taskId, projectPath }),
  }).then(r => r.json()).then(d => { if (d.error) throw new Error(d.error); return d; });

export const getTaskTerminal = (taskId, projectPath) =>
  fetch(`${BASE}/api/terminal/task/${encodeURIComponent(taskId)}?projectPath=${encodeURIComponent(projectPath)}`).then(r => r.json());

export const getActiveTerminals = (projectPath) =>
  fetch(`${BASE}/api/terminals/active?projectPath=${encodeURIComponent(projectPath)}`).then(r => r.json());

export const killPort = (port) =>
  fetch(`${BASE}/api/kill-port`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port }),
  }).then(r => r.json());

export const killTerminal = (id) =>
  fetch(`${BASE}/api/terminal/${id}`, { method: 'DELETE' });

export const assignPort = (projectPath, taskId) =>
  fetch(`${BASE}/api/tasks/${taskId}/assign-port`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath }),
  }).then(r => r.json());

export const getProjects = () =>
  fetch(`${BASE}/api/projects`).then(r => r.json());

export const addProject = (name, p) =>
  fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, path: p }),
  }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
// returns { ok, claudeMdUpdated }

export const removeProject = (p) =>
  fetch(`${BASE}/api/projects`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p }),
  }).then(r => r.json());

export const browseFolder = () =>
  fetch(`${BASE}/api/browse-folder`).then(r => r.json());

export const setActiveProject = (p) =>
  fetch(`${BASE}/api/active-project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p }),
  });

export const getPrompts = () =>
  fetch(`${BASE}/api/prompts`).then(r => r.json());

export const updatePrompts = (prompts) =>
  fetch(`${BASE}/api/prompts`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prompts),
  }).then(r => r.json());

export const updateBoardSettings = (projectPath, settings) =>
  fetch(`${BASE}/api/board`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath, ...settings }),
  }).then(r => r.json());
