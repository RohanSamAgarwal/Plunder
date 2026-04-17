// Structured logger for Plunder. Writes JSONL to server/logs/plunder.jsonl
// and mirrors to console. Rotates the main file on startup if too large and
// keeps the last N rotated copies.

import {
  mkdirSync, existsSync, statSync, renameSync, readdirSync, unlinkSync,
  createWriteStream, readFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', 'logs');
const GAMES_DIR = join(LOG_DIR, 'games');
const LOG_FILE = join(LOG_DIR, 'plunder.jsonl');
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_ROTATED = 5;
// Per-game logs: keep newest N files; prune oldest on startup and on write.
const MAX_GAME_LOGS = 200;

function ensureDir() {
  try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }
  try { mkdirSync(GAMES_DIR, { recursive: true }); } catch { /* ignore */ }
}

// Per-room append streams, keyed by the log filename. Reused across writes
// so we don't open/close on every event.
const gameStreams = new Map();

function safeRoomSlug(code) {
  // Room codes look like "GOLDEN-REEF-42"; keep it safe for a filename.
  return String(code).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

function gameLogPath(code) {
  return join(GAMES_DIR, `${safeRoomSlug(code)}.jsonl`);
}

function pruneOldGameLogs() {
  try {
    const files = readdirSync(GAMES_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, m: statSync(join(GAMES_DIR, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    while (files.length > MAX_GAME_LOGS) {
      const oldest = files.pop();
      try { unlinkSync(join(GAMES_DIR, oldest.f)); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

function rotateIfNeeded() {
  if (!existsSync(LOG_FILE)) return;
  try {
    const { size } = statSync(LOG_FILE);
    if (size < MAX_BYTES) return;

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const rotated = join(LOG_DIR, `plunder-${ts}.jsonl`);
    renameSync(LOG_FILE, rotated);

    const rotateds = readdirSync(LOG_DIR)
      .filter(f => f.startsWith('plunder-') && f.endsWith('.jsonl'))
      .sort(); // ISO timestamps sort lexicographically
    while (rotateds.length > MAX_ROTATED) {
      const oldest = rotateds.shift();
      try { unlinkSync(join(LOG_DIR, oldest)); } catch { /* ignore */ }
    }
  } catch (err) {
    console.error('[logger] rotation failed:', err);
  }
}

ensureDir();
rotateIfNeeded();
pruneOldGameLogs();

const stream = createWriteStream(LOG_FILE, { flags: 'a' });
stream.on('error', (err) => {
  console.error('[logger] write stream error:', err);
});

function gameStreamFor(code) {
  const slug = safeRoomSlug(code);
  let s = gameStreams.get(slug);
  if (!s) {
    s = createWriteStream(gameLogPath(code), { flags: 'a' });
    s.on('error', (err) => console.error(`[logger] game stream error (${slug}):`, err));
    gameStreams.set(slug, s);
  }
  return s;
}

function writeGame(code, level, event, data) {
  if (!code) return;
  const entry = {
    t: new Date().toISOString(),
    level,
    event,
    code,
    ...(data && typeof data === 'object' ? data : { data }),
  };
  try {
    gameStreamFor(code).write(JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('[logger] game write failed:', err);
  }
}

function readGameLog(code, limit = 5000) {
  try {
    const path = gameLogPath(code);
    if (!existsSync(path)) return [];
    const text = readFileSync(path, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    const start = Math.max(0, lines.length - limit);
    const out = [];
    for (let i = start; i < lines.length; i++) {
      try { out.push(JSON.parse(lines[i])); } catch { /* skip malformed */ }
    }
    return out;
  } catch {
    return [];
  }
}

function write(level, event, data) {
  const entry = {
    t: new Date().toISOString(),
    level,
    event,
    ...(data && typeof data === 'object' ? data : { data }),
  };

  // Mirror to console so Docker / systemd logs still see it
  const prefix = `[${entry.t}] [${level}] ${event}`;
  const rest = data ? ' ' + JSON.stringify(data) : '';
  if (level === 'error') console.error(prefix + rest);
  else if (level === 'warn') console.warn(prefix + rest);
  else console.log(prefix + rest);

  try {
    stream.write(JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('[logger] write failed:', err);
  }
}

function readRecent(limit = 500) {
  if (!existsSync(LOG_FILE)) return [];
  try {
    const text = readFileSync(LOG_FILE, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    const start = Math.max(0, lines.length - limit);
    const out = [];
    for (let i = start; i < lines.length; i++) {
      try { out.push(JSON.parse(lines[i])); } catch { /* skip malformed */ }
    }
    return out;
  } catch {
    return [];
  }
}

export const logger = {
  info:  (event, data) => write('info',  event, data),
  warn:  (event, data) => write('warn',  event, data),
  error: (event, data) => write('error', event, data),
  readRecent,
  logPath: LOG_FILE,

  // Per-game log: write an entry to both the global stream AND the
  // room-specific file so you can download just one game's worth of events.
  // `code` is the room code; falsy code logs globally only.
  gameLog(code, event, data) {
    write('info', event, { code, ...(data || {}) });
    writeGame(code, 'info', event, data);
  },
  gameWarn(code, event, data) {
    write('warn', event, { code, ...(data || {}) });
    writeGame(code, 'warn', event, data);
  },
  gameError(code, event, data) {
    write('error', event, { code, ...(data || {}) });
    writeGame(code, 'error', event, data);
  },
  readGameLog,
  gameLogPath,
};

// Install global handlers so crashes are recorded before the process dies.
// Defensive: only install once even if the module is imported multiple times.
if (!global.__plunderLoggerInstalled) {
  global.__plunderLoggerInstalled = true;

  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', {
      message: err?.message,
      stack: err?.stack,
    });
    // Give the stream a moment to flush, then exit so the process manager
    // (Docker / systemd) can restart us cleanly.
    setTimeout(() => process.exit(1), 200);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', {
      message: reason?.message ?? String(reason),
      stack: reason?.stack,
    });
  });

  process.on('SIGTERM', () => {
    logger.info('shutdown', { signal: 'SIGTERM' });
    setTimeout(() => process.exit(0), 200);
  });
  process.on('SIGINT', () => {
    logger.info('shutdown', { signal: 'SIGINT' });
    setTimeout(() => process.exit(0), 200);
  });
}
