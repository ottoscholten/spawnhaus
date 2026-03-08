import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export function Card({ task, onClick, isDone, onArchive, hasActiveTerminal, onOpenTerminal }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

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
      className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-lg p-3 cursor-pointer select-none transition-colors group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-700 font-mono mb-1">{task.id}</div>
          <div className="text-sm text-white leading-snug font-medium">{task.title}</div>
          {task.branch && (
            <div className="text-xs text-gray-700 font-mono mt-1.5 truncate">{task.branch}</div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {hasActiveTerminal && (
            <button
              onClick={e => { e.stopPropagation(); onOpenTerminal(task); }}
              className="text-emerald-500 hover:text-emerald-300 text-sm leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-gray-800 transition-colors"
              title="Open terminal"
            >
              ⬡
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
