import { useState, useEffect } from 'react';
import { getProjects, addProject, browseFolder, removeProject } from '../api';

function basename(p) {
  return p.split('/').filter(Boolean).pop() || p;
}

export function ProjectPicker({ onSelect }) {
  const [projects, setProjects] = useState([]);
  const [inputPath, setInputPath] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    getProjects().then(setProjects).catch(() => {});
  }, []);

  const handleOpen = async (e) => {
    e.preventDefault();
    const p = inputPath.trim();
    if (!p) return;
    setError('');
    try {
      const result = await addProject(basename(p), p);
      const notice = result.claudeMdUpdated ? 'Updated CLAUDE.md — added .kanban/WORKFLOW.md reference' : null;
      onSelect({ name: basename(p), path: p }, notice);
    } catch (err) {
      setError(err?.message === '400' ? 'Path does not exist.' : 'Server error — is the backend running?');
    }
  };

  const handleBrowse = async () => {
    try {
      const { path: p } = await browseFolder();
      if (!p) return;
      const clean = p.replace(/\/$/, '');
      const result = await addProject(basename(clean), clean);
      const msg = result.claudeMdUpdated ? 'Updated CLAUDE.md — added .kanban/WORKFLOW.md reference' : null;
      onSelect({ name: basename(clean), path: clean }, msg);
    } catch {}
  };

  return (
    <div className="h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tight font-mono">spawnhaus<span className="text-blue-500 animate-pulse">_</span></h1>
          <p className="text-gray-500 text-sm mt-1">vibe coding project hub</p>
        </div>

        <form onSubmit={handleOpen} className="mb-8">
          <label className="block text-xs text-gray-600 uppercase tracking-wider mb-2">
            Open Project
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={inputPath}
              onChange={e => { setInputPath(e.target.value); setError(''); }}
              placeholder="/path/to/project"
              className="flex-1 bg-gray-900 border border-gray-800 hover:border-gray-700 focus:border-blue-600 text-white px-3 py-2 rounded text-sm outline-none transition-colors font-mono"
              autoFocus
            />
            <button
              type="button"
              onClick={handleBrowse}
              className="px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded text-sm transition-colors"
              title="Browse for folder"
            >
              Browse
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition-colors"
            >
              Open
            </button>
          </div>
          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
        </form>

        {projects.length > 0 && (
          <div>
            <p className="text-xs text-gray-700 uppercase tracking-wider mb-3">Recent Projects</p>
            <div className="space-y-1">
              {projects.map(p => (
                <div key={p.path} className="flex items-center gap-2 group/row">
                  <button
                    onClick={() => onSelect(p, null)}
                    className="flex-1 text-left px-3 py-2.5 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 transition-colors group"
                  >
                    <div className="text-white text-sm font-medium group-hover:text-blue-400 transition-colors">
                      {p.name}
                    </div>
                    <div className="text-gray-600 text-xs font-mono mt-0.5">{p.path}</div>
                  </button>
                  <button
                    onClick={async () => {
                      await removeProject(p.path);
                      setProjects(prev => prev.filter(pr => pr.path !== p.path));
                    }}
                    className="opacity-0 group-hover/row:opacity-100 text-gray-700 hover:text-red-400 transition-all text-lg leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-gray-800 shrink-0"
                    title="Remove from list"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
