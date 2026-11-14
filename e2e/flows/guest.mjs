/**
 * Journey part 5: Try as guest → answer one word → upgrade to a full account, keeping the data.
 * Runs in its own browser context so it starts logged out.
 * @module e2e/flows/guest
 */
import { currentWord } from '../lib/answers.mjs';
import { apiCall, check, clickText, fill, newPage, shot, sleep, step, waitForHash } from '../lib/harness.mjs';
import { checkMeaningCard, waitForFeedback, waitForQuestion } from '../lib/practice.mjs';

/**
 * @param {import('../smoke.mjs').JourneyContext} ctx
 */
export async function guest(ctx) {
  const { browser, base, dbPath, watch } = ctx;
  const { context, page } = await newPage(browser);
  watch(page, 'guest');
  try {
    step('Try as guest');
    await page.goto(`${base}/#/`, { waitUntil: 'networkidle0' });
    await clickText(page, '.landing-ctas-hero button', 'Try as guest');
    await waitForHash(page, /^#\/dashboard$/);
    await page.waitForSelector('.dash-guest');
    const guestUser = (await apiCall(page, 'GET', '/api/auth/me')).data.user;
    check(guestUser.isGuest === true && guestUser.displayName === 'Guest', 'guest session created');
    await sleep(600);
    await shot(page, '27-guest-dashboard');

    step('Guest answers one word');
    await page.click('.dash-hero .btn-primary');
    await page.waitForSelector('.dash-nt-dialog[open]');
    await sleep(300);
    await clickText(page, '.dash-nt-dialog .dash-nt-option', 'Hiragana');
    await clickText(page, '.dash-nt-dialog .dash-nt-option-label', '10');
    await page.click('.dash-nt-dialog .modal-footer .btn-primary');
    const hash = await waitForHash(page, /^#\/practice\/\d+$/);
    const testId = Number(hash.split('/').pop());
    await waitForQuestion(page);
    const w = currentWord(dbPath, testId);
    await page.type('.answer-input', w.kana);
    await page.keyboard.press('Enter');
    check(await waitForFeedback(page) === 'correct', 'guest answer is correct');
    await checkMeaningCard(page, w.kana);

    step('Upgrade keeps the data');
    await page.evaluate(() => { location.hash = '#/register'; });
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Save your progress');
    check(true, 'guest sees the "Save your progress" upgrade form');
    await fill(page, 'input[name=displayName]', 'Former Guest');
    await fill(page, 'input[name=email]', `guest-${Date.now()}@example.com`);
    await fill(page, 'input[name=password]', 'guest upgrade 42');
    await shot(page, '28-guest-upgrade');
    await page.click('button[type=submit]');
    await waitForHash(page, /^#\/dashboard$/);
    const user = (await apiCall(page, 'GET', '/api/auth/me')).data.user;
    check(user.isGuest === false && user.id === guestUser.id, 'same account id is now a full account');
    const tests = (await apiCall(page, 'GET', '/api/tests')).data.tests;
    check(tests.length === 1 && tests[0].id === testId && tests[0].answeredCount === 1, 'the guest test and its answer are kept');
    const stats = (await apiCall(page, 'GET', '/api/stats/overview')).data;
    check(stats.totals.answered === 1 && stats.totals.wordsSeen === 1, 'stats still count the guest answer');
    await page.waitForSelector('.dash-test');
    check(await page.$('.dash-guest') === null, 'guest banner is gone');
    await sleep(800);
    await shot(page, '29-upgraded-dashboard', { fullPage: true });
  } finally {
    await context.close();
  }
}
