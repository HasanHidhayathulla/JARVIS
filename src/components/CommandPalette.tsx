import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Command,
  Cpu,
  FolderSync,
  Layers,
  MessageSquarePlus,
  Moon,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  Sun,
  Terminal,
  Trash2,
  Zap,
} from 'lucide-react';
import type {
  ChatSession,
  ModelConfig,
  ProviderAvailability,
  ThinkingDepth,
  WorkspaceView,
} from '../types';
import type { LocalDiscoveryResult } from '../lib/localBridge';

export interface PaletteAction {
  id: string;
  category: 'Sessions' | 'Models & Providers' | 'Terminal' | 'Navigation & Theme';
  title: string;
  subtitle: string;
  keywords: string;
  active?: boolean;
  icon: ReactNode;
  run: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  config: ModelConfig;
  availability: ProviderAvailability | null;
  localDiscovery: LocalDiscoveryResult | null;
  sessions: ChatSession[];
  activeSessionId: string;
  activeView: WorkspaceView;
  runningId: string | null;
  theme: 'dark' | 'light';
  onChangeConfig: (patch: Partial<ModelConfig>) => void;
  onSelectView: (view: WorkspaceView) => void;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onClearChat: () => void;
  onClearTerminal: () => void;
  onResetCwd: () => void;
  onKillProcess: () => void;
  onExecTerminal: (command: string) => void;
  onRefreshLocalModels: () => void;
  onToggleTheme: () => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  config,
  availability,
  localDiscovery,
  sessions,
  activeSessionId,
  activeView,
  runningId,
  theme,
  onChangeConfig,
  onSelectView,
  onNewSession,
  onSelectSession,
  onClearChat,
  onClearTerminal,
  onResetCwd,
  onKillProcess,
  onExecTerminal,
  onRefreshLocalModels,
  onToggleTheme,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      const timer = requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return () => cancelAnimationFrame(timer);
    }
  }, [isOpen]);

  const actions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = [];

    // Sessions
    list.push({
      id: 'session-new',
      category: 'Sessions',
      title: 'Create New Session',
      subtitle: 'Start a fresh assistant conversation thread',
      keywords: 'new session chat thread create',
      icon: <MessageSquarePlus className="w-4 h-4" aria-hidden="true" />,
      run: () => onNewSession(),
    });

    list.push({
      id: 'session-clear-chat',
      category: 'Sessions',
      title: 'Clear Current Conversation',
      subtitle: 'Remove all messages in the active session',
      keywords: 'clear chat thread reset messages',
      icon: <Trash2 className="w-4 h-4" aria-hidden="true" />,
      run: () => onClearChat(),
    });

    sessions.forEach((s) => {
      list.push({
        id: `session-switch-${s.id}`,
        category: 'Sessions',
        title: `Switch to Session: ${s.title}`,
        subtitle: `${s.messages.length} message${s.messages.length === 1 ? '' : 's'}`,
        keywords: `session switch ${s.title}`,
        active: s.id === activeSessionId,
        icon: <Layers className="w-4 h-4" aria-hidden="true" />,
        run: () => {
          onSelectSession(s.id);
          onSelectView('workspace');
        },
      });
    });

    // Models & Providers
    const geminiModels = availability?.gemini.models || [
      { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', description: 'Balanced reasoning & tool calling' },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', description: 'Fast lightweight responses' },
    ];

    geminiModels.forEach((m) => {
      list.push({
        id: `model-gemini-${m.id}`,
        category: 'Models & Providers',
        title: `Switch Model: ${m.label}`,
        subtitle: `Google Gemini API · ${m.id}`,
        keywords: `switch model gemini api ${m.id} ${m.label}`,
        active: config.mode === 'api' && config.apiProvider === 'gemini' && config.apiModel === m.id,
        icon: <Cpu className="w-4 h-4" aria-hidden="true" />,
        run: () => onChangeConfig({ mode: 'api', apiProvider: 'gemini', apiModel: m.id }),
      });
    });

    const openaiModels = availability?.openai.models || [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', description: 'Fast OpenAI API model' },
      { id: 'gpt-4o', label: 'GPT-4o', description: 'Flagship OpenAI API model' },
    ];
    openaiModels.forEach((m) => {
      list.push({
        id: `model-openai-${m.id}`,
        category: 'Models & Providers',
        title: `Switch Model: ${m.label}`,
        subtitle: `OpenAI-Compatible API · ${m.id}`,
        keywords: `switch model openai api ${m.id} ${m.label}`,
        active: config.mode === 'api' && config.apiProvider === 'openai' && config.apiModel === m.id,
        icon: <Cpu className="w-4 h-4" aria-hidden="true" />,
        run: () => onChangeConfig({ mode: 'api', apiProvider: 'openai', apiModel: m.id }),
      });
    });

    const anthropicModels = availability?.anthropic.models || [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', description: 'Anthropic API coding & shell model' },
    ];
    anthropicModels.forEach((m) => {
      list.push({
        id: `model-anthropic-${m.id}`,
        category: 'Models & Providers',
        title: `Switch Model: ${m.label}`,
        subtitle: `Anthropic API · ${m.id}`,
        keywords: `switch model anthropic claude api ${m.id} ${m.label}`,
        active: config.mode === 'api' && config.apiProvider === 'anthropic' && config.apiModel === m.id,
        icon: <Cpu className="w-4 h-4" aria-hidden="true" />,
        run: () => onChangeConfig({ mode: 'api', apiProvider: 'anthropic', apiModel: m.id }),
      });
    });

    list.push({
      id: 'provider-local-ollama',
      category: 'Models & Providers',
      title: 'Switch to Local Runtime: Ollama',
      subtitle: 'Endpoint http://127.0.0.1:11434',
      keywords: 'local model ollama localhost switch',
      active: config.mode === 'local' && config.localRuntime === 'ollama',
      icon: <Cpu className="w-4 h-4" aria-hidden="true" />,
      run: () =>
        onChangeConfig({
          mode: 'local',
          localRuntime: 'ollama',
          localBaseUrl: 'http://127.0.0.1:11434',
        }),
    });

    list.push({
      id: 'provider-local-lmstudio',
      category: 'Models & Providers',
      title: 'Switch to Local Runtime: LM Studio',
      subtitle: 'Endpoint http://127.0.0.1:1234/v1',
      keywords: 'local model lm studio lmstudio localhost switch',
      active: config.mode === 'local' && config.localRuntime === 'lmstudio',
      icon: <Cpu className="w-4 h-4" aria-hidden="true" />,
      run: () =>
        onChangeConfig({
          mode: 'local',
          localRuntime: 'lmstudio',
          localBaseUrl: 'http://127.0.0.1:1234/v1',
        }),
    });

    if (localDiscovery?.models.length) {
      localDiscovery.models.forEach((m) => {
        list.push({
          id: `local-discovered-${m.id}`,
          category: 'Models & Providers',
          title: `Use Local Model: ${m.label}`,
          subtitle: `${config.localRuntime} · ${config.localBaseUrl}`,
          keywords: `local model ${m.id} ${m.label} switch`,
          active: config.mode === 'local' && config.localModel === m.id,
          icon: <Cpu className="w-4 h-4" aria-hidden="true" />,
          run: () => onChangeConfig({ mode: 'local', localModel: m.id }),
        });
      });
    }

    list.push({
      id: 'local-discover-models',
      category: 'Models & Providers',
      title: 'Discover Local Models',
      subtitle: `Query ${config.localBaseUrl} for installed models`,
      keywords: 'refresh discover probe local models ollama lmstudio',
      icon: <RefreshCw className="w-4 h-4" aria-hidden="true" />,
      run: () => onRefreshLocalModels(),
    });

    (['LOW', 'MEDIUM', 'HIGH', 'XHIGH'] as ThinkingDepth[]).forEach((depth) => {
      list.push({
        id: `thinking-${depth}`,
        category: 'Models & Providers',
        title: `Set Gemini Reasoning Depth: ${depth}`,
        subtitle: 'Applies to Gemini 4 Hydrogen',
        keywords: `thinking depth reasoning ${depth.toLowerCase()}`,
        active:
          config.mode === 'api' &&
          config.apiProvider === 'gemini' &&
          config.apiModel === 'gemini-4-hydrogen' &&
          config.thinkingDepth === depth,
        icon: <Cpu className="w-4 h-4" aria-hidden="true" />,
        run: () =>
          onChangeConfig({
            mode: 'api',
            apiProvider: 'gemini',
            apiModel: 'gemini-4-hydrogen',
            thinkingDepth: depth,
          }),
      });
    });

    // Terminal actions
    list.push({
      id: 'terminal-clear',
      category: 'Terminal',
      title: 'Clear Terminal Buffer',
      subtitle: 'Clear all output from the internal PC terminal',
      keywords: 'clear terminal console output cls buffer',
      icon: <Trash2 className="w-4 h-4" aria-hidden="true" />,
      run: () => onClearTerminal(),
    });

    list.push({
      id: 'terminal-reset-cwd',
      category: 'Terminal',
      title: 'Reset Terminal Working Directory',
      subtitle: 'Return shell directory to workspace root',
      keywords: 'reset terminal directory cwd pwd root',
      icon: <FolderSync className="w-4 h-4" aria-hidden="true" />,
      run: () => onResetCwd(),
    });

    if (runningId) {
      list.push({
        id: 'terminal-kill',
        category: 'Terminal',
        title: 'Stop Running Terminal Process',
        subtitle: 'Send SIGTERM to the active shell command',
        keywords: 'kill stop abort cancel process terminal',
        icon: <Square className="w-4 h-4" aria-hidden="true" />,
        run: () => onKillProcess(),
      });
    }

    list.push({
      id: 'policy-ask',
      category: 'Terminal',
      title: 'Set Terminal Policy: Ask Before Run',
      subtitle: 'Require manual approval for AI shell commands',
      keywords: 'policy ask approval safe terminal control',
      active: config.executionPolicy === 'ask',
      icon: <ShieldCheck className="w-4 h-4" aria-hidden="true" />,
      run: () => onChangeConfig({ executionPolicy: 'ask' }),
    });

    list.push({
      id: 'policy-auto',
      category: 'Terminal',
      title: 'Set Terminal Policy: Auto Run',
      subtitle: 'Allow AI to execute shell commands automatically',
      keywords: 'policy auto run execute autonomous terminal control',
      active: config.executionPolicy === 'auto',
      icon: <Zap className="w-4 h-4" aria-hidden="true" />,
      run: () => onChangeConfig({ executionPolicy: 'auto' }),
    });

    [
      { cmd: 'ls -la', desc: 'List directory contents with details' },
      { cmd: 'uname -a', desc: 'Inspect kernel and host architecture' },
      { cmd: 'df -h', desc: 'Check mounted filesystem disk usage' },
      { cmd: 'ps aux | head -n 12', desc: 'Show active processes' },
    ].forEach((preset) => {
      list.push({
        id: `terminal-run-${preset.cmd}`,
        category: 'Terminal',
        title: `Run Command: ${preset.cmd}`,
        subtitle: preset.desc,
        keywords: `run execute terminal command ${preset.cmd} ${preset.desc}`,
        icon: <Play className="w-4 h-4" aria-hidden="true" />,
        run: () => {
          onSelectView('workspace');
          onExecTerminal(preset.cmd);
        },
      });
    });

    // Navigation & Theme
    list.push({
      id: 'nav-workspace',
      category: 'Navigation & Theme',
      title: 'Go to Workspace',
      subtitle: 'Split AI assistant and live internal terminal',
      keywords: 'workspace assistant terminal view navigate',
      active: activeView === 'workspace',
      icon: <Terminal className="w-4 h-4" aria-hidden="true" />,
      run: () => onSelectView('workspace'),
    });

    list.push({
      id: 'nav-providers',
      category: 'Navigation & Theme',
      title: 'Go to Providers',
      subtitle: 'Inspect API provider status and local runtimes',
      keywords: 'providers models status settings view navigate',
      active: activeView === 'providers',
      icon: <Cpu className="w-4 h-4" aria-hidden="true" />,
      run: () => onSelectView('providers'),
    });

    list.push({
      id: 'nav-log',
      category: 'Navigation & Theme',
      title: 'Go to Command Log',
      subtitle: 'Browse full terminal command audit history',
      keywords: 'command log audit history table view navigate',
      active: activeView === 'log',
      icon: <Command className="w-4 h-4" aria-hidden="true" />,
      run: () => onSelectView('log'),
    });

    list.push({
      id: 'theme-toggle',
      category: 'Navigation & Theme',
      title: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
      subtitle: 'Toggle workstation color appearance',
      keywords: 'theme dark light mode appearance toggle',
      icon:
        theme === 'dark' ? (
          <Sun className="w-4 h-4" aria-hidden="true" />
        ) : (
          <Moon className="w-4 h-4" aria-hidden="true" />
        ),
      run: () => onToggleTheme(),
    });

    return list;
  }, [
    activeSessionId,
    activeView,
    availability,
    config,
    localDiscovery,
    onChangeConfig,
    onClearChat,
    onClearTerminal,
    onExecTerminal,
    onKillProcess,
    onNewSession,
    onRefreshLocalModels,
    onResetCwd,
    onSelectSession,
    onSelectView,
    onToggleTheme,
    runningId,
    sessions,
    theme,
  ]);

  const filtered = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return actions;
    return actions.filter((item) => {
      const haystack = `${item.title} ${item.subtitle} ${item.category} ${item.keywords}`.toLowerCase();
      return tokens.every((tok) => haystack.includes(tok));
    });
  }, [actions, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const el = itemRefs.current[activeIndex];
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  if (!isOpen) return null;

  const executeItem = (item: PaletteAction) => {
    onClose();
    item.run();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length === 0) return;
      setActiveIndex((prev) => (prev + 1) % filtered.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length === 0) return;
      setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[activeIndex];
      if (target) executeItem(target);
    }
  };

  // Group filtered items by category while preserving global flat index
  const grouped: Array<{ category: string; items: Array<{ action: PaletteAction; flatIdx: number }> }> = [];
  const categoryMap = new Map<string, Array<{ action: PaletteAction; flatIdx: number }>>();
  filtered.forEach((action, flatIdx) => {
    let arr = categoryMap.get(action.category);
    if (!arr) {
      arr = [];
      categoryMap.set(action.category, arr);
      grouped.push({ category: action.category, items: arr });
    }
    arr.push({ action, flatIdx });
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[11vh] px-4 bg-slate-950/55 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] shadow-2xl overflow-hidden flex flex-col max-h-[72vh]">
        {/* Search Input Header */}
        <div className="px-4 h-12 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3 shrink-0">
          <Search className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, AI models, terminal tasks, or sessions..."
            aria-label="Search commands"
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
          >
            ESC
          </button>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="py-10 text-center space-y-1">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                No matching commands
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Try searching for &ldquo;clear&rdquo;, &ldquo;gemini&rdquo;, &ldquo;ollama&rdquo;, or &ldquo;session&rdquo;.
              </p>
            </div>
          ) : (
            <div className="space-y-3 py-1">
              {grouped.map((group) => (
                <div key={group.category} className="space-y-0.5">
                  <div className="px-3 py-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {group.category}
                  </div>
                  {group.items.map(({ action, flatIdx }) => {
                    const isSelected = flatIdx === activeIndex;
                    return (
                      <button
                        key={action.id}
                        ref={(el) => {
                          itemRefs.current[flatIdx] = el;
                        }}
                        type="button"
                        onMouseEnter={() => setActiveIndex(flatIdx)}
                        onClick={() => executeItem(action)}
                        className={`w-full px-3 py-2 rounded-lg flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-200'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={`shrink-0 ${
                              isSelected
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-slate-400 dark:text-slate-500'
                            }`}
                          >
                            {action.icon}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate">{action.title}</div>
                            <div
                              className={`text-[11px] truncate ${
                                isSelected
                                  ? 'text-blue-600/80 dark:text-blue-300/80'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {action.subtitle}
                            </div>
                          </div>
                        </div>

                        {action.active && (
                          <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 shrink-0">
                            Active
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Keyboard Footer */}
        <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
          <span className="font-mono tabular-nums">
            {filtered.length} command{filtered.length === 1 ? '' : 's'}
          </span>
          <span>↑↓ Navigate · ↵ Run · Esc Close</span>
        </div>
      </div>
    </div>
  );
}
