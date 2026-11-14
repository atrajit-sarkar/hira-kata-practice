/**
 * Cached HTTP downloads for the word-bank build.
 *
 * Downloaded files are treated as untrusted data: each source gets its own cache
 * subdirectory, files are only ever read back and parsed (JSON / CSV / tar), never executed.
 */
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

export const USER_AGENT = `HiraKata-wordbank-builder/1.0 (dictionary build script; Node.js ${process.versions.node})`;

const TIMEOUT_MS = 60_000;
const RETRY_DELAY_MS = 1_500;

/** Error raised when a download fails and no cached copy exists. */
export class DownloadError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = 'DownloadError';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch a URL with a descriptive User-Agent, a timeout and one retry.
 * Non-2xx responses with status 404 are not retried.
 * @param {string} url
 * @param {{ accept?: string, timeoutMs?: number }} [options] timeoutMs covers the whole response body
 * @returns {Promise<Response>} a successful (2xx) response
 * @throws {DownloadError}
 */
export async function fetchWithRetry(url, { accept, timeoutMs = TIMEOUT_MS } = {}) {
  const headers = { 'User-Agent': USER_AGENT };
  if (accept) headers.Accept = accept;
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      lastError = new DownloadError(`HTTP ${res.status} ${res.statusText} for ${url}`);
      if (res.status === 404) break;
    } catch (err) {
      lastError = new DownloadError(`Network error for ${url}: ${err.message}`, { cause: err });
    }
    if (attempt === 1) await sleep(RETRY_DELAY_MS);
  }
  throw lastError;
}

/**
 * Fetch a URL and parse the body as JSON.
 * @param {string} url
 * @returns {Promise<unknown>}
 */
export async function fetchJson(url) {
  const res = await fetchWithRetry(url, { accept: 'application/json' });
  return res.json();
}

/**
 * Return the bytes of `url`, using `cacheFile` when it already exists.
 * Downloads are written to a temporary name first and renamed, so an interrupted
 * download never leaves a truncated cache entry behind.
 * @param {string} url
 * @param {string} cacheFile absolute path of the cache file
 * @param {{ refresh?: boolean, timeoutMs?: number }} [options] refresh: ignore an existing cached
 *   copy; timeoutMs: time allowed for the whole download
 * @returns {Promise<{ data: Buffer, fromCache: boolean }>}
 */
export async function cachedDownload(url, cacheFile, { refresh = false, timeoutMs } = {}) {
  if (!refresh) {
    const cached = await readFile(cacheFile).catch(() => null);
    if (cached && cached.length > 0) return { data: cached, fromCache: true };
  }
  const res = await fetchWithRetry(url, { timeoutMs });
  const data = Buffer.from(await res.arrayBuffer());
  await mkdir(path.dirname(cacheFile), { recursive: true });
  const tmp = `${cacheFile}.part`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, cacheFile);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  return { data, fromCache: false };
}
