import { Plus } from 'lucide-react';
import type { WorkspaceView } from '../types';

interface HeaderProps {
  activeView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  onNewSession: () => void;
}

export function Header({ activeView, onSelectView, onNewSession }: HeaderProps) {
  const navItems: Array<{ id: WorkspaceView; label: string }> = [
    { id: 'workspace', label: 'Workspace' },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'providers', label: 'Providers' },
    { id: 'log', label: 'Command Log' },
  ];

  return (
    <header className="h-14 shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] px-4 lg:px-6 flex items-center justify-between gap-8">
      {/* Zone 1: Single text wordmark */}
      <button
        type="button"
        onClick={() => onSelectView('workspace')}
        className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-sm"
      >
        ShellPilot
      </button>

      {/* Zone 2: Clean single-line navigation links */}
      <nav aria-label="Primary" className="flex items-center gap-6">
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              className={`text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                isActive
                  ? 'border-blue-600 dark:border-blue-500 text-slate-900 dark:text-slate-100'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Single primary action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onNewSession}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          <span>New Session</span>
        </button>
      </div>
    </header>
  );
}
