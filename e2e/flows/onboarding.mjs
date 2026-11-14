/**
 * Journey part 1: landing → register → empty dashboard → New test dialog (mixed, 10 words).
 * @module e2e/flows/onboarding
 */
import { apiCall, check, clickText, fill, hashOf, shot, sleep, step, waitForHash } from '../lib/harness.mjs';

/**
 * @param {import('../smoke.mjs').JourneyContext} ctx
 */
export async function onboarding(ctx) {
  const { page, base, state } = ctx;

  step('Landing page');
  await page.goto(`${base}/#/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.landing-ctas-hero');
  check(await page.$eval('h1', (el) => el.textContent.length > 0), 'hero headline rendered');
  check((await page.title()).includes('HiraKata'), `document title "${await page.title()}"`);
  await page.waitForSelector('.demo-romaji');
  await sleep(1500);
  await shot(page, '01-landing');
  await page.click('.landing-ctas-hero a[href="#/register"]');
  await waitForHash(page, /^#\/register/);

  step('Register');
  await page.waitForSelector('input[name=displayName]');
  await page.click('button[type=submit]');
  await page.waitForSelector('.field.has-error .error-text');
  check(true, 'empty submit shows inline validation');
  await fill(page, 'input[name=displayName]', state.displayName);
  await fill(page, 'input[name=email]', state.email);
  await fill(page, 'input[name=password]', state.password);
  await shot(page, '02-register');
  await page.click('button[type=submit]');
  await waitForHash(page, /^#\/dashboard$/);
  check(true, 'registration lands on the dashboard');

  step('Empty dashboard');
  await page.waitForSelector('.dash-welcome');
  check(await page.$eval('.user-button-name', (el) => el.textContent) === state.displayName, 'topbar shows the display name');
  const me = await apiCall(page, 'GET', '/api/auth/me');
  check(me.status === 200 && me.data.user.isGuest === false, 'session cookie is set for a full account');
  state.userId = me.data.user.id;
  await sleep(500);
  await shot(page, '03-dashboard-empty', { fullPage: true });

  step('New test dialog (mixed, 10 words)');
  await page.click('.dash-hero .btn-primary');
  await page.waitForSelector('.dash-nt-dialog[open]');
  await sleep(400);
  await clickText(page, '.dash-nt-dialog .dash-nt-option', 'Mixed');
  await clickText(page, '.dash-nt-dialog .dash-nt-option-label', '10');
  await page.waitForFunction(() => /words? match/.test(document.querySelector('.dash-nt-summary')?.textContent || ''));
  check(true, `live count: ${await page.$eval('.dash-nt-summary', (el) => el.textContent.trim())}`);
  await sleep(400); // let the selection transition finish
  await shot(page, '04-new-test-dialog');
  await page.click('.dash-nt-dialog .modal-footer .btn-primary');
  const hash = await waitForHash(page, /^#\/practice\/\d+$/);
  state.testId = Number(hash.split('/').pop());
  const { data } = await apiCall(page, 'GET', `/api/tests/${state.testId}`);
  check(data.test.config.script === 'mixed' && data.test.totalQuestions === 10, 'created test is mixed with 10 words');
  check(data.test.title === 'Mixed · All levels · 10 words', `default title "${data.test.title}"`);
  check((await hashOf(page)) === `#/practice/${state.testId}`, 'Start opens the practice page');
}
