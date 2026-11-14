/**
 * Browser harness for the E2E journey: launches headless Chrome/Edge via puppeteer-core, records
 * console errors, page errors, failed requests and HTTP 5xx responses, and offers small helpers
 * (assertions, screenshots, clicking by text, authenticated downloads).
 * @module e2e/lib/harness
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { findBrowser } from '../../scripts/dev/shot.mjs';
import { ROOT } from './server.mjs';

export const SHOTS_DIR = path.join(ROOT, 'e2e', 'screenshots');
export const DOWNLOADS_DIR = path.join(ROOT, 'e2e', 'downloads');
export const DESKTOP = { width: 1280, height: 900 };
export const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Thrown by {@link check}; carries the failed expectation. */
export class AssertionError extends Error {
  name = 'AssertionError';
}

let passed = 0;

/**
 * Assert a condition and log it.
 * @param {unknown} cond
 * @param {string} message
 */
export function check(cond, message) {
  if (!cond) throw new AssertionError(message);
  passed += 1;
  console.log(`    ✓ ${message}`);
}

/** @returns {number} assertions passed so far */
export const passedCount = () => passed;

/**
 * Print a step heading.
 * @param {string} title
 */
export function step(title) {
  console.log(`\n▸ ${title}`);
}

/**
 * Is this console error the expected one? Logged-out pages call GET /api/auth/me, which answers
 * 401 by contract (SPEC §7.2), and Chrome logs every 4xx resource as a console error.
 * @param {import('puppeteer-core').ConsoleMessage} msg
 */
function isExpectedConsoleError(msg) {
  return /Failed to load resource: .*status of 401/.test(msg.text())
    && /\/api\/auth\/me$/.test(msg.location()?.url || '');
}

/**
 * Launch the browser.
 * @returns {Promise<{ browser: import('puppeteer-core').Browser, problems: string[], watch: (page: import('puppeteer-core').Page, label: string) => void }>}
 */
export async function launchBrowser() {
  await mkdir(SHOTS_DIR, { recursive: true });
  await mkdir(DOWNLOADS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check', '--lang=en-US'],
  });
  const problems = [];
  /** Attach problem listeners to a page. */
  const watch = (page, label) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !isExpectedConsoleError(msg)) problems.push(`[${label}] console.error: ${msg.text()} (${msg.location()?.url || '-'})`);
    });
    page.on('pageerror', (err) => problems.push(`[${label}] page error: ${err.message}`));
    page.on('response', (res) => {
      if (res.status() >= 500) problems.push(`[${label}] HTTP ${res.status()} ${res.request().method()} ${res.url()}`);
    });
    page.on('requestfailed', (req) => {
      const url = req.url();
      const reason = req.failure()?.errorText || '';
      // Google Fonts may be unreachable offline; aborted requests come from navigations/downloads.
      if (/fonts\.(googleapis|gstatic)\.com/.test(url) || reason === 'net::ERR_ABORTED') return;
      problems.push(`[${label}] request failed: ${req.method()} ${url} ${reason}`);
    });
  };
  return { browser, problems, watch };
}

/**
 * Open a new page in a fresh browser context with the given viewport and theme.
 * @param {import('puppeteer-core').Browser} browser
 * @param {{ viewport?: object, theme?: 'light'|'dark' }} [opts]
 */
export async function newPage(browser, { viewport = DESKTOP, theme = 'light' } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  page.setDefaultTimeout(15_000);
  return { context, page };
}

/**
 * Assert no rendered text node is a leaked JS value ("null", "undefined", "NaN", "[object Object]").
 * @param {import('puppeteer-core').Page} page
 * @param {string} label
 */
export async function checkNoStrayText(page, label) {
  const leaks = await page.evaluate(() => {
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent.trim();
      if (/^(null|undefined|NaN|\[object Object\])$/.test(text) && n.parentElement?.getClientRects().length) found.push(text);
    }
    return found;
  });
  check(leaks.length === 0, `${label}: no stray "null"/"undefined" text${leaks.length ? ` (found ${leaks.join(', ')})` : ''}`);
}

/**
 * Check the page for leaked values, then save a screenshot to e2e/screenshots/<name>.png.
 * @param {import('puppeteer-core').Page} page
 * @param {string} name
 * @param {{ fullPage?: boolean }} [opts]
 * @returns {Promise<string>} absolute file path
 */
export async function shot(page, name, { fullPage = false } = {}) {
  if (name !== 'failure') await checkNoStrayText(page, name);
  const file = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  return file;
}

/** Current location.hash of the page. */
export const hashOf = (page) => page.evaluate(() => location.hash);

/**
 * Wait until location.hash matches a pattern.
 * @param {import('puppeteer-core').Page} page
 * @param {RegExp} re
 */
export async function waitForHash(page, re, timeout = 10_000) {
  await page.waitForFunction((src, flags) => new RegExp(src, flags).test(location.hash), { timeout }, re.source, re.flags);
  return hashOf(page);
}

/**
 * Click the first visible element matching `selector` whose text contains `text`.
 * @param {import('puppeteer-core').Page} page
 * @param {string} selector
 * @param {string} text
 */
export async function clickText(page, selector, text) {
  const handle = await page.waitForFunction((sel, t) => [...document.querySelectorAll(sel)]
    .find((el) => el.textContent.includes(t) && el.getClientRects().length > 0), {}, selector, text);
  // Centre it first: the sticky practice header can cover elements near the top of the viewport.
  // (Not inside menus or dialogs: a page scroll closes an open menu.)
  await handle.evaluate((el) => { if (!el.closest('.menu, dialog')) el.scrollIntoView({ block: 'center', inline: 'nearest' }); });
  await handle.asElement().click();
}

/**
 * Click an element after centring it (the sticky header can cover elements near the top).
 * @param {import('puppeteer-core').Page} page
 * @param {string} selector
 */
export async function clickCentered(page, selector) {
  const el = await page.waitForSelector(selector, { visible: true });
  await el.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await el.click();
}

/**
 * Tap (touch) an element after centring it.
 * @param {import('puppeteer-core').Page} page
 * @param {string} selector
 */
export async function tapCentered(page, selector) {
  const el = await page.waitForSelector(selector, { visible: true });
  await el.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await el.tap();
}

/**
 * Replace the value of an input by typing like a user.
 * @param {import('puppeteer-core').Page} page
 * @param {string} selector
 * @param {string} text
 */
export async function fill(page, selector, text) {
  await page.waitForSelector(selector, { visible: true });
  await page.$eval(selector, (el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.type(selector, text);
}

/**
 * Call the JSON API from inside the page (same session cookie and CSRF header as the app).
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<{ status: number, data: any }>}
 */
export function apiCall(page, method, urlPath, body) {
  return page.evaluate(async (m, p, b) => {
    const res = await fetch(p, {
      method: m,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'HiraKata' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
  }, method, urlPath, body);
}

/**
 * Download a URL from Node with the page's session cookie, as a browser download would.
 * @param {import('puppeteer-core').Page} page
 * @param {string} url absolute or page-relative URL
 * @returns {Promise<{ status: number, type: string, disposition: string, bytes: Buffer }>}
 */
export async function downloadWithSession(page, url) {
  const absolute = new URL(url, page.url()).href;
  const cookies = await page.browserContext().cookies();
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const res = await fetch(absolute, { headers: { Cookie: cookie } });
  return {
    status: res.status,
    type: res.headers.get('content-type') || '',
    disposition: res.headers.get('content-disposition') || '',
    bytes: Buffer.from(await res.arrayBuffer()),
  };
}

/**
 * Assert the page has no horizontal overflow (no sideways scrolling on phones).
 * @param {import('puppeteer-core').Page} page
 * @param {string} label
 */
export async function checkNoOverflow(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check(sw <= iw, `${label}: no horizontal overflow (${sw} <= ${iw})`);
}

/**
 * Open another page in an existing browser context (same session cookie) with its own viewport.
 * @param {import('puppeteer-core').BrowserContext} context
 * @param {{ viewport?: object, theme?: 'light'|'dark' }} [opts]
 */
export async function pageIn(context, { viewport = DESKTOP, theme = 'light' } = {}) {
  const page = await context.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  page.setDefaultTimeout(15_000);
  return page;
}

/**
 * Replace speechSynthesis with a recorder that offers one Japanese voice ("HiraKata Test Voice",
 * ja-JP). Every utterance lands in `window.__spoken` as { text, rate, lang, voice }; each one
 * "plays" for 400 ms. Headless Chrome has no voices, so listen mode is tested with this stub.
 * @param {import('puppeteer-core').Page} page
 */
export async function installSpeechStub(page) {
  await page.evaluateOnNewDocument(() => {
    const voices = [{ name: 'HiraKata Test Voice', voiceURI: 'hirakata-test-ja', lang: 'ja-JP', localService: true, default: false }];
    const listeners = new Set();
    window.__spoken = [];
    const synth = {
      speaking: false,
      pending: false,
      paused: false,
      onvoiceschanged: null,
      getVoices: () => voices,
      speak(u) {
        window.__spoken.push({ text: u.text, rate: u.rate, lang: u.lang, voice: u.voice?.name || '' });
        this.speaking = true;
        setTimeout(() => u.onstart?.({ type: 'start' }), 10);
        setTimeout(() => { this.speaking = false; u.onend?.({ type: 'end' }); }, 400);
      },
      cancel() { this.speaking = false; },
      pause() {},
      resume() {},
      addEventListener(type, fn) { if (type === 'voiceschanged') listeners.add(fn); },
      removeEventListener(type, fn) { listeners.delete(fn); },
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) {
      this.text = text; this.lang = ''; this.rate = 1; this.pitch = 1; this.volume = 1; this.voice = null;
    };
  });
}

/**
 * Wait until the page has spoken `text` at least `count` times; returns the last utterance.
 * @param {import('puppeteer-core').Page} page
 * @param {string} text
 */
export async function waitForSpoken(page, text, count = 1) {
  await page.waitForFunction((t, n) => (window.__spoken || []).filter((u) => u.text === t).length >= n, { timeout: 5000 }, text, count);
  return page.evaluate((t) => window.__spoken.filter((u) => u.text === t).at(-1), text);
}

/**
 * Poll GET /api/auth/me until a saved setting has the expected value (settings save debounced).
 * @param {import('puppeteer-core').Page} page
 * @param {string} key
 * @param {unknown} value
 */
export async function waitForSetting(page, key, value, timeout = 5000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const me = await apiCall(page, 'GET', '/api/auth/me');
    if (me.data?.user?.settings?.[key] === value) return true;
    if (Date.now() > deadline) throw new AssertionError(`setting ${key} was not saved as ${JSON.stringify(value)} (is ${JSON.stringify(me.data?.user?.settings?.[key])})`);
    await sleep(200);
  }
}
