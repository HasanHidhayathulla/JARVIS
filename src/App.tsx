import { useCallback, useEffect, useRef, useState } from 'react';
import { AssistantPane } from './components/AssistantPane';
import { CommandLogView } from './components/CommandLogView';
import { Header } from './components/Header';
import { ProvidersView } from './components/ProvidersView';
import { Sidebar } from './components/Sidebar';
import { TerminalPane } from './components/TerminalPane';
import {
  discoverLocalModels,
  runBrowserLocalTurn,
  type BrowserLocalTurnResult,
  type LocalDiscoveryResult,
} from './lib/localBridge';
import type {
  ChatMessage,
  ChatSession,
  ModelConfig,
  ProviderAvailability,
  SystemInfo,
  TerminalCommandEntry,
  WorkspaceView,
} from './types';

const CONFIG_STORAGE_KEY = 'shellpilot_config_v1';
const SESSIONS_STORAGE_KEY = 'shellpilot_sessions_v1';
const THEME_STORAGE_KEY = 'shellpilot_theme_v1';

const DEFAULT_CONFIG: ModelConfig = {
  mode: 'api',
  apiProvider: 'gemini',
  apiModel: 'gemini-4-hydrogen',
  thinkingDepth: 'HIGH',
  localRuntime: 'ollama',
  localBaseUrl: 'http://127.0.0.1:11434',
  localModel: 'qwen2.5-coder:7b',
  executionPolicy: 'ask',
};

function createEmptySession(index = 1): ChatSession {
  return {
    id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: `Session ${index}`,
    createdAt: new Date().toISOString(),
    messages: [],
  };
}

function loadInitialConfig(): ModelConfig {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch {
    // Ignore storage error
  }
  return DEFAULT_CONFIG;
}

function loadInitialSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ChatSession[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Ignore storage error
  }
  return [createEmptySession(1)];
}

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // Ignore
    }
    return 'dark';
  });

  const [activeView, setActiveView] = useState<WorkspaceView>('workspace');
  const [config, setConfig] = useState<ModelConfig>(loadInitialConfig);
  const [availability, setAvailability] = useState<ProviderAvailability | null>(null);
  const [localDiscovery, setLocalDiscovery] = useState<LocalDiscoveryResult | null>(null);
  const [isDiscoveringLocal, setIsDiscoveringLocal] = useState(false);

  const [sessions, setSessions] = useState<ChatSession[]>(loadInitialSessions);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => sessions[0]?.id || '');

  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [cwd, setCwd] = useState<string>('');
  const [terminalEntries, setTerminalEntries] = useState<TerminalCommandEntry[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null);

  const [isSending, setIsSending] = useState(false);
  const [pendingCallId, setPendingCallId] = useState<string | null>(null);
  const [pendingSource, setPendingSource] = useState<'server' | 'browser' | null>(null);
  const [includeTerminalContext, setIncludeTerminalContext] = useState(true);

  const browserLocalContinuationRef = useRef<{
    callId: string;
    command: string;
    reason: string;
    messages: Array<Record<string, unknown>>;
    assistantMessageId: string;
  } | null>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  // Sync HTML theme class
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore
    }
  }, [theme]);

  // Persist config & sessions
  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    } catch {
      // Ignore
    }
  }, [config]);

  useEffect(() => {
    try {
      localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
    } catch {
      // Ignore
    }
  }, [sessions]);

  // Initial fetch of provider status & system info
  useEffect(() => {
    fetch('/api/providers/status')
      .then((r) => r.json())
      .then((data: ProviderAvailability) => setAvailability(data))
      .catch(() => {});

    fetch('/api/terminal/info')
      .then((r) => r.json())
      .then((data: { info: SystemInfo; entries: TerminalCommandEntry[] }) => {
        setSystemInfo(data.info);
        setCwd(data.info.cwd);
        setTerminalEntries(data.entries || []);
      })
      .catch(() => {});
  }, []);

  // Live SSE subscription to internal terminal stream
  useEffect(() => {
    const es = new EventSource('/api/terminal/events');
    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as
          | { type: 'snapshot'; cwd: string; runningId: string | null; entries: TerminalCommandEntry[] }
          | { type: 'command_start'; entry: TerminalCommandEntry }
          | { type: 'chunk'; id: string; stream: 'stdout' | 'stderr'; text: string }
          | { type: 'command_end'; entry: TerminalCommandEntry; cwd: string }
          | { type: 'cwd_change'; cwd: string }
          | { type: 'cleared'; cwd: string };

        if (event.type === 'snapshot') {
          setCwd(event.cwd);
          setRunningId(event.runningId);
          setTerminalEntries(event.entries);
        } else if (event.type === 'command_start') {
          setRunningId(event.entry.status === 'running' ? event.entry.id : null);
          setTerminalEntries((prev) => {
            if (prev.some((p) => p.id === event.entry.id)) return prev;
            return [...prev, event.entry];
          });
        } else if (event.type === 'chunk') {
          setTerminalEntries((prev) =>
            prev.map((item) => {
              if (item.id !== event.id) return item;
              return event.stream === 'stdout'
                ? { ...item, stdout: item.stdout + event.text }
                : { ...item, stderr: item.stderr + event.text };
            })
          );
        } else if (event.type === 'command_end') {
          setRunningId(null);
          setCwd(event.cwd);
          setTerminalEntries((prev) =>
            prev.map((item) => (item.id === event.entry.id ? event.entry : item))
          );
        } else if (event.type === 'cwd_change') {
          setCwd(event.cwd);
        } else if (event.type === 'cleared') {
          setCwd(event.cwd);
          setTerminalEntries([]);
        }
      } catch {
        // Ignore malformed SSE event
      }
    };

    return () => {
      es.close();
    };
  }, []);

  const handleRefreshLocalModels = useCallback(async () => {
    setIsDiscoveringLocal(true);
    try {
      const result = await discoverLocalModels(config.localRuntime, config.localBaseUrl);
      setLocalDiscovery(result);
      if (result.reachable && result.models.length > 0 && !config.localModel) {
        setConfig((prev) => ({ ...prev, localModel: result.models[0].id }));
      }
    } finally {
      setIsDiscoveringLocal(false);
    }
  }, [config.localBaseUrl, config.localModel, config.localRuntime]);

  const handleChangeConfig = (patch: Partial<ModelConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  };

  const updateSessionMessages = useCallback(
    (sessionId: string, updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const nextMessages = updater(s.messages);
          const firstUser = nextMessages.find((m) => m.role === 'user');
          const autoTitle =
            s.messages.length === 0 && firstUser
              ? firstUser.content.slice(0, 32) + (firstUser.content.length > 32 ? '…' : '')
              : s.title;
          return { ...s, title: autoTitle, messages: nextMessages };
        })
      );
    },
    []
  );

  const handleNewSession = () => {
    const next = createEmptySession(sessions.length + 1);
    setSessions((prev) => [next, ...prev]);
    setActiveSessionId(next.id);
    setPendingCallId(null);
    setPendingSource(null);
    setActiveView('workspace');
  };

  const handleDeleteSession = (id: string) => {
    fetch('/api/chat/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: id }),
    }).catch(() => {});

    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      if (remaining.length === 0) {
        const fresh = createEmptySession(1);
        setActiveSessionId(fresh.id);
        return [fresh];
      }
      if (id === activeSessionId) {
        setActiveSessionId(remaining[0].id);
      }
      return remaining;
    });
  };

  const handleExecTerminal = async (command: string) => {
    await fetch('/api/terminal/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, initiator: 'user' }),
    });
  };

  const handleKillProcess = () => {
    fetch('/api/terminal/kill', { method: 'POST' }).catch(() => {});
  };

  const handleClearTerminal = () => {
    fetch('/api/terminal/clear', { method: 'POST' }).catch(() => {});
  };

  const handleResetCwd = () => {
    fetch('/api/terminal/reset', { method: 'POST' })
      .then((r) => r.json())
      .then((data: { info?: SystemInfo }) => {
        if (data.info) {
          setSystemInfo(data.info);
          setCwd(data.info.cwd);
        }
      })
      .catch(() => {});
  };

  const handleSendMessage = async (rawText: string) => {
    if (!activeSession || isSending) return;
    const sessionId = activeSession.id;

    let promptForModel = rawText;
    if (includeTerminalContext) {
      const latest = terminalEntries[terminalEntries.length - 1];
      const ctxLines = [`[Terminal context: cwd=${cwd || 'unknown'}]`];
      if (latest) {
        const snippet = (latest.stdout || latest.stderr || '').slice(-1200);
        ctxLines.push(
          `[Last command: \`${latest.command}\` exit=${latest.exitCode ?? 'running'}]\n${snippet}`
        );
      }
      promptForModel = `${ctxLines.join('\n')}\n\nUser request:\n${rawText}`;
    }

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_u`,
      role: 'user',
      content: rawText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    updateSessionMessages(sessionId, (prev) => [...prev, userMsg]);
    setIsSending(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: promptForModel,
          config,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        // Fallback to browser-direct local model call if server couldn't reach localhost
        if (
          config.mode === 'local' &&
          typeof data.error === 'string' &&
          /ECONNREFUSED|fetch failed|connect/i.test(data.error)
        ) {
          const historyForBrowser = activeSession.messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role, content: m.content }));
          historyForBrowser.push({ role: 'user', content: promptForModel });

          const localTurn = await runBrowserLocalTurn(historyForBrowser, config, cwd);
          const assistantMsgId = `msg_${Date.now()}_a`;
          const assistantMsg: ChatMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content: localTurn.text,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            providerLabel: localTurn.providerLabel,
            modelLabel: localTurn.modelLabel,
            toolCalls: localTurn.toolCalls,
          };
          updateSessionMessages(sessionId, (prev) => [...prev, assistantMsg]);

          if (localTurn.status === 'awaiting_approval' && localTurn.pendingTool) {
            setPendingCallId(localTurn.pendingTool.callId);
            setPendingSource('browser');
            browserLocalContinuationRef.current = {
              callId: localTurn.pendingTool.callId,
              command: localTurn.pendingTool.command,
              reason: localTurn.pendingTool.reason,
              messages: localTurn.continuationMessages || historyForBrowser,
              assistantMessageId: assistantMsgId,
            };
          }
          return;
        }
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now()}_a`,
        role: 'assistant',
        content: data.text || '',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        providerLabel: data.providerLabel,
        modelLabel: data.modelLabel,
        toolCalls: data.toolCalls,
      };
      updateSessionMessages(sessionId, (prev) => [...prev, assistantMsg]);

      if (data.status === 'awaiting_approval' && data.pendingTool) {
        setPendingCallId(data.pendingTool.callId);
        setPendingSource('server');
      } else {
        setPendingCallId(null);
        setPendingSource(null);
      }
    } catch (err) {
      updateSessionMessages(sessionId, (prev) => [
        ...prev,
        {
          id: `msg_${Date.now()}_e`,
          role: 'error',
          content: err instanceof Error ? err.message : 'Unexpected provider error.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleToolDecision = async (callId: string, approved: boolean) => {
    if (!activeSession || isSending) return;
    const sessionId = activeSession.id;
    setIsSending(true);

    // Mark the trace visually right away
    updateSessionMessages(sessionId, (prev) =>
      prev.map((m) => ({
        ...m,
        toolCalls: m.toolCalls?.map((t) =>
          t.id === callId ? { ...t, status: approved ? 'running' : 'declined' } : t
        ),
      }))
    );

    try {
      if (pendingSource === 'browser' && browserLocalContinuationRef.current) {
        const ctx = browserLocalContinuationRef.current;
        browserLocalContinuationRef.current = null;
        let payload: Record<string, unknown>;
        let traceUpdate: Partial<{
          status: 'completed' | 'failed' | 'declined';
          stdout: string;
          stderr: string;
          exitCode: number | null;
          durationMs: number;
          cwd: string;
        }>;

        if (approved) {
          const execRes = await fetch('/api/terminal/exec', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: ctx.command, initiator: 'ai', reason: ctx.reason }),
          });
          const execData = await execRes.json();
          const entry = execData.entry as TerminalCommandEntry;
          payload = {
            command: entry.command,
            cwd: entry.cwd,
            exitCode: entry.exitCode,
            stdout: entry.stdout,
            stderr: entry.stderr,
          };
          traceUpdate = {
            status: entry.status === 'completed' ? 'completed' : 'failed',
            stdout: entry.stdout,
            stderr: entry.stderr,
            exitCode: entry.exitCode,
            durationMs: entry.durationMs,
            cwd: entry.cwd,
          };
        } else {
          payload = { declined: true, error: 'User declined terminal command.' };
          traceUpdate = { status: 'declined' };
        }

        const nextMessages = [
          ...ctx.messages,
          { role: 'tool', tool_call_id: callId, content: JSON.stringify(payload) },
        ];
        const nextTurn: BrowserLocalTurnResult = await runBrowserLocalTurn(
          nextMessages,
          config,
          cwd
        );

        updateSessionMessages(sessionId, (prev) =>
          prev.map((m) => {
            if (m.id !== ctx.assistantMessageId) return m;
            return {
              ...m,
              content: nextTurn.text || m.content,
              toolCalls: [
                ...(m.toolCalls || []).map((t) => (t.id === callId ? { ...t, ...traceUpdate } : t)),
                ...(nextTurn.toolCalls || []),
              ],
            };
          })
        );

        if (nextTurn.status === 'awaiting_approval' && nextTurn.pendingTool) {
          setPendingCallId(nextTurn.pendingTool.callId);
          setPendingSource('browser');
          browserLocalContinuationRef.current = {
            callId: nextTurn.pendingTool.callId,
            command: nextTurn.pendingTool.command,
            reason: nextTurn.pendingTool.reason,
            messages: nextTurn.continuationMessages || nextMessages,
            assistantMessageId: ctx.assistantMessageId,
          };
        } else {
          setPendingCallId(null);
          setPendingSource(null);
        }
        return;
      }

      const res = await fetch('/api/chat/tool-decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, callId, approved }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to execute tool decision.');
      }

      updateSessionMessages(sessionId, (prev) => {
        const idx = prev.findIndex((m) => m.toolCalls?.some((t) => t.id === callId));
        if (idx === -1) return prev;
        return prev.map((m, i) => {
          if (i !== idx) return m;
          const mergedTraces = [...(m.toolCalls || [])];
          for (const incoming of data.toolCalls || []) {
            const existingIdx = mergedTraces.findIndex((t) => t.id === incoming.id);
            if (existingIdx !== -1) {
              mergedTraces[existingIdx] = incoming;
            } else {
              mergedTraces.push(incoming);
            }
          }
          return {
            ...m,
            content: data.text ? (m.content ? `${m.content}\n\n${data.text}` : data.text) : m.content,
            toolCalls: mergedTraces,
          };
        });
      });

      if (data.status === 'awaiting_approval' && data.pendingTool) {
        setPendingCallId(data.pendingTool.callId);
        setPendingSource('server');
      } else {
        setPendingCallId(null);
        setPendingSource(null);
      }
    } catch (err) {
      setPendingCallId(null);
      setPendingSource(null);
      updateSessionMessages(sessionId, (prev) => [
        ...prev,
        {
          id: `msg_${Date.now()}_e`,
          role: 'error',
          content: err instanceof Error ? err.message : 'Tool decision error.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleClearChat = () => {
    if (!activeSession) return;
    fetch('/api/chat/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: activeSession.id }),
    }).catch(() => {});
    setPendingCallId(null);
    setPendingSource(null);
    updateSessionMessages(activeSession.id, () => []);
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100">
      <Header
        activeView={activeView}
        onSelectView={setActiveView}
        onNewSession={handleNewSession}
      />

      {activeView === 'workspace' ? (
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          <Sidebar
            config={config}
            onChangeConfig={handleChangeConfig}
            availability={availability}
            localDiscovery={localDiscovery}
            isDiscoveringLocal={isDiscoveringLocal}
            onRefreshLocalModels={handleRefreshLocalModels}
            sessions={sessions}
            activeSessionId={activeSession?.id || ''}
            onSelectSession={(id) => {
              setActiveSessionId(id);
              setPendingCallId(null);
              setPendingSource(null);
            }}
            onDeleteSession={handleDeleteSession}
            onQuickPrompt={(prompt) => void handleSendMessage(prompt)}
            systemInfo={systemInfo}
            theme={theme}
            onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          />

          <div className="flex-1 min-w-0 min-h-0 flex flex-col xl:flex-row overflow-hidden">
            <AssistantPane
              messages={activeSession?.messages || []}
              config={config}
              isSending={isSending}
              pendingCallId={pendingCallId}
              includeTerminalContext={includeTerminalContext}
              onToggleTerminalContext={() => setIncludeTerminalContext((v) => !v)}
              onSendMessage={(text) => void handleSendMessage(text)}
              onToolDecision={(callId, approved) => void handleToolDecision(callId, approved)}
              onRunSnippetInTerminal={(cmd) => void handleExecTerminal(cmd)}
              onClearChat={handleClearChat}
            />

            <TerminalPane
              entries={terminalEntries}
              cwd={cwd}
              systemInfo={systemInfo}
              runningId={runningId}
              onExecCommand={handleExecTerminal}
              onKillProcess={handleKillProcess}
              onClearTerminal={handleClearTerminal}
              onResetCwd={handleResetCwd}
            />
          </div>
        </div>
      ) : activeView === 'providers' ? (
        <ProvidersView
          config={config}
          availability={availability}
          localDiscovery={localDiscovery}
          isDiscoveringLocal={isDiscoveringLocal}
          onRefreshLocalModels={handleRefreshLocalModels}
          onActivateProvider={(patch) => {
            handleChangeConfig(patch);
            setActiveView('workspace');
          }}
        />
      ) : (
        <CommandLogView entries={terminalEntries} onClearLog={handleClearTerminal} />
      )}
    </div>
  );
}
