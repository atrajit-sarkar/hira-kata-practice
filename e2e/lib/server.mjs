/**
 * Starts a real HiraKata server for the E2E run: a free local port, a throw-away SQLite file in the
 * OS temp directory, and the default word bank (data/words.json.gz). Only the child process started here is
 * ever stopped.
 * @module e2e/lib/server
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the project root. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const READY_TIMEOUT_MS = 30_000;

/**
 * Ask the OS for a free TCP port on 127.0.0.1.
 * @returns {Promise<number>}
 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Spawn `server/index.js` and wait until it serves the SPA.
 * @returns {Promise<{ base: string, dbPath: string, logs: () => string, stop: () => Promise<void> }>}
 */
export async function startServer() {
  const port = await freePort();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hirakata-e2e-'));
  const dbPath = path.join(dir, 'e2e.db');
  const base = `http://127.0.0.1:${port}`;
  let output = '';

  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join('server', 'index.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: dbPath, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));

  /** Stop the child (idempotent) and remove the temp directory. */
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([exited, sleep(5000)]);
    }
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  };

  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (child.exitCode !== null) {
      await stop();
      throw new Error(`Server exited during startup (code ${child.exitCode}).\n${output}`);
    }
    try {
      const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) break;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`Server did not become ready within ${READY_TIMEOUT_MS / 1000}s.\n${output}`);
    }
    await sleep(200);
  }
  return { base, dbPath, logs: () => output, stop };
}
