import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const PRIORITY_DOT = {
  high:   'text-red-500',
  medium: 'text-amber-500',
  low:    'text-blue-400',
};

export function Card({ task, onClick, isDone, isBacklog, onArchive, onMoveToReady, hasActiveTerminal, onOpenTerminal, terminalColor, terminalNeedsAttention, hasDevServer, devPort, devUrl }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const borderCls = terminalNeedsAttention
    ? `border-2 border-amber-400 animate-pulse`
    : hasActiveTerminal && terminalColor
    ? `border-2 ${terminalColor.border}`
    : 'border border-gray-700/50 hover:border-gray-600 hover:shadow-md hover:-translate-y-px';

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1,
      }}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`bg-gray-900 ${borderCls} rounded-lg p-3 cursor-pointer select-none transition-all group`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            {task.priority && (
              <span className={`text-[9px] leading-none ${PRIORITY_DOT[task.priority]}`} title={task.priority}>▲</span>
            )}
            <span className="text-xs text-gray-700 font-mono">{task.id}</span>
          </div>
          <div className="text-sm text-white leading-snug font-medium">{task.title}</div>
          {task.branch && (
            <div className="text-xs text-gray-700 font-mono mt-1.5 truncate">{task.branch}</div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {hasDevServer && (devUrl || devPort) && (
            <a
              href={devUrl || `http://localhost:${devPort}`}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-blue-500 hover:text-blue-300 w-6 h-6 flex items-center justify-center rounded hover:bg-gray-800 transition-colors"
              title={`Open ${devUrl || `localhost:${devPort}`}`}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1"/>
                <path d="M6.5 1c0 0-2 2-2 5.5s2 5.5 2 5.5M6.5 1c0 0 2 2 2 5.5S6.5 12 6.5 12M1 6.5h11" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
              </svg>
            </a>
          )}
          {hasActiveTerminal && (
            <button
              onClick={e => { e.stopPropagation(); onOpenTerminal(task); }}
              className={`${terminalColor?.icon || 'text-emerald-400'} hover:text-white text-sm leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-gray-800 transition-colors`}
              title={terminalNeedsAttention ? 'Needs attention' : 'Open terminal'}
            >
              ⬡
            </button>
          )}
          {isBacklog && (
            <button
              onClick={e => { e.stopPropagation(); onMoveToReady(task); }}
              className="opacity-0 group-hover:opacity-100 text-gray-700 hover:text-cyan-400 transition-all text-xs leading-none px-1.5 h-6 flex items-center justify-center rounded hover:bg-gray-800"
              title="Move to Ready"
            >
              →
            </button>
          )}
          {isDone && (
            <button
              onClick={e => { e.stopPropagation(); onArchive(task); }}
              className="opacity-0 group-hover:opacity-100 text-gray-700 hover:text-red-400 transition-all text-lg leading-none w-6 h-6 flex items-center justify-center"
              title="Archive task"
            >
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
