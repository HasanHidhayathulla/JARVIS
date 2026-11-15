import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CornerDownLeft, RotateCcw, Square, Trash2 } from 'lucide-react';
import type { SystemInfo, TerminalCommandEntry } from '../types';

interface TerminalPaneProps {
  entries: TerminalCommandEntry[];
  cwd: string;
  systemInfo: SystemInfo | null;
  runningId: string | null;
  onExecCommand: (command: string) => Promise<void>;
  onKillProcess: () => void;
  onClearTerminal: () => void;
  onResetCwd: () => void;
}

const TERMINAL_PRESETS = ['ls -la', 'pwd', 'uname -a', 'df -h', 'ps aux | head -n 12'];

export function TerminalPane({
  entries,
  cwd,
  systemInfo,
  runningId,
  onExecCommand,
  onKillProcess,
  onClearTerminal,
  onResetCwd,
}: TerminalPaneProps) {
  const [commandInput, setCommandInput] = useState('');
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const userHistory = entries
    .filter((e) => e.initiator === 'user' && e.command.trim())
    .map((e) => e.command);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const submitCommand = async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed || isSubmitting) return;
    if (trimmed === 'clear') {
      setCommandInput('');
      onClearTerminal();
      return;
    }
    setCommandInput('');
    setHistoryIdx(-1);
    setIsSubmitting(true);
    try {
      await onExecCommand(trimmed);
    } finally {
      setIsSubmitting(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitCommand(commandInput);
      return;
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'c' && runningId) {
      e.preventDefault();
      onKillProcess();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (userHistory.length === 0) return;
      const nextIdx = historyIdx === -1 ? userHistory.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(nextIdx);
      setCommandInput(userHistory[nextIdx] || '');
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx === -1) return;
      if (historyIdx >= userHistory.length - 1) {
        setHistoryIdx(-1);
        setCommandInput('');
      } else {
        const nextIdx = historyIdx + 1;
        setHistoryIdx(nextIdx);
        setCommandInput(userHistory[nextIdx] || '');
      }
    }
  };

  const promptPrefix = systemInfo ? `${systemInfo.username}@${systemInfo.hostname}` : 'shell';

  return (
    <section
      aria-label="Internal PC Terminal"
      className="w-full xl:w-[46%] min-w-[340px] flex flex-col bg-[#090D16] text-slate-200"
    >
      {/* Terminal Top Bar */}
      <div className="h-11 px-4 border-b border-slate-800 bg-[#0F172A] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-display text-xs font-semibold text-slate-100 whitespace-nowrap">
            Internal Terminal
          </span>
          <span className="text-slate-600" aria-hidden="true">
            ·
          </span>
          <span className="font-mono text-[11px] text-slate-400 truncate" title={cwd}>
            {cwd || '~'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {runningId && (
            <button
              type="button"
              onClick={onKillProcess}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-red-950/70 border border-red-800 text-red-300 hover:bg-red-900/70 transition-colors cursor-pointer"
            >
              <Square className="w-3 h-3" aria-hidden="true" />
              <span>Stop</span>
            </button>
          )}
          <button
            type="button"
            onClick={onResetCwd}
            title="Reset working directory to workspace root"
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            <span>Reset</span>
          </button>
          <button
            type="button"
            onClick={onClearTerminal}
            title="Clear terminal buffer"
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded transition-colors cursor-pointer"
          >
            <Trash2 className="w-3 h-3" aria-hidden="true" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Quick Command Strip */}
      <div className="px-4 py-1.5 border-b border-slate-800/80 bg-[#0C1220] flex items-center gap-1.5 overflow-x-auto shrink-0">
        {TERMINAL_PRESETS.map((cmd) => (
          <button
            key={cmd}
            type="button"
            onClick={() => void submitCommand(cmd)}
            className="px-2 py-0.5 font-mono text-[11px] text-slate-400 hover:text-slate-100 hover:bg-slate-800 border border-slate-800 rounded whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            {cmd}
          </button>
        ))}
      </div>

      {/* Live Output Buffer */}
      <div
        ref={scrollRef}
        onClick={() => inputRef.current?.focus()}
        className="flex-1 overflow-y-auto p-4 font-mono text-[12.5px] leading-relaxed space-y-4 cursor-text"
      >
        {entries.length === 0 ? (
          <div className="text-slate-500 text-xs space-y-1">
            <p>
              Connected to host shell ({systemInfo ? `${systemInfo.platform} · ${systemInfo.shell}` : 'bash'}).
            </p>
            <p>Type a command below or ask the AI assistant to inspect or control the terminal.</p>
          </div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span
                    className={`text-[11px] shrink-0 ${
                      entry.initiator === 'ai' ? 'text-blue-400' : 'text-emerald-400'
                    }`}
                  >
                    [{entry.initiator}]
                  </span>
                  <span className="text-slate-500 text-[11px] shrink-0">{entry.cwd} $</span>
                  <span className="text-slate-100 font-medium break-all">{entry.command}</span>
                </div>
                <div className="text-[11px] text-slate-500 shrink-0 tabular-nums">
                  {entry.status === 'running'
                    ? 'running...'
                    : `exit ${entry.exitCode ?? 0} · ${entry.durationMs}ms`}
                </div>
              </div>

              {entry.stdout && (
                <pre className="text-slate-300 whitespace-pre-wrap break-words pl-1">
                  {entry.stdout}
                </pre>
              )}
              {entry.stderr && (
                <pre className="text-red-400 whitespace-pre-wrap break-words pl-1">
                  {entry.stderr}
                </pre>
              )}
            </div>
          ))
        )}
      </div>

      {/* Interactive Command Input */}
      <div className="px-4 py-2.5 border-t border-slate-800 bg-[#0F172A] flex items-center gap-2 shrink-0">
        <span className="font-mono text-xs text-blue-400 shrink-0 hidden sm:inline">
          {promptPrefix}
        </span>
        <span className="font-mono text-xs text-slate-500 shrink-0">$</span>
        <input
          ref={inputRef}
          type="text"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter shell command (cd, ls, cat, ps, git, python...)"
          aria-label="Terminal command input"
          className="flex-1 bg-transparent font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void submitCommand(commandInput)}
          disabled={!commandInput.trim() || isSubmitting}
          aria-label="Execute command"
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer disabled:opacity-40"
        >
          <CornerDownLeft className="w-3 h-3" aria-hidden="true" />
          <span>Run</span>
        </button>
      </div>
    </section>
  );
}
