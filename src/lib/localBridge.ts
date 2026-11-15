import type { LocalRuntimeId, ModelConfig, ToolCallTrace } from '../types';

export interface DiscoveredLocalModel {
  id: string;
  label: string;
  meta?: string;
}

export interface LocalDiscoveryResult {
  reachable: boolean;
  via: 'server' | 'browser' | 'none';
  models: DiscoveredLocalModel[];
  error?: string;
}

export async function discoverLocalModels(
  runtime: LocalRuntimeId,
  baseUrl: string
): Promise<LocalDiscoveryResult> {
  const cleanBase = baseUrl.replace(/\/+$/, '');

  // 1. Try server-side discovery (works when running locally on the user's PC)
  try {
    const params = new URLSearchParams({ runtime, baseUrl: cleanBase });
    const res = await fetch(`/api/providers/local/models?${params.toString()}`);
    if (res.ok) {
      const data = (await res.json()) as {
        reachable: boolean;
        models: DiscoveredLocalModel[];
        error?: string;
      };
      if (data.reachable) {
        return { reachable: true, via: 'server', models: data.models };
      }
    }
  } catch {
    // Fall through to browser direct attempt
  }

  // 2. Fallback: try browser-direct localhost fetch (works if Ollama/LM Studio runs on user's machine with CORS)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    if (runtime === 'ollama') {
      const url = cleanBase.endsWith('/v1')
        ? `${cleanBase.slice(0, -3)}/api/tags`
        : `${cleanBase}/api/tags`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json()) as {
          models?: Array<{ name: string; details?: { parameter_size?: string } }>;
        };
        return {
          reachable: true,
          via: 'browser',
          models: (data.models || []).map((m) => ({
            id: m.name,
            label: m.name,
            meta: m.details?.parameter_size || '',
          })),
        };
      }
    } else {
      const url = cleanBase.endsWith('/v1') ? `${cleanBase}/models` : `${cleanBase}/v1/models`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id: string }> };
        return {
          reachable: true,
          via: 'browser',
          models: (data.data || []).map((m) => ({ id: m.id, label: m.id })),
        };
      }
    }
  } catch (err) {
    return {
      reachable: false,
      via: 'none',
      models: [],
      error:
        err instanceof Error
          ? err.message
          : 'Could not reach local model endpoint from server or browser.',
    };
  }

  return {
    reachable: false,
    via: 'none',
    models: [],
    error: 'Local runtime did not respond.',
  };
}

export interface BrowserLocalTurnResult {
  status: 'completed' | 'awaiting_approval';
  text: string;
  toolCalls: ToolCallTrace[];
  pendingTool?: {
    callId: string;
    command: string;
    reason: string;
    cwd: string;
  };
  providerLabel: string;
  modelLabel: string;
  continuationMessages?: Array<Record<string, unknown>>;
}

const LOCAL_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_terminal_command',
      description: 'Execute a shell command in the internal PC terminal.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute.' },
          reason: { type: 'string', description: 'Short explanation.' },
        },
        required: ['command', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_system_info',
      description: 'Retrieve OS, CPU, RAM, and current working directory.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export async function runBrowserLocalTurn(
  messages: Array<Record<string, unknown>>,
  config: ModelConfig,
  cwd: string,
  existingTraces: ToolCallTrace[] = []
): Promise<BrowserLocalTurnResult> {
  const cleanBase = config.localBaseUrl.replace(/\/+$/, '');
  const endpoint = cleanBase.endsWith('/chat/completions')
    ? cleanBase
    : cleanBase.endsWith('/v1')
      ? `${cleanBase}/chat/completions`
      : `${cleanBase}/v1/chat/completions`;

  const providerLabel =
    config.localRuntime === 'ollama'
      ? 'Local · Ollama (Browser)'
      : config.localRuntime === 'lmstudio'
        ? 'Local · LM Studio (Browser)'
        : 'Local · Custom (Browser)';

  const workingMessages = [...messages];
  const traces = [...existingTraces];

  for (let step = 0; step < 5; step++) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.localModel,
        messages: [
          {
            role: 'system',
            content: `You are ShellPilot, an AI assistant connected to the internal PC terminal (cwd: ${cwd}). Use run_terminal_command to inspect files or run commands, or output <terminal_command>cmd</terminal_command>.`,
          },
          ...workingMessages,
        ],
        tools: LOCAL_TOOLS,
        stream: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Local endpoint returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{
            id?: string;
            function?: { name?: string; arguments?: string | Record<string, unknown> };
          }>;
        };
      }>;
    };

    const msg = data.choices?.[0]?.message;
    const text = (msg?.content || '').trim();
    const calls = msg?.tool_calls || [];

    if (calls.length === 0) {
      const tagMatch = text.match(/<terminal_command>([\s\S]*?)<\/terminal_command>/i);
      if (tagMatch && tagMatch[1]?.trim()) {
        const command = tagMatch[1].trim();
        const callId = `browser_local_${Date.now()}`;
        workingMessages.push({ role: 'assistant', content: text });

        if (config.executionPolicy === 'ask') {
          traces.push({
            id: callId,
            name: 'run_terminal_command',
            command,
            reason: 'Command requested by local model',
            cwd,
            status: 'awaiting_approval',
          });
          return {
            status: 'awaiting_approval',
            text: text.replace(/<terminal_command>[\s\S]*?<\/terminal_command>/gi, '').trim(),
            toolCalls: traces,
            pendingTool: {
              callId,
              command,
              reason: 'Command requested by local model',
              cwd,
            },
            providerLabel,
            modelLabel: config.localModel,
            continuationMessages: workingMessages,
          };
        }

        const execRes = await fetch('/api/terminal/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command, initiator: 'ai', reason: 'Local model command' }),
        });
        const execJson = await execRes.json();
        const entry = execJson.entry;
        traces.push({
          id: callId,
          name: 'run_terminal_command',
          command: entry.command,
          cwd: entry.cwd,
          status: entry.status === 'completed' ? 'completed' : 'failed',
          stdout: entry.stdout,
          stderr: entry.stderr,
          exitCode: entry.exitCode,
          durationMs: entry.durationMs,
        });
        workingMessages.push({
          role: 'user',
          content: `Terminal output for \`${entry.command}\` (exit ${entry.exitCode}):\n${entry.stdout}\n${entry.stderr}`,
        });
        continue;
      }

      return {
        status: 'completed',
        text: text || 'Done.',
        toolCalls: traces,
        providerLabel,
        modelLabel: config.localModel,
      };
    }

    workingMessages.push({
      role: 'assistant',
      content: text,
      tool_calls: calls,
    });

    for (let i = 0; i < calls.length; i++) {
      const tc = calls[i];
      const callId = tc.id || `bl_${Date.now()}_${i}`;
      const fnName = tc.function?.name || 'run_terminal_command';
      let argsObj: Record<string, unknown> = {};
      if (typeof tc.function?.arguments === 'string') {
        try {
          argsObj = JSON.parse(tc.function.arguments);
        } catch {
          argsObj = {};
        }
      } else if (tc.function?.arguments) {
        argsObj = tc.function.arguments;
      }

      if (fnName === 'get_system_info') {
        const infoRes = await fetch('/api/terminal/info');
        const infoJson = await infoRes.json();
        traces.push({
          id: callId,
          name: 'get_system_info',
          cwd: infoJson.info.cwd,
          status: 'completed',
          stdout: JSON.stringify(infoJson.info, null, 2),
          exitCode: 0,
          durationMs: 1,
        });
        workingMessages.push({
          role: 'tool',
          tool_call_id: callId,
          content: JSON.stringify(infoJson.info),
        });
        continue;
      }

      const command = String(argsObj.command || '').trim();
      const reason = String(argsObj.reason || 'Execute command in internal terminal');

      if (config.executionPolicy === 'ask') {
        traces.push({
          id: callId,
          name: 'run_terminal_command',
          command,
          reason,
          cwd,
          status: 'awaiting_approval',
        });
        return {
          status: 'awaiting_approval',
          text,
          toolCalls: traces,
          pendingTool: { callId, command, reason, cwd },
          providerLabel,
          modelLabel: config.localModel,
          continuationMessages: workingMessages,
        };
      }

      const execRes = await fetch('/api/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, initiator: 'ai', reason }),
      });
      const execJson = await execRes.json();
      const entry = execJson.entry;
      traces.push({
        id: callId,
        name: 'run_terminal_command',
        command: entry.command,
        reason,
        cwd: entry.cwd,
        status: entry.status === 'completed' ? 'completed' : 'failed',
        stdout: entry.stdout,
        stderr: entry.stderr,
        exitCode: entry.exitCode,
        durationMs: entry.durationMs,
      });
      workingMessages.push({
        role: 'tool',
        tool_call_id: callId,
        content: JSON.stringify({
          command: entry.command,
          cwd: entry.cwd,
          exitCode: entry.exitCode,
          stdout: entry.stdout,
          stderr: entry.stderr,
        }),
      });
    }
  }

  return {
    status: 'completed',
    text: 'Reached maximum tool iterations.',
    toolCalls: traces,
    providerLabel,
    modelLabel: config.localModel,
  };
}
