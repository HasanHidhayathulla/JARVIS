import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TerminalEntry {
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

export interface TerminalSystemInfo {
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

export type TerminalEvent =
  | { type: 'snapshot'; cwd: string; runningId: string | null; entries: TerminalEntry[] }
  | { type: 'command_start'; entry: TerminalEntry }
  | { type: 'chunk'; id: string; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'command_end'; entry: TerminalEntry; cwd: string }
  | { type: 'cwd_change'; cwd: string }
  | { type: 'cleared'; cwd: string };

const MAX_OUTPUT_CHARS = 32_000;
const MAX_LOG_ENTRIES = 200;
const COMMAND_TIMEOUT_MS = 30_000;

const BLOCKED_PATTERNS: RegExp[] = [
  /(^|\s|;|&&|\|)rm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(\/|\/\*|\~|\$HOME)(\s|$)/,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  /(^|\s)mkfs(\.[a-z0-9]+)?\s+\/dev\//i,
  /(^|\s)dd\s+.*of=\/dev\/(sd|nvme|hd|vd|disk)/i,
  />\s*\/dev\/(sd|nvme|hd|vd)/i,
];

function isCommandBlocked(command: string): string | null {
  const trimmed = command.trim();
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return 'Blocked potentially destructive root/device command for host safety.';
    }
  }
  return null;
}

function resolveShell(): string {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'cmd.exe';
  }
  if (fs.existsSync('/bin/bash')) {
    return '/bin/bash';
  }
  return process.env.SHELL || '/bin/sh';
}

class TerminalManager {
  private initialCwd: string;
  private cwd: string;
  private prevCwd: string;
  private entries: TerminalEntry[] = [];
  private activeChild: ChildProcess | null = null;
  private activeEntryId: string | null = null;
  private subscribers: Set<(event: TerminalEvent) => void> = new Set();

  constructor() {
    this.initialCwd = process.cwd();
    this.cwd = this.initialCwd;
    this.prevCwd = this.initialCwd;
  }

  public getCwd(): string {
    return this.cwd;
  }

  public getEntries(): TerminalEntry[] {
    return this.entries;
  }

  public getSystemInfo(): TerminalSystemInfo {
    const userInfo = os.userInfo();
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      username: userInfo.username || process.env.USER || 'user',
      shell: resolveShell(),
      cwd: this.cwd,
      homeDir: os.homedir(),
      cpuCount: os.cpus().length,
      totalMemoryGb: (os.totalmem() / 1024 ** 3).toFixed(1),
      freeMemoryGb: (os.freemem() / 1024 ** 3).toFixed(1),
      uptimeMinutes: Math.floor(os.uptime() / 60),
    };
  }

  public getDirectoryContext(): {
    cwd: string;
    directories: string[];
    files: string[];
    isGitRepo: boolean;
    hasPackageJson: boolean;
    packageScripts: string[];
    hasPython: boolean;
    hasDocker: boolean;
  } {
    const directories: string[] = [];
    const files: string[] = [];
    let hasPackageJson = false;
    let packageScripts: string[] = [];
    let hasPython = false;
    let hasDocker = false;

    try {
      const dirents = fs.readdirSync(this.cwd, { withFileTypes: true });
      for (const d of dirents) {
        if (d.name === 'node_modules') continue;
        if (d.isDirectory()) {
          if (d.name !== '.git' && directories.length < 40) {
            directories.push(d.name);
          }
        } else {
          if (files.length < 50) {
            files.push(d.name);
          }
          if (d.name === 'package.json') hasPackageJson = true;
          if (d.name.endsWith('.py') || d.name === 'requirements.txt' || d.name === 'pyproject.toml') {
            hasPython = true;
          }
          if (
            d.name === 'Dockerfile' ||
            d.name === 'docker-compose.yml' ||
            d.name === 'docker-compose.yaml' ||
            d.name === 'compose.yaml'
          ) {
            hasDocker = true;
          }
        }
      }
    } catch {
      // Ignore unreadable directory
    }

    if (hasPackageJson) {
      try {
        const rawPkg = fs.readFileSync(path.join(this.cwd, 'package.json'), 'utf8');
        const parsed = JSON.parse(rawPkg) as { scripts?: Record<string, string> };
        if (parsed.scripts && typeof parsed.scripts === 'object') {
          packageScripts = Object.keys(parsed.scripts).slice(0, 15);
        }
      } catch {
        // Ignore invalid package.json
      }
    }

    let isGitRepo = false;
    let checkDir = this.cwd;
    for (let depth = 0; depth < 4; depth++) {
      if (fs.existsSync(path.join(checkDir, '.git'))) {
        isGitRepo = true;
        break;
      }
      const parent = path.dirname(checkDir);
      if (parent === checkDir) break;
      checkDir = parent;
    }

    return {
      cwd: this.cwd,
      directories: directories.sort(),
      files: files.sort(),
      isGitRepo,
      hasPackageJson,
      packageScripts,
      hasPython,
      hasDocker,
    };
  }

  public subscribe(listener: (event: TerminalEvent) => void): () => void {
    this.subscribers.add(listener);
    listener({
      type: 'snapshot',
      cwd: this.cwd,
      runningId: this.activeEntryId,
      entries: this.entries,
    });
    return () => {
      this.subscribers.delete(listener);
    };
  }

  private emit(event: TerminalEvent): void {
    for (const listener of this.subscribers) {
      try {
        listener(event);
      } catch {
        // Ignore disconnected listeners
      }
    }
  }

  public clearEntries(): void {
    this.entries = [];
    this.emit({ type: 'cleared', cwd: this.cwd });
  }

  public resetSession(): TerminalSystemInfo {
    this.killActive();
    this.cwd = this.initialCwd;
    this.prevCwd = this.initialCwd;
    this.emit({ type: 'cwd_change', cwd: this.cwd });
    return this.getSystemInfo();
  }

  public killActive(): boolean {
    if (this.activeChild && !this.activeChild.killed) {
      this.activeChild.kill('SIGTERM');
      setTimeout(() => {
        if (this.activeChild && !this.activeChild.killed) {
          this.activeChild.kill('SIGKILL');
        }
      }, 800);
      return true;
    }
    return false;
  }

  private pushEntry(entry: TerminalEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries = this.entries.slice(-MAX_LOG_ENTRIES);
    }
  }

  private handlePureCd(rawCommand: string): { handled: boolean; entry?: TerminalEntry } {
    const trimmed = rawCommand.trim();
    if (trimmed !== 'cd' && !trimmed.startsWith('cd ')) {
      return { handled: false };
    }
    // Only handle simple single `cd` without chains (`&&`, `;`, `||`, `|`)
    if (/[;&|]/.test(trimmed)) {
      return { handled: false };
    }

    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const arg = trimmed === 'cd' ? '' : trimmed.slice(3).trim().replace(/^["']|["']$/g, '');

    let target: string;
    if (!arg || arg === '~') {
      target = os.homedir();
    } else if (arg === '-') {
      target = this.prevCwd;
    } else if (arg.startsWith('~/')) {
      target = path.join(os.homedir(), arg.slice(2));
    } else {
      target = path.resolve(this.cwd, arg);
    }

    const id = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    try {
      const stat = fs.statSync(target);
      if (!stat.isDirectory()) {
        const entry: TerminalEntry = {
          id,
          initiator: 'user',
          command: trimmed,
          cwd: this.cwd,
          stdout: '',
          stderr: `cd: not a directory: ${arg}\n`,
          exitCode: 1,
          status: 'failed',
          startedAt,
          durationMs: Date.now() - startMs,
        };
        this.pushEntry(entry);
        this.emit({ type: 'command_start', entry });
        this.emit({ type: 'command_end', entry, cwd: this.cwd });
        return { handled: true, entry };
      }
      this.prevCwd = this.cwd;
      this.cwd = target;
      const entry: TerminalEntry = {
        id,
        initiator: 'user',
        command: trimmed,
        cwd: this.cwd,
        stdout: `${this.cwd}\n`,
        stderr: '',
        exitCode: 0,
        status: 'completed',
        startedAt,
        durationMs: Date.now() - startMs,
      };
      this.pushEntry(entry);
      this.emit({ type: 'command_start', entry });
      this.emit({ type: 'command_end', entry, cwd: this.cwd });
      return { handled: true, entry };
    } catch {
      const entry: TerminalEntry = {
        id,
        initiator: 'user',
        command: trimmed,
        cwd: this.cwd,
        stdout: '',
        stderr: `cd: no such file or directory: ${arg}\n`,
        exitCode: 1,
        status: 'failed',
        startedAt,
        durationMs: Date.now() - startMs,
      };
      this.pushEntry(entry);
      this.emit({ type: 'command_start', entry });
      this.emit({ type: 'command_end', entry, cwd: this.cwd });
      return { handled: true, entry };
    }
  }

  public async execCommand(
    command: string,
    initiator: 'user' | 'ai',
    reason?: string
  ): Promise<TerminalEntry> {
    const trimmed = command.trim();
    const id = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    if (!trimmed) {
      return {
        id,
        initiator,
        command: '',
        reason,
        cwd: this.cwd,
        stdout: '',
        stderr: 'Empty command.',
        exitCode: 1,
        status: 'failed',
        startedAt,
        durationMs: 0,
      };
    }

    const blockReason = isCommandBlocked(trimmed);
    if (blockReason) {
      const blockedEntry: TerminalEntry = {
        id,
        initiator,
        command: trimmed,
        reason,
        cwd: this.cwd,
        stdout: '',
        stderr: blockReason + '\n',
        exitCode: 126,
        status: 'blocked',
        startedAt,
        durationMs: Date.now() - startMs,
      };
      this.pushEntry(blockedEntry);
      this.emit({ type: 'command_start', entry: blockedEntry });
      this.emit({ type: 'command_end', entry: blockedEntry, cwd: this.cwd });
      return blockedEntry;
    }

    const cdResult = this.handlePureCd(trimmed);
    if (cdResult.handled && cdResult.entry) {
      cdResult.entry.initiator = initiator;
      cdResult.entry.reason = reason;
      return cdResult.entry;
    }

    const entry: TerminalEntry = {
      id,
      initiator,
      command: trimmed,
      reason,
      cwd: this.cwd,
      stdout: '',
      stderr: '',
      exitCode: null,
      status: 'running',
      startedAt,
      durationMs: 0,
    };

    this.pushEntry(entry);
    this.activeEntryId = id;
    this.emit({ type: 'command_start', entry: { ...entry } });

    const shell = resolveShell();
    const isWin = process.platform === 'win32';
    const marker = `__SHELLPILOT_PWD_${id}__`;
    const wrappedCommand = isWin
      ? trimmed
      : `${trimmed}\n__sp_ec=$?\nprintf "\\n${marker}%s\\n" "$PWD"\nexit $__sp_ec`;
    const args = isWin ? ['/c', wrappedCommand] : ['-c', wrappedCommand];

    return new Promise<TerminalEntry>((resolve) => {
      let stdoutAcc = '';
      let stderrAcc = '';
      let wasKilled = false;
      let settled = false;

      const child = spawn(shell, args, {
        cwd: this.cwd,
        env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '0' },
      });
      this.activeChild = child;

      const timeout = setTimeout(() => {
        if (!child.killed) {
          wasKilled = true;
          stderrAcc += `\n[Process timed out after ${COMMAND_TIMEOUT_MS / 1000}s]\n`;
          child.kill('SIGTERM');
        }
      }, COMMAND_TIMEOUT_MS);

      child.stdout.on('data', (chunk: Buffer) => {
        let text = chunk.toString('utf8');
        // Strip internal PWD marker before streaming to clients
        const markerIndex = text.indexOf(marker);
        if (markerIndex !== -1) {
          const before = text.slice(0, markerIndex);
          const after = text.slice(markerIndex + marker.length);
          const pwdLine = after.split('\n')[0]?.trim();
          if (pwdLine && fs.existsSync(pwdLine)) {
            this.prevCwd = this.cwd;
            this.cwd = pwdLine;
          }
          text = before.endsWith('\n') ? before.slice(0, -1) : before;
        }

        if (text) {
          if (stdoutAcc.length < MAX_OUTPUT_CHARS) {
            const slice = text.slice(0, MAX_OUTPUT_CHARS - stdoutAcc.length);
            stdoutAcc += slice;
            this.emit({ type: 'chunk', id, stream: 'stdout', text: slice });
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        if (text && stderrAcc.length < MAX_OUTPUT_CHARS) {
          const slice = text.slice(0, MAX_OUTPUT_CHARS - stderrAcc.length);
          stderrAcc += slice;
          this.emit({ type: 'chunk', id, stream: 'stderr', text: slice });
        }
      });

      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this.activeChild === child) {
          this.activeChild = null;
          this.activeEntryId = null;
        }
        const killed = wasKilled || signal === 'SIGTERM' || signal === 'SIGKILL';
        entry.stdout = stdoutAcc;
        entry.stderr = stderrAcc;
        entry.exitCode = code ?? (killed ? 130 : 1);
        entry.status = killed ? 'killed' : entry.exitCode === 0 ? 'completed' : 'failed';
        entry.durationMs = Date.now() - startMs;
        this.emit({ type: 'command_end', entry: { ...entry }, cwd: this.cwd });
        resolve({ ...entry });
      };

      child.on('error', (err) => {
        stderrAcc += `${err.message}\n`;
        this.emit({ type: 'chunk', id, stream: 'stderr', text: `${err.message}\n` });
        finish(1, null);
      });

      child.on('close', (code, signal) => {
        finish(code, signal);
      });
    });
  }
}

export const terminalManager = new TerminalManager();
