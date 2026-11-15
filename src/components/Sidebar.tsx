import {
  ChevronDown,
  RefreshCw,
  ShieldCheck,
  Sun,
  Moon,
  Trash2,
  Zap,
} from 'lucide-react';
import type {
  ApiProviderId,
  ChatSession,
  ExecutionPolicy,
  LocalRuntimeId,
  ModelConfig,
  ProviderAvailability,
  SystemInfo,
  ThinkingDepth,
} from '../types';
import type { DiscoveredLocalModel, LocalDiscoveryResult } from '../lib/localBridge';

interface SidebarProps {
  config: ModelConfig;
  onChangeConfig: (next: Partial<ModelConfig>) => void;
  availability: ProviderAvailability | null;
  localDiscovery: LocalDiscoveryResult | null;
  isDiscoveringLocal: boolean;
  onRefreshLocalModels: () => void;
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onQuickPrompt: (prompt: string) => void;
  systemInfo: SystemInfo | null;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

const QUICK_PROMPTS = [
  { label: 'Inspect OS & Hardware', prompt: 'Inspect the host OS, CPU cores, memory, and disk usage using the terminal.' },
  { label: 'List Project Files', prompt: 'List the files and directory structure in the current working directory.' },
  { label: 'Check Listening Ports', prompt: 'Check active listening network ports and running Node/system processes.' },
  { label: 'Git Status & Log', prompt: 'Check the git status and last 5 commits if this directory is a repository.' },
];

const LOCAL_PRESET_URLS: Record<LocalRuntimeId, string> = {
  ollama: 'http://127.0.0.1:11434',
  lmstudio: 'http://127.0.0.1:1234/v1',
  custom: 'http://127.0.0.1:8080/v1',
};

const POPULAR_OLLAMA_SUGGESTIONS: DiscoveredLocalModel[] = [
  { id: 'qwen2.5-coder:7b', label: 'qwen2.5-coder:7b', meta: '7B' },
  { id: 'llama3.2:latest', label: 'llama3.2:latest', meta: '3B' },
  { id: 'deepseek-r1:8b', label: 'deepseek-r1:8b', meta: '8B' },
  { id: 'mistral:latest', label: 'mistral:latest', meta: '7B' },
];

export function Sidebar({
  config,
  onChangeConfig,
  availability,
  localDiscovery,
  isDiscoveringLocal,
  onRefreshLocalModels,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onQuickPrompt,
  systemInfo,
  theme,
  onToggleTheme,
}: SidebarProps) {
  const apiModels =
    config.apiProvider === 'gemini'
      ? availability?.gemini.models || [
          { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', description: 'Balanced', supportsThinking: true },
          { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', description: 'Fast', supportsThinking: false },
        ]
      : config.apiProvider === 'openai'
        ? availability?.openai.models || [
            { id: 'gpt-4o-mini', label: 'GPT-4o mini', description: 'Fast' },
            { id: 'gpt-4o', label: 'GPT-4o', description: 'Flagship' },
          ]
        : availability?.anthropic.models || [
            { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', description: 'Coding' },
          ];

  const isProviderReady =
    config.apiProvider === 'gemini'
      ? Boolean(availability?.gemini.configured)
      : config.apiProvider === 'openai'
        ? Boolean(availability?.openai.configured)
        : Boolean(availability?.anthropic.configured);

  const discoveredModels = localDiscovery?.models || [];
  const localSuggestions =
    discoveredModels.length > 0 ? discoveredModels : POPULAR_OLLAMA_SUGGESTIONS;

  return (
    <aside className="w-full lg:w-[272px] shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] flex flex-col overflow-y-auto">
      {/* Model & Provider Switcher */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400">
            Model Source
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {config.mode === 'api' ? 'Cloud API' : 'Local Runtime'}
          </span>
        </div>

        {/* Segmented Control: API Provider vs Local Model */}
        <div
          role="tablist"
          aria-label="Model provider mode"
          className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
        >
          <button
            type="button"
            role="tab"
            aria-selected={config.mode === 'api'}
            onClick={() => onChangeConfig({ mode: 'api' })}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              config.mode === 'api'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            API Provider
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={config.mode === 'local'}
            onClick={() => onChangeConfig({ mode: 'local' })}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              config.mode === 'local'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Local Model
          </button>
        </div>

        {config.mode === 'api' ? (
          <div className="space-y-3">
            <div>
              <label
                htmlFor="api-provider-select"
                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
              >
                API Provider
              </label>
              <div className="relative">
                <select
                  id="api-provider-select"
                  value={config.apiProvider}
                  onChange={(e) => {
                    const nextProvider = e.target.value as ApiProviderId;
                    const defaultModel =
                      nextProvider === 'gemini'
                        ? 'gemini-4-hydrogen'
                        : nextProvider === 'openai'
                          ? 'gpt-4o-mini'
                          : 'claude-sonnet-4-20250514';
                    onChangeConfig({ apiProvider: nextProvider, apiModel: defaultModel });
                  }}
                  className="w-full appearance-none rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 pr-8 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI-Compatible (Server Env)</option>
                  <option value="anthropic">Anthropic (Server Env)</option>
                </select>
                <ChevronDown
                  className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                {availability === null
                  ? 'Checking server configuration...'
                  : isProviderReady
                    ? 'Server environment configured · Ready'
                    : 'Not configured in server environment'}
              </p>
            </div>

            <div>
              <label
                htmlFor="api-model-select"
                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
              >
                Active Model
              </label>
              <div className="relative">
                <select
                  id="api-model-select"
                  value={config.apiModel}
                  onChange={(e) => onChangeConfig({ apiModel: e.target.value })}
                  className="w-full appearance-none rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 pr-8 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {apiModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
              </div>
            </div>

            {config.apiProvider === 'gemini' && config.apiModel === 'gemini-4-hydrogen' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Reasoning Depth
                  </span>
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {config.thinkingDepth}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md">
                  {(['LOW', 'MEDIUM', 'HIGH', 'XHIGH'] as ThinkingDepth[]).map((depth) => (
                    <button
                      key={depth}
                      type="button"
                      onClick={() => onChangeConfig({ thinkingDepth: depth })}
                      className={`py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                        config.thinkingDepth === depth
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      {depth}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label
                htmlFor="local-runtime-select"
                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
              >
                Local Runtime
              </label>
              <div className="relative">
                <select
                  id="local-runtime-select"
                  value={config.localRuntime}
                  onChange={(e) => {
                    const nextRuntime = e.target.value as LocalRuntimeId;
                    onChangeConfig({
                      localRuntime: nextRuntime,
                      localBaseUrl: LOCAL_PRESET_URLS[nextRuntime],
                    });
                  }}
                  className="w-full appearance-none rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 pr-8 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ollama">Ollama (localhost:11434)</option>
                  <option value="lmstudio">LM Studio (localhost:1234)</option>
                  <option value="custom">Custom OpenAI-Compatible</option>
                </select>
                <ChevronDown
                  className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="local-endpoint-input"
                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
              >
                Endpoint URL
              </label>
              <input
                id="local-endpoint-input"
                type="url"
                value={config.localBaseUrl}
                onChange={(e) => onChangeConfig({ localBaseUrl: e.target.value })}
                placeholder="http://127.0.0.1:11434"
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="local-model-input"
                  className="text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Model Tag
                </label>
                <button
                  type="button"
                  onClick={onRefreshLocalModels}
                  disabled={isDiscoveringLocal}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${isDiscoveringLocal ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>Discover</span>
                </button>
              </div>
              <input
                id="local-model-input"
                type="text"
                value={config.localModel}
                onChange={(e) => onChangeConfig({ localModel: e.target.value })}
                placeholder="e.g. qwen2.5-coder:7b"
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              {/* Quick selection from discovered or common local models */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {localSuggestions.slice(0, 6).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onChangeConfig({ localModel: m.id })}
                    className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors cursor-pointer truncate max-w-full ${
                      config.localModel === m.id
                        ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {localDiscovery && (
                <p
                  className={`mt-1.5 text-[11px] ${
                    localDiscovery.reachable
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {localDiscovery.reachable
                    ? `Connected (${localDiscovery.via}) · ${localDiscovery.models.length} models found`
                    : 'Local endpoint offline or blocked — start Ollama / LM Studio on your PC'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Terminal Execution Policy */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400">
            Terminal Control Policy
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => onChangeConfig({ executionPolicy: 'ask' as ExecutionPolicy })}
            className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              config.executionPolicy === 'ask'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Ask First</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeConfig({ executionPolicy: 'auto' as ExecutionPolicy })}
            className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              config.executionPolicy === 'auto'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Auto Run</span>
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          {config.executionPolicy === 'ask'
            ? 'AI proposes shell commands for your approval before executing in the terminal.'
            : 'AI executes shell commands directly in the internal terminal and reads output.'}
        </p>
      </div>

      {/* Quick Terminal Tasks */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-2">
        <h2 className="font-display text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400">
          Quick Tasks
        </h2>
        <div className="space-y-1">
          {QUICK_PROMPTS.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => onQuickPrompt(item.prompt)}
              className="w-full text-left px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 rounded-md transition-colors truncate cursor-pointer"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sessions */}
      <div className="p-4 flex-1 space-y-2 min-h-[120px]">
        <h2 className="font-display text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400">
          Sessions
        </h2>
        <div className="space-y-1">
          {sessions.map((s) => {
            const active = s.id === activeSessionId;
            return (
              <div
                key={s.id}
                className={`group flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                  active
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectSession(s.id)}
                  className="flex-1 text-left truncate cursor-pointer"
                >
                  {s.title}
                </button>
                {sessions.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Delete ${s.title}`}
                    onClick={() => onDeleteSession(s.id)}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer Info & Theme Toggle */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="truncate font-mono">
          {systemInfo ? `${systemInfo.platform} · ${systemInfo.arch}` : 'Host shell'}
        </span>
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer shrink-0"
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Light</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Dark</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
