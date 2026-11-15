import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleChatTurn,
  handleToolDecision,
  resetAiSession,
  type ChatRequestConfig,
} from './server/aiRouter.ts';
import { terminalManager, type TerminalEvent } from './server/terminalManager.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Provider capability & environment status (never returns raw API keys)
  app.get('/api/providers/status', (_req, res) => {
    res.json({
      gemini: {
        configured: Boolean(process.env.GEMINI_API_KEY),
        models: [
          {
            id: 'gemini-4-hydrogen',
            label: 'Gemini 4 Hydrogen',
            description: 'Balanced intelligence, reasoning & agentic tool calling',
            supportsThinking: true,
          },
          {
            id: 'gemini-3.1-flash-lite',
            label: 'Gemini 3.1 Flash Lite',
            description: 'Ultra-fast responses & lightweight shell assistance',
            supportsThinking: false,
          },
        ],
      },
      openai: {
        configured: Boolean(process.env.OPENAI_API_KEY),
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        models: [
          { id: 'gpt-4o-mini', label: 'GPT-4o mini', description: 'Fast OpenAI API model' },
          { id: 'gpt-4o', label: 'GPT-4o', description: 'Flagship OpenAI API model' },
        ],
      },
      anthropic: {
        configured: Boolean(process.env.ANTHROPIC_API_KEY),
        models: [
          {
            id: 'claude-sonnet-4-20250514',
            label: 'Claude Sonnet 4',
            description: 'Anthropic API coding & shell model',
          },
        ],
      },
      local: {
        defaultEndpoints: {
          ollama: 'http://127.0.0.1:11434',
          lmstudio: 'http://127.0.0.1:1234/v1',
          custom: 'http://127.0.0.1:8080/v1',
        },
      },
    });
  });

  // Discover models from a local runtime (Ollama, LM Studio, or OpenAI-compatible local server)
  app.get('/api/providers/local/models', async (req, res) => {
    const runtime = String(req.query.runtime || 'ollama');
    const rawBaseUrl = String(req.query.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    try {
      if (runtime === 'ollama') {
        const tagsUrl = rawBaseUrl.endsWith('/v1')
          ? `${rawBaseUrl.slice(0, -3)}/api/tags`
          : `${rawBaseUrl}/api/tags`;
        const response = await fetch(tagsUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = (await response.json()) as {
          models?: Array<{ name: string; size?: number; details?: { parameter_size?: string } }>;
        };
        const models = (data.models || []).map((m) => ({
          id: m.name,
          label: m.name,
          meta: m.details?.parameter_size || '',
        }));
        res.json({ reachable: true, models });
        return;
      }

      const modelsUrl = rawBaseUrl.endsWith('/v1')
        ? `${rawBaseUrl}/models`
        : `${rawBaseUrl}/v1/models`;
      const response = await fetch(modelsUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as { data?: Array<{ id: string }> };
      const models = (data.data || []).map((m) => ({
        id: m.id,
        label: m.id,
        meta: '',
      }));
      res.json({ reachable: true, models });
    } catch (err) {
      res.json({
        reachable: false,
        models: [],
        error: err instanceof Error ? err.message : 'Local runtime unreachable from server',
      });
    } finally {
      clearTimeout(timer);
    }
  });

  // Terminal system info & snapshot
  app.get('/api/terminal/info', (_req, res) => {
    res.json({
      info: terminalManager.getSystemInfo(),
      entries: terminalManager.getEntries(),
    });
  });

  // Working directory context for CLI command suggestions
  app.get('/api/terminal/context', (_req, res) => {
    res.json(terminalManager.getDirectoryContext());
  });

  // Live SSE terminal event stream
  app.get('/api/terminal/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unsubscribe = terminalManager.subscribe((event: TerminalEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    const keepAlive = setInterval(() => {
      res.write(': ping\n\n');
    }, 20_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  // Execute a command directly in the internal terminal
  app.post('/api/terminal/exec', async (req, res) => {
    const command = String(req.body?.command || '');
    const initiator = req.body?.initiator === 'ai' ? 'ai' : 'user';
    const reason = req.body?.reason ? String(req.body.reason) : undefined;

    if (!command.trim()) {
      res.status(400).json({ error: 'Command is required.' });
      return;
    }

    try {
      const entry = await terminalManager.execCommand(command, initiator, reason);
      res.json({ entry, cwd: terminalManager.getCwd() });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to execute terminal command.',
      });
    }
  });

  // Kill active terminal process
  app.post('/api/terminal/kill', (_req, res) => {
    const killed = terminalManager.killActive();
    res.json({ killed });
  });

  // Clear terminal log buffer
  app.post('/api/terminal/clear', (_req, res) => {
    terminalManager.clearEntries();
    res.json({ ok: true, cwd: terminalManager.getCwd() });
  });

  // Reset terminal working directory to workspace root
  app.post('/api/terminal/reset', (_req, res) => {
    const info = terminalManager.resetSession();
    res.json({ info });
  });

  // AI Chat endpoint
  app.post('/api/chat', async (req, res) => {
    const sessionId = String(req.body?.sessionId || 'default');
    const message = String(req.body?.message || '').trim();
    const config = req.body?.config as ChatRequestConfig | undefined;

    if (!message) {
      res.status(400).json({ error: 'Message cannot be empty.' });
      return;
    }
    if (!config) {
      res.status(400).json({ error: 'Model configuration is required.' });
      return;
    }

    try {
      const result = await handleChatTurn(sessionId, message, config);
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'AI provider request failed.',
      });
    }
  });

  // Approve or decline a pending AI terminal command
  app.post('/api/chat/tool-decision', async (req, res) => {
    const sessionId = String(req.body?.sessionId || 'default');
    const callId = String(req.body?.callId || '');
    const approved = Boolean(req.body?.approved);

    if (!callId) {
      res.status(400).json({ error: 'callId is required.' });
      return;
    }

    try {
      const result = await handleToolDecision(sessionId, callId, approved);
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to process tool decision.',
      });
    }
  });

  // Reset AI conversation memory for a session
  app.post('/api/chat/reset', (req, res) => {
    const sessionId = String(req.body?.sessionId || 'default');
    resetAiSession(sessionId);
    res.json({ ok: true });
  });

  if (isProduction) {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ShellPilot server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ShellPilot server:', err);
  process.exit(1);
});
