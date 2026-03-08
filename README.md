# VibeOps

A local DevOps Kanban app for developers. Vite + React frontend, Express/Node backend, real terminals via node-pty and xterm.js.

## Prerequisites

- Node.js 18+
- Xcode Command Line Tools (for node-pty native build):
  ```bash
  xcode-select --install
  ```

## Setup

```bash
npm install
npm run dev
```

Open **http://localhost:5173**

## Usage

1. Enter a project path on the Project Picker screen
2. Create tasks with **+ New Task**
3. Drag cards between columns — moving to **In Progress** auto-creates a git worktree
4. Click any card to open the detail panel
5. Click **Launch Agent** to open two side-by-side terminals:
   - Terminal 1: `claude` in the worktree directory
   - Terminal 2: `npm run dev` on an auto-assigned port (starting at 3100)
6. Use **Open in Browser** or **Show Preview** to view the running dev server
7. Archive completed tasks with the × on Done cards

## Data Storage

| Location | Contents |
|---|---|
| `<project>/.kanban/board.json` | Tasks |
| `<project>/.kanban/archive/` | Archived tasks |
| `<project>/.worktrees/TASK-XXX/` | Git worktrees |
| `~/.vibeops/projects.json` | Recent projects list |

## Notes

- Terminal sessions are ephemeral — they don't persist across server restarts
- The iframe preview may not load due to CORS restrictions in some dev servers
- Git worktree creation requires the project to be a git repository
- The board auto-refreshes via WebSocket when `board.json` changes on disk
