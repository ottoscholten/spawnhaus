import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pty = require('node-pty-prebuilt-multiarch');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const server = createServer(app);
const wss = new WebSocketServer({ server });
const terminals = new Map();
const taskTerminals = new Map(); // taskId → terminalId
const boardStatusCache = new Map(); // projectPath → Map(taskId, status)
const wsClients = new Set();
let boardWatcher = null;
let termIdCounter = 1;

const spawnhausDir = path.join(os.homedir(), '.spawnhaus');
const projectsFile = path.join(spawnhausDir, 'projects.json');
const promptsFile = path.join(spawnhausDir, 'prompts.json');

const DEFAULT_PROMPTS = {
  scopingPrompt: `You are scoping task {taskId}: {title}

{description}

You are in a git worktree on branch {branch} — an isolated branch for this task only.

Your goal is to define exactly what needs to be built:
- Ask clarifying questions if needed
- As the scope becomes clear, update the "description" field for id "{taskId}" in ../../.kanban/board.json
- When scoping is complete and the description fully captures what needs building, set the "status" field for id "{taskId}" to "In Progress" in ../../.kanban/board.json — the board will update automatically

Do not write code yet. Focus on understanding and documenting the scope.`,

  implementationPrompt: `You are implementing task {taskId}: {title}

{description}

You are in a git worktree on branch {branch} — an isolated branch for this task only.

Rules:
- All code changes must stay within this worktree
- Only exception: if scope changes during implementation, update the "description" field for id "{taskId}" in ../../.kanban/board.json

Please implement this task.`,
};
const kanbanDir = (p) => path.join(p, '.kanban');
const boardFile = (p) => path.join(p, '.kanban', 'board.json');
const archiveDir = (p) => path.join(p, '.kanban', 'archive');

const readBoard = (p) => {
  if (!fs.existsSync(boardFile(p)))
    return { project: { name: path.basename(p), path: p }, tasks: [], nextId: 1, nextDevPort: 3100 };
  return JSON.parse(fs.readFileSync(boardFile(p), 'utf8'));
};

const writeBoard = (p, board) => {
  if (!fs.existsSync(kanbanDir(p))) fs.mkdirSync(kanbanDir(p), { recursive: true });
  fs.writeFileSync(boardFile(p), JSON.stringify(board, null, 2));
};

const findClaudeSessionId = (cwd) => {
  try {
    const encoded = cwd.replace(/\//g, '-');
    const sessionDir = path.join(os.homedir(), '.claude', 'projects', encoded);
    if (!fs.existsSync(sessionDir)) return null;
    const files = fs.readdirSync(sessionDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ id: f.replace('.jsonl', ''), mtime: fs.statSync(path.join(sessionDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length > 0 ? files[0].id : null;
  } catch { return null; }
};

const getPromptsData = () => {
  const overrides = fs.existsSync(promptsFile) ? JSON.parse(fs.readFileSync(promptsFile, 'utf8')) : {};
  return { ...DEFAULT_PROMPTS, ...overrides };
};

const applyTemplate = (template, task) => template
  .replace(/\{taskId\}/g, task.id)
  .replace(/\{title\}/g, task.title)
  .replace(/\{description\}/g, task.description || '')
  .replace(/\{branch\}/g, task.branch || task.id.toLowerCase());

const broadcast = (data) => {
  const msg = JSON.stringify(data);
  wsClients.forEach(ws => ws.readyState === 1 && ws.send(msg));
};

const watchProject = (projectPath) => {
  if (boardWatcher) boardWatcher.close();
  boardWatcher = chokidar.watch(projectPath, {
    ignoreInitial: true,
    depth: 2,
    ignored: /(node_modules|\.git|\.worktrees)/,
  });
  const onChange = (f) => {
    if (!f.endsWith('board.json')) return;
    broadcast({ type: 'board-update' });
    // Detect Scoping → In Progress transitions and inject implementation prompt
    try {
      const board = readBoard(projectPath);
      const cache = boardStatusCache.get(projectPath) || new Map();
      for (const task of board.tasks) {
        const prev = cache.get(task.id);
        if (prev === 'Scoping' && task.status === 'In Progress') {
          const terminalId = taskTerminals.get(`${projectPath}:${task.id}`);
          if (terminalId && terminals.has(terminalId)) {
            const prompts = getPromptsData();
            const message = applyTemplate(prompts.implementationPrompt, task);
            terminals.get(terminalId).pty.write(message + '\r');
          }
        }
        cache.set(task.id, task.status);
      }
      boardStatusCache.set(projectPath, cache);
    } catch {}
  };
  boardWatcher.on('change', onChange).on('add', onChange);
};

// Folder picker (macOS osascript)
app.get('/api/browse-folder', (req, res) => {
  try {
    const p = execSync(`osascript -e 'POSIX path of (choose folder)'`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    res.json({ path: p });
  } catch {
    res.json({ path: null });
  }
});

// Projects
app.get('/api/projects', (req, res) => {
  if (!fs.existsSync(projectsFile)) return res.json([]);
  res.json(JSON.parse(fs.readFileSync(projectsFile, 'utf8')));
});

const KANBAN_WORKFLOW = `# Spawnhaus — Task Management Workflow

This file defines the task lifecycle and agent rules for this project.
Task data lives in \`.kanban/board.json\`, rendered as markdown in the Spawnhaus UI.

## Status lifecycle
\`Backlog\` → \`Scoping\` → \`In Progress\` → \`Review\` → \`Done\`

- **Backlog** — rough idea, not yet thought through. ID: \`BACKLOG-XXX\`. No agent should touch these.
- **Scoping** — the agent plans the task, agrees scope with the human, then builds it in the same session. Set status to \`In Progress\` when starting to write code — this signals to other agents that the task is claimed.
- **In Progress** — actively being built on a git worktree branch. Do not pick up tasks already in this state.
- **Review** — implementation complete, under review.
- **Done** — merged and complete. Append \`## What was built\` to the description before marking done.

## ID scheme
- Backlog tasks: \`BACKLOG-001\`, \`BACKLOG-002\`, ...
- All other tasks: \`TASK-001\`, \`TASK-002\`, ...
- Promoting a Backlog task out of Backlog auto-assigns a \`TASK-XXX\` id

## Agent step-by-step
1. \`git pull origin main\` — always start from the latest codebase
2. Read the task description carefully — build exactly what it says, no creative interpretation
3. Scope first: nail down exact files, types, UI, acceptance criteria, and what is out of scope — before writing any code
4. Update the \`description\` in \`.kanban/board.json\` with the agreed spec
5. Set status to \`In Progress\` when coding begins — this claims the task
6. When done: append \`## What was built\` to the description, then set status to \`Done\` and open a PR

## Agent rules
- Only pick up tasks in \`Scoping\` state — never tasks already \`In Progress\` or beyond
- Never modify another task's fields
- Only update \`description\` and \`status\` in \`.kanban/board.json\`
- Set status to \`In Progress\` when scoping is agreed and coding begins
- Before setting status to \`Done\`, append \`## What was built\` to the description

## Writing conventions
All fields are rendered as **markdown** in the Spawnhaus UI.

### \`title\`
One short sentence. No punctuation at the end. No markdown.

### \`description\`
The single source of truth for this task. Use markdown:
- \`##\` for sections (e.g. \`## Schema\`, \`## API\`, \`## UI\`, \`## Tests\`, \`## Out of scope\`)
- Bullet lists for requirements
- Inline \`code\` for file paths, field names, values
- **Bold** for non-negotiable rules

**Lifecycle:**
- Scoping: write the full spec of what needs to be built
- Implementation: update if scope changes
- Done: append \`## What was built\` — what was actually implemented, key decisions, gotchas, known limitations
`;

app.post('/api/projects', (req, res) => {
  const { name, path: p } = req.body;
  if (!fs.existsSync(p)) return res.status(400).json({ error: 'Path does not exist' });
  if (!fs.existsSync(spawnhausDir)) fs.mkdirSync(spawnhausDir, { recursive: true });
  let projects = fs.existsSync(projectsFile) ? JSON.parse(fs.readFileSync(projectsFile, 'utf8')) : [];
  projects = projects.filter(pr => pr.path !== p);
  projects.unshift({ name, path: p });
  fs.writeFileSync(projectsFile, JSON.stringify(projects, null, 2));
  // Initialise .kanban/ for new projects
  const kDir = kanbanDir(p);
  if (!fs.existsSync(kDir)) {
    fs.mkdirSync(kDir, { recursive: true });
    fs.mkdirSync(archiveDir(p), { recursive: true });
    writeBoard(p, { project: { name, path: p }, tasks: [], nextId: 1, nextBacklogId: 1, nextDevPort: 3100 });
  }
  fs.writeFileSync(path.join(kDir, 'WORKFLOW.md'), KANBAN_WORKFLOW);

  // Add task management reference to CLAUDE.md if not already present
  const claudeMdPath = path.join(p, 'CLAUDE.md');
  const claudeRef = '\n## Task Management\nSee `.kanban/WORKFLOW.md` for the task workflow and agent rules.\n';
  let claudeMdUpdated = false;
  const existing = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf8') : '';
  if (!existing.includes('.kanban/WORKFLOW.md')) {
    fs.writeFileSync(claudeMdPath, existing + claudeRef);
    claudeMdUpdated = true;
  }

  watchProject(p);
  res.json({ ok: true, claudeMdUpdated });
});

app.delete('/api/projects', (req, res) => {
  const { path: p } = req.body;
  if (!fs.existsSync(projectsFile)) return res.json({ ok: true });
  let projects = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
  projects = projects.filter(pr => pr.path !== p);
  fs.writeFileSync(projectsFile, JSON.stringify(projects, null, 2));
  res.json({ ok: true });
});

// Prompts
app.get('/api/prompts', (req, res) => {
  const overrides = fs.existsSync(promptsFile) ? JSON.parse(fs.readFileSync(promptsFile, 'utf8')) : {};
  res.json({ ...DEFAULT_PROMPTS, ...overrides });
});

app.patch('/api/prompts', (req, res) => {
  if (!fs.existsSync(spawnhausDir)) fs.mkdirSync(spawnhausDir, { recursive: true });
  fs.writeFileSync(promptsFile, JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

app.post('/api/active-project', (req, res) => {
  watchProject(req.body.path);
  res.json({ ok: true });
});

// Tasks
app.get('/api/tasks', (req, res) => res.json(readBoard(req.query.projectPath)));

app.post('/api/tasks', (req, res) => {
  const { projectPath, title, description, status } = req.body;
  const board = readBoard(projectPath);
  const toScoping = status === 'Scoping';
  let id;
  if (toScoping) {
    id = `TASK-${String(board.nextId).padStart(3, '0')}`;
    board.nextId++;
  } else {
    const nextBacklog = (board.nextBacklogId || 1);
    id = `BACKLOG-${String(nextBacklog).padStart(3, '0')}`;
    board.nextBacklogId = nextBacklog + 1;
  }
  const task = { id, title, description: description || '', status: toScoping ? 'Scoping' : 'Backlog', branch: null, worktreePath: null, devPort: null, createdAt: new Date().toISOString() };
  board.tasks.push(task);
  writeBoard(projectPath, board);
  res.json(task);
});

app.patch('/api/tasks/:id', (req, res) => {
  const { projectPath, ...updates } = req.body;
  const board = readBoard(projectPath);
  const idx = board.tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const task = board.tasks[idx];
  // Promote BACKLOG-XXX → TASK-XXX when moving to Scoping or beyond
  if (task.id.startsWith('BACKLOG-') && updates.status && updates.status !== 'Backlog') {
    const newId = `TASK-${String(board.nextId).padStart(3, '0')}`;
    board.nextId++;
    board.tasks[idx] = { ...task, ...updates, id: newId };
  } else {
    board.tasks[idx] = { ...task, ...updates };
  }
  writeBoard(projectPath, board);
  res.json(board.tasks[idx]);
});

app.delete('/api/tasks/:id', (req, res) => {
  const { projectPath, noArchive } = req.body;
  const board = readBoard(projectPath);
  const idx = board.tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const task = { ...board.tasks[idx], archivedAt: new Date().toISOString() };
  board.tasks.splice(idx, 1);
  writeBoard(projectPath, board);
  if (!noArchive) {
    if (!fs.existsSync(archiveDir(projectPath))) fs.mkdirSync(archiveDir(projectPath), { recursive: true });
    const md = [
      `# ${task.id}: ${task.title}`,
      ``,
      `| Field | Value |`,
      `|---|---|`,
      `| Status | ${task.status} |`,
      `| Created | ${task.createdAt ? new Date(task.createdAt).toLocaleString() : '—'} |`,
      `| Archived | ${new Date().toLocaleString()} |`,
      task.branch ? `| Branch | \`${task.branch}\` |` : null,
      task.worktreePath ? `| Worktree | \`${task.worktreePath}\` |` : null,
      task.devPort ? `| Dev Port | ${task.devPort} |` : null,
      ``,
      `## Description`,
      ``,
      task.description || '*(no description)*',
    ].filter(l => l !== null).join('\n');
    fs.writeFileSync(path.join(archiveDir(projectPath), `${task.id}.md`), md);
  }
  // Clean up git worktree if one was created for this task
  if (task.worktreePath) {
    const absWt = path.isAbsolute(task.worktreePath)
      ? task.worktreePath
      : path.join(projectPath, task.worktreePath);
    if (fs.existsSync(absWt)) {
      try {
        execSync(`git -C "${projectPath}" worktree remove --force "${absWt}"`, { stdio: 'pipe' });
      } catch {}
    }
  }
  res.json({ ok: true });
});

app.patch('/api/board', (req, res) => {
  const { projectPath, ...settings } = req.body;
  const board = readBoard(projectPath);
  Object.assign(board, settings);
  writeBoard(projectPath, board);
  res.json({ ok: true });
});

app.post('/api/tasks/:id/assign-port', (req, res) => {
  const { projectPath } = req.body;
  const board = readBoard(projectPath);
  const idx = board.tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  if (board.tasks[idx].devPort) return res.json({ devPort: board.tasks[idx].devPort });
  const devPort = board.nextDevPort || 3100;
  board.nextDevPort = devPort + 1;
  board.tasks[idx].devPort = devPort;
  writeBoard(projectPath, board);
  res.json({ devPort });
});

const symlinkEnv = (projectPath, wtPath) => {
  const mainEnv = path.join(projectPath, '.env');
  const wtEnv = path.join(wtPath, '.env');
  if (fs.existsSync(mainEnv) && !fs.existsSync(wtEnv)) {
    try { fs.symlinkSync('../../.env', wtEnv); } catch {}
  }
};

// Worktree
app.post('/api/worktree/create', (req, res) => {
  const { projectPath, taskId } = req.body;
  const branch = taskId.toLowerCase();
  const wtPath = path.join(projectPath, '.worktrees', taskId);
  try {
    if (!fs.existsSync(wtPath))
      execSync(`git -C "${projectPath}" worktree add -b "${branch}" "${wtPath}"`, { stdio: 'pipe' });
    symlinkEnv(projectPath, wtPath);
    const relPath = path.relative(projectPath, wtPath);
    res.json({ worktreePath: relPath, branch });
  } catch {
    try {
      execSync(`git -C "${projectPath}" worktree add "${wtPath}" "${branch}"`, { stdio: 'pipe' });
      symlinkEnv(projectPath, wtPath);
      const relPath = path.relative(projectPath, wtPath);
      res.json({ worktreePath: relPath, branch });
    } catch (e2) {
      const relPath = path.relative(projectPath, wtPath);
      res.json({ worktreePath: relPath, branch, error: e2.message });
    }
  }
});

// Terminal
app.post('/api/terminal/create', (req, res) => {
  const { cwd, command } = req.body;
  const id = `term-${termIdCounter++}`;
  const safeCwd = (cwd && fs.existsSync(cwd)) ? cwd : os.homedir();
  const shells = [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'].filter(Boolean);

  let proc;
  for (const shell of shells) {
    try {
      proc = pty.spawn(shell, [], {
        name: 'xterm-256color', cols: 80, rows: 24,
        cwd: safeCwd,
        env: { ...process.env, TERM: 'xterm-256color' },
      });
      break;
    } catch {}
  }

  if (!proc) return res.status(500).json({ error: 'Could not spawn terminal — no usable shell found' });

  const termEntry = { pty: proc, clients: new Set(), pendingMessage: req.body.message || null, idleTimer: null, watchingIdle: false, outputBuffer: '', cwd: safeCwd, taskId: req.body.taskId || null, projectPath: req.body.projectPath || null };
  terminals.set(id, termEntry);

  proc.onData(data => {
    const term = terminals.get(id);
    if (!term) return;
    // Rolling output buffer (last 100KB) for replay on reconnect
    term.outputBuffer += data;
    if (term.outputBuffer.length > 100000) term.outputBuffer = term.outputBuffer.slice(-100000);
    // Broadcast to xterm clients
    const msg = JSON.stringify({ type: 'terminal-output', terminalId: id, data });
    term.clients.forEach(ws => ws.readyState === 1 && ws.send(msg));
    // Detect Claude session exit — grab session ID from output and kill PTY
    if (req.body.taskId && !req.body.taskId.endsWith(':dev') && !term.sessionCaptured) {
      const match = term.outputBuffer.match(/Resume this session with:[\s\S]{0,100}claude --resume ([a-f0-9-]{36})/);
      if (match) {
        term.sessionCaptured = true;
        const sessionId = match[1];
        if (req.body.projectPath) {
          try {
            const board = readBoard(req.body.projectPath);
            const idx = board.tasks.findIndex(t => t.id === req.body.taskId);
            if (idx !== -1) { board.tasks[idx].claudeSessionId = sessionId; writeBoard(req.body.projectPath, board); }
          } catch {}
        }
        setTimeout(() => { try { proc.kill(); } catch {} }, 500);
      }
    }
    // Idle detection: when PTY goes quiet for 1.5s after command launched, inject pending message
    if (term.pendingMessage && term.watchingIdle) {
      clearTimeout(term.idleTimer);
      term.idleTimer = setTimeout(() => {
        if (term.pendingMessage) {
          proc.write(term.pendingMessage + '\r');
          term.pendingMessage = null;
        }
      }, 1500);
    }
  });

  const taskKey = req.body.taskId && req.body.projectPath ? `${req.body.projectPath}:${req.body.taskId}` : null;
  if (taskKey) taskTerminals.set(taskKey, id);
  proc.onExit(() => {
    const term = terminals.get(id);
    if (term) {
      // Fallback: if Claude exited without showing the resume message, grab session ID from filesystem
      if (!term.sessionCaptured && term.taskId && !term.taskId.endsWith(':dev') && term.projectPath) {
        try {
          const sessionId = findClaudeSessionId(term.cwd);
          if (sessionId) {
            const board = readBoard(term.projectPath);
            const idx = board.tasks.findIndex(t => t.id === term.taskId);
            if (idx !== -1 && board.tasks[idx].claudeSessionId !== sessionId) {
              board.tasks[idx].claudeSessionId = sessionId;
              writeBoard(term.projectPath, board);
            }
          }
        } catch {}
      }
      const exitMsg = JSON.stringify({ type: 'terminal-exit', terminalId: id });
      term.clients.forEach(ws => ws.readyState === 1 && ws.send(exitMsg));
    }
    terminals.delete(id);
    if (taskKey && taskTerminals.get(taskKey) === id) {
      taskTerminals.delete(taskKey);
      if (!req.body.taskId.endsWith(':dev')) broadcast({ type: 'board-update' });
    }
  });
  if (command) setTimeout(() => proc.write(command + '\r'), 800);

  // Start watching for idle state after shell + command have had time to start
  if (req.body.message) {
    setTimeout(() => { if (terminals.get(id)) terminals.get(id).watchingIdle = true; }, 2000);
    // Fallback: send after 20s regardless
    setTimeout(() => {
      const term = terminals.get(id);
      if (term?.pendingMessage) { proc.write(term.pendingMessage + '\r'); term.pendingMessage = null; }
    }, 20000);
  }

  res.json({ terminalId: id });
});

app.delete('/api/terminal/:id', (req, res) => {
  const term = terminals.get(req.params.id);
  if (term) { try { term.pty.kill(); } catch {} terminals.delete(req.params.id); }
  res.json({ ok: true });
});

app.get('/api/terminal/task/:taskId', (req, res) => {
  const key = req.query.projectPath ? `${req.query.projectPath}:${req.params.taskId}` : req.params.taskId;
  const terminalId = taskTerminals.get(key);
  if (!terminalId || !terminals.has(terminalId)) {
    taskTerminals.delete(key);
    return res.json({ terminalId: null });
  }
  res.json({ terminalId });
});

// Skills
app.get('/api/skills', (req, res) => {
  const { projectPath } = req.query;
  if (!projectPath) return res.json({ skills: [], commands: [] });

  const parseFrontmatter = (content, fallbackName) => {
    let name = fallbackName, description = '';
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const fm = fmMatch[1];
      const nm = fm.match(/^name:\s*(.+)$/m);
      const dm = fm.match(/^description:\s*(.+)$/m);
      if (nm) name = nm[1].trim();
      if (dm) description = dm[1].trim();
    }
    return { name, description };
  };

  const skills = [];
  const skillsDir = path.join(projectPath, '.claude', 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const mdPath = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(mdPath)) continue;
      const content = fs.readFileSync(mdPath, 'utf8');
      const { name, description } = parseFrontmatter(content, entry.name);
      skills.push({ id: entry.name, name, description, content, type: 'skill' });
    }
  }

  const commands = [];
  const commandsDir = path.join(projectPath, '.claude', 'commands');
  if (fs.existsSync(commandsDir)) {
    for (const entry of fs.readdirSync(commandsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const content = fs.readFileSync(path.join(commandsDir, entry.name), 'utf8');
      const id = entry.name.replace(/\.md$/, '');
      const { name, description } = parseFrontmatter(content, id);
      commands.push({ id, name, description, content, type: 'command' });
    }
  }

  res.json({ skills, commands });
});

// Agents
app.get('/api/agents', (req, res) => {
  const { projectPath } = req.query;
  const pluginsFile = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');
  if (!fs.existsSync(pluginsFile)) return res.json([]);
  try {
    const data = JSON.parse(fs.readFileSync(pluginsFile, 'utf8'));
    const all = Array.isArray(data) ? data : Object.values(data);
    const agents = projectPath ? all.filter(a => a.projectPath === projectPath) : all;
    res.json(agents);
  } catch { res.json([]); }
});

// Plugins (MCPs)
app.get('/api/plugins', (req, res) => {
  const settingsFile = path.join(os.homedir(), '.claude', 'settings.json');
  if (!fs.existsSync(settingsFile)) return res.json({});
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    res.json(settings.mcpServers || {});
  } catch { res.json({}); }
});

app.delete('/api/plugins/:name', (req, res) => {
  const settingsFile = path.join(os.homedir(), '.claude', 'settings.json');
  if (!fs.existsSync(settingsFile)) return res.json({ ok: true });
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    if (settings.mcpServers) delete settings.mcpServers[req.params.name];
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/kill-port', (req, res) => {
  const { port } = req.body;
  try { execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: 'pipe' }); } catch {}
  res.json({ ok: true });
});

app.get('/api/terminals/active', (req, res) => {
  const projectPath = req.query.projectPath;
  const prefix = projectPath ? `${projectPath}:` : null;
  const active = {};
  taskTerminals.forEach((terminalId, key) => {
    if (!terminals.has(terminalId)) { taskTerminals.delete(key); return; }
    if (!prefix || key.startsWith(prefix)) {
      const taskId = prefix ? key.slice(prefix.length) : key;
      active[taskId] = terminalId;
    }
  });
  res.json(active);
});

// WebSocket
wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const term = msg.terminalId ? terminals.get(msg.terminalId) : null;
      if (msg.type === 'attach-terminal' && term) {
        term.clients.add(ws);
        if (term.outputBuffer) ws.send(JSON.stringify({ type: 'terminal-output', terminalId: msg.terminalId, data: term.outputBuffer }));
      }
      else if (msg.type === 'terminal-input' && term) term.pty.write(msg.data);
      else if (msg.type === 'terminal-resize' && term) term.pty.resize(msg.cols, msg.rows);
    } catch {}
  });
  ws.on('close', () => {
    wsClients.delete(ws);
    terminals.forEach(t => t.clients.delete(ws));
  });
});

// On shutdown, save Claude session IDs for any terminals that are still running
const saveAllSessionsAndExit = () => {
  terminals.forEach((term) => {
    if (!term.taskId || term.taskId.endsWith(':dev') || !term.projectPath || term.sessionCaptured) return;
    try {
      const sessionId = findClaudeSessionId(term.cwd);
      if (sessionId) {
        const board = readBoard(term.projectPath);
        const idx = board.tasks.findIndex(t => t.id === term.taskId);
        if (idx !== -1) { board.tasks[idx].claudeSessionId = sessionId; writeBoard(term.projectPath, board); }
      }
    } catch {}
  });
  process.exit(0);
};
process.on('SIGTERM', saveAllSessionsAndExit);
process.on('SIGINT', saveAllSessionsAndExit);

const onPortInUse = () => {
  console.error('Port 3001 already in use — another Spawnhaus server is running, backend not started.');
  process.exit(0);
};
server.on('error', (err) => err.code === 'EADDRINUSE' ? onPortInUse() : (() => { throw err; })());
wss.on('error', (err) => err.code === 'EADDRINUSE' ? onPortInUse() : (() => { throw err; })());
server.listen(3001, () => console.log('Spawnhaus server on :3001'));
