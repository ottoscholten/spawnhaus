import { useState, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { updateTask, createTerminal, killTerminal, assignPort, createWorktree, getPrompts, getTaskTerminal, deleteTask } from '../api';
import { Terminal } from './Terminal';
import { on, send } from '../ws';

const STATUSES = ['Backlog', 'Scoping', 'In Progress', 'Review', 'Done'];

const STATUS_STYLE = {
  'Backlog':     'bg-gray-800 text-gray-400',
  'Scoping':     'bg-purple-900/60 text-purple-300',
  'In Progress': 'bg-blue-900/60 text-blue-300',
  'Review':      'bg-yellow-900/60 text-yellow-300',
  'Done':        'bg-green-900/60 text-green-300',
};

const STATUS_DOT = {
  'Backlog':     'bg-gray-500',
  'Scoping':     'bg-purple-400',
  'In Progress': 'bg-blue-400',
  'Review':      'bg-yellow-400',
  'Done':        'bg-green-400',
};

function applyTemplate(template, task) {
  return template
    .replace(/\{taskId\}/g, task.id)
    .replace(/\{title\}/g, task.title)
    .replace(/\{description\}/g, task.description || '')
    .replace(/\{branch\}/g, task.branch || task.id.toLowerCase());
}

function EditableField({ value, onChange, onSave, placeholder, label }) {
  const [editing, setEditing] = useState(false);
  const taRef = useRef(null);

  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      taRef.current.style.height = 'auto';
      taRef.current.style.height = taRef.current.scrollHeight + 'px';
    }
  }, [editing]);

  if (editing) {
    return (
      <textarea
        ref={taRef}
        value={value}
        onChange={e => {
          onChange(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = e.target.scrollHeight + 'px';
        }}
        onBlur={() => { setEditing(false); onSave(); }}
        placeholder={placeholder}
        className="w-full bg-gray-900/50 border border-gray-700 rounded-lg text-sm text-gray-300 placeholder-gray-700 px-3 py-2 outline-none resize-none transition-colors"
      />
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="w-full min-h-[2.5rem] cursor-text rounded-lg px-3 py-2 text-sm hover:bg-gray-900/40 transition-colors"
    >
      {value ? (
        <div className="prose prose-sm prose-invert max-w-none
          prose-headings:text-gray-200 prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1
          prose-p:text-gray-300 prose-p:leading-relaxed prose-p:my-1
          prose-li:text-gray-300 prose-li:my-0
          prose-ul:my-1 prose-ol:my-1
          prose-code:text-blue-300 prose-code:bg-gray-800 prose-code:px-1 prose-code:rounded
          prose-strong:text-gray-200">
          <Markdown>{value}</Markdown>
        </div>
      ) : (
        <span className="text-gray-700">{placeholder}</span>
      )}
    </div>
  );
}

export function TicketPanel({ task, project, onClose, onUpdate, activeTerminals, terminalColor, hasStickyTerminal }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || '');
  const [claudeTermIdState, setClaudeTermId] = useState(null);
  const [devTermIdState, setDevTermId] = useState(null);
  const claudeTermId = claudeTermIdState || activeTerminals?.[task.id] || null;
  const devTermId = devTermIdState || activeTerminals?.[task.id + ':dev'] || null;
  const [devPort, setDevPort] = useState(task.devPort);
  const [showIframe, setShowIframe] = useState(false);
  const [termHeight, setTermHeight] = useState(420);
  const [launching, setLaunching] = useState(false);
  const [devStarting, setDevStarting] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description || '');
    setDevPort(task.devPort);
    setClaudeTermId(null);
    setDevTermId(null);
    setShowIframe(false);
    setLaunchError('');
    getTaskTerminal(task.id, project.path).then(({ terminalId }) => {
      if (terminalId) setClaudeTermId(terminalId);
    });
    getTaskTerminal(task.id + ':dev', project.path).then(({ terminalId }) => {
      if (terminalId) setDevTermId(terminalId);
    });
  }, [task.id]);

  useEffect(() => on('terminal-exit', (msg) => {
    if (msg.terminalId === claudeTermIdState) { setClaudeTermId(null); onUpdate(); }
    if (msg.terminalId === devTermIdState) setDevTermId(null);
  }));

  const save = async () => {
    const titleVal = title || task.title;
    if (titleVal === task.title && description === (task.description || '')) return;
    await updateTask(project.path, task.id, { title: titleVal, description });
    onUpdate();
  };

  const handleDelete = async () => {
    await deleteTask(project.path, task.id);
    onClose();
    onUpdate();
  };

  const handleLaunchClaude = async (forceNew = false) => {
    setLaunching(true);
    setLaunchError('');
    try {
      const resolveCwd = (p) => p && !p.startsWith('/') ? `${project.path}/${p}` : p;
      let worktreeTask = task;
      let cwd = resolveCwd(task.worktreePath);
      if (!cwd) {
        const wt = await createWorktree(project.path, task.id);
        cwd = wt.worktreePath;
        await updateTask(project.path, task.id, { worktreePath: wt.worktreePath, branch: wt.branch });
        worktreeTask = { ...task, worktreePath: wt.worktreePath, branch: wt.branch };
        onUpdate();
      }
      const prompts = await getPrompts();
      const template = worktreeTask.status === 'Scoping'
        ? prompts.scopingPrompt
        : prompts.implementationPrompt;
      const context = applyTemplate(template, worktreeTask);
      const command = (!forceNew && task.claudeSessionId) ? `claude --resume ${task.claudeSessionId}` : 'claude';
      const message = (!forceNew && task.claudeSessionId) ? null : context;
      const t = await createTerminal(cwd, command, message, task.id, project.path);
      setClaudeTermId(t.terminalId);
      onUpdate();
    } catch (e) {
      setLaunchError(e.message || 'Failed to launch Claude');
    } finally {
      setLaunching(false);
    }
  };

  const handleStartDev = async () => {
    setDevStarting(true);
    try {
      if (devTermId) await killTerminal(devTermId);
      const cwd = task.worktreePath
        ? (task.worktreePath.startsWith('/') ? task.worktreePath : `${project.path}/${task.worktreePath}`)
        : project.path;
      let port = devPort;
      if (!port) {
        const res = await assignPort(project.path, task.id);
        port = res.devPort;
        setDevPort(port);
      }
      const backendPort = port + 1000;
      const t = await createTerminal(cwd, `lsof -ti :${port} | xargs kill -9 2>/dev/null; rm -f .next/dev/lock && VITE_PORT=${port} PORT=${backendPort} VITE_TASK_ID=${task.id} npm run dev`, null, task.id + ':dev', project.path);
      setDevTermId(t.terminalId);
      onUpdate();
    } catch (e) {
      setLaunchError(e.message || 'Failed to start dev server');
    } finally {
      setDevStarting(false);
    }
  };

  const handleStopDev = async () => {
    if (!devTermId) return;
    send({ type: 'terminal-input', terminalId: devTermId, data: '\x03' });
    await new Promise(r => setTimeout(r, 300));
    await killTerminal(devTermId);
    setDevTermId(null);
    onUpdate();
  };

  const handleResizeMouseDown = (e) => {
    const startY = e.clientY;
    const startH = termHeight;
    const onMove = (ev) => setTermHeight(Math.max(200, Math.min(800, startH + ev.clientY - startY)));
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div className="h-full bg-gray-950 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-gray-800">
        <span className="text-xs text-gray-600 font-mono">{task.id}</span>
        <div className="flex items-center gap-2">

          {/* Status dropdown */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors outline-none ${STATUS_STYLE[task.status] || STATUS_STYLE['Backlog']}`}>
                {task.status} ▾
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl py-1 min-w-[9rem] z-30 outline-none"
              >
                {STATUSES.map(s => (
                  <DropdownMenu.Item
                    key={s}
                    onSelect={async () => {
                      await updateTask(project.path, task.id, { status: s });
                      onUpdate();
                    }}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer outline-none select-none
                      data-[highlighted]:bg-gray-800 transition-colors
                      ${task.status === s ? 'opacity-40 pointer-events-none' : 'text-gray-300'}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[s]}`} />
                    {s}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          {/* Delete (backlog only) */}
          {task.status === 'Backlog' && (<>
            <div className="w-px h-4 bg-gray-800" />
            <Dialog.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
              <Dialog.Trigger asChild>
                <button
                  className="text-gray-700 hover:text-red-400 transition-colors"
                  title="Delete task"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/70 z-50" />
                <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm shadow-2xl z-50 outline-none">
                  <Dialog.Title className="text-white font-semibold mb-1">Delete task?</Dialog.Title>
                  <Dialog.Description className="text-sm text-gray-500 mb-5 truncate">
                    "{task.title}"
                  </Dialog.Description>
                  <div className="flex justify-end gap-2">
                    <Dialog.Close asChild>
                      <button className="px-4 py-2 text-gray-500 hover:text-white text-sm transition-colors">
                        Cancel
                      </button>
                    </Dialog.Close>
                    <button
                      onClick={handleDelete}
                      className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded text-sm font-medium transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </>)}

          <div className="w-px h-4 bg-gray-800" />
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-white text-xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-gray-800 transition-colors"
          >
            ×
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={save}
          className="w-full bg-transparent text-white text-lg font-semibold focus:outline-none border-b border-transparent focus:border-gray-700 pb-1 transition-colors"
        />

        <EditableField
          value={description}
          onChange={setDescription}
          onSave={save}
          placeholder="Add a description..."
        />

        {/* Meta */}
        {(task.branch || task.worktreePath) && (
          <div className="space-y-1.5">
            {task.branch && (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <span className="w-16 shrink-0">Branch</span>
                <code className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded font-mono">{task.branch}</code>
              </div>
            )}
            {task.worktreePath && (
              <div className="flex items-start gap-2 text-xs text-gray-600">
                <span className="w-16 shrink-0 pt-0.5">Worktree</span>
                <code className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded font-mono text-xs break-all">{task.worktreePath}</code>
              </div>
            )}
          </div>
        )}

        {task.status !== 'Backlog' && (<>
          {/* ── Claude terminal ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600 font-mono uppercase tracking-wider">Claude Agent</span>
              {!claudeTermId && (
                <div className="flex items-center gap-1.5">
                  {task.claudeSessionId && (
                    <button
                      onClick={() => handleLaunchClaude(true)}
                      disabled={launching}
                      className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 disabled:opacity-50 text-white rounded text-xs font-medium transition-colors"
                    >
                      {launching ? 'Launching...' : 'New Agent'}
                    </button>
                  )}
                  <button
                    onClick={() => handleLaunchClaude(false)}
                    disabled={launching}
                    className={`px-3 py-1.5 disabled:opacity-50 text-white rounded text-xs font-medium transition-colors ${
                      task.claudeSessionId ? 'bg-gray-700 hover:bg-gray-600' : 'bg-emerald-800 hover:bg-emerald-700'
                    }`}
                  >
                    {launching ? 'Launching...' : task.claudeSessionId ? 'Re-open Agent' : 'Launch Agent'}
                  </button>
                </div>
              )}
            </div>
            {launchError && <p className="text-red-400 text-xs">{launchError}</p>}
            {claudeTermId && hasStickyTerminal && (
              <p className="text-xs text-gray-600 italic">Terminal open in floating window</p>
            )}
            {claudeTermId && !hasStickyTerminal && (
              <div className={`border rounded-lg overflow-hidden flex flex-col ${terminalColor ? terminalColor.border : 'border-gray-800'}`} style={{ height: termHeight }}>
                <div className={`text-xs px-2 py-1 border-b font-mono shrink-0 flex items-center justify-between ${terminalColor ? `${terminalColor.headerBg} ${terminalColor.headerText} ${terminalColor.headerBorder}` : 'text-gray-600 border-gray-800 bg-gray-900/80'}`}>
                  <span>claude — {task.worktreePath || project.path}</span>
                  <button
                    onClick={async () => {
                      send({ type: 'terminal-input', terminalId: claudeTermId, data: '/exit\r' });
                      await new Promise(r => setTimeout(r, 2000));
                      await killTerminal(claudeTermId);
                      setClaudeTermId(null);
                      onUpdate();
                    }}
                    className="text-gray-600 hover:text-red-400 transition-colors ml-2"
                    title="End session"
                  >
                    End session
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <Terminal terminalId={claudeTermId} />
                </div>
              </div>
            )}
            {claudeTermId && !hasStickyTerminal && (
              <div
                className="h-1.5 rounded cursor-row-resize bg-gray-800 hover:bg-blue-600 transition-colors"
                onMouseDown={handleResizeMouseDown}
              />
            )}
          </div>

          {/* ── Dev server terminal ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600 font-mono uppercase tracking-wider">
                Dev Server{devPort ? ` :${devPort}` : ''}
              </span>
              <div className="flex items-center gap-1.5">
                {devTermId && (
                  <>
                    <button
                      onClick={handleStartDev}
                      disabled={devStarting}
                      className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded text-xs transition-colors disabled:opacity-50"
                    >
                      {devStarting ? 'Restarting...' : 'Restart'}
                    </button>
                    <button
                      onClick={handleStopDev}
                      className="px-2.5 py-1 bg-gray-800 hover:bg-red-900/60 border border-gray-700 hover:border-red-800 text-gray-300 hover:text-red-300 rounded text-xs transition-colors"
                    >
                      Stop
                    </button>
                  </>
                )}
                {!devTermId && (
                  <button
                    onClick={handleStartDev}
                    disabled={devStarting}
                    className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded text-xs font-medium transition-colors"
                  >
                    {devStarting ? 'Starting...' : 'Start Dev Server'}
                  </button>
                )}
              </div>
            </div>
            {devTermId && (
              <div className="border border-gray-800 rounded-lg overflow-hidden flex flex-col" style={{ height: termHeight }}>
                <div className="text-xs text-gray-600 px-2 py-1 border-b border-gray-800 bg-gray-900/80 font-mono shrink-0">
                  npm run dev — {task.worktreePath || project.path}
                </div>
                <div className="flex-1 overflow-hidden">
                  <Terminal terminalId={devTermId} />
                </div>
              </div>
            )}
          </div>

          {/* Browser / Preview */}
          {devPort && devTermId && (
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={`http://localhost:${devPort}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white rounded text-xs font-medium transition-colors"
                >
                  Open in Browser ↗
                </a>
                <button
                  onClick={() => setShowIframe(v => !v)}
                  className="px-3 py-1.5 border border-gray-800 hover:border-gray-700 text-gray-500 hover:text-white rounded text-xs transition-colors"
                >
                  {showIframe ? 'Hide Preview' : 'Show Preview'}
                </button>
                {showIframe && <span className="text-xs text-gray-700">(may not load due to CORS)</span>}
              </div>
              {showIframe && (
                <iframe
                  src={`http://localhost:${devPort}`}
                  className="w-full h-64 mt-2 border border-gray-800 rounded-lg bg-white"
                  title="Dev Preview"
                />
              )}
            </div>
          )}
        </>)}
      </div>
    </div>
  );
}
