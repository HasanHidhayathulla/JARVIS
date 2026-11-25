import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type Content,
  type FunctionDeclaration,
} from '@google/genai';
import { terminalManager } from './terminalManager.ts';

export type ProviderMode = 'api' | 'local';
export type ApiProviderId = 'gemini' | 'openai' | 'anthropic';
export type LocalRuntimeId = 'ollama' | 'lmstudio' | 'custom';
export type ThinkingDepth = 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH';
export type ExecutionPolicy = 'ask' | 'auto';

export interface ChatRequestConfig {
  mode: ProviderMode;
  apiProvider: ApiProviderId;
  apiModel: string;
  thinkingDepth: ThinkingDepth;
  localRuntime: LocalRuntimeId;
  localBaseUrl: string;
  localModel: string;
  executionPolicy: ExecutionPolicy;
}

export interface ToolTrace {
  id: string;
  name: 'run_terminal_command' | 'get_system_info';
  command?: string;
  reason?: string;
  cwd?: string;
  status: 'awaiting_approval' | 'running' | 'completed' | 'failed' | 'declined';
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  durationMs?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated?: boolean;
}

export interface PendingDecisionState {
  callId: string;
  toolName: 'run_terminal_command';
  command: string;
  reason: string;
  cwd: string;
  providerKind: 'gemini' | 'openai_compat' | 'anthropic' | 'ollama';
  config: ChatRequestConfig;
  tracesSoFar: ToolTrace[];
  usageSoFar: TokenUsage;
  geminiContents?: Content[];
  openaiMessages?: Array<Record<string, unknown>>;
  anthropicMessages?: Array<Record<string, unknown>>;
  ollamaMessages?: Array<Record<string, unknown>>;
}

interface SessionRecord {
  geminiContents: Content[];
  openaiMessages: Array<Record<string, unknown>>;
  anthropicMessages: Array<Record<string, unknown>>;
  ollamaMessages: Array<Record<string, unknown>>;
  pending?: PendingDecisionState;
}

export interface ChatTurnResult {
  status: 'completed' | 'awaiting_approval';
  text: string;
  toolCalls: ToolTrace[];
  pendingTool?: {
    callId: string;
    command: string;
    reason: string;
    cwd: string;
  };
  providerLabel: string;
  modelLabel: string;
  usage: TokenUsage;
}

function emptyUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function addUsage(
  acc: TokenUsage,
  promptTokens: number,
  completionTokens: number,
  totalTokens?: number,
  estimated = false
): void {
  acc.promptTokens += promptTokens;
  acc.completionTokens += completionTokens;
  acc.totalTokens += totalTokens ?? promptTokens + completionTokens;
  if (estimated) acc.estimated = true;
}

const sessions = new Map<string, SessionRecord>();

function getOrCreateSession(sessionId: string): SessionRecord {
  let rec = sessions.get(sessionId);
  if (!rec) {
    rec = {
      geminiContents: [],
      openaiMessages: [],
      anthropicMessages: [],
      ollamaMessages: [],
    };
    sessions.set(sessionId, rec);
  }
  return rec;
}

export function resetAiSession(sessionId: string): void {
  sessions.delete(sessionId);
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Check your Settings > Secrets panel.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildSystemInstruction(): string {
  const info = terminalManager.getSystemInfo();
  return [
    'You are ShellPilot, a precise technical AI assistant connected directly to the internal terminal of the user’s host machine.',
    `Host environment: ${info.platform} (${info.arch}), shell ${info.shell}, user ${info.username}, current working directory: ${info.cwd}.`,
    'You have two tools:',
    '1. `run_terminal_command`: execute any shell command inside the internal terminal to inspect files, check system status, run scripts, inspect processes/ports, or modify workspace files.',
    '2. `get_system_info`: inspect OS, CPU, RAM, user, and current working directory.',
    'Rules:',
    '- Always verify facts by running commands via `run_terminal_command` rather than guessing file contents or system metrics.',
    '- Keep commands concise, non-interactive (use flags like `-y`, `--no-pager`, `head -n 30`), and safe.',
    '- Summarize command outputs clearly in Markdown with exact paths, exit codes, and actionable findings.',
  ].join('\n');
}

const geminiTools: FunctionDeclaration[] = [
  {
    name: 'run_terminal_command',
    description:
      'Execute a shell command in the internal PC terminal and receive stdout, stderr, exitCode, and updated cwd.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: 'The exact shell command to run in the internal terminal.',
        },
        reason: {
          type: Type.STRING,
          description: 'Short plain-English explanation of why this command is needed.',
        },
      },
      required: ['command', 'reason'],
    },
  },
  {
    name: 'get_system_info',
    description:
      'Retrieve current host OS, architecture, CPU cores, free/total RAM, current user, shell, and working directory.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
];

const openAiTools = [
  {
    type: 'function',
    function: {
      name: 'run_terminal_command',
      description:
        'Execute a shell command in the internal PC terminal and receive stdout, stderr, exitCode, and updated cwd.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Exact shell command to execute.' },
          reason: { type: 'string', description: 'Short explanation for running the command.' },
        },
        required: ['command', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_system_info',
      description: 'Get host OS, CPU, RAM, username, shell, and working directory.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

const anthropicTools = [
  {
    name: 'run_terminal_command',
    description:
      'Execute a shell command in the internal PC terminal and receive stdout, stderr, exitCode, and updated cwd.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Exact shell command to execute.' },
        reason: { type: 'string', description: 'Short explanation for running the command.' },
      },
      required: ['command', 'reason'],
    },
  },
  {
    name: 'get_system_info',
    description: 'Get host OS, CPU, RAM, username, shell, and working directory.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

function mapThinkingLevel(depth: ThinkingDepth): ThinkingLevel {
  switch (depth) {
    case 'LOW':
      return ThinkingLevel.LOW;
    case 'MEDIUM':
      return ThinkingLevel.MEDIUM;
    case 'XHIGH':
      return ThinkingLevel.XHIGH;
    case 'HIGH':
    default:
      return ThinkingLevel.HIGH;
  }
}

async function runGeminiLoop(
  session: SessionRecord,
  config: ChatRequestConfig,
  traces: ToolTrace[],
  usage: TokenUsage = emptyUsage()
): Promise<ChatTurnResult> {
  const ai = getGeminiClient();
  const model = config.apiModel || 'gemini-4-hydrogen';
  const systemInstruction = buildSystemInstruction();

  const geminiConfig: Record<string, unknown> = {
    systemInstruction,
    tools: [{ functionDeclarations: geminiTools }],
  };

  if (model === 'gemini-4-hydrogen') {
    geminiConfig.thinkingConfig = {
      thinkingLevel: mapThinkingLevel(config.thinkingDepth),
    };
  }

  for (let step = 0; step < 6; step++) {
    const response = await ai.models.generateContent({
      model,
      contents: session.geminiContents,
      config: geminiConfig,
    });

    const um = response.usageMetadata;
    if (um) {
      const prompt = um.promptTokenCount || 0;
      const completion = (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0);
      const total = um.totalTokenCount || prompt + completion;
      addUsage(usage, prompt, completion, total);
    }

    const candidateContent = response.candidates?.[0]?.content;
    if (candidateContent) {
      session.geminiContents.push(candidateContent);
    }

    const calls = response.functionCalls;
    if (!calls || calls.length === 0) {
      const finalText = (response.text || '').trim();
      return {
        status: 'completed',
        text: finalText || 'Done.',
        toolCalls: traces,
        providerLabel: 'Google Gemini',
        modelLabel: model,
        usage,
      };
    }

    // Process tool calls sequentially; pause immediately on `run_terminal_command` if policy === 'ask'
    const responseParts: Array<{
      functionResponse: { id?: string; name: string; response: Record<string, unknown> };
    }> = [];

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const callId = call.id || `call_${Date.now()}_${i}`;
      const callName = call.name || 'run_terminal_command';
      const args = (call.args || {}) as Record<string, unknown>;

      if (callName === 'get_system_info') {
        const sysInfo = terminalManager.getSystemInfo();
        traces.push({
          id: callId,
          name: 'get_system_info',
          cwd: sysInfo.cwd,
          status: 'completed',
          stdout: JSON.stringify(sysInfo, null, 2),
          exitCode: 0,
          durationMs: 1,
        });
        responseParts.push({
          functionResponse: {
            id: call.id,
            name: 'get_system_info',
            response: { systemInfo: sysInfo },
          },
        });
        continue;
      }

      const command = String(args.command || '').trim();
      const reason = String(args.reason || 'Execute shell command requested by assistant');

      if (config.executionPolicy === 'ask') {
        const pendingTrace: ToolTrace = {
          id: callId,
          name: 'run_terminal_command',
          command,
          reason,
          cwd: terminalManager.getCwd(),
          status: 'awaiting_approval',
        };
        traces.push(pendingTrace);

        session.pending = {
          callId,
          toolName: 'run_terminal_command',
          command,
          reason,
          cwd: terminalManager.getCwd(),
          providerKind: 'gemini',
          config,
          tracesSoFar: traces,
          usageSoFar: usage,
          geminiContents: session.geminiContents,
        };

        return {
          status: 'awaiting_approval',
          text: (response.text || '').trim(),
          toolCalls: traces,
          pendingTool: {
            callId,
            command,
            reason,
            cwd: terminalManager.getCwd(),
          },
          providerLabel: 'Google Gemini',
          modelLabel: model,
          usage,
        };
      }

      const execResult = await terminalManager.execCommand(command, 'ai', reason);
      traces.push({
        id: callId,
        name: 'run_terminal_command',
        command: execResult.command,
        reason,
        cwd: execResult.cwd,
        status: execResult.status === 'completed' ? 'completed' : 'failed',
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        exitCode: execResult.exitCode,
        durationMs: execResult.durationMs,
      });

      responseParts.push({
        functionResponse: {
          id: call.id,
          name: 'run_terminal_command',
          response: {
            command: execResult.command,
            cwd: execResult.cwd,
            exitCode: execResult.exitCode,
            stdout: execResult.stdout,
            stderr: execResult.stderr,
          },
        },
      });
    }

    session.geminiContents.push({
      role: 'user',
      parts: responseParts,
    });
  }

  return {
    status: 'completed',
    text: 'Reached maximum tool step limit for this turn.',
    toolCalls: traces,
    providerLabel: 'Google Gemini',
    modelLabel: model,
    usage,
  };
}

function parseFallbackCommand(text: string): { command: string; reason: string } | null {
  const tagMatch = text.match(/<terminal_command>([\s\S]*?)<\/terminal_command>/i);
  if (tagMatch && tagMatch[1]?.trim()) {
    return { command: tagMatch[1].trim(), reason: 'Terminal command requested by local model' };
  }
  return null;
}

async function runOpenAiCompatLoop(
  session: SessionRecord,
  config: ChatRequestConfig,
  traces: ToolTrace[],
  endpointUrl: string,
  apiKey: string | undefined,
  providerLabel: string,
  model: string,
  providerKind: 'openai_compat' | 'ollama',
  usage: TokenUsage = emptyUsage()
): Promise<ChatTurnResult> {
  const systemPrompt =
    buildSystemInstruction() +
    (providerKind === 'ollama'
      ? '\nIf native tool calling is unavailable, you may also request a command by outputting <terminal_command>your_command</terminal_command>.'
      : '');

  for (let step = 0; step < 6; step++) {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...session.openaiMessages,
    ];

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const res = await fetch(endpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        tools: openAiTools,
        stream: false,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${providerLabel} returned HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          role?: string;
          content?: string | null;
          tool_calls?: Array<{
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
      message?: {
        role?: string;
        content?: string;
        tool_calls?: Array<{
          function?: { name?: string; arguments?: Record<string, unknown> | string };
        }>;
      };
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const msg = data.choices?.[0]?.message || data.message;
    if (!msg) {
      throw new Error(`${providerLabel} returned an empty response payload.`);
    }

    const rawText = (msg.content || '').trim();
    const nativeToolCalls = msg.tool_calls || [];

    if (data.usage) {
      const p = data.usage.prompt_tokens || 0;
      const c = data.usage.completion_tokens || 0;
      addUsage(usage, p, c, data.usage.total_tokens || p + c);
    } else if (typeof data.prompt_eval_count === 'number' || typeof data.eval_count === 'number') {
      const p = data.prompt_eval_count || 0;
      const c = data.eval_count || 0;
      addUsage(usage, p, c, p + c);
    } else {
      const promptChars = messages.reduce(
        (sum, m) => sum + JSON.stringify(m).length,
        0
      );
      const completionChars = rawText.length + JSON.stringify(nativeToolCalls).length;
      addUsage(
        usage,
        Math.max(1, Math.ceil(promptChars / 4)),
        Math.max(1, Math.ceil(completionChars / 4)),
        undefined,
        true
      );
    }

    if (nativeToolCalls.length === 0) {
      const fallback = providerKind === 'ollama' ? parseFallbackCommand(rawText) : null;
      if (fallback) {
        const callId = `local_call_${Date.now()}`;
        session.openaiMessages.push({ role: 'assistant', content: rawText });

        if (config.executionPolicy === 'ask') {
          traces.push({
            id: callId,
            name: 'run_terminal_command',
            command: fallback.command,
            reason: fallback.reason,
            cwd: terminalManager.getCwd(),
            status: 'awaiting_approval',
          });
          session.pending = {
            callId,
            toolName: 'run_terminal_command',
            command: fallback.command,
            reason: fallback.reason,
            cwd: terminalManager.getCwd(),
            providerKind,
            config,
            tracesSoFar: traces,
            usageSoFar: usage,
            openaiMessages: session.openaiMessages,
          };
          return {
            status: 'awaiting_approval',
            text: rawText.replace(/<terminal_command>[\s\S]*?<\/terminal_command>/gi, '').trim(),
            toolCalls: traces,
            pendingTool: {
              callId,
              command: fallback.command,
              reason: fallback.reason,
              cwd: terminalManager.getCwd(),
            },
            providerLabel,
            modelLabel: model,
            usage,
          };
        }

        const execResult = await terminalManager.execCommand(
          fallback.command,
          'ai',
          fallback.reason
        );
        traces.push({
          id: callId,
          name: 'run_terminal_command',
          command: execResult.command,
          reason: fallback.reason,
          cwd: execResult.cwd,
          status: execResult.status === 'completed' ? 'completed' : 'failed',
          stdout: execResult.stdout,
          stderr: execResult.stderr,
          exitCode: execResult.exitCode,
          durationMs: execResult.durationMs,
        });
        session.openaiMessages.push({
          role: 'user',
          content: `Terminal output for \`${execResult.command}\` (exit ${execResult.exitCode}, cwd ${execResult.cwd}):\nstdout:\n${execResult.stdout}\nstderr:\n${execResult.stderr}`,
        });
        continue;
      }

      session.openaiMessages.push({ role: 'assistant', content: rawText });
      return {
        status: 'completed',
        text: rawText || 'Done.',
        toolCalls: traces,
        providerLabel,
        modelLabel: model,
        usage,
      };
    }

    // Store assistant tool call turn
    session.openaiMessages.push({
      role: 'assistant',
      content: msg.content || '',
      tool_calls: nativeToolCalls,
    });

    for (let i = 0; i < nativeToolCalls.length; i++) {
      const tc = nativeToolCalls[i];
      const callId = ('id' in tc && typeof tc.id === 'string' && tc.id) || `tc_${Date.now()}_${i}`;
      const fnName = tc.function?.name || 'run_terminal_command';
      let argsObj: Record<string, unknown> = {};
      if (typeof tc.function?.arguments === 'string') {
        try {
          argsObj = JSON.parse(tc.function.arguments);
        } catch {
          argsObj = {};
        }
      } else if (tc.function?.arguments && typeof tc.function.arguments === 'object') {
        argsObj = tc.function.arguments;
      }

      if (fnName === 'get_system_info') {
        const sysInfo = terminalManager.getSystemInfo();
        traces.push({
          id: callId,
          name: 'get_system_info',
          cwd: sysInfo.cwd,
          status: 'completed',
          stdout: JSON.stringify(sysInfo, null, 2),
          exitCode: 0,
          durationMs: 1,
        });
        session.openaiMessages.push({
          role: 'tool',
          tool_call_id: callId,
          content: JSON.stringify(sysInfo),
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
          cwd: terminalManager.getCwd(),
          status: 'awaiting_approval',
        });
        session.pending = {
          callId,
          toolName: 'run_terminal_command',
          command,
          reason,
          cwd: terminalManager.getCwd(),
          providerKind,
          config,
          tracesSoFar: traces,
          usageSoFar: usage,
          openaiMessages: session.openaiMessages,
        };
        return {
          status: 'awaiting_approval',
          text: rawText,
          toolCalls: traces,
          pendingTool: {
            callId,
            command,
            reason,
            cwd: terminalManager.getCwd(),
          },
          providerLabel,
          modelLabel: model,
          usage,
        };
      }

      const execResult = await terminalManager.execCommand(command, 'ai', reason);
      traces.push({
        id: callId,
        name: 'run_terminal_command',
        command: execResult.command,
        reason,
        cwd: execResult.cwd,
        status: execResult.status === 'completed' ? 'completed' : 'failed',
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        exitCode: execResult.exitCode,
        durationMs: execResult.durationMs,
      });

      session.openaiMessages.push({
        role: 'tool',
        tool_call_id: callId,
        content: JSON.stringify({
          command: execResult.command,
          cwd: execResult.cwd,
          exitCode: execResult.exitCode,
          stdout: execResult.stdout,
          stderr: execResult.stderr,
        }),
      });
    }
  }

  return {
    status: 'completed',
    text: 'Reached maximum tool step limit for this turn.',
    toolCalls: traces,
    providerLabel,
    modelLabel: model,
    usage,
  };
}

async function runAnthropicLoop(
  session: SessionRecord,
  config: ChatRequestConfig,
  traces: ToolTrace[],
  usage: TokenUsage = emptyUsage()
): Promise<ChatTurnResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured in server environment variables.');
  }
  const model = config.apiModel || 'claude-sonnet-4-20250514';

  for (let step = 0; step < 6; step++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: buildSystemInstruction(),
        tools: anthropicTools,
        messages: session.anthropicMessages,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic returned HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      content?: Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    };

    if (data.usage) {
      addUsage(usage, data.usage.input_tokens || 0, data.usage.output_tokens || 0);
    }

    const blocks = data.content || [];
    session.anthropicMessages.push({ role: 'assistant', content: blocks });

    const textParts = blocks.filter((b) => b.type === 'text').map((b) => b.text || '');
    const toolUses = blocks.filter((b) => b.type === 'tool_use');

    if (toolUses.length === 0) {
      return {
        status: 'completed',
        text: textParts.join('\n').trim() || 'Done.',
        toolCalls: traces,
        providerLabel: 'Anthropic',
        modelLabel: model,
        usage,
      };
    }

    const toolResults: Array<Record<string, unknown>> = [];
    for (let i = 0; i < toolUses.length; i++) {
      const tu = toolUses[i];
      const callId = tu.id || `anth_${Date.now()}_${i}`;
      const name = tu.name || 'run_terminal_command';
      const input = tu.input || {};

      if (name === 'get_system_info') {
        const sysInfo = terminalManager.getSystemInfo();
        traces.push({
          id: callId,
          name: 'get_system_info',
          cwd: sysInfo.cwd,
          status: 'completed',
          stdout: JSON.stringify(sysInfo, null, 2),
          exitCode: 0,
          durationMs: 1,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: callId,
          content: JSON.stringify(sysInfo),
        });
        continue;
      }

      const command = String(input.command || '').trim();
      const reason = String(input.reason || 'Execute command in internal terminal');

      if (config.executionPolicy === 'ask') {
        traces.push({
          id: callId,
          name: 'run_terminal_command',
          command,
          reason,
          cwd: terminalManager.getCwd(),
          status: 'awaiting_approval',
        });
        session.pending = {
          callId,
          toolName: 'run_terminal_command',
          command,
          reason,
          cwd: terminalManager.getCwd(),
          providerKind: 'anthropic',
          config,
          tracesSoFar: traces,
          usageSoFar: usage,
          anthropicMessages: session.anthropicMessages,
        };
        return {
          status: 'awaiting_approval',
          text: textParts.join('\n').trim(),
          toolCalls: traces,
          pendingTool: {
            callId,
            command,
            reason,
            cwd: terminalManager.getCwd(),
          },
          providerLabel: 'Anthropic',
          modelLabel: model,
          usage,
        };
      }

      const execResult = await terminalManager.execCommand(command, 'ai', reason);
      traces.push({
        id: callId,
        name: 'run_terminal_command',
        command: execResult.command,
        reason,
        cwd: execResult.cwd,
        status: execResult.status === 'completed' ? 'completed' : 'failed',
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        exitCode: execResult.exitCode,
        durationMs: execResult.durationMs,
      });

      toolResults.push({
        type: 'tool_result',
        tool_use_id: callId,
        content: JSON.stringify({
          command: execResult.command,
          cwd: execResult.cwd,
          exitCode: execResult.exitCode,
          stdout: execResult.stdout,
          stderr: execResult.stderr,
        }),
      });
    }

    session.anthropicMessages.push({ role: 'user', content: toolResults });
  }

  return {
    status: 'completed',
    text: 'Reached maximum tool step limit for this turn.',
    toolCalls: traces,
    providerLabel: 'Anthropic',
    modelLabel: model,
    usage,
  };
}

function getLocalEndpointUrl(config: ChatRequestConfig): {
  endpointUrl: string;
  providerLabel: string;
  providerKind: 'openai_compat' | 'ollama';
} {
  const base = config.localBaseUrl.replace(/\/+$/, '');
  if (config.localRuntime === 'ollama') {
    const endpoint = base.endsWith('/v1')
      ? `${base}/chat/completions`
      : base.endsWith('/api/chat')
        ? base
        : `${base}/v1/chat/completions`;
    return {
      endpointUrl: endpoint,
      providerLabel: 'Local · Ollama',
      providerKind: 'ollama',
    };
  }
  if (config.localRuntime === 'lmstudio') {
    const endpoint = base.endsWith('/chat/completions')
      ? base
      : base.endsWith('/v1')
        ? `${base}/chat/completions`
        : `${base}/v1/chat/completions`;
    return {
      endpointUrl: endpoint,
      providerLabel: 'Local · LM Studio',
      providerKind: 'openai_compat',
    };
  }
  const endpoint = base.endsWith('/chat/completions')
    ? base
    : base.endsWith('/v1')
      ? `${base}/chat/completions`
      : `${base}/v1/chat/completions`;
  return {
    endpointUrl: endpoint,
    providerLabel: 'Local · Custom',
    providerKind: 'openai_compat',
  };
}

export async function handleChatTurn(
  sessionId: string,
  userMessage: string,
  config: ChatRequestConfig
): Promise<ChatTurnResult> {
  const session = getOrCreateSession(sessionId);
  session.pending = undefined;
  const traces: ToolTrace[] = [];

  if (config.mode === 'api') {
    if (config.apiProvider === 'gemini') {
      session.geminiContents.push({
        role: 'user',
        parts: [{ text: userMessage }],
      });
      return runGeminiLoop(session, config, traces);
    }

    if (config.apiProvider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not configured in server environment variables.');
      }
      const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(
        /\/+$/,
        ''
      );
      session.openaiMessages.push({ role: 'user', content: userMessage });
      return runOpenAiCompatLoop(
        session,
        config,
        traces,
        `${baseUrl}/chat/completions`,
        apiKey,
        'OpenAI API',
        config.apiModel || 'gpt-4o-mini',
        'openai_compat'
      );
    }

    if (config.apiProvider === 'anthropic') {
      session.anthropicMessages.push({ role: 'user', content: userMessage });
      return runAnthropicLoop(session, config, traces);
    }
  }

  // Local runtime
  const model = config.localModel.trim();
  if (!model) {
    throw new Error('Please enter or select a local model name before sending.');
  }
  const { endpointUrl, providerLabel, providerKind } = getLocalEndpointUrl(config);
  session.openaiMessages.push({ role: 'user', content: userMessage });

  return runOpenAiCompatLoop(
    session,
    config,
    traces,
    endpointUrl,
    undefined,
    providerLabel,
    model,
    providerKind
  );
}

export async function handleToolDecision(
  sessionId: string,
  callId: string,
  approved: boolean
): Promise<ChatTurnResult> {
  const session = sessions.get(sessionId);
  if (!session || !session.pending || session.pending.callId !== callId) {
    throw new Error('No matching pending terminal command awaiting approval.');
  }

  const pending = session.pending;
  session.pending = undefined;
  const traces = [...pending.tracesSoFar];
  const targetTrace = traces.find((t) => t.id === callId);

  let toolPayload: Record<string, unknown>;

  if (approved) {
    const execResult = await terminalManager.execCommand(
      pending.command,
      'ai',
      pending.reason
    );
    if (targetTrace) {
      targetTrace.status = execResult.status === 'completed' ? 'completed' : 'failed';
      targetTrace.stdout = execResult.stdout;
      targetTrace.stderr = execResult.stderr;
      targetTrace.exitCode = execResult.exitCode;
      targetTrace.durationMs = execResult.durationMs;
      targetTrace.cwd = execResult.cwd;
    }
    toolPayload = {
      command: execResult.command,
      cwd: execResult.cwd,
      exitCode: execResult.exitCode,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
    };
  } else {
    if (targetTrace) {
      targetTrace.status = 'declined';
    }
    toolPayload = {
      declined: true,
      error: 'The user declined permission to run this command in the internal terminal.',
    };
  }

  if (pending.providerKind === 'gemini') {
    session.geminiContents.push({
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: callId,
            name: 'run_terminal_command',
            response: toolPayload,
          },
        },
      ],
    });
    return runGeminiLoop(session, pending.config, traces, { ...pending.usageSoFar });
  }

  if (pending.providerKind === 'anthropic') {
    session.anthropicMessages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: callId,
          content: JSON.stringify(toolPayload),
        },
      ],
    });
    return runAnthropicLoop(session, pending.config, traces, { ...pending.usageSoFar });
  }

  // OpenAI-compatible or Ollama
  const lastAssistantMsg = session.openaiMessages[session.openaiMessages.length - 1];
  const hasNativeToolCall = Boolean(
    lastAssistantMsg && Array.isArray(lastAssistantMsg.tool_calls) && lastAssistantMsg.tool_calls.length > 0
  );

  if (hasNativeToolCall) {
    session.openaiMessages.push({
      role: 'tool',
      tool_call_id: callId,
      content: JSON.stringify(toolPayload),
    });
  } else {
    session.openaiMessages.push({
      role: 'user',
      content: approved
        ? `Terminal result for \`${pending.command}\`: ${JSON.stringify(toolPayload)}`
        : `User declined running \`${pending.command}\`. Continue without executing it.`,
    });
  }

  if (pending.config.mode === 'api' && pending.config.apiProvider === 'openai') {
    const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(
      /\/+$/,
      ''
    );
    return runOpenAiCompatLoop(
      session,
      pending.config,
      traces,
      `${baseUrl}/chat/completions`,
      process.env.OPENAI_API_KEY,
      'OpenAI API',
      pending.config.apiModel || 'gpt-4o-mini',
      'openai_compat',
      { ...pending.usageSoFar }
    );
  }

  const { endpointUrl, providerLabel, providerKind } = getLocalEndpointUrl(pending.config);
  return runOpenAiCompatLoop(
    session,
    pending.config,
    traces,
    endpointUrl,
    undefined,
    providerLabel,
    pending.config.localModel,
    providerKind,
    { ...pending.usageSoFar }
  );
}
