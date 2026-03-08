import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { getSkills, getAgents, getPlugins, deletePlugin, createTerminal } from '../api';

// Hardcoded recommended items (project-type-agnostic for now)
const RECOMMENDED_SKILLS = [
  { id: 'commit', name: 'commit', description: 'Generate smart git commit messages from staged changes' },
  { id: 'review-pr', name: 'review-pr', description: 'AI-powered pull request review with actionable feedback' },
  { id: 'test-runner', name: 'test-runner', description: 'Run and summarise test suites intelligently' },
];

export const RECOMMENDED_AGENTS = [
  // Currently empty — extend per project type as needed
];

const TABS = ['Skills', 'Agents', 'Plugins'];

function TabBar({ active, onChange }) {
  return (
    <div className="flex border-b border-gray-800 shrink-0 px-5">
      {TABS.map(tab => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
            active === tab
              ? 'text-white border-blue-500'
              : 'text-gray-500 border-transparent hover:text-gray-300'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

function SkillViewer({ item, onBack }) {
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-2 px-5 py-3 border-b border-gray-800">
        <button onClick={onBack} className="text-gray-500 hover:text-white text-xs transition-colors">← Back</button>
        <span className="text-gray-600">·</span>
        <span className="text-gray-400 text-xs font-mono">{item.type === 'command' ? `/${item.id}` : item.name}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 prose prose-invert prose-sm max-w-none">
        <ReactMarkdown>{item.content}</ReactMarkdown>
      </div>
    </div>
  );
}

function SkillsTab({ project }) {
  const [data, setData] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [installing, setInstalling] = useState({});

  useEffect(() => {
    getSkills(project.path).then(setData);
  }, [project.path]);

  const installed = data ? [...(data.skills || []), ...(data.commands || [])] : null;
  const installedIds = new Set(installed?.map(s => s.id) || []);
  const recommended = RECOMMENDED_SKILLS.filter(r => !installedIds.has(r.id));

  const handleInstall = async (skill) => {
    setInstalling(prev => ({ ...prev, [skill.id]: true }));
    try {
      await createTerminal(project.path, `claude plugin install ${skill.id}@claude-code-plugins`);
    } finally {
      setInstalling(prev => ({ ...prev, [skill.id]: false }));
    }
  };

  if (viewing) return <SkillViewer item={viewing} onBack={() => setViewing(null)} />;

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6">
      {installed === null ? (
        <div className="text-xs text-gray-600">Loading...</div>
      ) : installed.length === 0 ? (
        <div className="text-xs text-gray-600">No skills or commands found in <code className="text-gray-500 bg-gray-800 px-1 rounded">.claude/skills/</code> or <code className="text-gray-500 bg-gray-800 px-1 rounded">.claude/commands/</code>.</div>
      ) : (
        <div>
          <p className="text-xs text-gray-600 uppercase tracking-wider font-medium mb-3">Installed</p>
          <div className="space-y-1">
            {installed.map(item => (
              <button
                key={item.id}
                onClick={() => setViewing(item)}
                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-gray-800 transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-white font-medium">
                      {item.type === 'command' ? `/${item.id}` : item.name}
                    </span>
                    {item.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                    )}
                  </div>
                  <span className="text-gray-700 group-hover:text-gray-500 text-xs ml-3 shrink-0">View →</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {recommended.length > 0 && (
        <div>
          <p className="text-xs text-gray-600 uppercase tracking-wider font-medium mb-3">Recommended</p>
          <div className="space-y-1">
            {recommended.map(item => (
              <div key={item.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-gray-800">
                <div>
                  <span className="text-sm text-gray-400 font-medium">{item.name}</span>
                  {item.description && (
                    <p className="text-xs text-gray-600 mt-0.5">{item.description}</p>
                  )}
                </div>
                <button
                  onClick={() => handleInstall(item)}
                  disabled={installing[item.id]}
                  className="ml-3 shrink-0 px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors disabled:opacity-50"
                >
                  {installing[item.id] ? 'Installing…' : 'Install'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentsTab({ project }) {
  const [agents, setAgents] = useState(null);
  const [uninstalling, setUninstalling] = useState({});
  const [installing, setInstalling] = useState({});

  const load = () => getAgents(project.path).then(setAgents);

  useEffect(() => { load(); }, [project.path]);

  const installedNames = new Set(agents?.map(a => a.name) || []);
  const recommendedMissing = RECOMMENDED_AGENTS.filter(r => !installedNames.has(r.name));

  const handleUninstall = async (agent) => {
    const name = agent.name || agent.id;
    setUninstalling(prev => ({ ...prev, [name]: true }));
    try {
      await createTerminal(project.path, `claude plugin uninstall ${name}`);
      await load();
    } finally {
      setUninstalling(prev => ({ ...prev, [name]: false }));
    }
  };

  const handleInstall = async (agent) => {
    const name = agent.name || agent.id;
    setInstalling(prev => ({ ...prev, [name]: true }));
    try {
      await createTerminal(project.path, `claude plugin install ${name}@claude-code-plugins`);
    } finally {
      setInstalling(prev => ({ ...prev, [name]: false }));
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6">
      {agents === null ? (
        <div className="text-xs text-gray-600">Loading...</div>
      ) : agents.length === 0 ? (
        <div className="text-xs text-gray-600">No agents installed for this project. Agent data is read from <code className="text-gray-500 bg-gray-800 px-1 rounded">~/.claude/plugins/installed_plugins.json</code>.</div>
      ) : (
        <div>
          <p className="text-xs text-gray-600 uppercase tracking-wider font-medium mb-3">Installed</p>
          <div className="space-y-1">
            {agents.map(agent => {
              const name = agent.name || agent.id;
              return (
                <div key={name} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-800/50">
                  <div>
                    <span className="text-sm text-white font-medium">{name}</span>
                    {agent.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{agent.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleUninstall(agent)}
                    disabled={uninstalling[name]}
                    className="ml-3 shrink-0 px-2.5 py-1 text-xs bg-gray-700 hover:bg-red-900/50 hover:text-red-400 text-gray-400 rounded transition-colors disabled:opacity-50"
                  >
                    {uninstalling[name] ? 'Uninstalling…' : 'Uninstall'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {recommendedMissing.length > 0 && (
        <div>
          <p className="text-xs text-gray-600 uppercase tracking-wider font-medium mb-3">Recommended</p>
          <div className="space-y-1">
            {recommendedMissing.map(agent => {
              const name = agent.name || agent.id;
              return (
                <div key={name} className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-gray-800">
                  <div>
                    <span className="text-sm text-gray-400 font-medium">{name}</span>
                    {agent.description && (
                      <p className="text-xs text-gray-600 mt-0.5">{agent.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleInstall(agent)}
                    disabled={installing[name]}
                    className="ml-3 shrink-0 px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors disabled:opacity-50"
                  >
                    {installing[name] ? 'Installing…' : 'Install'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PluginsTab() {
  const [mcpServers, setMcpServers] = useState(null);
  const [deleting, setDeleting] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = () => getPlugins().then(setMcpServers);

  useEffect(() => { load(); }, []);

  const handleDelete = async (name) => {
    setDeleting(prev => ({ ...prev, [name]: true }));
    try {
      await deletePlugin(name);
      setMcpServers(prev => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    } finally {
      setDeleting(prev => ({ ...prev, [name]: false }));
      setConfirmDelete(null);
    }
  };

  const entries = mcpServers ? Object.entries(mcpServers) : null;

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6">
      <p className="text-xs text-gray-600">
        MCP servers from <code className="text-gray-500 bg-gray-800 px-1 rounded">~/.claude/settings.json</code>.
        Deleting a server affects all projects globally.
      </p>
      {entries === null ? (
        <div className="text-xs text-gray-600">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-xs text-gray-600">No MCP servers configured.</div>
      ) : (
        <div className="space-y-1">
          {entries.map(([name, config]) => (
            <div key={name} className="px-3 py-2.5 rounded-lg bg-gray-800/50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm text-white font-medium">{name}</span>
                  {config.command && (
                    <p className="text-xs text-gray-500 font-mono mt-0.5 truncate">
                      {config.command} {(config.args || []).join(' ')}
                    </p>
                  )}
                </div>
                {confirmDelete === name ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs text-gray-500">Remove globally?</span>
                    <button
                      onClick={() => handleDelete(name)}
                      disabled={deleting[name]}
                      className="px-2 py-0.5 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors disabled:opacity-50"
                    >
                      {deleting[name] ? '…' : 'Yes'}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="px-2 py-0.5 text-xs text-gray-500 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(name)}
                    className="shrink-0 px-2.5 py-1 text-xs bg-gray-700 hover:bg-red-900/50 hover:text-red-400 text-gray-400 rounded transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ExtensionsModal({ project, onClose }) {
  const [tab, setTab] = useState('Skills');

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[560px] max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Extensions</h2>
            <p className="text-xs text-gray-600 mt-0.5">{project.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-white text-xl leading-none">×</button>
        </div>

        <TabBar active={tab} onChange={setTab} />

        {tab === 'Skills' && <SkillsTab project={project} />}
        {tab === 'Agents' && <AgentsTab project={project} />}
        {tab === 'Plugins' && <PluginsTab />}
      </div>
    </div>
  );
}
