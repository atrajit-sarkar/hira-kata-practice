#!/usr/bin/env node
/**
 * Dev screenshot helper for HiraKata (puppeteer-core + a locally installed Chrome/Edge).
 *
 * Usage:
 *   node scripts/dev/shot.mjs --base http://localhost:3100 --route "#/dashboard" --out C:\path\shot.png [options]
 *
 * Options:
 *   --base <url>            Server origin (default http://127.0.0.1:3000)
 *   --route <hash>          Hash route to open, e.g. "#/login" (default "#/")
 *   --out <file.png>        Output PNG path (required)
 *   --width <px>            Viewport width (default 1280)
 *   --height <px>           Viewport height (default 860)
 *   --mobile                390x844 @2x touch viewport
 *   --full                  Full-page screenshot
 *   --theme light|dark      Force theme (localStorage 'hk-theme' + prefers-color-scheme)
 *   --register "Name|email|password"  Register first (falls back to login if the email exists)
 *   --login "email|password"          Log in first
 *   --guest                 Start a guest session first
 *   --wait <ms>             Extra wait after load (default 900)
 *   --selector <css>        Wait for this selector before the screenshot
 *   --script <file.mjs>     Module whose default export `async (page, ctx) => {}` runs before the screenshot
 *   --reduced-motion        Emulate prefers-reduced-motion: reduce
 *
 * Console errors, page errors, failed requests and HTTP >= 400 responses are printed to stdout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

export function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!found) throw new Error('No Chrome/Edge found. Set CHROME_PATH to a Chromium-based browser executable.');
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiCall(page, method, url, body) {
  return page.evaluate(async (m, u, b) => {
    const res = await fetch(u, {
      method: m,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'HiraKata' },
      body: m === 'GET' ? undefined : JSON.stringify(b ?? {}),
      credentials: 'same-origin',
    });
    let json = null;
    try { json = await res.json(); } catch { /* ignore */ }
    return { status: res.status, json };
  }, method, url, body ?? null);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    console.error('Missing --out <file.png>. See header of scripts/dev/shot.mjs for usage.');
    process.exit(2);
  }
  const base = String(args.base || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const route = String(args.route || '#/');
  const mobile = Boolean(args.mobile);
  const width = Number(args.width || (mobile ? 390 : 1280));
  const height = Number(args.height || (mobile ? 844 : 860));
  const theme = args.theme === 'dark' || args.theme === 'light' ? args.theme : null;
  const waitMs = Number(args.wait ?? 900);

  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars'],
    defaultViewport: { width, height, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile },
  });
  const problems = [];
  try {
    const page = await browser.newPage();
    page.on('console', (msg) => {
      const t = msg.type();
      if (t === 'error' || t === 'warn' || t === 'warning') problems.push(`[console.${t}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`[pageerror] ${err && err.stack ? err.stack : err}`));
    page.on('requestfailed', (req) => problems.push(`[requestfailed] ${req.method()} ${req.url()} ${req.failure()?.errorText || ''}`));
    page.on('response', (res) => { if (res.status() >= 400) problems.push(`[http ${res.status()}] ${res.request().method()} ${res.url()}`); });

    const features = [];
    if (theme) features.push({ name: 'prefers-color-scheme', value: theme });
    if (args['reduced-motion']) features.push({ name: 'prefers-reduced-motion', value: 'reduce' });
    if (features.length) await page.emulateMediaFeatures(features);
    if (theme) {
      await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('hk-theme', t); } catch { /* ignore */ } }, theme);
    }

    // Establish the origin first so auth calls are same-origin and cookies land in the browser.
    if (args.register || args.login || args.guest) {
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      if (args.register) {
        const [displayName, email, password] = String(args.register).split('|');
        const r = await apiCall(page, 'POST', '/api/auth/register', { displayName, email, password });
        if (r.status === 409) {
          const l = await apiCall(page, 'POST', '/api/auth/login', { email, password, remember: true });
          console.log(`register: 409 -> login ${l.status}`);
        } else {
          console.log(`register: ${r.status}`);
        }
      } else if (args.login) {
        const [email, password] = String(args.login).split('|');
        const l = await apiCall(page, 'POST', '/api/auth/login', { email, password, remember: true });
        console.log(`login: ${l.status}`);
      } else if (args.guest) {
        const g = await apiCall(page, 'POST', '/api/auth/guest');
        console.log(`guest: ${g.status}`);
      }
      await page.goto('about:blank');
    }

    const target = base + '/' + (route.startsWith('#') ? route : '#' + route.replace(/^\/?/, '/'));
    await page.goto(target, { waitUntil: 'networkidle0', timeout: 30000 });
    if (args.selector) await page.waitForSelector(String(args.selector), { timeout: 15000 });

    if (args.script) {
      const mod = await import(pathToFileURL(path.resolve(String(args.script))).href);
      const fn = mod.default || mod.run;
      if (typeof fn !== 'function') throw new Error('--script module must default-export an async function (page, ctx)');
      await fn(page, { base, route, args, sleep, api: (m, u, b) => apiCall(page, m, u, b) });
    }

    await sleep(waitMs);
    const outPath = path.resolve(String(args.out));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath, fullPage: Boolean(args.full) });
    console.log(`Saved ${outPath}`);
  } finally {
    await browser.close();
  }
  if (problems.length) {
    console.log(`\n${problems.length} browser problem(s):`);
    for (const p of problems) console.log('  ' + p);
  } else {
    console.log('No browser console errors.');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
