import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';

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

const PORT = parseInt(process.env.PORT || '3001');
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

Read \`.kanban/task.json\` in this directory — it contains your full task context, description, and other active tasks to avoid overlapping with.

You are in a git worktree on branch {branch} — an isolated branch for this task only.

Your goal is to define exactly what needs to be built:
- Ask clarifying questions if needed
- As the scope becomes clear, update \`description\` in \`.kanban/task.json\`
- When scoping is complete, set \`status\` to "In Progress" in \`.kanban/task.json\` — the board updates automatically

Do not write code yet. Focus on understanding and documenting the scope.

**Only modify \`.kanban/task.json\` — never write to files outside this worktree.**`,

  implementationPrompt: `You are now implementing task {taskId}: {title}

Read \`.kanban/task.json\` in this directory for your full task context and description.

You are in a git worktree on branch {branch} — an isolated branch for this task only.

Rules:
- All code changes must stay within this worktree
- Update \`description\` in \`.kanban/task.json\` if scope changes during implementation
- When you open a PR, set \`prLink\` in \`.kanban/task.json\` to the PR URL
- Before marking done, populate \`followUpTasks\` in \`.kanban/task.json\` with any related features, improvements, or technical debt you noticed but did not build — each entry needs a \`title\` and \`description\`. These automatically become Backlog items.
- When done, set \`status\` to "Review" in \`.kanban/task.json\`

**Quality checks:** When you set status to "Review", automated checks (lint, tests) will run in this worktree and the results will be injected back to you as a message. If checks fail, fix the issues and set status back to "Review" — do not consider the task complete until you receive a message confirming all checks passed.

**Only modify \`.kanban/task.json\` — never write to files outside this worktree.**

Please implement this task.`,

  orchestratorPrompt: `You are the Orchestrator for {projectName}.

Your role is **project-level planning** — not individual task implementation.

## Your responsibilities

- Review the Backlog and move well-shaped tasks to **Ready**
- Combine tasks that are too small for a single agent worktree session (we work in small codebases — avoid micro-tasks)
- Split tasks that are too large or span unrelated concerns
- Ensure tasks in Ready are: clearly scoped, non-overlapping with other active tasks, and right-sized for one agent
- Rewrite task titles and descriptions for clarity when needed
- **When writing descriptions, reference specific files or directories** where the work will happen — this reduces the agent's upfront codebase exploration and saves tokens

## What you do NOT do

- You do not scope individual tasks — that is the task agent's job once it picks up the task
- You do not move tasks to Scoping, In Progress, Review, or Done — only between Backlog and Ready
- You do not write code

## How task agents work

Once a task reaches **Scoping**, a single dedicated agent handles it end-to-end:
1. Reads the task, asks clarifying questions with the human
2. Refines the scope directly in the task description
3. Moves itself to In Progress when coding begins
4. Builds, self-reviews, then moves to Review
5. The human checks and approves

Your job ends when a task is in Ready. The task agent owns everything after that.

## Status lifecycle

Backlog → Ready → Scoping → In Progress → Review → Done

## Board access

The live board is at \`.kanban/board.json\` in the project root. Read and edit it directly.
The UI updates automatically when you save the file.

**Always re-read \`.kanban/board.json\` before every action.** Other task agents may have updated tasks, descriptions, or statuses since you last read it. Never act on a cached version.

**When you see tasks in Done status**, run \`git pull\` in the project root before doing anything else. Completed tasks mean PRs have been merged — pull to stay in sync with the latest codebase before reviewing or planning further work.

**You may update:** \`title\`, \`description\`, \`status\` (Backlog ↔ Ready only), \`priority\`
**Never touch:** \`id\`, \`branch\`, \`worktreePath\`, \`devPort\`, \`claudeSessionId\`, \`createdAt\`
**Never set status to:** Scoping, In Progress, Review, or Done

## Priority

Set \`priority\` on tasks to signal urgency. Use sparingly — not every task needs one.

- \`"high"\` — blocks other work, time-sensitive, or a critical bug
- \`"medium"\` — important but not urgent; should be picked up soon
- \`"low"\` — nice to have, can wait
- omit or \`null\` — unprioritised (default)

Tasks are displayed high → medium → low → unprioritised within each column.`,
};
const isRegisteredProject = (p) => {
  if (!p) return false;
  try {
    const projects = fs.existsSync(projectsFile) ? JSON.parse(fs.readFileSync(projectsFile, 'utf8')) : [];
    return projects.some(pr => pr.path === p);
  } catch { return false; }
};

const kanbanDir = (p) => path.join(p, '.kanban');
const boardFile = (p) => path.join(p, '.kanban', 'board.json');
const archiveDir = (p) => path.join(p, '.kanban', 'archive');

const readBoard = (p) => {
  const bf = boardFile(p);
  if (!fs.existsSync(bf))
    return { project: { name: path.basename(p), path: p }, tasks: [], nextId: 1, nextDevPort: 3100 };
  const raw = fs.readFileSync(bf, 'utf8');
  if (!raw.trim()) throw new Error(`board.json is empty: ${bf}`);
  return JSON.parse(raw);
};

const writeBoard = (p, board) => {
  if (!fs.existsSync(kanbanDir(p))) fs.mkdirSync(kanbanDir(p), { recursive: true });
  const bf = boardFile(p);
  // Safety: never wipe tasks — if existing board has tasks and new board has none, refuse
  if (fs.existsSync(bf)) {
    try {
      const existing = JSON.parse(fs.readFileSync(bf, 'utf8'));
      const existingCount = existing.tasks?.length || 0;
      const newCount = board.tasks?.length || 0;
      if (existingCount > 0 && newCount === 0) {
        const backupPath = bf.replace('.json', `.backup-${Date.now()}.json`);
        fs.copyFileSync(bf, backupPath);
        console.error(`[writeBoard] REFUSED: would wipe ${existingCount} tasks → 0. Backup at ${backupPath}`);
        throw new Error(`board write refused: would delete all ${existingCount} tasks`);
      }
      if (existingCount > newCount) {
        const backupPath = bf.replace('.json', `.backup-${Date.now()}.json`);
        fs.copyFileSync(bf, backupPath);
        console.warn(`[writeBoard] task count decreased (${existingCount} → ${newCount}), backup at ${backupPath}`);
      }
    } catch (e) {
      if (e.message?.startsWith('board write refused')) throw e;
      // JSON parse error on existing file — proceed with write
    }
  }
  fs.writeFileSync(bf, JSON.stringify(board, null, 2));
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

const getPromptsData = (projectPath) => {
  const overrides = projectPath ? (readBoard(projectPath).promptOverrides || {}) : {};
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

const removeWorktree = (projectPath, task) => {
  if (!task.worktreePath) return;
  const absWt = path.isAbsolute(task.worktreePath)
    ? task.worktreePath
    : path.join(projectPath, task.worktreePath);
  if (fs.existsSync(absWt)) {
    try { execSync(`git -C "${projectPath}" worktree remove --force "${absWt}"`, { stdio: 'pipe' }); } catch {}
  }
  const branch = task.branch || task.id?.toLowerCase();
  if (branch) {
    try { execSync(`git -C "${projectPath}" branch -D "${branch}"`, { stdio: 'pipe' }); } catch {}
  }
};

const watchProject = (projectPath) => {
  if (boardWatcher) boardWatcher.close();

  const watchPaths = [path.join(projectPath, '.kanban', 'board.json')];
  const worktreesDir = path.join(projectPath, '.worktrees');
  if (fs.existsSync(worktreesDir)) {
    for (const entry of fs.readdirSync(worktreesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) watchPaths.push(path.join(worktreesDir, entry.name, '.kanban', 'task.json'));
    }
  }

  boardWatcher = chokidar.watch(watchPaths, { ignoreInitial: true });

  const onChange = (f) => {
    if (f.endsWith('task.json')) {
      syncTaskJson(projectPath, f);
      // board.json watcher will fire after sync and handle the rest
      return;
    }
    if (!f.endsWith('board.json')) return;
    broadcast({ type: 'board-update' });
    try {
      const board = readBoard(projectPath);
      const cache = boardStatusCache.get(projectPath) || new Map();
      for (const task of board.tasks) {
        const prev = cache.get(task.id);
        // Scoping → In Progress: inject implementation prompt
        if (prev === 'Scoping' && task.status === 'In Progress') {
          const terminalId = taskTerminals.get(`${projectPath}:${task.id}`);
          if (terminalId && terminals.has(terminalId)) {
            const prompts = getPromptsData(projectPath);
            const message = applyTemplate(prompts.implementationPrompt, task);
            terminals.get(terminalId).pty.write(message + '\r');
          }
        }
        // Any → Review: run quality checks
        if (prev && prev !== 'Review' && task.status === 'Review') {
          runQualityChecks(projectPath, task);
        }
        // Scoping → Ready or Backlog: remove worktree, clear worktreePath
        if (prev === 'Scoping' && (task.status === 'Ready' || task.status === 'Backlog')) {
          removeWorktree(projectPath, task);
          const idx = board.tasks.findIndex(t => t.id === task.id);
          if (idx !== -1) { board.tasks[idx].worktreePath = null; board.tasks[idx].branch = null; }
          writeBoard(projectPath, board);
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
\`Backlog\` → \`Ready\` → \`Scoping\` → \`In Progress\` → \`Review\` → \`Done\`

- **Backlog** — rough idea, not yet thought through. ID: \`BACKLOG-XXX\`. No agent should touch these.
- **Ready** — reviewed by the Orchestrator and human, well-shaped, ready to be picked up. Still \`BACKLOG-XXX\` ID until it enters Scoping.
- **Scoping** — the agent plans the task, agrees scope with the human, then builds it in the same session. Set status to \`In Progress\` when starting to write code — this signals to other agents that the task is claimed. A git worktree is created when a task enters this state.
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

## Worktree context
When working in a git worktree, a \`TASK_CONTEXT.md\` file will be present in the worktree root.
**Read it first** — it contains the task ID, title, current status, and full description.
This file is gitignored and kept in sync automatically by Spawnhaus. Do not commit it.

## Agent rules
- Only pick up tasks in \`Scoping\` state — never tasks already \`In Progress\` or beyond
- Never modify another task's fields in \`.kanban/board.json\`
- You may update \`description\` and \`status\` for your own task only
- Set status to \`In Progress\` when scoping is agreed and coding begins
- Before setting status to \`Done\`, append \`## What was built\` to the description

## Orchestrator
A separate Orchestrator agent manages the Backlog and Ready columns.
It ensures tasks are well-scoped and right-sized before agents pick them up.
Task agents do not interact with the Orchestrator directly.

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

  // Add task.json and TASK_CONTEXT.md to .gitignore if not already present
  const gitignorePath = path.join(p, '.gitignore');
  const gitignoreContent = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
  let gitignoreAdditions = '';
  if (!gitignoreContent.includes('.kanban/task.json')) gitignoreAdditions += '.kanban/task.json\n';
  if (!gitignoreContent.includes('.kanban/WORKFLOW.md')) gitignoreAdditions += '.kanban/WORKFLOW.md\n';
  if (!gitignoreContent.includes('TASK_CONTEXT.md')) gitignoreAdditions += 'TASK_CONTEXT.md\n';
  if (gitignoreAdditions) {
    fs.writeFileSync(gitignorePath, gitignoreContent + '\n# Spawnhaus worktree files (local only)\n' + gitignoreAdditions);
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
app.get('/api/prompts/defaults', (req, res) => res.json(DEFAULT_PROMPTS));

app.get('/api/prompts', (req, res) => {
  const { projectPath } = req.query;
  if (!projectPath) return res.status(400).json({ error: 'projectPath required' });
  res.json(getPromptsData(projectPath));
});

app.patch('/api/prompts', (req, res) => {
  const { projectPath, ...promptFields } = req.body;
  if (!projectPath) return res.status(400).json({ error: 'projectPath required' });
  const board = readBoard(projectPath);
  const overrides = {};
  for (const [key, val] of Object.entries(promptFields)) {
    if (val !== DEFAULT_PROMPTS[key]) overrides[key] = val;
  }
  board.promptOverrides = Object.keys(overrides).length > 0 ? overrides : undefined;
  writeBoard(projectPath, board);
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
  // Promote BACKLOG-XXX → TASK-XXX only when entering Scoping or beyond (Ready keeps BACKLOG-XXX)
  const PROMOTE_STATUSES = new Set(['Scoping', 'In Progress', 'Review', 'Done']);
  if (task.id.startsWith('BACKLOG-') && updates.status && PROMOTE_STATUSES.has(updates.status)) {
    const newId = `TASK-${String(board.nextId).padStart(3, '0')}`;
    board.nextId++;
    board.tasks[idx] = { ...task, ...updates, id: newId };
  } else {
    board.tasks[idx] = { ...task, ...updates };
  }
  writeBoard(projectPath, board);
  // Keep TASK_CONTEXT.md in sync if worktree exists
  const updatedTask = board.tasks[idx];
  if (updatedTask.worktreePath) {
    const wtPath = path.isAbsolute(updatedTask.worktreePath)
      ? updatedTask.worktreePath
      : path.join(projectPath, updatedTask.worktreePath);
    if (fs.existsSync(wtPath)) writeTaskJson(wtPath, projectPath, updatedTask, board);
  }
  res.json(updatedTask);
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
  removeWorktree(projectPath, task);
  res.json({ ok: true });
});

app.patch('/api/board', (req, res) => {
  const { projectPath, ...settings } = req.body;
  // Never allow board settings to overwrite structural task data
  delete settings.tasks;
  delete settings.nextId;
  delete settings.nextBacklogId;
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

const writeTaskJson = (wtPath, projectPath, task, board) => {
  try {
    if (!fs.existsSync(wtPath)) { console.error('[writeTaskJson] wtPath does not exist:', wtPath); return; }
    const otherActive = board
      ? board.tasks
          .filter(t => t.id !== task.id && (t.status === 'Ready' || t.status === 'Scoping' || t.status === 'In Progress'))
          .map(t => ({
            id: t.id,
            status: t.status,
            title: t.title,
            summary: t.description?.split('\n').find(l => l.trim() && !l.startsWith('#')) || '',
          }))
      : [];

    const taskJson = {
      taskId: task.id,
      title: task.title,
      status: task.status,
      description: task.description || '',
      prLink: task.prLink || null,
      branch: task.branch || task.id.toLowerCase(),
      projectPath,
      worktreePath: wtPath,
      otherActiveTasks: otherActive,
      followUpTasks: [],
    };

    const kanbanDir = path.join(wtPath, '.kanban');
    if (!fs.existsSync(kanbanDir)) fs.mkdirSync(kanbanDir, { recursive: true });
    fs.writeFileSync(path.join(kanbanDir, 'task.json'), JSON.stringify(taskJson, null, 2));
  } catch (e) { console.error('[writeTaskJson] failed:', e.message, { wtPath }); }
};

const syncTaskJson = (projectPath, taskJsonPath) => {
  try {
    const taskData = JSON.parse(fs.readFileSync(taskJsonPath, 'utf8'));
    if (!taskData.taskId) return;
    const board = readBoard(projectPath);
    const idx = board.tasks.findIndex(t => t.id === taskData.taskId);
    if (idx === -1) return;
    let changed = false;
    for (const field of ['status', 'description', 'prLink']) {
      if (taskData[field] !== undefined && board.tasks[idx][field] !== taskData[field]) {
        board.tasks[idx][field] = taskData[field];
        changed = true;
      }
    }
    if (Array.isArray(taskData.followUpTasks) && taskData.followUpTasks.length > 0) {
      for (const followUp of taskData.followUpTasks) {
        if (!followUp.title) continue;
        const nextBacklog = board.nextBacklogId || 1;
        const id = `BACKLOG-${String(nextBacklog).padStart(3, '0')}`;
        board.nextBacklogId = nextBacklog + 1;
        board.tasks.push({
          id, title: followUp.title, description: followUp.description || '',
          status: 'Backlog', branch: null, worktreePath: null, devPort: null,
          createdAt: new Date().toISOString(),
        });
        changed = true;
      }
      taskData.followUpTasks = [];
      fs.writeFileSync(taskJsonPath, JSON.stringify(taskData, null, 2));
    }
    if (changed) writeBoard(projectPath, board);
  } catch {}
};

const runQualityChecks = (projectPath, task) => {
  const board = readBoard(projectPath);
  const checks = (board.qualityChecks || []).filter(c => c.trim());
  if (checks.length === 0) return;

  const wtPath = task.worktreePath
    ? (path.isAbsolute(task.worktreePath) ? task.worktreePath : path.join(projectPath, task.worktreePath))
    : projectPath;

  setImmediate(() => {
    const results = [];
    for (const cmd of checks) {
      try {
        const output = execSync(cmd, { cwd: wtPath, timeout: 60000, encoding: 'utf8', stdio: 'pipe' });
        results.push({ cmd, passed: true, output: output.trim() });
      } catch (e) {
        const output = ((e.stdout || '') + '\n' + (e.stderr || '')).trim();
        results.push({ cmd, passed: false, output: output.slice(0, 3000) });
      }
    }

    const allPassed = results.every(r => r.passed);
    let msg = '\n--- Spawnhaus quality checks ---\n\n';
    for (const r of results) {
      msg += `${r.passed ? '✓' : '✗'} ${r.cmd}\n`;
      if (!r.passed && r.output) msg += `\n${r.output}\n\n`;
    }
    msg += allPassed
      ? '\nAll checks passed. The task is ready for human review.\n'
      : '\nSome checks failed. Fix the issues above, then set status back to "Review" in .kanban/task.json when done.\n';
    msg += '---';

    const terminalId = taskTerminals.get(`${projectPath}:${task.id}`);
    if (terminalId && terminals.has(terminalId)) {
      setTimeout(() => {
        const term = terminals.get(terminalId);
        if (term) term.pty.write(msg + '\r');
      }, 2000);
    }
  });
};

const writeWorktreeKanban = (wtPath) => {
  try {
    const kanbanDir = path.join(wtPath, '.kanban');
    if (!fs.existsSync(kanbanDir)) fs.mkdirSync(kanbanDir, { recursive: true });
    fs.writeFileSync(path.join(kanbanDir, 'WORKFLOW.md'), KANBAN_WORKFLOW);
  } catch (e) { console.error('[writeWorktreeKanban] failed:', e.message); }
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
    try {
      const board = readBoard(projectPath);
      const task = board.tasks.find(t => t.id === taskId);
      if (!task) console.error('[worktree/create] task not found:', taskId, board.tasks.map(t => t.id));
      if (task) writeTaskJson(wtPath, projectPath, task, board);
      writeWorktreeKanban(wtPath);
    } catch (e) { console.error('[worktree/create] setup error:', e.message); }
    if (boardWatcher) boardWatcher.add(path.join(wtPath, '.kanban', 'task.json'));
    res.json({ worktreePath: relPath, branch });
  } catch {
    try {
      execSync(`git -C "${projectPath}" worktree add "${wtPath}" "${branch}"`, { stdio: 'pipe' });
      symlinkEnv(projectPath, wtPath);
      const relPath = path.relative(projectPath, wtPath);
      try {
        const board = readBoard(projectPath);
        const task = board.tasks.find(t => t.id === taskId);
        if (!task) console.error('[worktree/create] task not found (fallback):', taskId, board.tasks.map(t => t.id));
        if (task) writeTaskJson(wtPath, projectPath, task, board);
        writeWorktreeKanban(wtPath);
      } catch (e) { console.error('[worktree/create] setup error (fallback):', e.message); }
      if (boardWatcher) boardWatcher.add(path.join(wtPath, '.kanban', 'task.json'));
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
            if (req.body.taskId === '__orchestrator__') {
              board.orchestratorSessionId = sessionId;
            } else {
              const idx = board.tasks.findIndex(t => t.id === req.body.taskId);
              if (idx !== -1) board.tasks[idx].claudeSessionId = sessionId;
            }
            writeBoard(req.body.projectPath, board);
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
            if (term.taskId === '__orchestrator__') {
              if (board.orchestratorSessionId !== sessionId) {
                board.orchestratorSessionId = sessionId;
                writeBoard(term.projectPath, board);
              }
            } else {
              const idx = board.tasks.findIndex(t => t.id === term.taskId);
              if (idx !== -1 && board.tasks[idx].claudeSessionId !== sessionId) {
                board.tasks[idx].claudeSessionId = sessionId;
                writeBoard(term.projectPath, board);
              }
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

app.post('/api/upload-temp', (req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    try {
      const buf = Buffer.concat(chunks);
      const ext = (req.headers['x-filename'] || 'file').split('.').pop() || 'bin';
      const filePath = path.join(os.tmpdir(), `spawnhaus-${randomUUID()}.${ext}`);
      fs.writeFileSync(filePath, buf);
      res.json({ path: filePath });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// Skills
app.get('/api/skills', (req, res) => {
  const { projectPath } = req.query;
  if (!projectPath || !isRegisteredProject(projectPath)) return res.json({ skills: [], commands: [] });

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
    const tmp = settingsFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
    fs.renameSync(tmp, settingsFile);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/kill-port', (req, res) => {
  const port = parseInt(req.body.port, 10);
  if (!port || port < 1 || port > 65535) return res.status(400).json({ error: 'Invalid port' });
  try { execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: 'pipe' }); } catch {}
  res.json({ ok: true });
});

app.post('/api/orchestrator/launch', (req, res) => {
  const { projectPath } = req.body;
  if (!isRegisteredProject(projectPath)) return res.status(403).json({ error: 'Not a registered project' });

  // Return existing terminal if already running
  const key = `${projectPath}:__orchestrator__`;
  const existingTermId = taskTerminals.get(key);
  if (existingTermId && terminals.has(existingTermId)) {
    return res.json({ terminalId: existingTermId, existing: true });
  }

  const board = readBoard(projectPath);
  const sessionId = board.orchestratorSessionId;
  const prompts = getPromptsData(projectPath);
  const prompt = (prompts.orchestratorPrompt || DEFAULT_PROMPTS.orchestratorPrompt)
    .replace(/\{projectName\}/g, board.project?.name || path.basename(projectPath))
    .replace(/\{projectPath\}/g, projectPath);

  res.json({
    cwd: projectPath,
    command: sessionId ? `claude --resume ${sessionId}` : 'claude',
    message: sessionId ? null : prompt,
    taskId: '__orchestrator__',
    projectPath,
  });
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
        if (term.taskId === '__orchestrator__') {
          board.orchestratorSessionId = sessionId;
        } else {
          const idx = board.tasks.findIndex(t => t.id === term.taskId);
          if (idx !== -1) board.tasks[idx].claudeSessionId = sessionId;
        }
        writeBoard(term.projectPath, board);
      }
    } catch {}
  });
  process.exit(0);
};
process.on('SIGTERM', saveAllSessionsAndExit);
process.on('SIGINT', saveAllSessionsAndExit);

const onPortInUse = () => {
  console.error(`Port ${PORT} already in use — another Spawnhaus server is running, backend not started.`);
  process.exit(0);
};
server.on('error', (err) => err.code === 'EADDRINUSE' ? onPortInUse() : (() => { throw err; })());
wss.on('error', (err) => err.code === 'EADDRINUSE' ? onPortInUse() : (() => { throw err; })());
server.listen(PORT, () => console.log(`Spawnhaus server on :${PORT}`));
