import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRight } from 'lucide-react';
import type { ChatMessage, ChatSession, TerminalCommandEntry } from '../types';

interface DashboardViewProps {
  sessions: ChatSession[];
  activeSessionId: string;
  terminalEntries: TerminalCommandEntry[];
  theme: 'dark' | 'light';
  onOpenWorkspace: () => void;
}

type SessionScope = 'all' | 'current';

function extractBaseCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return 'unknown';
  const parts = trimmed.split(/\s+/);
  const first = parts[0] || 'unknown';
  // Combine common multi-word CLIs for clearer insights
  if ((first === 'git' || first === 'npm' || first === 'docker') && parts[1]) {
    return `${first} ${parts[1]}`;
  }
  return first;
}

function estimateFallbackTokens(msg: ChatMessage): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
} {
  if (msg.usage) {
    return {
      promptTokens: msg.usage.promptTokens,
      completionTokens: msg.usage.completionTokens,
      totalTokens: msg.usage.totalTokens,
      estimated: Boolean(msg.usage.estimated),
    };
  }
  const completionChars =
    msg.content.length +
    (msg.toolCalls?.reduce(
      (sum, t) => sum + (t.command?.length || 0) + (t.stdout?.length || 0),
      0
    ) || 0);
  const completionTokens = Math.max(1, Math.ceil(completionChars / 4));
  const promptTokens = Math.max(12, Math.ceil(completionTokens * 1.4));
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimated: true,
  };
}

export function DashboardView({
  sessions,
  activeSessionId,
  terminalEntries,
  theme,
  onOpenWorkspace,
}: DashboardViewProps) {
  const [scope, setScope] = useState<SessionScope>('all');

  const scopedMessages = useMemo(() => {
    const targetSessions =
      scope === 'current'
        ? sessions.filter((s) => s.id === activeSessionId)
        : sessions;
    const list: Array<{ sessionTitle: string; msg: ChatMessage }> = [];
    targetSessions.forEach((s) => {
      s.messages.forEach((m) => {
        if (m.role === 'assistant') {
          list.push({ sessionTitle: s.title, msg: m });
        }
      });
    });
    return list;
  }, [activeSessionId, scope, sessions]);

  const tokenMetrics = useMemo(() => {
    let promptTotal = 0;
    let completionTotal = 0;
    let total = 0;
    let hasEstimated = false;

    const perTurn = scopedMessages.map((entry, idx) => {
      const usage = estimateFallbackTokens(entry.msg);
      promptTotal += usage.promptTokens;
      completionTotal += usage.completionTokens;
      total += usage.totalTokens;
      if (usage.estimated) hasEstimated = true;

      return {
        turn: `T${idx + 1}`,
        model: entry.msg.modelLabel || 'Unknown',
        provider: entry.msg.providerLabel || 'Provider',
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        timestamp: entry.msg.timestamp,
      };
    });

    const byModelMap = new Map<
      string,
      { model: string; promptTokens: number; completionTokens: number; turns: number }
    >();
    perTurn.forEach((t) => {
      const existing = byModelMap.get(t.model) || {
        model: t.model,
        promptTokens: 0,
        completionTokens: 0,
        turns: 0,
      };
      existing.promptTokens += t.promptTokens;
      existing.completionTokens += t.completionTokens;
      existing.turns += 1;
      byModelMap.set(t.model, existing);
    });

    const byModel = Array.from(byModelMap.values()).sort(
      (a, b) =>
        b.promptTokens + b.completionTokens - (a.promptTokens + a.completionTokens)
    );

    return {
      promptTotal,
      completionTotal,
      total,
      hasEstimated,
      turnsCount: perTurn.length,
      modelsCount: byModel.length,
      perTurn,
      byModel,
    };
  }, [scopedMessages]);

  const commandMetrics = useMemo(() => {
    const freqMap = new Map<
      string,
      { command: string; aiCount: number; userCount: number; total: number }
    >();

    let aiCount = 0;
    let userCount = 0;
    let completedCount = 0;
    let durationSum = 0;
    let finishedCount = 0;

    terminalEntries.forEach((entry) => {
      if (entry.initiator === 'ai') aiCount += 1;
      else userCount += 1;

      if (entry.status !== 'running') {
        finishedCount += 1;
        durationSum += entry.durationMs || 0;
        if (entry.exitCode === 0) completedCount += 1;
      }

      const base = extractBaseCommand(entry.command);
      const current = freqMap.get(base) || {
        command: base,
        aiCount: 0,
        userCount: 0,
        total: 0,
      };
      if (entry.initiator === 'ai') current.aiCount += 1;
      else current.userCount += 1;
      current.total += 1;
      freqMap.set(base, current);
    });

    const topCommands = Array.from(freqMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const recentLatency = terminalEntries.slice(-16).map((e, idx) => ({
      index: `#${idx + 1}`,
      command: e.command.length > 22 ? `${e.command.slice(0, 22)}…` : e.command,
      durationMs: e.durationMs || 0,
      exitCode: e.exitCode ?? 0,
      initiator: e.initiator === 'ai' ? 'AI' : 'User',
    }));

    const successRate =
      finishedCount > 0 ? Math.round((completedCount / finishedCount) * 100) : 0;
    const avgDurationMs =
      finishedCount > 0 ? Math.round(durationSum / finishedCount) : 0;

    return {
      total: terminalEntries.length,
      aiCount,
      userCount,
      successRate,
      avgDurationMs,
      topCommands,
      recentLatency,
    };
  }, [terminalEntries]);

  const axisTickColor = theme === 'dark' ? '#94A3B8' : '#64748B';
  const gridStroke = theme === 'dark' ? '#1E293B' : '#E2E8F0';
  const tooltipStyle = {
    backgroundColor: theme === 'dark' ? '#0F172A' : '#FFFFFF',
    borderColor: theme === 'dark' ? '#1E293B' : '#E2E8F0',
    borderRadius: '8px',
    fontSize: '12px',
    color: theme === 'dark' ? '#F1F5F9' : '#0F172A',
  };

  const hasAnyData = tokenMetrics.turnsCount > 0 || commandMetrics.total > 0;

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-8 bg-slate-50 dark:bg-[#0B1120]">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header & Scope Filter */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Usage &amp; Terminal Telemetry
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Token consumption across providers and command execution frequency in the internal terminal.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg self-start">
            <button
              type="button"
              onClick={() => setScope('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                scope === 'all'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              All Sessions
            </button>
            <button
              type="button"
              onClick={() => setScope('current')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                scope === 'current'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Current Session
            </button>
          </div>
        </div>

        {/* 4-Column KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-4 space-y-1.5">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Total Tokens
            </div>
            <div className="font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {tokenMetrics.total.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {tokenMetrics.promptTotal.toLocaleString()} in · {tokenMetrics.completionTotal.toLocaleString()} out
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-4 space-y-1.5">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Assistant Turns
            </div>
            <div className="font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {tokenMetrics.turnsCount.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {tokenMetrics.modelsCount} active model{tokenMetrics.modelsCount === 1 ? '' : 's'}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-4 space-y-1.5">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Terminal Commands
            </div>
            <div className="font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {commandMetrics.total.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {commandMetrics.aiCount} AI · {commandMetrics.userCount} Manual
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-4 space-y-1.5">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Command Success Rate
            </div>
            <div className="font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {commandMetrics.total > 0 ? `${commandMetrics.successRate}%` : '—'}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              Avg latency {commandMetrics.avgDurationMs}ms
            </div>
          </div>
        </div>

        {!hasAnyData ? (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-10 text-center space-y-3">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              No usage or terminal telemetry recorded yet
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
              Send a message to any AI provider or execute commands in the internal terminal to populate token curves, model comparisons, and command frequency charts.
            </p>
            <div className="pt-1">
              <button
                type="button"
                onClick={onOpenWorkspace}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer"
              >
                <span>Open Workspace</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Chart 1: Token Usage Over Turns */}
            <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-5 space-y-4">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Token Usage by Turn
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Prompt vs completion tokens per assistant turn
                  </p>
                </div>
                {tokenMetrics.hasEstimated && (
                  <span className="text-[11px] font-mono text-slate-400">
                    Includes estimates
                  </span>
                )}
              </div>

              {tokenMetrics.perTurn.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
                  No assistant turns recorded in this scope yet.
                </div>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={tokenMetrics.perTurn}
                      margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                      <XAxis
                        dataKey="turn"
                        tick={{ fontSize: 11, fill: axisTickColor }}
                        axisLine={{ stroke: gridStroke }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: axisTickColor }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Area
                        type="monotone"
                        dataKey="promptTokens"
                        name="Prompt Tokens"
                        stackId="1"
                        stroke="#2563EB"
                        fill="#3B82F6"
                        fillOpacity={0.25}
                      />
                      <Area
                        type="monotone"
                        dataKey="completionTokens"
                        name="Completion Tokens"
                        stackId="1"
                        stroke="#16A34A"
                        fill="#22C55E"
                        fillOpacity={0.3}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            {/* Chart 2: Token Consumption by Model */}
            <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-5 space-y-4">
              <div>
                <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Token Consumption by Model
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Cumulative prompt and completion tokens per active model
                </p>
              </div>

              {tokenMetrics.byModel.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
                  No model usage data available in this scope.
                </div>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={tokenMetrics.byModel}
                      margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                      <XAxis
                        dataKey="model"
                        tick={{ fontSize: 11, fill: axisTickColor }}
                        axisLine={{ stroke: gridStroke }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: axisTickColor }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar
                        dataKey="promptTokens"
                        name="Prompt Tokens"
                        stackId="model"
                        fill="#3B82F6"
                        radius={[0, 0, 0, 0]}
                      />
                      <Bar
                        dataKey="completionTokens"
                        name="Completion Tokens"
                        stackId="model"
                        fill="#16A34A"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            {/* Chart 3: Terminal Command Frequency */}
            <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-5 space-y-4">
              <div>
                <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Terminal Command Frequency
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Most frequent CLI commands grouped by AI vs manual initiation
                </p>
              </div>

              {commandMetrics.topCommands.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
                  No terminal commands executed yet.
                </div>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={commandMetrics.topCommands}
                      layout="vertical"
                      margin={{ top: 4, right: 16, left: 12, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
                      <XAxis
                        type="number"
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: axisTickColor }}
                        axisLine={{ stroke: gridStroke }}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="command"
                        width={96}
                        tick={{ fontSize: 11, fill: axisTickColor }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar
                        dataKey="aiCount"
                        name="AI Initiated"
                        stackId="freq"
                        fill="#3B82F6"
                        radius={[0, 0, 0, 0]}
                      />
                      <Bar
                        dataKey="userCount"
                        name="Manual"
                        stackId="freq"
                        fill="#10B981"
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            {/* Chart 4: Recent Command Latency */}
            <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] p-5 space-y-4">
              <div>
                <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Recent Command Latency (ms)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Execution duration across the last {commandMetrics.recentLatency.length} terminal commands
                </p>
              </div>

              {commandMetrics.recentLatency.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
                  No terminal execution timing recorded yet.
                </div>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={commandMetrics.recentLatency}
                      margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                      <XAxis
                        dataKey="index"
                        tick={{ fontSize: 11, fill: axisTickColor }}
                        axisLine={{ stroke: gridStroke }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: axisTickColor }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(val) => [`${val} ms`, 'Duration']}
                        labelFormatter={(_label, payload) =>
                          payload?.[0]?.payload?.command
                            ? `${payload[0].payload.command} (${payload[0].payload.initiator})`
                            : ''
                        }
                      />
                      <Bar
                        dataKey="durationMs"
                        name="Duration (ms)"
                        fill="#6366F1"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
