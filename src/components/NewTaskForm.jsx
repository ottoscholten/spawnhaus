import { useState } from 'react';
import { createTask } from '../api';

export function NewTaskForm({ project, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (status) => {
    if (!title.trim() || loading) return;
    setLoading(true);
    try {
      await createTask(project.path, { title: title.trim(), description: description.trim(), status });
      onCreated();
      onClose();
    } catch {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[450]"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-white font-semibold mb-5">New Task</h2>
        <form onSubmit={e => { e.preventDefault(); handleSubmit('Backlog'); }} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-600 mb-1.5">Title</label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full bg-gray-800 border border-gray-700 focus:border-blue-600 text-white px-3 py-2 rounded text-sm outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional..."
              className="w-full bg-gray-800 border border-gray-700 focus:border-blue-600 text-white px-3 py-2 rounded text-sm outline-none transition-colors resize-none"
            />
          </div>
          <div className="flex justify-between items-center pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-500 hover:text-white text-sm transition-colors"
            >
              Cancel
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleSubmit('Ready')}
                disabled={loading || !title.trim()}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-300 rounded text-sm font-medium transition-colors"
              >
                {loading ? 'Creating...' : 'Add to Ready'}
              </button>
              <button
                type="submit"
                disabled={loading || !title.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded text-sm font-medium transition-colors"
              >
                {loading ? 'Creating...' : 'Add to Backlog'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
