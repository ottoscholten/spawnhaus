import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  pointerWithin,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';

// Colors chosen to not clash with column header colors (blue=In Progress, purple=Scoping, yellow=Review, green=Done)
// Orange/amber is reserved for the Orchestrator — task terminals never use it
const TERMINAL_COLORS = [
  { border: 'border-rose-500',    headerBg: 'bg-rose-900/40',    headerText: 'text-rose-300',    headerBorder: 'border-rose-800/60',    icon: 'text-rose-400' },
  { border: 'border-fuchsia-500', headerBg: 'bg-fuchsia-900/40', headerText: 'text-fuchsia-300', headerBorder: 'border-fuchsia-800/60', icon: 'text-fuchsia-400' },
  { border: 'border-teal-500',    headerBg: 'bg-teal-900/40',    headerText: 'text-teal-300',    headerBorder: 'border-teal-800/60',    icon: 'text-teal-400' },
  { border: 'border-indigo-500',  headerBg: 'bg-indigo-900/40',  headerText: 'text-indigo-300',  headerBorder: 'border-indigo-800/60',  icon: 'text-indigo-400' },
  { border: 'border-lime-500',    headerBg: 'bg-lime-900/40',    headerText: 'text-lime-300',    headerBorder: 'border-lime-800/60',    icon: 'text-lime-400' },
  { border: 'border-sky-500',     headerBg: 'bg-sky-900/40',     headerText: 'text-sky-300',     headerBorder: 'border-sky-800/60',     icon: 'text-sky-400' },
];

function taskColor(taskId) {
  const num = parseInt(taskId.replace(/\D/g, ''), 10) || 0;
  return TERMINAL_COLORS[num % TERMINAL_COLORS.length];
}

const collisionDetection = (args) => {
  const archiveHit = pointerWithin({
    ...args,
    droppableContainers: args.droppableContainers.filter(c => c.id === '__archive__'),
  });
  if (archiveHit.length > 0) return archiveHit;
  return closestCorners(args);
};
import { Column } from './Column';
import { TicketPanel } from './TicketPanel';
import { NewTaskForm } from './NewTaskForm';
import { Terminal } from './Terminal';
import { SettingsPanel } from './SettingsPanel';
import { RECOMMENDED_AGENTS } from '../recommendations';
import { getTasks, updateTask, archiveTask, getActiveTerminals, getAgents, createTerminal, killTerminal, updateBoardSettings, createWorktree } from '../api';
import { on } from '../ws';

const COLUMNS = ['Backlog', 'Ready', 'Scoping', 'In Progress', 'Review', 'Done'];

function ArchiveDropZone({ isActive }) {
  const { setNodeRef, isOver } = useDroppable({ id: '__archive__' });
  return (
    <div
      ref={setNodeRef}
      className={`w-44 shrink-0 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5 transition-colors duration-150 ${
        isOver
          ? 'border-red-500 bg-red-900/20 text-red-400'
          : isActive
          ? 'border-gray-600 text-gray-500'
          : 'border-gray-800 text-gray-700'
      }`}
    >
      <span className="text-lg">↓</span>
      <span className="text-xs font-medium uppercase tracking-wider">Archive</span>
    </div>
  );
}


function StickyTerminal({ task, terminalId, index, onClose, color }) {
  const [pos, setPos] = useState({ x: 40 + index * 24, y: 60 + index * 24 });
  const [size, setSize] = useState({ w: 580, h: 320 });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const onMouseDown = (e) => {
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const onMove = (ev) => {
      if (!dragging.current) return;
      setPos({ x: ev.clientX - dragOffset.current.x, y: ev.clientY - dragOffset.current.y });
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const onResizeMouseDown = (e) => {
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startW = size.w, startH = size.h;
    const onMove = (ev) => setSize({
      w: Math.max(300, startW + ev.clientX - startX),
      h: Math.max(200, startH + ev.clientY - startY),
    });
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      style={{ position: 'fixed', left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: 200 }}
      className="bg-gray-950 border border-gray-700 rounded-xl shadow-2xl flex flex-col overflow-hidden"
    >
      <div
        onMouseDown={onMouseDown}
        className={`shrink-0 flex items-center justify-between px-3 py-2 border-b cursor-grab active:cursor-grabbing select-none ${color ? `${color.headerBg} ${color.headerText} ${color.headerBorder}` : 'border-gray-800 bg-gray-900'}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600 font-mono">{task.id}</span>
          <span className="text-xs text-gray-400 truncate max-w-xs">{task.title}</span>
        </div>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={onClose}
          className="text-gray-600 hover:text-white text-lg leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-gray-800"
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <Terminal terminalId={terminalId} fontSize={12} />
      </div>
      <div
        onMouseDown={onResizeMouseDown}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        style={{ background: 'transparent' }}
      />
    </div>
  );
}

function OrchestratorTerminal({ terminalId, onClose, onEndSession, onNewSession }) {
  const [pos, setPos] = useState(() => ({ x: 20, y: Math.max(60, window.innerHeight - 360) }));
  const [size, setSize] = useState({ w: 580, h: 320 });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const onMouseDown = (e) => {
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const onMove = (ev) => { if (dragging.current) setPos({ x: ev.clientX - dragOffset.current.x, y: ev.clientY - dragOffset.current.y }); };
    const onUp = () => { dragging.current = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const onResizeMouseDown = (e) => {
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY, startW = size.w, startH = size.h;
    const onMove = (ev) => setSize({ w: Math.max(400, startW + ev.clientX - startX), h: Math.max(240, startH + ev.clientY - startY) });
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      style={{ position: 'fixed', left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: 300 }}
      className="bg-gray-950 border border-amber-800/50 rounded-xl shadow-2xl flex flex-col overflow-hidden"
      onClick={e => e.stopPropagation()}
    >
      <div
        onMouseDown={onMouseDown}
        className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-amber-800/40 bg-amber-950/50 cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-center gap-2">
          <span className="text-amber-500 text-sm">⬡</span>
          <span className="text-amber-300 text-xs font-semibold tracking-wide">Orchestrator</span>
          <div className="flex items-center gap-1" onMouseDown={e => e.stopPropagation()}>
            <button
              onClick={onNewSession}
              className="text-amber-800 hover:text-amber-300 text-xs px-2 py-0.5 rounded hover:bg-amber-900/40 transition-colors"
              title="Clear session and start fresh next time"
            >New</button>
            <button
              onClick={onEndSession}
              className="text-amber-800 hover:text-amber-300 text-xs px-2 py-0.5 rounded hover:bg-amber-900/40 transition-colors"
              title="End session (saves for resume)"
            >End session</button>
          </div>
        </div>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={onClose}
          className="text-amber-800 hover:text-amber-300 text-lg leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-amber-900/40 transition-colors"
        >×</button>
      </div>
      <div className="flex-1 overflow-hidden">
        <Terminal terminalId={terminalId} fontSize={12} />
      </div>
      <div onMouseDown={onResizeMouseDown} className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize" />
    </div>
  );
}

export function Board({ project, onChangeProject, notice, onDismissNotice }) {
  const [board, setBoard] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [agentBanner, setAgentBanner] = useState(null); // array of missing agent names
  const [dragging, setDragging] = useState(null);
  const [activeTerminals, setActiveTerminals] = useState({});
  const [stickyTerminals, setStickyTerminals] = useState([]);
  const [showOrchestrator, setShowOrchestrator] = useState(false);
  const relaunchingOrchestrator = useRef(false);
  const [needsAttention, setNeedsAttention] = useState(new Set());
  const attentionTimers = useRef({});
  const [devUrls, setDevUrls] = useState({});
  const activeTerminalsRef = useRef({});

  const fetchBoard = useCallback(async () => {
    try {
      const [data, active] = await Promise.all([getTasks(project.path), getActiveTerminals(project.path)]);
      setBoard(data);
      setActiveTerminals(active);
      activeTerminalsRef.current = active;
    } catch {}
  }, [project.path]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  // Check for missing recommended agents on project open
  useEffect(() => {
    if (RECOMMENDED_AGENTS.length === 0) return;
    getAgents(project.path).then(agents => {
      const installedNames = new Set(agents.map(a => a.name || a.id));
      const missing = RECOMMENDED_AGENTS.filter(r => !installedNames.has(r.name)).map(r => r.name);
      if (missing.length > 0) setAgentBanner(missing);
    }).catch(() => {});
  }, [project.path]);

  useEffect(() => {
    if (!board || !selectedTask) return;
    const updated = board.tasks.find(t => t.id === selectedTask.id);
    if (updated) setSelectedTask(updated);
    else setSelectedTask(null);
  }, [board]);

  useEffect(() => on('board-update', fetchBoard), [fetchBoard]);

  // Attention detection: terminal idle for 5s after activity = needs attention
  // Also parse dev server URLs from terminal output
  useEffect(() => on('terminal-output', ({ terminalId, data }) => {
    clearTimeout(attentionTimers.current[terminalId]);
    setNeedsAttention(prev => {
      if (!prev.has(terminalId)) return prev;
      const next = new Set(prev); next.delete(terminalId); return next;
    });
    attentionTimers.current[terminalId] = setTimeout(() => {
      setNeedsAttention(prev => new Set([...prev, terminalId]));
    }, 5000);
    // Parse dev server URL
    const devEntry = Object.entries(activeTerminalsRef.current).find(([k, v]) => v === terminalId && k.endsWith(':dev'));
    if (devEntry && data) {
      const matches = [...data.matchAll(/https?:\/\/localhost:\d+/g)];
      if (matches.length) {
        const taskId = devEntry[0].replace(':dev', '');
        const url = matches[matches.length - 1][0].replace(/\/$/, '');
        setDevUrls(prev => prev[taskId] === url ? prev : { ...prev, [taskId]: url });
      }
    }
  }), []);

  useEffect(() => on('terminal-exit', ({ terminalId }) => {
    clearTimeout(attentionTimers.current[terminalId]);
    delete attentionTimers.current[terminalId];
    setNeedsAttention(prev => { const next = new Set(prev); next.delete(terminalId); return next; });
    const devEntry = Object.entries(activeTerminalsRef.current).find(([k, v]) => v === terminalId && k.endsWith(':dev'));
    if (devEntry) {
      const taskId = devEntry[0].replace(':dev', '');
      setDevUrls(prev => { const next = { ...prev }; delete next[taskId]; return next; });
    }
  }), []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const handleDragStart = ({ active }) => {
    const task = board?.tasks.find(t => t.id === active.id);
    setDragging(task || null);
  };

  const handleDragEnd = async ({ active, over }) => {
    setDragging(null);
    if (!over || active.id === over.id) return;

    const task = board.tasks.find(t => t.id === active.id);
    if (!task) return;

    // Archive drop zone — only Done tasks
    if (over.id === '__archive__') {
      if (task.status !== 'Done') return;
      await archiveTask(project.path, task.id);
      if (selectedTask?.id === task.id) setSelectedTask(null);
      fetchBoard();
      return;
    }

    const targetStatus = COLUMNS.includes(String(over.id))
      ? String(over.id)
      : board.tasks.find(t => t.id === over.id)?.status;

    if (!targetStatus || targetStatus === task.status) return;

    setBoard(prev => ({
      ...prev,
      tasks: prev.tasks.map(t => t.id === task.id ? { ...t, status: targetStatus } : t),
    }));

    const updatedTask = await updateTask(project.path, task.id, { status: targetStatus });
    if (targetStatus === 'Scoping' && !task.worktreePath) {
      const wt = await createWorktree(project.path, updatedTask.id);
      await updateTask(project.path, updatedTask.id, { worktreePath: wt.worktreePath, branch: wt.branch });
    }
    fetchBoard();
  };

  const clearAttention = (terminalId) => {
    if (!terminalId) return;
    clearTimeout(attentionTimers.current[terminalId]);
    setNeedsAttention(prev => { const next = new Set(prev); next.delete(terminalId); return next; });
  };

  const handleOpenTerminal = (task) => {
    const terminalId = activeTerminals[task.id];
    if (!terminalId) return;
    clearAttention(terminalId);
    setStickyTerminals(prev => prev.find(s => s.task.id === task.id)
      ? prev
      : [...prev, { task, terminalId }]);
  };

  // Hide orchestrator panel when its terminal exits (skip if we're relaunching)
  useEffect(() => {
    if (!activeTerminals['__orchestrator__'] && !relaunchingOrchestrator.current) setShowOrchestrator(false);
  }, [activeTerminals]);

  const launchOrchestrator = async () => {
    const data = await fetch('/api/orchestrator/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: project.path }),
    }).then(r => r.json());
    if (data.terminalId) return; // already running
    await createTerminal(data.cwd, data.command, data.message, data.taskId, data.projectPath);
    await fetchBoard();
  };

  const handleOrchestratorClick = async () => {
    if (activeTerminals['__orchestrator__']) {
      clearAttention(activeTerminals['__orchestrator__']);
      setShowOrchestrator(s => !s);
      return;
    }
    try {
      await launchOrchestrator();
      setShowOrchestrator(true);
    } catch {}
  };

  const handleEndOrchestratorSession = async () => {
    const termId = activeTerminals['__orchestrator__'];
    if (termId) await killTerminal(termId);
    // fetchBoard will be triggered by board-update broadcast on terminal exit
  };

  const handleNewOrchestratorSession = async () => {
    const termId = activeTerminals['__orchestrator__'];
    relaunchingOrchestrator.current = true;
    try {
      if (termId) await killTerminal(termId);
      await updateBoardSettings(project.path, { orchestratorSessionId: null });
      await launchOrchestrator();
      setShowOrchestrator(true);
    } finally {
      relaunchingOrchestrator.current = false;
    }
  };

  const handleArchive = async (task) => {
    await archiveTask(project.path, task.id);
    if (selectedTask?.id === task.id) setSelectedTask(null);
    fetchBoard();
  };

  if (!board) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex gap-1.5">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-1.5 h-1.5 rounded-full bg-gray-700 animate-pulse" style={{ animationDelay: `${i * 200}ms` }} />
          ))}
        </div>
      </div>
    );
  }

  const tasksByCol = (col) => board.tasks.filter(t => t.status === col);
  const terminalColorMap = Object.fromEntries(Object.keys(activeTerminals).map(id => [id, taskColor(id)]));
  const openStickyTerminalIds = new Set(stickyTerminals.map(s => s.terminalId));
  const effectiveNeedsAttention = new Set([...needsAttention].filter(tid => !openStickyTerminalIds.has(tid)));
  const orchestratorNeedsAttention = !showOrchestrator && needsAttention.has(activeTerminals['__orchestrator__']);

  return (
    <div className="h-screen bg-gray-950 flex flex-col overflow-hidden" onClick={() => { if (showOrchestrator) { clearAttention(activeTerminals['__orchestrator__']); setShowOrchestrator(false); } }}>
      {notice && (
        <div className="shrink-0 bg-emerald-900/40 border-b border-emerald-800/50 px-5 py-2 flex items-center justify-between">
          <span className="text-xs text-emerald-400">{notice}</span>
          <button onClick={onDismissNotice} className="text-emerald-600 hover:text-emerald-300 text-lg leading-none ml-4">×</button>
        </div>
      )}
      {agentBanner && (
        <div className="shrink-0 bg-amber-900/30 border-b border-amber-800/40 px-5 py-2 flex items-center justify-between">
          <span className="text-xs text-amber-400">
            Recommended agent{agentBanner.length > 1 ? 's' : ''} not installed: {agentBanner.join(', ')}.{' '}
            <button onClick={() => setShowSettings(true)} className="underline hover:text-amber-300 transition-colors">
              View in Settings
            </button>
          </span>
          <button onClick={() => setAgentBanner(null)} className="text-amber-600 hover:text-amber-300 text-lg leading-none ml-4">×</button>
        </div>
      )}
      {/* Header */}
      <div className="shrink-0 border-b border-gray-800 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-white font-semibold text-sm">Spawnhaus</span>
          <span className="text-gray-700 text-xs">·</span>
          <span className="text-gray-400 text-xs font-medium">{project.name}</span>
          <span className="text-gray-700 text-xs font-mono hidden lg:block truncate max-w-xs">{project.path}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewTask(true)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition-colors"
          >
            + New Task
          </button>
          <button
            onClick={() => setShowSettings(s => !s)}
            className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${showSettings ? 'text-white bg-gray-800' : 'text-gray-600 hover:text-white hover:bg-gray-800/60'}`}
            title="Settings"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7.5 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M2.697 2.697l1.06 1.06M11.243 11.243l1.06 1.06M2.697 12.303l1.06-1.06M11.243 3.757l1.06-1.06" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Board + Panel */}
      <div className="flex-1 flex overflow-hidden relative">
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className={`flex gap-4 p-5 flex-1 h-full ${selectedTask ? 'overflow-hidden' : 'overflow-x-auto overflow-y-hidden'}`}>
            {COLUMNS.map(col => (
              <Column
                key={col}
                id={col}
                title={col}
                tasks={tasksByCol(col)}
                onTaskClick={(task) => {
                  setSelectedTask(task);
                  setShowSettings(false);
                }}
                onArchive={handleArchive}
                onMoveToReady={async (task) => {
                  await updateTask(project.path, task.id, { status: 'Ready' });
                  fetchBoard();
                }}
                activeTerminals={activeTerminals}
                onOpenTerminal={handleOpenTerminal}
                terminalColorMap={terminalColorMap}
                needsAttention={effectiveNeedsAttention}
                devUrls={devUrls}
              />
            ))}
            <ArchiveDropZone isActive={dragging?.status === 'Done'} />
          </div>
          <DragOverlay dropAnimation={null}>
            {dragging && (
              <div className="bg-gray-900 border border-blue-500 rounded-lg p-3 shadow-2xl w-64 opacity-95 rotate-1">
                <div className="text-xs text-gray-500 font-mono mb-1">{dragging.id}</div>
                <div className="text-sm text-white font-medium">{dragging.title}</div>
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {selectedTask && (
          <>
            <div className="absolute left-0 top-0 bottom-0 w-2/5 z-[390]" onClick={() => setSelectedTask(null)} />
            <div className="absolute right-0 top-0 bottom-0 w-3/5 z-[400] shadow-2xl border-l border-gray-800">
              <TicketPanel
                task={selectedTask}
                project={project}
                onClose={() => setSelectedTask(null)}
                onUpdate={fetchBoard}
                activeTerminals={activeTerminals}
                terminalColor={activeTerminals[selectedTask.id] ? taskColor(selectedTask.id) : null}
                hasStickyTerminal={stickyTerminals.some(s => s.task.id === selectedTask.id)}
              />
            </div>
          </>
        )}

        {showSettings && board && (
          <SettingsPanel
            project={project}
            board={board}
            onClose={() => setShowSettings(false)}
            onBoardSaved={fetchBoard}
            onChangeProject={onChangeProject}
          />
        )}
      </div>

      {showNewTask && (
        <NewTaskForm
          project={project}
          onClose={() => setShowNewTask(false)}
          onCreated={fetchBoard}
        />
      )}

      {stickyTerminals.map(({ task, terminalId }, i) => (
        <StickyTerminal
          key={task.id}
          task={task}
          terminalId={terminalId}
          index={i}
          onClose={() => { clearAttention(terminalId); setStickyTerminals(prev => prev.filter(s => s.task.id !== task.id)); }}
          color={taskColor(task.id)}
        />
      ))}

      {/* Orchestrator sticky button */}
      <button
        onClick={e => { e.stopPropagation(); handleOrchestratorClick(); }}
        className={`fixed bottom-5 left-5 z-[350] flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium shadow-lg border transition-colors ${
          activeTerminals['__orchestrator__']
            ? 'bg-amber-950/90 border-amber-700/60 text-amber-300 hover:bg-amber-900/90'
            : 'bg-gray-900/90 border-gray-700/60 text-gray-400 hover:text-amber-300 hover:border-amber-800/60 hover:bg-amber-950/60'
        } ${orchestratorNeedsAttention ? 'ring-2 ring-amber-300 animate-pulse' : ''}`}
        title="Orchestrator — project-level planning agent"
      >
        <span className={activeTerminals['__orchestrator__'] ? 'text-amber-500' : 'text-gray-600'}>⬡</span>
        <span>Orchestrator</span>
        {activeTerminals['__orchestrator__'] && (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        )}
      </button>

      {showOrchestrator && activeTerminals['__orchestrator__'] && (
        <OrchestratorTerminal
          terminalId={activeTerminals['__orchestrator__']}
          onClose={() => { clearAttention(activeTerminals['__orchestrator__']); setShowOrchestrator(false); }}
          onEndSession={handleEndOrchestratorSession}
          onNewSession={handleNewOrchestratorSession}
        />
      )}
    </div>
  );
}
