/**
 * Journey part 4: logout → login → resume the active test → overall PDF, then a phone-width
 * pass over the main pages (screenshots + no horizontal overflow).
 * @module e2e/flows/returning
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DESKTOP, DOWNLOADS_DIR, MOBILE, apiCall, check, checkNoOverflow, clickText, downloadWithSession,
  fill, shot, sleep, step, waitForHash,
} from '../lib/harness.mjs';

/** Load a hash route from scratch (fresh render, as after a reload) and wait for it. */
async function openRoute(page, base, hash, readySelector) {
  await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector(readySelector);
  await sleep(900);
}

/**
 * @param {import('../smoke.mjs').JourneyContext} ctx
 */
export async function returning(ctx) {
  const { page, base, state } = ctx;

  step('Log out');
  await page.click('.user-button');
  await page.waitForSelector('.menu .menu-item');
  await clickText(page, '.menu .menu-item', 'Log out');
  await waitForHash(page, /^#\/$/);
  check((await apiCall(page, 'GET', '/api/auth/me')).status === 401, 'session is gone after logout');

  step('Log in');
  await page.click('.landing-ctas-hero a[href="#/login"]');
  await waitForHash(page, /^#\/login/);
  await fill(page, 'input[name=email]', state.email);
  await fill(page, 'input[name=password]', state.password);
  await shot(page, '19-login-dark');
  await page.click('button[type=submit]');
  await waitForHash(page, /^#\/dashboard$/);
  check(true, 'login lands on the dashboard');

  step('Dashboard with data');
  await page.waitForSelector('.dash-continue');
  await page.waitForSelector('.dash-test');
  await sleep(1200);
  check((await page.$$('.dash-test')).length === 2, 'tests list shows the closed test and the retry test');
  await shot(page, '20-dashboard-dark', { fullPage: true });

  step('Resume the active test');
  await page.click(`.dash-continue [aria-label^="Resume"]`);
  await waitForHash(page, new RegExp(`^#/practice/${state.mistakesTestId}$`));
  await page.waitForSelector('.answer-input');
  const st = (await apiCall(page, 'GET', `/api/tests/${state.mistakesTestId}/state`)).data;
  check(st.test.status === 'active' && st.current?.position === 0, 'resumed test is active on its first word');
  await sleep(600);
  await shot(page, '21-practice-resumed-dark');

  step('Overall PDF report');
  await openRoute(page, base, '#/dashboard', '.dash-hero a[download]:not([hidden])');
  const href = await page.$eval('.dash-hero a[download]', (a) => a.getAttribute('href'));
  check(href.startsWith('/api/reports/overall.pdf'), `dashboard links to ${href}`);
  const pdf = await downloadWithSession(page, href);
  check(pdf.status === 200 && pdf.type.startsWith('application/pdf'), 'overall.pdf answers 200 application/pdf');
  check(pdf.bytes.subarray(0, 5).toString('latin1') === '%PDF-', 'overall report starts with %PDF-');
  check(/filename="hirakata-progress-\d{4}-\d{2}-\d{2}\.pdf"/.test(pdf.disposition), `download name: ${pdf.disposition}`);
  await writeFile(path.join(DOWNLOADS_DIR, 'overall-report.pdf'), pdf.bytes);

  step('Phone width (390 px, light theme)');
  await apiCall(page, 'PATCH', '/api/auth/me', { settings: { theme: 'light' } });
  await page.evaluate(() => { try { localStorage.setItem('hk-theme', 'light'); } catch { /* storage blocked */ } });
  await page.setViewport(MOBILE);
  const routes = [
    ['22-mobile-dashboard', '#/dashboard', '.dash-test'],
    ['23-mobile-practice', `#/practice/${state.mistakesTestId}`, '.answer-input'],
    ['24-mobile-results', `#/results/${state.testId}`, '.review-item'],
    ['25-mobile-vocab', '#/vocab', '.vocab-tile'],
    ['26-mobile-settings', '#/settings', 'input[name=displayName]'],
  ];
  for (const [name, hash, ready] of routes) {
    await openRoute(page, base, hash, ready);
    await checkNoOverflow(page, hash);
    await shot(page, name, { fullPage: name !== '23-mobile-practice' });
  }
  await page.setViewport(DESKTOP);
}
