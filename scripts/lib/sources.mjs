/**
 * Locating, downloading (with cache) and parsing the word-bank source data:
 * the full English JMdict from jmdict-simplified (SPEC §15.1), and the JLPT vocabulary lists.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { readTarGz, parseCsvRecords } from './archive.mjs';
import { cachedDownload, fetchJson } from './download.mjs';

const RELEASES_API = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';
// The asset name becomes a cache file name, so it must not contain path separators. The version
// must start with a digit, so the smaller "jmdict-eng-common-*" edition never matches.
const ASSET_PATTERN = /^jmdict-eng-(\d[0-9A-Za-z._+-]*)\.json\.tgz$/;
// The full edition is ~11.5 MB; allow slow connections more time than the default request timeout.
const JMDICT_TIMEOUT_MS = 10 * 60_000;

/** Download URL of a release asset; jmdict-simplified tags releases with the version string. */
function assetFromName(name) {
  const version = ASSET_PATTERN.exec(name)[1];
  const base = 'https://github.com/scriptin/jmdict-simplified/releases/download';
  return { name, url: `${base}/${encodeURIComponent(version)}/${encodeURIComponent(name)}` };
}

/** Build timestamp of a release asset name ("3.6.2+20261109214828" → "20261109214828"), for ordering. */
const releaseStamp = (name) => /\+(\d+)\.json\.tgz$/.exec(name)?.[1] ?? '';
const FALLBACK_ASSET = assetFromName('jmdict-eng-3.6.2+20261109214828.json.tgz');
const JLPT_URL = (n) => `https://raw.githubusercontent.com/stephenmk/yomitan-jlpt-vocab/main/original_data/n${n}.csv`;
export const JLPT_LEVELS = Object.freeze([5, 4, 3, 2, 1]);

/**
 * Pick the JMdict asset to use: the latest GitHub release when reachable, otherwise the newest
 * cached archive, otherwise the pinned fallback release.
 * @param {string} cacheDir directory holding cached JMdict archives
 * @param {(msg: string) => void} log
 * @returns {Promise<{ name: string, url: string }>}
 */
async function resolveJmdictAsset(cacheDir, log) {
  try {
    const release = await fetchJson(RELEASES_API);
    const asset = release?.assets?.find((a) => ASSET_PATTERN.test(a.name));
    if (asset?.browser_download_url) return { name: asset.name, url: asset.browser_download_url };
    log('Latest release has no jmdict-eng .json.tgz asset; using fallback release.');
  } catch (err) {
    log(`Could not query the latest release (${err.message}).`);
    const cached = (await readdir(cacheDir).catch(() => []))
      .filter((f) => ASSET_PATTERN.test(f))
      .sort((a, b) => releaseStamp(a).localeCompare(releaseStamp(b)));
    if (cached.length) {
      const name = cached[cached.length - 1];
      log(`Using cached archive ${name}.`);
      return assetFromName(name);
    }
  }
  return FALLBACK_ASSET;
}

/**
 * Download (or read from cache) and parse the full English JMdict (~210k entries, ~120 MB of JSON).
 * @param {{ cacheRoot: string, refresh?: boolean, log?: (msg: string) => void }} options
 * @returns {Promise<{ dict: { version: string, dictDate: string, words: object[] }, releaseVersion: string, fromCache: boolean }>}
 */
export async function loadJmdict({ cacheRoot, refresh = false, log = () => {} }) {
  const cacheDir = path.join(cacheRoot, 'jmdict');
  const asset = await resolveJmdictAsset(cacheDir, log);
  const { data, fromCache } = await cachedDownload(asset.url, path.join(cacheDir, asset.name), {
    refresh,
    timeoutMs: JMDICT_TIMEOUT_MS,
  });
  const member = readTarGz(data).find((f) => f.name.endsWith('.json'));
  if (!member) throw new Error(`${asset.name} does not contain a .json file`);
  const dict = JSON.parse(member.data.toString('utf8'));
  if (!Array.isArray(dict?.words) || typeof dict.dictDate !== 'string') {
    throw new Error(`${asset.name} is not a jmdict-simplified dictionary (missing words/dictDate)`);
  }
  return { dict, releaseVersion: ASSET_PATTERN.exec(asset.name)[1], fromCache };
}

/**
 * Download (or read from cache) the JLPT lists and map JMdict ids to their easiest level.
 * All five lists must load; otherwise JLPT data is treated as unavailable (null).
 * @param {{ cacheRoot: string, refresh?: boolean, log?: (msg: string) => void }} options
 * @returns {Promise<Map<string, number>|null>} JMdict id → 5..1, or null when unavailable
 */
export async function loadJlpt({ cacheRoot, refresh = false, log = () => {} }) {
  const byId = new Map();
  try {
    for (const level of JLPT_LEVELS) {
      const file = path.join(cacheRoot, 'jlpt', `n${level}.csv`);
      const { data } = await cachedDownload(JLPT_URL(level), file, { refresh });
      const records = parseCsvRecords(data.toString('utf8'), ['jmdict_seq', 'kana']);
      for (const { jmdict_seq: seq } of records) {
        const id = seq.trim();
        if (/^\d+$/.test(id) && (byId.get(id) ?? 0) < level) byId.set(id, level);
      }
    }
  } catch (err) {
    log(`JLPT lists unavailable (${err.message}); every word gets jlpt: null.`);
    return null;
  }
  return byId;
}
