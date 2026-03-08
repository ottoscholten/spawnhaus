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
const TERMINAL_COLORS = [
  { border: 'border-orange-500',  headerBg: 'bg-orange-900/40',  headerText: 'text-orange-300',  headerBorder: 'border-orange-800/60',  icon: 'text-orange-400' },
  { border: 'border-rose-500',    headerBg: 'bg-rose-900/40',    headerText: 'text-rose-300',    headerBorder: 'border-rose-800/60',    icon: 'text-rose-400' },
  { border: 'border-fuchsia-500', headerBg: 'bg-fuchsia-900/40', headerText: 'text-fuchsia-300', headerBorder: 'border-fuchsia-800/60', icon: 'text-fuchsia-400' },
  { border: 'border-teal-500',    headerBg: 'bg-teal-900/40',    headerText: 'text-teal-300',    headerBorder: 'border-teal-800/60',    icon: 'text-teal-400' },
  { border: 'border-indigo-500',  headerBg: 'bg-indigo-900/40',  headerText: 'text-indigo-300',  headerBorder: 'border-indigo-800/60',  icon: 'text-indigo-400' },
  { border: 'border-lime-500',    headerBg: 'bg-lime-900/40',    headerText: 'text-lime-300',    headerBorder: 'border-lime-800/60',    icon: 'text-lime-400' },
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
import { ExtensionsModal, RECOMMENDED_AGENTS } from './ExtensionsModal';
import { getTasks, updateTask, archiveTask, updateBoardSettings, getPrompts, updatePrompts, getActiveTerminals, getAgents } from '../api';
import { on } from '../ws';

const COLUMNS = ['Backlog', 'Scoping', 'In Progress', 'Review', 'Done'];

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

function BoardSettings({ board, project, onSaved, onClose }) {
  const [nextId, setNextId] = useState(String(board.nextId));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const num = parseInt(nextId, 10);
    if (isNaN(num) || num < 1) return;
    setSaving(true);
    await updateBoardSettings(project.path, { nextId: num });
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-72 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-white font-semibold mb-4 text-sm">Board Settings</h2>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Next task number</label>
          <input
            type="number"
            min="1"
            value={nextId}
            onChange={e => setNextId(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 focus:border-blue-600 text-white px-3 py-2 rounded text-sm outline-none font-mono"
            autoFocus
          />
          <p className="text-xs text-gray-600 mt-1.5">Next task will be TASK-{String(nextId).padStart(3, '0')}</p>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-gray-500 hover:text-white text-sm transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition-colors disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptsModal({ onClose }) {
  const [prompts, setPrompts] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPrompts().then(setPrompts);
  }, []);

  const handleSave = async () => {
    if (!prompts) return;
    setSaving(true);
    await updatePrompts(prompts);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[560px] max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Agent Prompts</h2>
            <p className="text-xs text-gray-600 mt-0.5">Global — stored in ~/.spawnhaus/prompts.json</p>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-white text-xl leading-none">×</button>
        </div>

        {!prompts ? (
          <div className="p-5 text-xs text-gray-600">Loading...</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <p className="text-xs text-gray-600">
              Variables: <code className="text-gray-400 bg-gray-800 px-1 rounded">{'{taskId}'}</code>{' '}
              <code className="text-gray-400 bg-gray-800 px-1 rounded">{'{title}'}</code>{' '}
              <code className="text-gray-400 bg-gray-800 px-1 rounded">{'{description}'}</code>{' '}
              <code className="text-gray-400 bg-gray-800 px-1 rounded">{'{branch}'}</code>
            </p>
            <div>
              <label className="block text-xs text-purple-400 font-medium mb-1.5 uppercase tracking-wider">Scoping Prompt</label>
              <p className="text-xs text-gray-600 mb-1.5">Used when task status is <em>Scoping</em>. Claude should move the task to In Progress when done.</p>
              <textarea
                value={prompts.scopingPrompt}
                onChange={e => setPrompts(p => ({ ...p, scopingPrompt: e.target.value }))}
                rows={8}
                className="w-full bg-gray-800 border border-gray-700 focus:border-purple-600 text-gray-300 text-xs px-3 py-2 rounded outline-none resize-y font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-blue-400 font-medium mb-1.5 uppercase tracking-wider">Implementation Prompt</label>
              <p className="text-xs text-gray-600 mb-1.5">Used when task status is <em>In Progress</em> or later.</p>
              <textarea
                value={prompts.implementationPrompt}
                onChange={e => setPrompts(p => ({ ...p, implementationPrompt: e.target.value }))}
                rows={8}
                className="w-full bg-gray-800 border border-gray-700 focus:border-blue-600 text-gray-300 text-xs px-3 py-2 rounded outline-none resize-y font-mono"
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-800 shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 text-gray-500 hover:text-white text-sm transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving || !prompts} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition-colors disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
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

export function Board({ project, onChangeProject, notice, onDismissNotice }) {
  const [board, setBoard] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [showExtensions, setShowExtensions] = useState(false);
  const [agentBanner, setAgentBanner] = useState(null); // array of missing agent names
  const [dragging, setDragging] = useState(null);
  const [activeTerminals, setActiveTerminals] = useState({});
  const [stickyTerminals, setStickyTerminals] = useState([]);

  const fetchBoard = useCallback(async () => {
    try {
      const [data, active] = await Promise.all([getTasks(project.path), getActiveTerminals(project.path)]);
      setBoard(data);
      setActiveTerminals(active);
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

    await updateTask(project.path, task.id, { status: targetStatus });
    fetchBoard();
  };

  const handleOpenTerminal = (task) => {
    const terminalId = activeTerminals[task.id];
    if (!terminalId) return;
    setStickyTerminals(prev => prev.find(s => s.task.id === task.id)
      ? prev
      : [...prev, { task, terminalId }]);
  };

  const handleArchive = async (task) => {
    await archiveTask(project.path, task.id);
    if (selectedTask?.id === task.id) setSelectedTask(null);
    fetchBoard();
  };

  if (!board) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-700 text-sm">Loading...</div>
      </div>
    );
  }

  const tasksByCol = (col) => board.tasks.filter(t => t.status === col);
  const terminalColorMap = Object.fromEntries(Object.keys(activeTerminals).map(id => [id, taskColor(id)]));

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col overflow-hidden">
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
            <button onClick={() => setShowExtensions(true)} className="underline hover:text-amber-300 transition-colors">
              View in Extensions
            </button>
          </span>
          <button onClick={() => setAgentBanner(null)} className="text-amber-600 hover:text-amber-300 text-lg leading-none ml-4">×</button>
        </div>
      )}
      {/* Header */}
      <div className="shrink-0 border-b border-gray-800 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-white font-semibold text-sm">{project.name}</span>
          <span className="text-gray-700 text-xs font-mono hidden sm:block truncate max-w-xs">{project.path}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExtensions(true)}
            className="px-3 py-1.5 text-gray-600 hover:text-white text-xs transition-colors"
            title="Skills, agents & plugins"
          >
            Extensions
          </button>
          <button
            onClick={() => setShowPrompts(true)}
            className="px-3 py-1.5 text-gray-600 hover:text-white text-xs transition-colors"
            title="Agent prompts (global)"
          >
            Agent Prompts
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="px-2 py-1.5 text-gray-600 hover:text-white text-base leading-none transition-colors"
            title="Board settings"
          >
            ⚙
          </button>
          <button
            onClick={() => setShowNewTask(true)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition-colors"
          >
            + New Task
          </button>
          <button
            onClick={onChangeProject}
            className="px-3 py-1.5 text-gray-600 hover:text-white text-xs transition-colors"
          >
            Switch Project
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
          <div className="flex gap-4 p-5 overflow-x-auto flex-1">
            {COLUMNS.map(col => (
              <Column
                key={col}
                id={col}
                title={col}
                tasks={tasksByCol(col)}
                onTaskClick={(task) => {
                  setSelectedTask(task);
                }}
                onArchive={handleArchive}
                activeTerminals={activeTerminals}
                onOpenTerminal={handleOpenTerminal}
                terminalColorMap={terminalColorMap}
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
            <div className="absolute left-0 top-0 bottom-0 w-2/5 z-10" onClick={() => setSelectedTask(null)} />
            <div className="absolute right-0 top-0 bottom-0 w-3/5 z-20 shadow-2xl border-l border-gray-800">
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
      </div>

      {showNewTask && (
        <NewTaskForm
          project={project}
          onClose={() => setShowNewTask(false)}
          onCreated={fetchBoard}
        />
      )}

      {showSettings && board && (
        <BoardSettings
          board={board}
          project={project}
          onSaved={fetchBoard}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showPrompts && (
        <PromptsModal onClose={() => setShowPrompts(false)} />
      )}

      {showExtensions && (
        <ExtensionsModal project={project} onClose={() => setShowExtensions(false)} />
      )}

      {stickyTerminals.map(({ task, terminalId }, i) => (
        <StickyTerminal
          key={task.id}
          task={task}
          terminalId={terminalId}
          index={i}
          onClose={() => setStickyTerminals(prev => prev.filter(s => s.task.id !== task.id))}
          color={taskColor(task.id)}
        />
      ))}
    </div>
  );
}
