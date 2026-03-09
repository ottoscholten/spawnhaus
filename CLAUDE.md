# Spawnhaus — Claude Instructions

This is the Spawnhaus project: a local AI agent task board built with Vite + React + Express.

## Project Knowledge
See `KNOWLEDGE.md` in this directory for full architecture, file map, and outstanding issues.

## Key Rules for This Project
- Backend runs on port 3001 by default (`PORT` env var to override), frontend on 5173 (`VITE_PORT` to override)
- Global app config lives in `~/.spawnhaus/` (projects.json, prompts.json)
- Task data lives in `.kanban/board.json` inside each project
- Always restart `server.js` after backend changes (frontend hot-reloads automatically)
- When adding new UI primitives, prefer Radix UI components over custom implementations

## Task Management
See `.kanban/WORKFLOW.md` for the task workflow and agent rules.

## Working in a worktree
If `TASK_CONTEXT.md` exists in the current directory, read it first — it contains the task ID, title, description, and status for the task you are working on. This file is gitignored and kept in sync automatically.

## Code Review
A code-reviewer agent is installed. Run `/code-reviewer` in the Claude terminal to review recent changes before marking a task Done.
