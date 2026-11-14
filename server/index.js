/**
 * Server entry point: loads config, word bank and database, starts listening, prints a banner and
 * shuts down gracefully on SIGINT/SIGTERM.
 * @module server/index
 */
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { housekeeping, openDatabase } from './db.js';
import { WordBankError, loadWordBankWithFallback } from './services/wordbank.js';

const HOUSEKEEPING_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SHUTDOWN_GRACE_MS = 5000;

/**
 * Print a fatal startup error and exit.
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`\n  HiraKata could not start.\n  ${message}\n`);
  process.exit(1);
}

/**
 * Load the word bank (`.json.gz` or `.json`; the other spelling is tried when the configured file
 * is missing), turning known problems into friendly messages.
 * @param {string} wordsPath
 * @param {string|null} fallbackPath
 * @returns {Promise<{ bank: import('./services/wordbank.js').WordBank, path: string }>}
 */
async function loadWords(wordsPath, fallbackPath) {
  try {
    return await loadWordBankWithFallback(wordsPath, fallbackPath);
  } catch (err) {
    if (err instanceof WordBankError && err.code === 'MISSING') {
      fail(`The word bank was not found at ${wordsPath}${fallbackPath ? ` (or ${fallbackPath})` : ''}.\n`
        + '  Run npm run build:words to download JMdict and build data/words.json.gz, then start again.');
    }
    if (err instanceof WordBankError) {
      fail(`${err.message}\n  Run npm run build:words to rebuild the word bank (data/words.json.gz).`);
    }
    throw err;
  }
}

const fmt = (n) => n.toLocaleString('en-US');

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fail(err.message);
  }
  const { bank: wordbank, path: wordsPath } = await loadWords(config.wordsPath, config.wordsFallbackPath);
  const db = openDatabase(config.dbPath);
  const cleaned = housekeeping(db);
  const app = createApp({ config, db, wordbank });

  const server = app.listen(config.port, config.host);
  server.on('error', (err) => {
    db.close();
    if (err.code === 'EADDRINUSE') fail(`Port ${config.port} is already in use. Set PORT to a free port.`);
    if (err.code === 'EACCES') fail(`Permission denied for ${config.host}:${config.port}.`);
    fail(err.message);
  });
  server.on('listening', () => {
    const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
    const host = ['0.0.0.0', '::'].includes(config.host) ? 'localhost' : config.host;
    const { counts } = wordbank;
    const jlptTagged = Object.values(counts.byJlpt).reduce((a, b) => a + b, 0);
    console.log([
      '',
      '  HiraKata · ひらカタ is ready',
      `  ➜ http://${host.includes(':') ? `[${host}]` : host}:${port}/`,
      `  Words     ${fmt(counts.total)} (hiragana ${fmt(counts.byScript.hiragana)} · katakana ${fmt(counts.byScript.katakana)}`
        + ` · common ${fmt(counts.common)})` + (jlptTagged ? ` · JLPT-tagged ${fmt(jlptTagged)}` : ''),
      `  Bank      ${wordsPath}`,
      `  Database  ${config.dbPath}`,
      `  Mode      ${config.nodeEnv}${cleaned.sessions || cleaned.guests
        ? ` · cleaned ${cleaned.sessions} expired session(s), ${cleaned.guests} stale guest(s)` : ''}`,
      '',
    ].join('\n'));
  });

  const timer = setInterval(() => {
    try {
      housekeeping(db);
    } catch (err) {
      console.error('Housekeeping failed:', err);
    }
  }, HOUSEKEEPING_INTERVAL_MS);
  timer.unref();

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n  ${signal} received, shutting down…`);
    clearInterval(timer);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), SHUTDOWN_GRACE_MS).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
