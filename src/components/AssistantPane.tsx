import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Play,
  Send,
  Terminal,
  X,
} from 'lucide-react';
import type { ChatMessage, ModelConfig, ToolCallTrace } from '../types';

interface AssistantPaneProps {
  messages: ChatMessage[];
  config: ModelConfig;
  isSending: boolean;
  pendingCallId: string | null;
  includeTerminalContext: boolean;
  onToggleTerminalContext: () => void;
  onSendMessage: (text: string) => void;
  onToolDecision: (callId: string, approved: boolean) => void;
  onRunSnippetInTerminal: (command: string) => void;
  onClearChat: () => void;
}

function CodeBlock({
  lang,
  code,
  onRun,
}: {
  lang: string;
  code: string;
  onRun: (cmd: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const isShell = ['bash', 'sh', 'zsh', 'shell', 'console', 'powershell', 'cmd', ''].includes(
    lang.toLowerCase()
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="my-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-100 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800 bg-slate-900/80 text-[11px] text-slate-400">
        <span className="font-mono">{lang || 'text'}</span>
        <div className="flex items-center gap-2">
          {isShell && (
            <button
              type="button"
              onClick={() => onRun(code.trim())}
              className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
            >
              <Play className="w-3 h-3" aria-hidden="true" />
              <span>Run in Terminal</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 hover:text-slate-200 cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
      <pre className="p-3 text-xs font-mono leading-relaxed overflow-x-auto">{code}</pre>
    </div>
  );
}

function FormattedMessageBody({
  content,
  onRunSnippet,
}: {
  content: string;
  onRunSnippet: (cmd: string) => void;
}) {
  if (!content) return null;

  const segments = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-2 text-[14px] leading-relaxed text-slate-800 dark:text-slate-200">
      {segments.map((seg, idx) => {
        if (seg.startsWith('```') && seg.endsWith('```')) {
          const inner = seg.slice(3, -3);
          const firstNewline = inner.indexOf('\n');
          const lang = firstNewline !== -1 ? inner.slice(0, firstNewline).trim() : '';
          const code = firstNewline !== -1 ? inner.slice(firstNewline + 1) : inner;
          return <CodeBlock key={idx} lang={lang} code={code.trimEnd()} onRun={onRunSnippet} />;
        }

        const lines = seg.split('\n');
        return (
          <div key={idx} className="space-y-1.5">
            {lines.map((line, lIdx) => {
              if (!line.trim()) return <div key={lIdx} className="h-1" />;
              const inlineParts = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
              return (
                <p key={lIdx} className="whitespace-pre-wrap break-words">
                  {inlineParts.map((part, pIdx) => {
                    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
                      return (
                        <code
                          key={pIdx}
                          className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[12px] text-slate-900 dark:text-slate-100"
                        >
                          {part.slice(1, -1)}
                        </code>
                      );
                    }
                    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
                      return (
                        <strong key={pIdx} className="font-semibold text-slate-900 dark:text-white">
                          {part.slice(2, -2)}
                        </strong>
                      );
                    }
                    return <span key={pIdx}>{part}</span>;
                  })}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function ToolCallCard({
  trace,
  isBusy,
  onDecision,
}: {
  trace: ToolCallTrace;
  isBusy: boolean;
  onDecision: (callId: string, approved: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(
    trace.status === 'awaiting_approval' || trace.status === 'failed'
  );

  const hasOutput = Boolean(trace.stdout || trace.stderr);

  const statusText =
    trace.status === 'awaiting_approval'
      ? 'Approval required'
      : trace.status === 'running'
        ? 'Executing'
        : trace.status === 'completed'
          ? `Exit ${trace.exitCode ?? 0}`
          : trace.status === 'declined'
            ? 'Declined'
            : `Failed (Exit ${trace.exitCode ?? 1})`;

  const statusColor =
    trace.status === 'awaiting_approval'
      ? 'text-amber-600 dark:text-amber-400'
      : trace.status === 'completed'
        ? 'text-emerald-600 dark:text-emerald-400'
        : trace.status === 'declined'
          ? 'text-slate-500 dark:text-slate-400'
          : 'text-red-600 dark:text-red-400';

  return (
    <div className="my-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
          <span className="font-mono text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
            {trace.name === 'get_system_info' ? 'get_system_info()' : trace.command}
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0 text-[11px] tabular-nums">
          {typeof trace.durationMs === 'number' && (
            <span className="text-slate-500 dark:text-slate-400 font-mono">{trace.durationMs}ms</span>
          )}
          <span className={`font-medium ${statusColor}`}>{statusText}</span>
          {hasOutput && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Hide output' : 'Show output'}
              className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
            >
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {trace.reason && (
        <div className="px-3 pb-2 text-xs text-slate-600 dark:text-slate-400 flex items-center justify-between gap-2">
          <span className="truncate">{trace.reason}</span>
          {trace.cwd && <span className="font-mono text-[11px] text-slate-400 shrink-0">{trace.cwd}</span>}
        </div>
      )}

      {trace.status === 'awaiting_approval' && (
        <div className="px-3 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onDecision(trace.id, false)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Decline</span>
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onDecision(trace.id, true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Run in Terminal</span>
          </button>
        </div>
      )}

      {expanded && hasOutput && (
        <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-950 p-3 font-mono text-[12px] leading-relaxed max-h-56 overflow-y-auto">
          {trace.stdout && <pre className="text-slate-200 whitespace-pre-wrap">{trace.stdout}</pre>}
          {trace.stderr && <pre className="text-red-400 whitespace-pre-wrap">{trace.stderr}</pre>}
        </div>
      )}
    </div>
  );
}

export function AssistantPane({
  messages,
  config,
  isSending,
  pendingCallId,
  includeTerminalContext,
  onToggleTerminalContext,
  onSendMessage,
  onToolDecision,
  onRunSnippetInTerminal,
  onClearChat,
}: AssistantPaneProps) {
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const activeProviderLabel =
    config.mode === 'api'
      ? config.apiProvider === 'gemini'
        ? 'Google Gemini'
        : config.apiProvider === 'openai'
          ? 'OpenAI API'
          : 'Anthropic API'
      : config.localRuntime === 'ollama'
        ? 'Local · Ollama'
        : config.localRuntime === 'lmstudio'
          ? 'Local · LM Studio'
          : 'Local · Custom';

  const activeModelLabel = config.mode === 'api' ? config.apiModel : config.localModel || 'Not set';

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isSending || pendingCallId) return;
    setInput('');
    onSendMessage(trimmed);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <section
      aria-label="AI Assistant"
      className="flex-1 min-w-0 flex flex-col bg-white dark:bg-[#0B1120] border-b xl:border-b-0 xl:border-r border-slate-200 dark:border-slate-800"
    >
      {/* Clean unboxed context bar */}
      <div className="h-11 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 min-w-0">
          <span className="font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
            {activeProviderLabel}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono truncate">{activeModelLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap">
            {config.executionPolicy === 'ask' ? 'Ask Before Run' : 'Auto Run'}
          </span>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={onClearChat}
            className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Clear Thread
          </button>
        )}
      </div>

      {/* Conversation Scroll Area */}
      <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-5 space-y-6">
        {messages.length === 0 ? (
          <div className="max-w-xl mx-auto pt-8 space-y-6">
            <div className="space-y-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Assistant &amp; Internal Terminal Control
              </h1>
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Switch between cloud API providers and local models on the left. Ask the assistant to inspect your system, navigate files, check ports, or run shell commands directly in the internal terminal.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  title: 'System & Disk Audit',
                  prompt: 'Check OS version, CPU count, memory usage, and disk space in the terminal.',
                },
                {
                  title: 'Workspace Inspection',
                  prompt: 'List files in the current workspace and inspect package.json dependencies.',
                },
                {
                  title: 'Process & Network Check',
                  prompt: 'Show the top 10 processes by memory usage and active listening ports.',
                },
                {
                  title: 'Interactive Troubleshooting',
                  prompt: 'Check Node.js, npm, git, and Python versions available on this machine.',
                },
              ].map((starter) => (
                <button
                  key={starter.title}
                  type="button"
                  onClick={() => onSendMessage(starter.prompt)}
                  className="text-left p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50 transition-colors cursor-pointer"
                >
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {starter.title}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                    {starter.prompt}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((msg) => (
              <div key={msg.id} className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {msg.role === 'user'
                      ? 'You'
                      : msg.role === 'error'
                        ? 'Provider Error'
                        : 'ShellPilot'}
                  </span>
                  {msg.providerLabel && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{msg.providerLabel}</span>
                    </>
                  )}
                  {msg.modelLabel && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-[11px]">{msg.modelLabel}</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums text-[11px]">{msg.timestamp}</span>
                </div>

                {msg.role === 'error' ? (
                  <div className="p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span className="leading-relaxed">{msg.content}</span>
                  </div>
                ) : (
                  <div
                    className={
                      msg.role === 'user'
                        ? 'p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70'
                        : 'pt-0.5'
                    }
                  >
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="mb-2.5">
                        {msg.toolCalls.map((trace) => (
                          <ToolCallCard
                            key={trace.id}
                            trace={trace}
                            isBusy={isSending}
                            onDecision={onToolDecision}
                          />
                        ))}
                      </div>
                    )}
                    <FormattedMessageBody
                      content={msg.content}
                      onRunSnippet={onRunSnippetInTerminal}
                    />
                  </div>
                )}
              </div>
            ))}

            {isSending && (
              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                Waiting for {activeModelLabel}...
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="p-3 lg:p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] shrink-0">
        <div className="max-w-3xl mx-auto space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeTerminalContext}
                onChange={onToggleTerminalContext}
                className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500"
              />
              <span>Include current working directory &amp; latest terminal output</span>
            </label>
            {pendingCallId && (
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                Approve or decline the pending command above to continue
              </span>
            )}
          </div>

          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={Boolean(pendingCallId)}
              placeholder={
                pendingCallId
                  ? 'Awaiting command approval...'
                  : 'Ask the assistant or instruct it to run a command in the terminal...'
              }
              className="flex-1 resize-none rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!input.trim() || isSending || Boolean(pendingCallId)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 h-[42px]"
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Send</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
