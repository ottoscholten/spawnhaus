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
| `src/components/Board.jsx` | Main board, columns, sticky floating terminals, PromptsModal |
| `src/components/TicketPanel.jsx` | Sidebar task detail: agent terminal, dev server, status |
| `src/components/Card.jsx` | Kanban card with active terminal color indicator |
| `src/components/Column.jsx` | Kanban column with drag-and-drop |
| `src/components/Terminal.jsx` | xterm.js wrapper, supports file drag-and-drop |
| `src/components/NewTaskForm.jsx` | Modal to create task → Backlog or Scoping |
| `src/components/ProjectPicker.jsx` | Project open/recent list UI |
| `~/.spawnhaus/projects.json` | Recent projects list |
| `~/.spawnhaus/prompts.json` | Global Claude prompts (scoping + implementation templates) |
| `.kanban/board.json` | Per-project task data (inside each managed project) |
| `.kanban/WORKFLOW.md` | Task workflow and agent rules (inside each managed project) |

## Architecture

### Terminal System
- `node-pty-prebuilt-multiarch` for PTY processes
- xterm.js (`@xterm/xterm` + `@xterm/addon-fit`) for rendering
- WebSocket for live terminal I/O — frontend connects via `ws://<host>/ws`, proxied by vite
- Server-side `taskTerminals` Map: **keyed as `projectPath:taskId`** to prevent cross-project collisions
- Dev terminals tracked as `projectPath:taskId:dev`
- Each terminal has a 100KB rolling `outputBuffer` for history replay on reconnect
- `terminal-exit` WS event broadcast when PTY exits
- On shutdown (SIGINT/SIGTERM): server saves Claude session IDs for all running terminals before exiting

### Claude Session Capture
- PTY output watched for regex: `Resume this session with:[\s\S]{0,100}claude --resume ([a-f0-9-]{36})`
- On match: session ID saved to board.json, PTY killed after 500ms
- Fallback on terminal exit: if session not captured via regex, `findClaudeSessionId(cwd)` reads from `~/.claude/projects/` filesystem
- Re-open uses `claude --resume <id>`; "New Agent" forces fresh session

### Terminal UI Behaviour
- Sticky floating terminals: draggable, resizable, per-task
- Opening TicketPanel does NOT close the sticky terminal
- TicketPanel hides inline terminal viewer when sticky is open ("Terminal open in floating window")
- Closing TicketPanel does NOT re-open the sticky (sticky stays independent)
- Active terminal cards get a stable color border (hashed from task ID, 6-color palette: orange/rose/fuchsia/teal/indigo/lime — chosen to not clash with column header colors)
- Color matches card border, card icon, sticky terminal header, TicketPanel terminal header
- File drag-and-drop on terminal: uploads file to `/tmp/spawnhaus-<uuid>.<ext>`, types path into terminal

### Task ID Scheme
- Tasks created in Backlog → `BACKLOG-001`, `BACKLOG-002`, ...
- Tasks created in any other status → `TASK-001`, `TASK-002`, ...
- Dragging BACKLOG-XXX out of Backlog → auto-promoted to TASK-XXX on server PATCH

### Worktrees
- Created on first "Launch Agent" click
- `.env` symlink created pointing to `../../.env` (main project env)
- Stored as relative path in `task.worktreePath` (e.g. `.worktrees/TASK-001`)
- `TASK_CONTEXT.md` written to worktree root on creation — contains task ID, title, status, description
- `TASK_CONTEXT.md` re-written on every task PATCH to stay in sync
- `TASK_CONTEXT.md` is gitignored (added to project `.gitignore` on project open)
- Agents should read `TASK_CONTEXT.md` first — WORKFLOW.md instructs this

### Dev Server
- "Start Dev Server" assigns a `devPort` (3100+) stored in board.json
- Backend port for worktree = `devPort + 1000` (e.g. devPort 3101 → backend on 4101)
- Command: `VITE_PORT=<devPort> PORT=<devPort+1000> npm run dev`
- "Stop" sends Ctrl+C first, waits 300ms, then kills PTY + calls onUpdate to clear stale activeTerminals
- "End session" sends `/exit\r`, waits 2s (for session ID capture), then kills PTY

### Phase-Specific Prompts
- "Scoping" status → uses `prompts.scopingPrompt` template
- "In Progress" status → uses `prompts.implementationPrompt` template
- When chokidar detects Scoping → In Progress transition, injects implementation prompt into active terminal
- Templates support `{taskId}`, `{title}`, `{description}`, `{branch}` placeholders

### Project Initialisation (on open)
When a project is opened via `POST /api/projects`:
1. Creates `.kanban/` + `board.json` if not present
2. Writes `.kanban/WORKFLOW.md` (always refreshed)
3. Appends task management reference to `CLAUDE.md` if not present
4. Appends `TASK_CONTEXT.md` to project `.gitignore` if not present

### Board Data Shape (board.json task)
```json
{
  "id": "TASK-001",
  "title": "...",
  "description": "...",
  "status": "In Progress",
  "branch": "task-001",
  "worktreePath": ".worktrees/TASK-001",
  "devPort": 3101,
  "claudeSessionId": "uuid-here"
}
```

## UI Stack
- Tailwind CSS + @tailwindcss/typography for styling
- `@radix-ui/react-dialog` — delete confirmation modal
- `@radix-ui/react-dropdown-menu` — status pill dropdown
- `@dnd-kit/core` + `@dnd-kit/sortable` — drag and drop with custom collision detection
- `react-markdown` — renders description as markdown in TicketPanel

## Columns
`Backlog → Scoping → In Progress → Review → Done`

- Backlog tasks: no agent/dev server controls shown, can be deleted
- Done tasks: archive button (×) on hover, drag to archive zone at end of board
- Archive: creates `.kanban/archive/TASK-XXX.md`, removes from board, cleans up worktree

## Agent / Orchestrator Pattern
- Main Claude Code session acts as orchestrator: creates tasks, reviews, coordinates
- Worktree agents act as implementers: scoped to one task each
- Safe to write outside worktree: only `.kanban/board.json` (status + description fields)
- Dangerous: modifying main project files from a worktree (branch conflicts)
- `code-reviewer` agent installed — run `/code-reviewer` before marking tasks Done

## Outstanding / Known Issues
- No migration for existing tasks in Backlog status with a TASK-XXX id
- board.json tasks with no `id` field need BACKLOG-XXX ids (server-side migration not yet built)
- `getActiveTerminals` and `getTaskTerminal` now require `projectPath` param — old calls without it fall back gracefully but won't scope correctly
