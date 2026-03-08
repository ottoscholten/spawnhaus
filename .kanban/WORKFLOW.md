# VibeOps — Task Management Workflow

This file defines the task lifecycle and agent rules for this project.
Task data lives in `.kanban/board.json`, rendered as markdown in the VibeOps UI.

## Status lifecycle
`Backlog` → `Scoping` → `In Progress` → `Review` → `Done`

- **Backlog** — rough idea, not yet thought through. ID: `BACKLOG-XXX`. No agent should touch these.
- **Scoping** — the agent plans the task, agrees scope with the human, then builds it in the same session. Set status to `In Progress` when starting to write code — this signals to other agents that the task is claimed.
- **In Progress** — actively being built on a git worktree branch. Do not pick up tasks already in this state.
- **Review** — implementation complete, under review.
- **Done** — merged and complete. Append `## What was built` to the description before marking done.

## ID scheme
- Backlog tasks: `BACKLOG-001`, `BACKLOG-002`, ...
- All other tasks: `TASK-001`, `TASK-002`, ...
- Promoting a Backlog task out of Backlog auto-assigns a `TASK-XXX` id

## Agent step-by-step
1. `git pull origin main` — always start from the latest codebase
2. Read the task description carefully — build exactly what it says, no creative interpretation
3. Scope first: nail down exact files, types, UI, acceptance criteria, and what is out of scope — before writing any code
4. Update the `description` in `.kanban/board.json` with the agreed spec
5. Set status to `In Progress` when coding begins — this claims the task
6. When done: append `## What was built` to the description, then set status to `Done` and open a PR

## Agent rules
- Only pick up tasks in `Scoping` state — never tasks already `In Progress` or beyond
- Never modify another task's fields
- Only update `description` and `status` in `.kanban/board.json`
- Set status to `In Progress` when scoping is agreed and coding begins
- Before setting status to `Done`, append `## What was built` to the description

## Writing conventions
All fields are rendered as **markdown** in the VibeOps UI.

### `title`
One short sentence. No punctuation at the end. No markdown.

### `description`
The single source of truth for this task. Use markdown:
- `##` for sections (e.g. `## Schema`, `## API`, `## UI`, `## Tests`, `## Out of scope`)
- Bullet lists for requirements
- Inline `code` for file paths, field names, values
- **Bold** for non-negotiable rules

**Lifecycle:**
- Scoping: write the full spec of what needs to be built
- Implementation: update if scope changes
- Done: append `## What was built` — what was actually implemented, key decisions, gotchas, known limitations
