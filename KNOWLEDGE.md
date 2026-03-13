# Spawnhaus — Project Knowledge

Local AI agent task board. Vite + React frontend, Express/Node backend.

## Running the App
```
npm run dev   # starts both frontend and backend via concurrently
```
- Backend port: `3001` by default — override with `PORT=XXXX`
- Frontend port: `5173` by default — override with `VITE_PORT=XXXX`
- Vite proxies `/api` and `/ws` to the backend port (configured in `vite.config.js`)
- To run a worktree instance alongside the main app: `PORT=3002 VITE_PORT=3102 npm run dev`

## Key Files

| File | Purpose |
|------|---------|
| `server.js` | Express API + WebSocket server + PTY terminal management |
| `src/api.js` | All fetch calls to backend (relative URLs, proxied by vite) |
| `src/ws.js` | WebSocket client (connects to current page host via `/ws`) |
| `src/components/Board.jsx` | Main board, columns, orchestrator UI, sticky terminals |
| `src/components/TicketPanel.jsx` | Sidebar task detail: agent terminal, dev server, status |
| `src/components/Card.jsx` | Kanban card with active terminal color indicator + dev server link |
| `src/components/Column.jsx` | Kanban column with drag-and-drop |
| `src/components/Terminal.jsx` | xterm.js wrapper, supports file drag-and-drop |
| `src/components/NewTaskForm.jsx` | Modal to create task → Backlog or Scoping |
| `src/components/ProjectPicker.jsx` | Project open/recent list UI |
| `src/components/SettingsPanel.jsx` | Full-screen settings: Skills, Agents, Plugins, Prompts, Board tabs |
| `~/.spawnhaus/projects.json` | Recent projects list |
| `~/.spawnhaus/prompts.json` | Global Claude prompts (orchestrator + scoping + implementation templates) |
| `.kanban/board.json` | Per-project task data (inside each managed project, gitignored) |

## Columns

`Backlog → Ready → Scoping → In Progress → Review → Done`

- **Backlog**: raw ideas, BACKLOG-XXX IDs, no agent controls
- **Ready**: orchestrator/human approved, still BACKLOG-XXX ID, no worktree yet
- **Scoping**: worktree + task.json created on drag here; agent scopes then builds
- **In Progress**: agent moved itself here when coding began; worktree exists
- **Review**: agent self-moved here after build + self-review
- **Done**: human approved; archive button (×) on hover, drag to archive zone

BACKLOG-XXX → TASK-XXX promotion happens when a task enters **Scoping** or beyond. Moving to Ready keeps BACKLOG-XXX.

## Worktrees

- **Created**: automatically on drag to Scoping (not on Launch Agent click)
- **Location**: `.worktrees/TASK-001/` inside the managed project
- **Removed**: automatically when task moves Scoping → Ready or Backlog (worktree dir + git branch both deleted)
- **Also removed**: when task is archived/deleted
- `.env` symlink created pointing to `../../.env` (main project env)
- Stored as relative path in `task.worktreePath` (e.g. `.worktrees/TASK-001`)

### Files written to every worktree by server
- `.kanban/task.json` — agent reads for context, writes status/description/prLink updates
- `.kanban/WORKFLOW.md` — task lifecycle docs, server-managed (not committed)
Both are gitignored in managed projects. Server creates them fresh, git never tracks them.

### task.json shape
```json
{
  "taskId": "TASK-001",
  "title": "...",
  "status": "Scoping",
  "description": "...",
  "prLink": null,
  "branch": "task-001",
  "projectPath": "/abs/path/to/project",
  "worktreePath": "/abs/path/to/worktree",
  "otherActiveTasks": [
    { "id": "TASK-002", "status": "In Progress", "title": "...", "summary": "..." }
  ]
}
```

### Status sync (task.json → board.json)
- Agent writes `.kanban/task.json` — never touches files outside its worktree
- Server chokidar watches `.kanban/task.json` in all active worktrees
- On change: `syncTaskJson` reads task.json, applies `status`/`description`/`prLink` to board.json
- board.json watcher then broadcasts `board-update` → UI re-fetches
- Scoping → In Progress transition detected via board.json watcher → injects implementationPrompt into active terminal

## Orchestrator

A project-level planning agent (not a task executor).

- **Role**: manages Backlog ↔ Ready. Combines/splits/refines tasks. Never moves tasks to Scoping or beyond.
- **UI**: amber `⬡ Orchestrator` button fixed bottom-left of board. Pulse dot when running.
- **Terminal**: amber-themed, draggable, resizable. Header has "End session" and "New" buttons.
- **Session**: stored as `board.orchestratorSessionId` (root-level, not in tasks array)
- **Launch**: `POST /api/orchestrator/launch` → returns command/cwd/message; frontend calls `/api/terminal/create` with `taskId: '__orchestrator__'`
- **Prompt**: editable in Settings > Prompts tab (amber section). Variables: `{projectName}`, `{projectPath}`
- **Isolation**: runs in project root (not a worktree). Reads/writes board.json directly.

## Terminal System

- `node-pty-prebuilt-multiarch` for PTY processes
- xterm.js (`@xterm/xterm` + `@xterm/addon-fit`) for rendering
- WebSocket for live I/O — frontend connects via `ws://<host>/ws`, proxied by vite
- `taskTerminals` Map keyed as `projectPath:taskId` (orchestrator uses `projectPath:__orchestrator__`)
- Dev terminals tracked as `projectPath:taskId:dev`
- 100KB rolling `outputBuffer` per terminal for history replay on reconnect
- `terminal-exit` WS event broadcast when PTY exits

### Claude Session Capture
- PTY output watched for: `Resume this session with:[\s\S]{0,100}claude --resume ([a-f0-9-]{36})`
- On match: session ID saved to board.json (`claudeSessionId` on task, or `orchestratorSessionId` on board root), PTY killed after 500ms
- Fallback on exit: `findClaudeSessionId(cwd)` reads from `~/.claude/projects/` filesystem
- Re-open: `claude --resume <id>`; "New" forces fresh session

### Terminal Colors
6-color palette (orange/rose/fuchsia/teal/indigo/lime) — hashed from task ID, chosen not to clash with column header colors (blue=In Progress, purple=Scoping, yellow=Review, green=Done, cyan=Ready).

### Dev Server
- Assigns `devPort` (3100+) stored in board.json, backend port = `devPort + 1000`
- Command: `VITE_PORT=<devPort> PORT=<devPort+1000> VITE_TASK_ID=<id> npm run dev`
- URL parsed from terminal output (regex `https?://localhost:\d+`) not from devPort
- "Stop": Ctrl+C → 300ms wait → kill PTY
- "End session": `/exit\r` → 2s wait → kill PTY

## Prompts

Stored in `~/.spawnhaus/prompts.json`, editable in Settings > Prompts tab. Three prompts:

| Prompt | Variables | When used |
|--------|-----------|-----------|
| `orchestratorPrompt` | `{projectName}`, `{projectPath}` | Injected when orchestrator launches without a saved session |
| `scopingPrompt` | `{taskId}`, `{title}`, `{description}`, `{branch}` | Injected when scoping agent launches without saved session |
| `implementationPrompt` | same | Auto-injected when chokidar detects Scoping → In Progress transition |

## Project Initialisation (on open via POST /api/projects)
1. Creates `.kanban/` + `board.json` if not present
2. Writes `.kanban/WORKFLOW.md` (always refreshed to latest template)
3. Appends task management reference to `CLAUDE.md` if not present
4. Appends to `.gitignore` if not present: `.kanban/task.json`, `.kanban/WORKFLOW.md`, `TASK_CONTEXT.md`

## Board Data Shape

### board.json (root)
```json
{
  "project": { "name": "myapp", "path": "/abs/path" },
  "tasks": [...],
  "nextId": 3,
  "nextBacklogId": 8,
  "nextDevPort": 3102,
  "orchestratorSessionId": "uuid-or-null"
}
```

### Task object
```json
{
  "id": "TASK-001",
  "title": "...",
  "description": "...",
  "status": "In Progress",
  "branch": "task-001",
  "worktreePath": ".worktrees/TASK-001",
  "devPort": 3101,
  "claudeSessionId": "uuid-here",
  "prLink": null,
  "createdAt": "ISO date"
}
```

## UI Stack
- Tailwind CSS + @tailwindcss/typography
- `@radix-ui/react-tabs`, `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip`, `@radix-ui/react-separator`
- `@dnd-kit/core` + `@dnd-kit/sortable` — drag and drop
- `react-markdown` — description rendering
- DM Sans (body) + DM Mono (code/mono) via Google Fonts

## gitignore for Managed Projects
Server adds these to `.gitignore` on project registration:
```
.kanban/task.json
.kanban/WORKFLOW.md
TASK_CONTEXT.md
```
`board.json` must be manually gitignored + `git rm --cached .kanban/board.json` if previously committed.

## Agent Rules (enforced via prompts + WORKFLOW.md)
- Only update `.kanban/task.json` — never files outside the worktree
- Only pick up Scoping tasks — not In Progress or beyond
- Move to In Progress when coding begins (updates task.json → syncs to board.json)
- Move to Review after build + self-code-review
- Append `## What was built` to description before Review

## Outstanding / Known Issues
- No migration for existing tasks that have TASK-XXX ids but are in Backlog status
- board.json tasks with no `id` field need BACKLOG-XXX ids (no server-side migration)
- Terminal scroll viewport can jump when Claude shows permission prompts (BACKLOG-006)
