import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card } from './Card';

const HEADER_STYLE = {
  'Backlog': 'text-gray-500',
  'Ready': 'text-cyan-400',
  'Scoping': 'text-purple-400',
  'In Progress': 'text-blue-400',
  'Review': 'text-yellow-400',
  'Done': 'text-green-400',
};

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

export function Column({ id, title, tasks, onTaskClick, onArchive, onMoveToReady, activeTerminals, onOpenTerminal, terminalColorMap, needsAttention, devUrls }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const sortedTasks = [...tasks].sort((a, b) =>
    (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3)
  );

  return (
    <div className="flex flex-col w-64 shrink-0 h-full">
      <div className="flex items-center gap-2 mb-3 px-1 shrink-0">
        <span className={`text-xs font-semibold uppercase tracking-wider ${HEADER_STYLE[title]}`}>
          {title}
        </span>
        <span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded-full tabular-nums">
          {tasks.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto min-h-16 rounded-lg p-2 transition-colors duration-150 ${
          isOver ? 'bg-gray-800/50 ring-1 ring-inset ring-gray-700' : 'bg-gray-900/20'
        }`}
      >
        <SortableContext items={sortedTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {sortedTasks.map(task => (
              <Card
                key={task.id}
                task={task}
                onClick={() => onTaskClick(task)}
                isDone={title === 'Done'}
                isBacklog={title === 'Backlog'}
                onArchive={onArchive}
                onMoveToReady={onMoveToReady}
                hasActiveTerminal={!!activeTerminals?.[task.id]}
                onOpenTerminal={onOpenTerminal}
                terminalColor={activeTerminals?.[task.id] ? terminalColorMap?.[task.id] : null}
                terminalNeedsAttention={needsAttention?.has(activeTerminals?.[task.id])}
                hasDevServer={!!activeTerminals?.[task.id + ':dev']}
                devPort={task.devPort}
                devUrl={devUrls?.[task.id]}
              />
            ))}
          </div>
        </SortableContext>
      </div>
    </div>
  );
}
