import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CornerDownLeft, RotateCcw, Square, Trash2 } from 'lucide-react';
import type { SystemInfo, TerminalCommandEntry, TerminalContextInfo } from '../types';

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

interface CliSuggestion {
  command: string;
  description: string;
  source: 'history' | 'path' | 'git' | 'npm' | 'context' | 'cli';
}

const TERMINAL_PRESETS = ['ls -la', 'pwd', 'uname -a', 'df -h', 'ps aux | head -n 12'];

const STATIC_CLI_CATALOG: CliSuggestion[] = [
  { command: 'ls -la', description: 'List all files including hidden entries', source: 'cli' },
  { command: 'ls -lh', description: 'List files with human-readable sizes', source: 'cli' },
  { command: 'pwd', description: 'Print current working directory', source: 'cli' },
  { command: 'cd ..', description: 'Move up one directory', source: 'cli' },
  { command: 'grep -rn "" .', description: 'Search text recursively in current directory', source: 'cli' },
  { command: 'find . -maxdepth 2 -type f', description: 'Find files up to 2 levels deep', source: 'cli' },
  { command: 'ps aux | head -n 15', description: 'Inspect top running processes', source: 'cli' },
  { command: 'df -h', description: 'Display filesystem disk usage', source: 'cli' },
  { command: 'free -h', description: 'Display memory and swap usage', source: 'cli' },
  { command: 'uname -a', description: 'Print kernel and architecture details', source: 'cli' },
  { command: 'lsof -i -P -n', description: 'List active network ports and sockets', source: 'cli' },
  { command: 'env | sort', description: 'Display sorted environment variables', source: 'cli' },
  { command: 'which node', description: 'Locate the Node.js binary path', source: 'cli' },
  { command: 'clear', description: 'Clear the terminal output buffer', source: 'cli' },
];

const SOURCE_PRIORITY: Record<CliSuggestion['source'], number> = {
  history: 5,
  path: 4,
  git: 3,
  npm: 3,
  context: 2,
  cli: 1,
};

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
  const [dirContext, setDirContext] = useState<TerminalContextInfo | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [selectedSuggestionIdx, setSelectedSuggestionIdx] = useState<number>(-1);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const userHistory = useMemo(
    () =>
      entries
        .filter((e) => e.initiator === 'user' && e.command.trim())
        .map((e) => e.command),
    [entries]
  );

  // Refresh working directory context when cwd or command count changes
  useEffect(() => {
    let cancelled = false;
    fetch('/api/terminal/context')
      .then((r) => r.json())
      .then((data: TerminalContextInfo) => {
        if (!cancelled) setDirContext(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cwd, entries.length]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  // Close suggestion popover on outside click
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSuggestionsOpen(false);
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, []);

  const suggestions = useMemo<CliSuggestion[]>(() => {
    const raw = commandInput;
    const trimmed = raw.trimStart();
    if (!trimmed) return [];

    const lower = trimmed.toLowerCase();
    const byCommand = new Map<string, CliSuggestion>();

    const addCandidate = (item: CliSuggestion) => {
      if (item.command === raw.trim()) return;
      if (!byCommand.has(item.command)) {
        byCommand.set(item.command, item);
      }
    };

    // 1. Recent history (both user & AI commands, newest first)
    for (let i = entries.length - 1; i >= 0; i--) {
      const cmd = entries[i].command.trim();
      if (!cmd) continue;
      addCandidate({
        command: cmd,
        description: entries[i].initiator === 'ai' ? 'Previously run by assistant' : 'Recent command',
        source: 'history',
      });
    }

    // 2. Dynamic path completions for common path-taking commands
    if (dirContext) {
      const pathMatch = trimmed.match(/^(cd|ls|cat|head|tail|less|grep|rm|touch|mkdir)\s+(.*)$/i);
      if (pathMatch) {
        const verb = pathMatch[1].toLowerCase();
        const argPart = pathMatch[2] || '';
        const argLower = argPart.toLowerCase();
        const wantsDirsOnly = verb === 'cd';
        const candidates = wantsDirsOnly
          ? dirContext.directories
          : [...dirContext.directories.map((d) => `${d}/`), ...dirContext.files];

        for (const name of candidates) {
          if (!argLower || name.toLowerCase().startsWith(argLower)) {
            const cmdText =
              verb === 'grep'
                ? `grep -rn "" ${name}`
                : `${verb} ${name}`;
            addCandidate({
              command: cmdText,
              description: name.endsWith('/') || wantsDirsOnly ? `Directory in ${dirContext.cwd}` : `File in ${dirContext.cwd}`,
              source: 'path',
            });
          }
        }
      }

      // 3. Context-aware project/repo commands
      if (dirContext.isGitRepo) {
        [
          { command: 'git status', description: 'Show working tree status' },
          { command: 'git diff', description: 'Show unstaged changes' },
          { command: 'git log -n 10 --oneline', description: 'Show recent 10 commits' },
          { command: 'git branch -a', description: 'List local and remote branches' },
        ].forEach((g) => addCandidate({ ...g, source: 'git' }));
      }

      if (dirContext.hasPackageJson) {
        for (const script of dirContext.packageScripts) {
          addCandidate({
            command: `npm run ${script}`,
            description: `Run package.json script "${script}"`,
            source: 'npm',
          });
        }
        addCandidate({
          command: 'cat package.json',
          description: 'Inspect Node project manifest',
          source: 'npm',
        });
      }

      if (dirContext.hasPython) {
        addCandidate({
          command: 'python3 --version',
          description: 'Check installed Python 3 runtime',
          source: 'context',
        });
        addCandidate({
          command: 'pip list',
          description: 'List installed Python packages',
          source: 'context',
        });
      }

      if (dirContext.hasDocker) {
        addCandidate({
          command: 'docker ps',
          description: 'List running containers',
          source: 'context',
        });
        addCandidate({
          command: 'docker compose ps',
          description: 'List compose service status',
          source: 'context',
        });
      }
    }

    // 4. General CLI catalog
    for (const item of STATIC_CLI_CATALOG) {
      addCandidate(item);
    }

    // Filter and rank
    const tokens = lower.split(/\s+/).filter(Boolean);
    const scored: Array<{ item: CliSuggestion; score: number }> = [];

    for (const item of byCommand.values()) {
      const cmdLower = item.command.toLowerCase();
      const descLower = item.description.toLowerCase();
      const fullHaystack = `${cmdLower} ${descLower}`;

      const matchesAllTokens = tokens.every((t) => fullHaystack.includes(t));
      if (!matchesAllTokens) continue;

      let score = SOURCE_PRIORITY[item.source] * 10;
      if (cmdLower.startsWith(lower)) {
        score += 100;
      } else if (cmdLower.includes(lower)) {
        score += 45;
      }
      scored.push({ item, score });
    }

    scored.sort((a, b) => b.score - a.score || a.item.command.length - b.item.command.length);
    return scored.slice(0, 8).map((s) => s.item);
  }, [commandInput, dirContext, entries]);

  const applySuggestion = (suggestion: CliSuggestion) => {
    setCommandInput(suggestion.command);
    setSelectedSuggestionIdx(-1);
    setSuggestionsOpen(false);
    inputRef.current?.focus();
  };

  const submitCommand = async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed || isSubmitting) return;
    if (trimmed === 'clear') {
      setCommandInput('');
      setSuggestionsOpen(false);
      setSelectedSuggestionIdx(-1);
      onClearTerminal();
      return;
    }
    setCommandInput('');
    setHistoryIdx(-1);
    setSuggestionsOpen(false);
    setSelectedSuggestionIdx(-1);
    setIsSubmitting(true);
    try {
      await onExecCommand(trimmed);
    } finally {
      setIsSubmitting(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const hasMenu = suggestionsOpen && suggestions.length > 0;

    if (e.key === 'Escape' && hasMenu) {
      e.preventDefault();
      setSuggestionsOpen(false);
      setSelectedSuggestionIdx(-1);
      return;
    }

    if (e.key === 'Tab' && hasMenu) {
      e.preventDefault();
      const target =
        selectedSuggestionIdx >= 0 && selectedSuggestionIdx < suggestions.length
          ? suggestions[selectedSuggestionIdx]
          : suggestions[0];
      if (target) applySuggestion(target);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (hasMenu && selectedSuggestionIdx >= 0 && selectedSuggestionIdx < suggestions.length) {
        void submitCommand(suggestions[selectedSuggestionIdx].command);
      } else {
        void submitCommand(commandInput);
      }
      return;
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'c' && runningId) {
      e.preventDefault();
      onKillProcess();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hasMenu) {
        setSelectedSuggestionIdx((prev) =>
          prev <= 0 ? suggestions.length - 1 : prev - 1
        );
        return;
      }
      if (userHistory.length === 0) return;
      const nextIdx = historyIdx === -1 ? userHistory.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(nextIdx);
      setCommandInput(userHistory[nextIdx] || '');
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hasMenu) {
        setSelectedSuggestionIdx((prev) =>
          prev >= suggestions.length - 1 ? 0 : prev + 1
        );
        return;
      }
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
      ref={containerRef}
      aria-label="Internal PC Terminal"
      className="w-full xl:w-[46%] min-w-[340px] flex flex-col bg-[#090D16] text-slate-200 relative"
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
            <p>Type a command below for context-aware suggestions, or ask the AI assistant to control the terminal.</p>
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

      {/* Context-Aware CLI Command Suggestions Popover */}
      {suggestionsOpen && suggestions.length > 0 && (
        <div
          role="listbox"
          aria-label="CLI command suggestions"
          className="absolute bottom-12 left-3 right-3 z-20 rounded-lg border border-slate-700/90 bg-[#0F172A] shadow-2xl overflow-hidden"
        >
          <div className="px-3 py-1.5 border-b border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
            <span>
              Suggestions
              {dirContext?.isGitRepo ? ' · git' : ''}
              {dirContext?.hasPackageJson ? ' · npm' : ''}
            </span>
            <span className="font-mono">Tab complete · ↑↓ select · Esc dismiss</span>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {suggestions.map((item, idx) => {
              const isSelected = idx === selectedSuggestionIdx;
              return (
                <button
                  key={item.command}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setSelectedSuggestionIdx(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(item);
                  }}
                  className={`w-full px-3 py-1.5 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-blue-950/70 text-blue-100'
                      : 'text-slate-200 hover:bg-slate-800/70'
                  }`}
                >
                  <div className="min-w-0 flex items-baseline gap-2.5">
                    <span className="font-mono text-xs font-medium text-slate-100 truncate">
                      {item.command}
                    </span>
                    <span className="text-[11px] text-slate-400 truncate">
                      {item.description}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-slate-500 shrink-0">
                    {item.source}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

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
          onChange={(e) => {
            const val = e.target.value;
            setCommandInput(val);
            setHistoryIdx(-1);
            setSelectedSuggestionIdx(-1);
            setSuggestionsOpen(Boolean(val.trim()));
          }}
          onFocus={() => {
            if (commandInput.trim()) setSuggestionsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Enter shell command (cd, ls, cat, git, grep...)"
          aria-label="Terminal command input"
          aria-autocomplete="list"
          aria-expanded={suggestionsOpen && suggestions.length > 0}
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
