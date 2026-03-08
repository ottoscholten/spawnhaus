import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import * as Tabs from '@radix-ui/react-tabs';
import * as Separator from '@radix-ui/react-separator';
import * as Tooltip from '@radix-ui/react-tooltip';
import { getSkills, getAgents, getPlugins, deletePlugin, createTerminal, getPrompts, updatePrompts, updateBoardSettings } from '../api';
import { RECOMMENDED_SKILLS, RECOMMENDED_AGENTS } from '../recommendations';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripFrontmatter(content) {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, '').trimStart();
}

function SectionLabel({ children }) {
  return <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-600 px-1 mb-1.5">{children}</p>;
}

// ─── Skill viewer ─────────────────────────────────────────────────────────────

function SkillViewer({ item, onBack }) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-white/5">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-200 transition-colors">
          <span>←</span> Back
        </button>
        <Separator.Root orientation="vertical" className="h-3 w-px bg-gray-700 mx-0.5" />
        <span className="text-xs text-gray-400 font-mono">{item.type === 'command' ? `/${item.id}` : item.name}</span>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3">
        <div className="prose prose-invert prose-sm max-w-none prose-p:text-gray-400 prose-headings:text-gray-200">
          <ReactMarkdown>{stripFrontmatter(item.content)}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

// ─── Skills ───────────────────────────────────────────────────────────────────

function SkillsTab({ project }) {
  const [data, setData] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [installing, setInstalling] = useState({});

  useEffect(() => {
    getSkills(project.path).then(setData).catch(() => setData({ skills: [], commands: [] }));
  }, [project.path]);

  const installed = data ? [...(data.skills || []), ...(data.commands || [])] : null;
  const installedIds = new Set(installed?.map(s => s.id) || []);
  const recommended = RECOMMENDED_SKILLS.filter(r => !installedIds.has(r.id));

  const handleInstall = async (skill) => {
    setInstalling(prev => ({ ...prev, [skill.id]: true }));
    try { await createTerminal(project.path, `claude plugin install ${skill.id}@claude-code-plugins`); }
    finally { setInstalling(prev => ({ ...prev, [skill.id]: false })); }
  };

  if (viewing) return <SkillViewer item={viewing} onBack={() => setViewing(null)} />;

  return (
    <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-5">
      {installed === null ? (
        <p className="text-xs text-gray-600 px-1">Loading…</p>
      ) : installed.length === 0 ? (
        <p className="text-xs text-gray-600 px-1 leading-relaxed">
          No skills found in <code className="text-gray-500 bg-gray-800/80 px-1 py-0.5 rounded">.claude/skills/</code> or{' '}
          <code className="text-gray-500 bg-gray-800/80 px-1 py-0.5 rounded">.claude/commands/</code>.
        </p>
      ) : (
        <div>
          <SectionLabel>Installed</SectionLabel>
          <div className="rounded-lg overflow-hidden border border-gray-800/60">
            {installed.map((item, i) => (
              <div key={item.id}>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => setViewing(item)}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-gray-800/60 transition-colors group flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-gray-200 group-hover:text-white transition-colors">
                          {item.type === 'command' ? `/${item.id}` : item.name}
                        </p>
                        {item.description && <p className="text-[11px] text-gray-600 mt-0.5 truncate">{item.description}</p>}
                      </div>
                      <span className="text-gray-700 group-hover:text-gray-400 transition-colors shrink-0 text-xs">→</span>
                    </button>
                  </Tooltip.Trigger>
                  {item.description && (
                    <Tooltip.Portal>
                      <Tooltip.Content side="right" className="z-50 max-w-[200px] rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-xs text-gray-300 shadow-xl">
                        {item.description}
                        <Tooltip.Arrow className="fill-gray-700" />
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  )}
                </Tooltip.Root>
                {i < installed.length - 1 && <Separator.Root className="h-px bg-gray-800/60" />}
              </div>
            ))}
          </div>
        </div>
      )}

      {recommended.length > 0 && (
        <div>
          <SectionLabel>Recommended</SectionLabel>
          <div className="space-y-1.5">
            {recommended.map(item => (
              <div key={item.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg border border-dashed border-gray-700/70 hover:border-gray-600 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-gray-400">{item.name}</p>
                  {item.description && <p className="text-[11px] text-gray-600 mt-0.5 truncate">{item.description}</p>}
                </div>
                <button
                  onClick={() => handleInstall(item)}
                  disabled={installing[item.id]}
                  className="shrink-0 px-2.5 py-1 text-[11px] font-medium bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 text-gray-300 rounded-md transition-colors disabled:opacity-40"
                >
                  {installing[item.id] ? '…' : '+ Install'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Agents ───────────────────────────────────────────────────────────────────

function AgentsTab({ project }) {
  const [agents, setAgents] = useState(null);
  const [uninstalling, setUninstalling] = useState({});
  const [installing, setInstalling] = useState({});

  const load = useCallback(() => {
    getAgents(project.path).then(setAgents).catch(() => setAgents([]));
  }, [project.path]);

  useEffect(() => { load(); }, [load]);

  const installedNames = new Set(agents?.map(a => a.name) || []);
  const recommendedMissing = RECOMMENDED_AGENTS.filter(r => !installedNames.has(r.name));

  const handleUninstall = async (agent) => {
    const name = agent.name || agent.id;
    setUninstalling(prev => ({ ...prev, [name]: true }));
    try { await createTerminal(project.path, `claude plugin uninstall ${name}`); load(); }
    finally { setUninstalling(prev => ({ ...prev, [name]: false })); }
  };

  const handleInstall = async (agent) => {
    const name = agent.name || agent.id;
    setInstalling(prev => ({ ...prev, [name]: true }));
    try { await createTerminal(project.path, `claude plugin install ${name}@claude-code-plugins`); load(); }
    finally { setInstalling(prev => ({ ...prev, [name]: false })); }
  };

  return (
    <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-5">
      {agents === null ? (
        <p className="text-xs text-gray-600 px-1">Loading…</p>
      ) : agents.length === 0 ? (
        <p className="text-xs text-gray-600 px-1 leading-relaxed">
          No agents installed for this project.{' '}
          <code className="text-gray-600 bg-gray-800/80 px-1 py-0.5 rounded">~/.claude/plugins/installed_plugins.json</code>
        </p>
      ) : (
        <div>
          <SectionLabel>Installed</SectionLabel>
          <div className="rounded-lg overflow-hidden border border-gray-800/60">
            {agents.map((agent, i) => {
              const name = agent.name || agent.id;
              return (
                <div key={name}>
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-200">{name}</p>
                      {agent.description && <p className="text-[11px] text-gray-600 mt-0.5 truncate">{agent.description}</p>}
                    </div>
                    <button
                      onClick={() => handleUninstall(agent)}
                      disabled={uninstalling[name]}
                      className="shrink-0 px-2.5 py-1 text-[11px] font-medium bg-gray-800 hover:bg-red-900/40 border border-gray-700 hover:border-red-800 text-gray-400 hover:text-red-400 rounded-md transition-colors disabled:opacity-40"
                    >
                      {uninstalling[name] ? '…' : 'Uninstall'}
                    </button>
                  </div>
                  {i < agents.length - 1 && <Separator.Root className="h-px bg-gray-800/60" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {recommendedMissing.length > 0 && (
        <div>
          <SectionLabel>Recommended</SectionLabel>
          <div className="space-y-1.5">
            {recommendedMissing.map(agent => {
              const name = agent.name || agent.id;
              return (
                <div key={name} className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg border border-dashed border-gray-700/70 hover:border-gray-600 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-gray-400">{name}</p>
                    {agent.description && <p className="text-[11px] text-gray-600 mt-0.5 truncate">{agent.description}</p>}
                  </div>
                  <button
                    onClick={() => handleInstall(agent)}
                    disabled={installing[name]}
                    className="shrink-0 px-2.5 py-1 text-[11px] font-medium bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 text-gray-300 rounded-md transition-colors disabled:opacity-40"
                  >
                    {installing[name] ? '…' : '+ Install'}
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

// ─── Plugins (MCPs) ───────────────────────────────────────────────────────────

function PluginsTab() {
  const [mcpServers, setMcpServers] = useState(null);
  const [deleting, setDeleting] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(() => {
    getPlugins().then(setMcpServers).catch(() => setMcpServers({}));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (name) => {
    setDeleting(prev => ({ ...prev, [name]: true }));
    try {
      await deletePlugin(name);
      setMcpServers(prev => { const n = { ...prev }; delete n[name]; return n; });
    } finally {
      setDeleting(prev => ({ ...prev, [name]: false }));
      setConfirmDelete(null);
    }
  };

  const entries = mcpServers ? Object.entries(mcpServers) : null;

  return (
    <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-5">
      <p className="text-[11px] text-gray-600 px-1 leading-relaxed">
        From <code className="text-gray-500 bg-gray-800/80 px-1 py-0.5 rounded">~/.claude/settings.json</code>. Deleting affects all projects globally.
      </p>
      {entries === null ? (
        <p className="text-xs text-gray-600 px-1">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-gray-600 px-1">No MCP servers configured.</p>
      ) : (
        <div className="rounded-lg overflow-hidden border border-gray-800/60">
          {entries.map(([name, config], i) => (
            <div key={name}>
              <div className="px-3.5 py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-gray-200">{name}</p>
                  {config.command && (
                    <p className="text-[11px] text-gray-600 font-mono mt-0.5 truncate">
                      {config.command}{config.args?.length ? ' ' + config.args.join(' ') : ''}
                    </p>
                  )}
                </div>
                {confirmDelete === name ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] text-gray-500">Remove globally?</span>
                    <button onClick={() => handleDelete(name)} disabled={deleting[name]}
                      className="px-2 py-0.5 text-[11px] font-medium bg-red-700 hover:bg-red-600 text-white rounded-md disabled:opacity-40 transition-colors">
                      {deleting[name] ? '…' : 'Yes'}
                    </button>
                    <button onClick={() => setConfirmDelete(null)} className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDelete(name)}
                    className="shrink-0 px-2.5 py-1 text-[11px] font-medium bg-gray-800 hover:bg-red-900/40 border border-gray-700 hover:border-red-800 text-gray-400 hover:text-red-400 rounded-md transition-colors">
                    Delete
                  </button>
                )}
              </div>
              {i < entries.length - 1 && <Separator.Root className="h-px bg-gray-800/60" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

function PromptsTab() {
  const [prompts, setPrompts] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef(null);

  useEffect(() => { getPrompts().then(setPrompts); }, []);
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const handleSave = async () => {
    if (!prompts) return;
    setSaving(true);
    try {
      await updatePrompts(prompts);
      setSaved(true);
      savedTimer.current = setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  };

  if (!prompts) return <div className="p-4 text-xs text-gray-600">Loading…</div>;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
        <p className="text-[11px] text-gray-600 px-1 leading-relaxed">
          Stored in <code className="text-gray-500 bg-gray-800/80 px-1 py-0.5 rounded">~/.spawnhaus/prompts.json</code>.
          Variables:{' '}
          {['{taskId}', '{title}', '{description}', '{branch}'].map(v => (
            <code key={v} className="text-gray-400 bg-gray-800/80 px-1 py-0.5 rounded mx-0.5">{v}</code>
          ))}
        </p>
        <div>
          <label className="block text-[10px] font-semibold tracking-widest uppercase text-purple-500 mb-1.5 px-1">Scoping Prompt</label>
          <textarea value={prompts.scopingPrompt} onChange={e => setPrompts(p => ({ ...p, scopingPrompt: e.target.value }))}
            rows={7} className="w-full bg-gray-800/60 border border-gray-700/80 focus:border-purple-600/60 text-gray-300 text-xs px-3 py-2.5 rounded-lg outline-none resize-y font-mono leading-relaxed" />
        </div>
        <div>
          <label className="block text-[10px] font-semibold tracking-widest uppercase text-blue-500 mb-1.5 px-1">Implementation Prompt</label>
          <textarea value={prompts.implementationPrompt} onChange={e => setPrompts(p => ({ ...p, implementationPrompt: e.target.value }))}
            rows={7} className="w-full bg-gray-800/60 border border-gray-700/80 focus:border-blue-600/60 text-gray-300 text-xs px-3 py-2.5 rounded-lg outline-none resize-y font-mono leading-relaxed" />
        </div>
      </div>
      <div className="shrink-0 px-4 py-3 border-t border-white/5 flex justify-end">
        <button onClick={handleSave} disabled={saving}
          className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
          {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ─── Board ────────────────────────────────────────────────────────────────────

function BoardTab({ board, project, onSaved, onChangeProject }) {
  const [nextId, setNextId] = useState(String(board.nextId));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef(null);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const handleSave = async () => {
    const num = parseInt(nextId, 10);
    if (isNaN(num) || num < 1) return;
    setSaving(true);
    try {
      await updateBoardSettings(project.path, { nextId: num });
      onSaved();
      setSaved(true);
      savedTimer.current = setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-5">
      <div>
        <label className="block text-[10px] font-semibold tracking-widest uppercase text-gray-600 mb-2 px-1">Next task number</label>
        <input type="number" min="1" value={nextId} onChange={e => setNextId(e.target.value)}
          className="w-full bg-gray-800/60 border border-gray-700/80 focus:border-blue-600/60 text-white px-3 py-2.5 rounded-lg text-sm outline-none font-mono" />
        <p className="text-[11px] text-gray-600 mt-2 px-1">
          Next task: <code className="text-gray-500">TASK-{String(nextId).padStart(3, '0')}</code>
        </p>
      </div>
      <div className="flex items-center justify-between">
        <button onClick={onChangeProject}
          className="px-3 py-1.5 text-xs text-gray-500 hover:text-white transition-colors">
          Switch Project
        </button>
        <button onClick={handleSave} disabled={saving}
          className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
          {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

const TABS = [
  ['skills',   'Skills'],
  ['agents',   'Agents'],
  ['plugins',  'Plugins'],
  ['prompts',  'Prompts'],
  ['board',    'Board'],
];

export function SettingsPanel({ project, board, onClose, onBoardSaved, onChangeProject }) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target) && !e.target.closest('[data-radix-popper-content-wrapper]')) {
        onCloseRef.current();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <Tooltip.Provider delayDuration={400}>
      <div
        ref={panelRef}
        className="fixed left-0 top-0 bottom-0 z-30 flex flex-col bg-[rgb(10,10,14)] border-r border-white/[0.06] overflow-hidden" style={{ width: '470px' }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-white/[0.05]">
          <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-gray-500">Settings</span>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors w-6 h-6 flex items-center justify-center rounded hover:bg-white/5">
            ×
          </button>
        </div>

        {/* Single flat tab row */}
        <Tabs.Root defaultValue="skills" className="flex flex-col flex-1 min-h-0">
          <Tabs.List className="shrink-0 flex border-b border-white/[0.05] px-2">
            {TABS.map(([value, label]) => (
              <Tabs.Trigger
                key={value}
                value={value}
                className="relative px-2.5 py-2.5 text-[11px] font-medium text-gray-500 data-[state=active]:text-white transition-colors select-none outline-none
                  after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:content-[''] after:bg-blue-500
                  after:scale-x-0 after:transition-transform data-[state=active]:after:scale-x-100"
              >
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <Tabs.Content value="skills"  className="flex flex-col flex-1 min-h-0 outline-none data-[state=inactive]:hidden"><SkillsTab project={project} /></Tabs.Content>
          <Tabs.Content value="agents"  className="flex flex-col flex-1 min-h-0 outline-none data-[state=inactive]:hidden"><AgentsTab project={project} /></Tabs.Content>
          <Tabs.Content value="plugins" className="flex flex-col flex-1 min-h-0 outline-none data-[state=inactive]:hidden"><PluginsTab /></Tabs.Content>
          <Tabs.Content value="prompts" className="flex flex-col flex-1 min-h-0 outline-none data-[state=inactive]:hidden"><PromptsTab /></Tabs.Content>
          <Tabs.Content value="board"   className="flex flex-col flex-1 min-h-0 outline-none data-[state=inactive]:hidden">
            {board && <BoardTab board={board} project={project} onSaved={onBoardSaved} onChangeProject={onChangeProject} />}
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </Tooltip.Provider>
  );
}
