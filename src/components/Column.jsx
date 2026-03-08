import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card } from './Card';

const HEADER_STYLE = {
  'Backlog': 'text-gray-500',
  'Scoping': 'text-purple-400',
  'In Progress': 'text-blue-400',
  'Review': 'text-yellow-400',
  'Done': 'text-green-400',
};

export function Column({ id, title, tasks, onTaskClick, onArchive, activeTerminals, onOpenTerminal }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="flex flex-col w-64 shrink-0">
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className={`text-xs font-semibold uppercase tracking-wider ${HEADER_STYLE[title]}`}>
          {title}
        </span>
        <span className="text-xs text-gray-700 bg-gray-800 px-1.5 py-0.5 rounded-full tabular-nums">
          {tasks.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 min-h-16 rounded-lg p-2 transition-colors duration-150 ${
          isOver ? 'bg-gray-800/50 ring-1 ring-inset ring-gray-700' : 'bg-gray-900/20'
        }`}
      >
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {tasks.map(task => (
              <Card
                key={task.id}
                task={task}
                onClick={() => onTaskClick(task)}
                isDone={title === 'Done'}
                onArchive={onArchive}
                hasActiveTerminal={!!activeTerminals?.[task.id]}
                onOpenTerminal={onOpenTerminal}
              />
            ))}
          </div>
        </SortableContext>
      </div>
    </div>
  );
}
