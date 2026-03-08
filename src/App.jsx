import { useState, useEffect } from 'react';
import { ProjectPicker } from './components/ProjectPicker';
import { Board } from './components/Board';
import { setActiveProject } from './api';

export default function App() {
  const [project, setProject] = useState(() => {
    try {
      const saved = localStorage.getItem('spawnhaus-project');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (project) setActiveProject(project.path).catch(() => {});
  }, [project?.path]);

  const handleSelect = (proj, msg) => {
    localStorage.setItem('spawnhaus-project', JSON.stringify(proj));
    setNotice(msg || null);
    setProject(proj);
  };

  const handleChange = () => {
    localStorage.removeItem('spawnhaus-project');
    setProject(null);
  };

  if (!project) return <ProjectPicker onSelect={handleSelect} />;
  return <Board project={project} onChangeProject={handleChange} notice={notice} onDismissNotice={() => setNotice(null)} />;
}
