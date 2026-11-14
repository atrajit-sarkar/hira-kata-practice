#!/usr/bin/env node
/**
 * HiraKata end-to-end smoke test (`npm run e2e`).
 *
 * Spawns the real server on a free port with a throw-away SQLite database and drives headless
 * Chrome/Edge (puppeteer-core) through the whole learner journey:
 *   landing → register → empty dashboard → New test (mixed, 10) → practice (script hint, guided
 *   spelling with a wrong key, clean answer, wrong script, skip, romaji typing; meaning card after
 *   each) → progress PDF mid-test → End test → results → Practise mistakes → vocab (search, star)
 *   → settings (dark theme, display name) → logout → login → resume → overall PDF → phone-width
 *   pass → guest → answer → upgrade keeps the data. Then v2 (SPEC §15) with a second learner and
 *   a stubbed Japanese voice: listen mode + word pool, input methods on a touch phone and desktop
 *   (keys / handwriting / device, OS keyboard never requested), shuffled keys and column labels,
 *   settings, dashboard breakdowns and PDFs.
 *
 * Screenshots go to e2e/screenshots/, downloaded PDFs to e2e/downloads/ (both gitignored).
 * Fails (exit 1) on any assertion, console error, page error, failed request or HTTP 5xx.
 * Set CHROME_PATH to use a specific Chromium-based browser.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { guest } from './flows/guest.mjs';
import { listen } from './flows/listen.mjs';
import { methods } from './flows/methods.mjs';
import { surfaces } from './flows/surfaces.mjs';
import { onboarding } from './flows/onboarding.mjs';
import { practice } from './flows/practice.mjs';
import { returning } from './flows/returning.mjs';
import { review } from './flows/review.mjs';
import { SHOTS_DIR, launchBrowser, newPage, passedCount, shot } from './lib/harness.mjs';
import { startServer } from './lib/server.mjs';

/**
 * Shared state handed to every flow.
 * @typedef {object} JourneyContext
 * @property {string} base server origin
 * @property {string} dbPath the run's SQLite file (read-only use: answer key)
 * @property {import('puppeteer-core').Browser} browser
 * @property {import('puppeteer-core').Page} page the main learner's page
 * @property {(page: import('puppeteer-core').Page, label: string) => void} watch attach problem listeners
 * @property {Record<string, any>} state values carried between flows
 * @property {import('puppeteer-core').Page} [activePage] the page a flow is driving (failure screenshot)
 */

const ALL_FLOWS = [onboarding, practice, review, returning, guest, listen, methods, surfaces];
/** E2E_FLOWS=listen,methods runs a subset (for debugging; flows that depend on earlier ones need them). */
const FLOWS = process.env.E2E_FLOWS
  ? ALL_FLOWS.filter((f) => process.env.E2E_FLOWS.split(',').includes(f.name))
  : ALL_FLOWS;

async function main() {
  const started = Date.now();
  await rm(path.join(SHOTS_DIR, 'failure.png'), { force: true });
  const server = await startServer();
  console.log(`HiraKata E2E · server ${server.base}`);
  let browserHandle;
  let failed = false;
  /** @type {JourneyContext | undefined} */
  let ctx;
  try {
    browserHandle = await launchBrowser();
    const { browser, problems, watch } = browserHandle;
    const { page } = await newPage(browser);
    watch(page, 'learner');
    ctx = {
      base: server.base,
      dbPath: server.dbPath,
      browser,
      page,
      watch,
      state: { displayName: 'Kana Learner', email: `learner-${Date.now()}@example.com`, password: 'kana practice 2026' },
    };
    for (const flow of FLOWS) {
      await flow(ctx);
      if (problems.length) throw new Error(`Browser problems during ${flow.name}:\n  ${problems.join('\n  ')}`);
    }
  } catch (err) {
    failed = true;
    console.error(`\n✗ FAILED: ${err.message}`);
    if (err.name !== 'AssertionError' && err.stack) console.error(err.stack.split('\n').slice(1, 6).join('\n'));
    const failedPage = ctx?.activePage || ctx?.page;
    if (failedPage) {
      const file = await shot(failedPage, 'failure', { fullPage: true }).catch(() => null);
      if (file) console.error(`  screenshot: ${file}`);
      console.error(`  url: ${failedPage.url()}`);
    }
    const logs = server.logs().trim();
    if (logs) console.error(`\n--- server output ---\n${logs.split('\n').slice(-30).join('\n')}`);
  } finally {
    await browserHandle?.browser.close().catch(() => {});
    await server.stop();
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (failed) {
    console.error(`\nE2E failed after ${passedCount()} passing checks (${secs}s).`);
    process.exitCode = 1;
  } else {
    console.log(`\n✓ E2E passed: ${passedCount()} checks in ${secs}s. Screenshots: ${SHOTS_DIR}`);
  }
}

await main();
