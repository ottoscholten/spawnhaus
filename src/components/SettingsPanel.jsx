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

function SectionHeading({ children, count }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[10px] font-mono font-semibold tracking-[0.18em] uppercase text-gray-600">{children}{count != null ? ` (${count})` : ''}</span>
      <div className="flex-1 h-px bg-white/[0.04]" />
    </div>
  );
}

function EmptyState({ children }) {
  return (
    <div className="py-10 flex flex-col items-center gap-2">
      <div className="w-8 h-8 rounded-full border border-white/[0.07] flex items-center justify-center text-gray-700 text-base">∅</div>
      <p className="text-xs text-gray-600 text-center leading-relaxed max-w-xs">{children}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="py-10 flex items-center justify-center">
      <div className="flex gap-1">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-1 h-1 rounded-full bg-gray-700 animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
        ))}
      </div>
    </div>
  );
}

function ItemRow({ name, description, badge, actions, onClick }) {
  const inner = (
    <div className={`group flex items-center gap-3 px-4 py-3 transition-colors ${onClick ? 'hover:bg-white/[0.03] cursor-pointer' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-gray-200 group-hover:text-white transition-colors">{name}</span>
          {badge && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.05] text-gray-500 border border-white/[0.06]">{badge}</span>}
        </div>
        {description && <p className="text-[11px] text-gray-600 mt-0.5 truncate leading-relaxed">{description}</p>}
      </div>
      <div className="shrink-0 flex items-center gap-2" onClick={e => e.stopPropagation()}>
        {actions}
      </div>
      {onClick && <span className="shrink-0 text-gray-700 group-hover:text-gray-400 transition-colors text-xs ml-1">→</span>}
    </div>
  );

  return onClick ? <button className="w-full text-left" onClick={onClick}>{inner}</button> : inner;
}

function ActionButton({ onClick, disabled, variant = 'default', children }) {
  const base = 'px-2.5 py-1 text-[11px] font-medium rounded transition-colors disabled:opacity-40';
  const variants = {
    default: 'bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.12] text-gray-400 hover:text-gray-200',
    danger: 'bg-white/[0.05] hover:bg-red-950/60 border border-white/[0.08] hover:border-red-900/60 text-gray-400 hover:text-red-400',
    confirm: 'bg-red-600 hover:bg-red-500 border border-red-500 text-white',
    install: 'bg-blue-600/20 hover:bg-blue-600/30 border border-blue-600/30 hover:border-blue-500/50 text-blue-400 hover:text-blue-300',
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]}`}>
      {children}
    </button>
  );
}

function ItemList({ children }) {
  return (
    <div className="rounded-lg overflow-hidden border border-white/[0.06] divide-y divide-white/[0.04]">
      {children}
    </div>
  );
}

function CodeChip({ children }) {
  return <code className="text-[11px] font-mono text-gray-500 bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded">{children}</code>;
}

// ─── Skill viewer ─────────────────────────────────────────────────────────────

function SkillViewer({ item, onBack }) {
  return (
    <div>
      <div className="flex items-center gap-3 px-8 py-4 border-b border-white/[0.04] sticky top-0 bg-[#06060a]">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-300 transition-colors"
        >
          ← back
        </button>
        <Separator.Root orientation="vertical" className="h-3 w-px bg-white/[0.08]" />
        <span className="text-xs font-mono text-gray-400">
          {item.type === 'command' ? `/${item.id}` : item.name}
        </span>
      </div>
      <div className="px-8 py-6 max-w-2xl">
        <div className="prose prose-invert prose-sm max-w-none prose-p:text-gray-400 prose-headings:text-gray-200 prose-code:text-gray-300 prose-code:bg-white/[0.05] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:border prose-code:border-white/[0.06]">
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

  const load = useCallback(() => {
    getSkills(project.path).then(setData).catch(() => setData({ skills: [], commands: [] }));
  }, [project.path]);

  useEffect(() => { load(); }, [load]);

  const installed = data ? [...(data.skills || []), ...(data.commands || [])] : null;
  const installedIds = new Set(installed?.map(s => s.id) || []);
  const recommended = RECOMMENDED_SKILLS.filter(r => !installedIds.has(r.id));

  const handleInstall = async (skill) => {
    setInstalling(prev => ({ ...prev, [skill.id]: true }));
    try { await createTerminal(project.path, `claude plugin install ${skill.id}@claude-code-plugins`); load(); }
    finally { setInstalling(prev => ({ ...prev, [skill.id]: false })); }
  };

  if (viewing) return <SkillViewer item={viewing} onBack={() => setViewing(null)} />;

  return (
    <div className="px-8 py-7 max-w-2xl space-y-7">
      {installed === null ? (
        <LoadingState />
      ) : (
        <>
          <div>
            <SectionHeading count={installed.length}>Installed</SectionHeading>
            {installed.length === 0 ? (
              <EmptyState>
                No skills in <CodeChip>.claude/skills/</CodeChip> or <CodeChip>.claude/commands/</CodeChip>
              </EmptyState>
            ) : (
              <ItemList>
                  {installed.map(item => (
                    <Tooltip.Root key={item.id}>
                      <Tooltip.Trigger asChild>
                        <div>
                          <ItemRow
                            name={item.type === 'command' ? `/${item.id}` : item.name}
                            description={item.description}
                            badge={item.type === 'command' ? 'cmd' : 'skill'}
                            onClick={() => setViewing(item)}
                          />
                        </div>
                      </Tooltip.Trigger>
                      {item.description && (
                        <Tooltip.Portal>
                          <Tooltip.Content side="right" className="z-50 max-w-[220px] rounded-lg bg-gray-900 border border-white/[0.08] px-3 py-2 text-xs text-gray-300 shadow-2xl">
                            {item.description}
                            <Tooltip.Arrow className="fill-gray-900" />
                          </Tooltip.Content>
                        </Tooltip.Portal>
                      )}
                    </Tooltip.Root>
                  ))}
                </ItemList>
            )}
          </div>

          {recommended.length > 0 && (
            <div>
              <SectionHeading count={recommended.length}>Recommended</SectionHeading>
              <ItemList>
                {recommended.map(item => (
                  <ItemRow
                    key={item.id}
                    name={item.name}
                    description={item.description}
                    actions={
                      <ActionButton onClick={() => handleInstall(item)} disabled={installing[item.id]} variant="install">
                        {installing[item.id] ? '…' : '+ Install'}
                      </ActionButton>
                    }
                  />
                ))}
              </ItemList>
            </div>
          )}
        </>
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
    <div className="px-8 py-7 max-w-2xl space-y-7">
      {agents === null ? (
        <LoadingState />
      ) : (
        <>
          <div>
            <SectionHeading count={agents.length}>Installed</SectionHeading>
            {agents.length === 0 ? (
              <EmptyState>
                No agents installed. Source: <CodeChip>~/.claude/plugins/installed_plugins.json</CodeChip>
              </EmptyState>
            ) : (
              <ItemList>
                {agents.map(agent => {
                  const name = agent.name || agent.id;
                  return (
                    <ItemRow
                      key={name}
                      name={name}
                      description={agent.description}
                      actions={
                        <ActionButton onClick={() => handleUninstall(agent)} disabled={uninstalling[name]} variant="danger">
                          {uninstalling[name] ? '…' : 'Uninstall'}
                        </ActionButton>
                      }
                    />
                  );
                })}
              </ItemList>
            )}
          </div>

          {recommendedMissing.length > 0 && (
            <div>
              <SectionHeading count={recommendedMissing.length}>Recommended</SectionHeading>
              <ItemList>
                {recommendedMissing.map(agent => {
                  const name = agent.name || agent.id;
                  return (
                    <ItemRow
                      key={name}
                      name={name}
                      description={agent.description}
                      actions={
                        <ActionButton onClick={() => handleInstall(agent)} disabled={installing[name]} variant="install">
                          {installing[name] ? '…' : '+ Install'}
                        </ActionButton>
                      }
                    />
                  );
                })}
              </ItemList>
            </div>
          )}
        </>
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
    <div className="px-8 py-7 max-w-2xl space-y-7">
      <p className="text-[11px] text-gray-600 leading-relaxed">
        MCP servers from <CodeChip>~/.claude/settings.json</CodeChip>. Deletions apply globally across all projects.
      </p>
      {entries === null ? (
        <LoadingState />
      ) : entries.length === 0 ? (
        <EmptyState>No MCP servers configured.</EmptyState>
      ) : (
        <div>
          <SectionHeading count={entries.length}>Configured</SectionHeading>
          <ItemList>
            {entries.map(([name, config]) => (
              <ItemRow
                key={name}
                name={name}
                description={config.command ? `${config.command}${config.args?.length ? ' ' + config.args.join(' ') : ''}` : undefined}
                actions={
                  confirmDelete === name ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-600">Remove globally?</span>
                      <ActionButton onClick={() => handleDelete(name)} disabled={deleting[name]} variant="confirm">
                        {deleting[name] ? '…' : 'Yes'}
                      </ActionButton>
                      <button onClick={() => setConfirmDelete(null)} className="text-[11px] text-gray-600 hover:text-gray-300 transition-colors">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <ActionButton onClick={() => setConfirmDelete(name)} variant="danger">Delete</ActionButton>
                  )
                }
              />
            ))}
          </ItemList>
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

  useEffect(() => { getPrompts().then(setPrompts).catch(() => setPrompts({ scopingPrompt: '', implementationPrompt: '' })); }, []);
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

  if (!prompts) return <div className="px-8 py-7"><LoadingState /></div>;

  return (
    <div className="px-8 py-7 max-w-2xl space-y-6">
      <p className="text-[11px] text-gray-600 leading-relaxed">
        Stored in <CodeChip>~/.spawnhaus/prompts.json</CodeChip>.{' '}
        Available variables:{' '}
        {['{taskId}', '{title}', '{description}', '{branch}'].map(v => (
          <CodeChip key={v}>{v}</CodeChip>
        ))}
      </p>

      <div className="space-y-5">
        <div>
          <label className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-mono font-semibold tracking-[0.18em] uppercase text-purple-500/80">Scoping Prompt</span>
            <div className="flex-1 h-px bg-purple-900/30" />
          </label>
          <textarea
            value={prompts.scopingPrompt}
            onChange={e => setPrompts(p => ({ ...p, scopingPrompt: e.target.value }))}
            rows={8}
            className="w-full bg-[#0d0d12] border border-white/[0.07] focus:border-purple-700/40 text-gray-300 text-[12px] px-4 py-3 rounded-lg outline-none resize-y font-mono leading-relaxed transition-colors"
          />
        </div>

        <div>
          <label className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-mono font-semibold tracking-[0.18em] uppercase text-blue-500/80">Implementation Prompt</span>
            <div className="flex-1 h-px bg-blue-900/30" />
          </label>
          <textarea
            value={prompts.implementationPrompt}
            onChange={e => setPrompts(p => ({ ...p, implementationPrompt: e.target.value }))}
            rows={8}
            className="w-full bg-[#0d0d12] border border-white/[0.07] focus:border-blue-700/40 text-gray-300 text-[12px] px-4 py-3 rounded-lg outline-none resize-y font-mono leading-relaxed transition-colors"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            saved
              ? 'bg-emerald-900/40 border border-emerald-800/60 text-emerald-400'
              : 'bg-blue-600 hover:bg-blue-500 border border-blue-500 text-white'
          } disabled:opacity-50`}
        >
          {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

// ─── Board ────────────────────────────────────────────────────────────────────

function BoardTab({ board, project, onSaved }) {
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
    <div className="px-8 py-7 max-w-2xl space-y-6">
      <div>
        <label className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-mono font-semibold tracking-[0.18em] uppercase text-gray-600">Next task number</span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </label>
        <input
          type="number"
          min="1"
          value={nextId}
          onChange={e => setNextId(e.target.value)}
          className="w-40 bg-[#0d0d12] border border-white/[0.07] focus:border-blue-700/40 text-white px-4 py-2.5 rounded-lg text-sm outline-none font-mono transition-colors"
        />
        <p className="text-[11px] text-gray-600 mt-2">
          Next task will be{' '}
          <span className="font-mono text-gray-400">TASK-{String(nextId).padStart(3, '0')}</span>
        </p>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            saved
              ? 'bg-emerald-900/40 border border-emerald-800/60 text-emerald-400'
              : 'bg-blue-600 hover:bg-blue-500 border border-blue-500 text-white'
          } disabled:opacity-50`}
        >
          {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

// ─── Nav icons ────────────────────────────────────────────────────────────────

const NAV_ICONS = {
  skills: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 1L8.5 5H13L9.5 7.5L11 11.5L7 9L3 11.5L4.5 7.5L1 5H5.5L7 1Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
    </svg>
  ),
  agents: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="7" cy="5" r="2.5" stroke="currentColor" strokeWidth="1"/>
      <path d="M2 12c0-2.761 2.239-5 5-5s5 2.239 5 5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  ),
  plugins: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1"/>
      <rect x="8" y="1.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1"/>
      <rect x="1.5" y="8" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1"/>
      <rect x="8" y="8" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1"/>
    </svg>
  ),
  prompts: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 3h10M2 7h7M2 11h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  ),
  board: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1"/>
      <path d="M1.5 5.5h11" stroke="currentColor" strokeWidth="1"/>
      <path d="M6 5.5v7" stroke="currentColor" strokeWidth="1"/>
    </svg>
  ),
};

// ─── Main panel ───────────────────────────────────────────────────────────────

const TABS = [
  ['skills',  'Skills'],
  ['agents',  'Agents'],
  ['plugins', 'Plugins'],
  ['prompts', 'Prompts'],
  ['board',   'Board'],
];

export function SettingsPanel({ project, board, onClose, onBoardSaved, onChangeProject }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="fixed inset-0 z-30 flex bg-[#06060a]">
        <Tabs.Root defaultValue="skills" orientation="vertical" className="flex flex-1 min-h-0">

          {/* ── Left sidebar nav ── */}
          <div className="w-52 shrink-0 flex flex-col border-r border-white/[0.05] bg-black/30">

            {/* Wordmark / context */}
            <div className="px-5 pt-6 pb-4">
              <p className="text-[10px] font-mono font-bold tracking-[0.2em] uppercase text-gray-500 mb-0.5">Settings</p>
              <p className="text-[11px] text-gray-600 truncate">{project.name}</p>
            </div>

            <Separator.Root className="h-px bg-white/[0.04] mx-4 mb-2" />

            {/* Nav items */}
            <Tabs.List className="flex flex-col px-2 gap-0.5 flex-1">
              {TABS.map(([value, label]) => (
                <Tabs.Trigger
                  key={value}
                  value={value}
                  className="group flex items-center gap-2.5 px-3 py-2 rounded-md text-[12px] text-gray-500
                    data-[state=active]:text-white data-[state=active]:bg-white/[0.05]
                    hover:text-gray-300 hover:bg-white/[0.03]
                    transition-all select-none outline-none text-left relative
                    data-[state=active]:before:absolute data-[state=active]:before:left-0 data-[state=active]:before:top-1 data-[state=active]:before:bottom-1 data-[state=active]:before:w-0.5 data-[state=active]:before:bg-blue-500 data-[state=active]:before:rounded-full"
                >
                  <span className="opacity-50 group-data-[state=active]:opacity-100 transition-opacity">
                    {NAV_ICONS[value]}
                  </span>
                  {label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            {/* Bottom: Switch Project */}
            <div className="px-2 pb-4">
              <Separator.Root className="h-px bg-white/[0.04] mx-2 mb-2" />
              <button
                onClick={onChangeProject}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[12px] text-gray-600 hover:text-gray-300 hover:bg-white/[0.03] transition-all text-left"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 6h8M6 3l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Switch Project
              </button>
            </div>
          </div>

          {/* ── Right content pane ── */}
          <div className="flex-1 flex flex-col min-w-0">

            {/* Top bar */}
            <div className="shrink-0 flex items-center justify-end px-6 py-3 border-b border-white/[0.04]">
              <button
                onClick={onClose}
                className="flex items-center gap-1.5 text-[11px] text-gray-600 hover:text-gray-300 transition-colors"
              >
                Close
                <kbd className="text-[10px] bg-white/[0.04] border border-white/[0.08] rounded px-1.5 py-0.5 leading-none font-mono">Esc</kbd>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
              <Tabs.Content value="skills"  className="outline-none data-[state=inactive]:hidden"><SkillsTab project={project} /></Tabs.Content>
              <Tabs.Content value="agents"  className="outline-none data-[state=inactive]:hidden"><AgentsTab project={project} /></Tabs.Content>
              <Tabs.Content value="plugins" className="outline-none data-[state=inactive]:hidden"><PluginsTab /></Tabs.Content>
              <Tabs.Content value="prompts" className="outline-none data-[state=inactive]:hidden"><PromptsTab /></Tabs.Content>
              <Tabs.Content value="board"   className="outline-none data-[state=inactive]:hidden">
                {board && <BoardTab board={board} project={project} onSaved={onBoardSaved} />}
              </Tabs.Content>
            </div>
          </div>

        </Tabs.Root>
      </div>
    </Tooltip.Provider>
  );
}
