export type ProviderMode = 'api' | 'local';
export type ApiProviderId = 'gemini' | 'openai' | 'anthropic';
export type LocalRuntimeId = 'ollama' | 'lmstudio' | 'custom';
export type ThinkingDepth = 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH';
export type ExecutionPolicy = 'ask' | 'auto';
export type WorkspaceView = 'workspace' | 'dashboard' | 'providers' | 'log';

export interface ModelConfig {
  mode: ProviderMode;
  apiProvider: ApiProviderId;
  apiModel: string;
  thinkingDepth: ThinkingDepth;
  localRuntime: LocalRuntimeId;
  localBaseUrl: string;
  localModel: string;
  executionPolicy: ExecutionPolicy;
}

export interface ProviderAvailability {
  gemini: {
    configured: boolean;
    models: Array<{ id: string; label: string; description: string; supportsThinking: boolean }>;
  };
  openai: {
    configured: boolean;
    baseUrl: string;
    models: Array<{ id: string; label: string; description: string }>;
  };
  anthropic: {
    configured: boolean;
    models: Array<{ id: string; label: string; description: string }>;
  };
  local: {
    defaultEndpoints: Record<LocalRuntimeId, string>;
  };
}

export interface SystemInfo {
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  username: string;
  shell: string;
  cwd: string;
  homeDir: string;
  cpuCount: number;
  totalMemoryGb: string;
  freeMemoryGb: string;
  uptimeMinutes: number;
}

export interface TerminalCommandEntry {
  id: string;
  initiator: 'user' | 'ai';
  command: string;
  reason?: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  status: 'running' | 'completed' | 'failed' | 'killed' | 'blocked';
  startedAt: string;
  durationMs: number;
}

export interface ToolCallTrace {
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

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp: string;
  providerLabel?: string;
  modelLabel?: string;
  toolCalls?: ToolCallTrace[];
  usage?: TokenUsage;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  messages: ChatMessage[];
}

export interface TerminalContextInfo {
  cwd: string;
  directories: string[];
  files: string[];
  isGitRepo: boolean;
  hasPackageJson: boolean;
  packageScripts: string[];
  hasPython: boolean;
  hasDocker: boolean;
}
