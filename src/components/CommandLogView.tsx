import { useMemo, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import type { TerminalCommandEntry } from '../types';

interface CommandLogViewProps {
  entries: TerminalCommandEntry[];
  onClearLog: () => void;
}

type LogFilter = 'all' | 'ai' | 'user' | 'failed';

export function CommandLogView({ entries, onClearLog }: CommandLogViewProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LogFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...entries]
      .reverse()
      .filter((e) => {
        if (filter === 'ai' && e.initiator !== 'ai') return false;
        if (filter === 'user' && e.initiator !== 'user') return false;
        if (filter === 'failed' && e.status !== 'failed' && e.status !== 'blocked') return false;
        if (q && !e.command.toLowerCase().includes(q) && !e.cwd.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      });
  }, [entries, filter, search]);

  const selected = filtered.find((e) => e.id === selectedId) || filtered[0] || null;

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-8 bg-slate-50 dark:bg-[#0B1120]">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Terminal Command Log
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Unified audit trail of every shell command initiated by you or the active AI model.
            </p>
          </div>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={onClearLog}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F172A] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Clear Log</span>
            </button>
          )}
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg self-start">
            {(
              [
                { id: 'all', label: 'All Commands' },
                { id: 'ai', label: 'AI Initiated' },
                { id: 'user', label: 'Manual' },
                { id: 'failed', label: 'Failed' },
              ] as Array<{ id: LogFilter; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  filter === tab.id
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search
              className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter commands or paths..."
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F172A] pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-10 text-center space-y-2">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              No matching terminal commands
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Execute a command in the Workspace terminal or ask the assistant to inspect your PC.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-7 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-3">Source</th>
                    <th className="py-2.5 px-3">Command</th>
                    <th className="py-2.5 px-3 text-right">Exit</th>
                    <th className="py-2.5 px-3 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {filtered.map((entry) => {
                    const isSelected = selected?.id === entry.id;
                    return (
                      <tr
                        key={entry.id}
                        onClick={() => setSelectedId(entry.id)}
                        className={`h-10 cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-50/70 dark:bg-blue-950/30'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="px-3 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {entry.initiator === 'ai' ? 'AI' : 'User'}
                        </td>
                        <td className="px-3 font-mono text-slate-900 dark:text-slate-100 max-w-[260px] truncate">
                          {entry.command}
                        </td>
                        <td
                          className={`px-3 text-right font-mono tabular-nums ${
                            entry.exitCode === 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {entry.exitCode ?? '—'}
                        </td>
                        <td className="px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {entry.durationMs}ms
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {selected && (
              <div className="lg:col-span-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 space-y-1">
                  <div className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 break-all">
                    {selected.command}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                    {selected.cwd} · {new Date(selected.startedAt).toLocaleTimeString()}
                  </div>
                </div>
                <div className="p-4 bg-slate-950 font-mono text-xs leading-relaxed max-h-[420px] overflow-y-auto">
                  {selected.stdout && (
                    <pre className="text-slate-200 whitespace-pre-wrap">{selected.stdout}</pre>
                  )}
                  {selected.stderr && (
                    <pre className="text-red-400 whitespace-pre-wrap">{selected.stderr}</pre>
                  )}
                  {!selected.stdout && !selected.stderr && (
                    <span className="text-slate-500">No output captured.</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
