# Spawnhaus — Project Knowledge

Local AI agent task board. Vite + React frontend (port 5173), Express/Node backend (port 3001).

## Running the App
```
npm run dev   # starts both frontend (5173) and backend (3001) via concurrently
```

## Key Files

| File | Purpose |
|------|---------|
| `server.js` | Express API + WebSocket server + PTY terminal management |
| `src/api.js` | All fetch calls to backend |
| `src/ws.js` | WebSocket client (singleton, on/send helpers) |
| `src/components/Board.jsx` | Main board, columns, sticky floating terminals, PromptsModal |
| `src/components/TicketPanel.jsx` | Sidebar task detail: agent terminal, dev server, status |
| `src/components/Card.jsx` | Kanban card, shows active terminal indicator |
| `src/components/Column.jsx` | Kanban column with drag-and-drop |
| `src/components/Terminal.jsx` | xterm.js wrapper component |
| `src/components/NewTaskForm.jsx` | Modal to create task → Backlog or Scoping |
| `~/.spawnhaus/projects.json` | Recent projects list |
| `~/.spawnhaus/prompts.json` | Global Claude prompts (scoping + implementation templates) |
| `.kanban/board.json` | Per-project task data (inside each managed project) |
| `.kanban/WORKFLOW.md` | Task workflow and agent rules (inside each managed project) |

## Architecture

### Terminal System
- `node-pty-prebuilt-multiarch` for PTY processes
- xterm.js (`@xterm/xterm` + `@xterm/addon-fit`) for rendering
- WebSocket for live terminal I/O
- Server-side `taskTerminals` Map: `taskId → terminalId` (persists across page reloads)
- Dev terminals tracked as `taskId + ':dev'`
- Each terminal has a 100KB rolling `outputBuffer` for history replay on reconnect
- `terminal-exit` WS event broadcast when PTY exits

### Claude Session Capture
- PTY output watched for regex: `Resume this session with:[\s\S]{0,100}claude --resume ([a-f0-9-]{36})`
- On match: session ID saved to board.json, PTY killed after 500ms
- Re-open uses `claude --resume <id>`; "New Agent" forces fresh session

### Task ID Scheme
- Tasks created in Backlog → `BACKLOG-001`, `BACKLOG-002`, ...
- Tasks created in any other status → `TASK-001`, `TASK-002`, ...
- Dragging BACKLOG-XXX out of Backlog → auto-promoted to TASK-XXX on server PATCH

### Worktrees
- Created on first "Launch Agent" click
- `.env` symlink created pointing to `../../.env` (main project env)
- Stored as relative path in `task.worktreePath` (e.g. `.worktrees/TASK-001`)

### Phase-Specific Prompts
- "Scoping" status → uses `prompts.scopingPrompt` template
- "In Progress" status → uses `prompts.implementationPrompt` template
- When chokidar detects Scoping → In Progress transition, injects implementation prompt into active terminal
- Templates support `{taskId}`, `{title}`, `{description}`, `{branch}` placeholders

### Board Data Shape (board.json task)
```json
{
  "id": "TASK-001",
  "title": "...",
  "description": "...",
  "status": "In Progress",
  "branch": "task-001",
  "worktreePath": ".worktrees/task-001",
  "devPort": 3002,
  "claudeSessionId": "uuid-here"
}
```

## UI Stack
- Tailwind CSS + @tailwindcss/typography for styling
- `@radix-ui/react-dialog` — delete confirmation modal
- `@radix-ui/react-dropdown-menu` — status pill dropdown
- `@dnd-kit/core` + `@dnd-kit/sortable` — drag and drop
- `react-markdown` — renders description as markdown in TicketPanel

## Columns
`Backlog → Scoping → In Progress → Review → Done`

- Backlog tasks: no agent/dev server controls shown, can be deleted
- Done tasks: archive button (×) on hover, drag to archive zone at end of board
- Sticky floating terminals: draggable, resizable, per-task, shown on board when no panel open

## Outstanding / Known Issues
- No migration for existing tasks in Backlog status with a TASK-XXX id
- board.json tasks with no `id` field need to be assigned BACKLOG-XXX ids (server-side migration not yet built)
