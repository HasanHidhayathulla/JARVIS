import { CheckCircle2, RefreshCw, Terminal, XCircle } from 'lucide-react';
import type { ModelConfig, ProviderAvailability } from '../types';
import type { LocalDiscoveryResult } from '../lib/localBridge';

interface ProvidersViewProps {
  config: ModelConfig;
  availability: ProviderAvailability | null;
  localDiscovery: LocalDiscoveryResult | null;
  isDiscoveringLocal: boolean;
  onRefreshLocalModels: () => void;
  onActivateProvider: (patch: Partial<ModelConfig>) => void;
}

export function ProvidersView({
  config,
  availability,
  localDiscovery,
  isDiscoveringLocal,
  onRefreshLocalModels,
  onActivateProvider,
}: ProvidersViewProps) {
  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-8 bg-slate-50 dark:bg-[#0B1120]">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="space-y-1.5">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            AI Providers &amp; Local Runtimes
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Switch between server-configured API providers and local inference servers running on your machine. All providers share the same internal terminal tool interface.
          </p>
        </div>

        {/* Cloud API Providers */}
        <section className="space-y-3">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            01. Server-Side API Providers
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Google Gemini */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-4 flex flex-col justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Google Gemini
                  </h3>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium ${
                      availability?.gemini.configured
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {availability?.gemini.configured ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Ready</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Env missing</span>
                      </>
                    )}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Powered by <span className="font-mono">@google/genai</span> with native function calling and configurable thinking depth.
                </p>
                <div className="pt-1 text-xs font-mono text-slate-500 dark:text-slate-400">
                  gemini-4-hydrogen · gemini-3.1-flash-lite
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onActivateProvider({
                    mode: 'api',
                    apiProvider: 'gemini',
                    apiModel: 'gemini-4-hydrogen',
                  })
                }
                className={`w-full py-2 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  config.mode === 'api' && config.apiProvider === 'gemini'
                    ? 'bg-blue-600 text-white'
                    : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {config.mode === 'api' && config.apiProvider === 'gemini'
                  ? 'Active Provider'
                  : 'Use Google Gemini'}
              </button>
            </div>

            {/* OpenAI-Compatible */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-4 flex flex-col justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    OpenAI-Compatible
                  </h3>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium ${
                      availability?.openai.configured
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {availability?.openai.configured ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Ready</span>
                      </>
                    ) : (
                      <span>Optional Env</span>
                    )}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Uses server-side <span className="font-mono">OPENAI_API_KEY</span> and{' '}
                  <span className="font-mono">OPENAI_BASE_URL</span> environment variables.
                </p>
                <div className="pt-1 text-xs font-mono text-slate-500 dark:text-slate-400">
                  gpt-4o-mini · gpt-4o
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onActivateProvider({
                    mode: 'api',
                    apiProvider: 'openai',
                    apiModel: 'gpt-4o-mini',
                  })
                }
                className={`w-full py-2 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  config.mode === 'api' && config.apiProvider === 'openai'
                    ? 'bg-blue-600 text-white'
                    : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {config.mode === 'api' && config.apiProvider === 'openai'
                  ? 'Active Provider'
                  : 'Use OpenAI API'}
              </button>
            </div>

            {/* Anthropic */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-4 flex flex-col justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Anthropic
                  </h3>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium ${
                      availability?.anthropic.configured
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {availability?.anthropic.configured ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Ready</span>
                      </>
                    ) : (
                      <span>Optional Env</span>
                    )}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Uses server-side <span className="font-mono">ANTHROPIC_API_KEY</span> for Claude tool-use workflows.
                </p>
                <div className="pt-1 text-xs font-mono text-slate-500 dark:text-slate-400">
                  claude-sonnet-4-20250514
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onActivateProvider({
                    mode: 'api',
                    apiProvider: 'anthropic',
                    apiModel: 'claude-sonnet-4-20250514',
                  })
                }
                className={`w-full py-2 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  config.mode === 'api' && config.apiProvider === 'anthropic'
                    ? 'bg-blue-600 text-white'
                    : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {config.mode === 'api' && config.apiProvider === 'anthropic'
                  ? 'Active Provider'
                  : 'Use Anthropic'}
              </button>
            </div>
          </div>
        </section>

        {/* Local Runtimes */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              02. Local Inference Runtimes
            </h2>
            <button
              type="button"
              onClick={onRefreshLocalModels}
              disabled={isDiscoveringLocal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F172A] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isDiscoveringLocal ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Probe Local Endpoint</span>
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Ollama
                </div>
                <div className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
                  http://127.0.0.1:11434
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onActivateProvider({
                      mode: 'local',
                      localRuntime: 'ollama',
                      localBaseUrl: 'http://127.0.0.1:11434',
                    })
                  }
                  className="mt-3 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 cursor-pointer"
                >
                  Select Ollama
                </button>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  LM Studio
                </div>
                <div className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
                  http://127.0.0.1:1234/v1
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onActivateProvider({
                      mode: 'local',
                      localRuntime: 'lmstudio',
                      localBaseUrl: 'http://127.0.0.1:1234/v1',
                    })
                  }
                  className="mt-3 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 cursor-pointer"
                >
                  Select LM Studio
                </button>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  llama.cpp / vLLM
                </div>
                <div className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
                  http://127.0.0.1:8080/v1
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onActivateProvider({
                      mode: 'local',
                      localRuntime: 'custom',
                      localBaseUrl: 'http://127.0.0.1:8080/v1',
                    })
                  }
                  className="mt-3 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 cursor-pointer"
                >
                  Select Custom URL
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400">
                <Terminal className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" aria-hidden="true" />
                <div>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    Endpoint Status ({config.localBaseUrl}):{' '}
                  </span>
                  {localDiscovery ? (
                    localDiscovery.reachable ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        Reachable via {localDiscovery.via} · {localDiscovery.models.length} model(s)
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">
                        Not reachable ({localDiscovery.error || 'connection refused'})
                      </span>
                    )
                  ) : (
                    <span>Click Probe Local Endpoint to check connectivity</span>
                  )}
                </div>
              </div>
              <code className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-900 font-mono text-[11px] text-slate-700 dark:text-slate-300 shrink-0">
                OLLAMA_ORIGINS=* ollama serve
              </code>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
