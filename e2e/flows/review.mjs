/**
 * Journey part 3: results (grade seal, review list) → Practise mistakes → vocabulary (search,
 * star) → settings (dark theme, display name).
 * @module e2e/flows/review
 */
import { apiCall, check, clickText, fill, hashOf, shot, sleep, step, waitForHash } from '../lib/harness.mjs';

/** Navigate inside the SPA by changing the hash, as the app's own links do. */
async function goHash(page, hash, readySelector) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForSelector(readySelector);
  await sleep(500);
}

/**
 * @param {import('../smoke.mjs').JourneyContext} ctx
 */
export async function review(ctx) {
  const { page, state } = ctx;

  step('Results');
  await page.waitForSelector('.grade-seal');
  await page.waitForSelector('.review-item');
  check(await hashOf(page) === `#/results/${state.testId}`, '?fresh=1 is removed after the celebration');
  const { data } = await apiCall(page, 'GET', `/api/tests/${state.testId}`);
  const t = data.test;
  check(t.status === 'closed' && t.answeredCount === 6, `test closed with 6 answers (${t.correctCount} correct, ${t.wrongCount} wrong, ${t.skippedCount} skipped)`);
  check(t.correctCount === 4 && t.wrongCount === 1 && t.skippedCount === 1, 'server counts match the journey');
  const seal = await page.$eval('.grade-seal', (el) => el.textContent);
  check(seal.includes(t.grade), `grade seal shows ${t.grade}`);
  check((await page.$$('.review-item')).length === 10, 'review list shows all 10 words');
  check((await page.$$('.review-item:not(.is-pending)')).length === 6, '6 of them are answered, 4 marked not answered');
  await page.click('.results-review .tab[data-value="wrong"]');
  await sleep(200);
  const wrongRows = await page.$$eval('.review-item', (els) => els.filter((e) => e.getClientRects().length > 0).length);
  check(wrongRows === 1, 'Wrong filter shows the wrong-script answer');
  await page.click('.results-review .tab[data-value="all"]');
  await sleep(1200);
  await shot(page, '15-results', { fullPage: true });
  await page.click('.review-item .review-row');
  await sleep(500);
  check(await page.$('.review-item.is-open .word-card') !== null, 'a review row expands to the word card');

  step('Practise mistakes');
  await clickText(page, '.results-actions button', 'Practise mistakes');
  const hash = await waitForHash(page, /^#\/practice\/\d+$/);
  state.mistakesTestId = Number(hash.split('/').pop());
  const retry = (await apiCall(page, 'GET', `/api/tests/${state.mistakesTestId}`)).data.test;
  check(retry.config.source === 'test-mistakes' && retry.config.sourceTestId === state.testId, 'new test uses source test-mistakes');
  check(retry.totalQuestions === 2 && retry.title.startsWith('Retry · '), `"${retry.title}" has the 2 missed words`);
  await page.waitForSelector('.answer-input');

  step('Vocabulary: search and star');
  await goHash(page, '#/vocab', '.vocab-tile');
  check((await page.$$('.vocab-tile')).length === 6, 'vocabulary lists the 6 practised words');
  await shot(page, '16-vocab', { fullPage: true });
  await fill(page, '.vocab-search input', state.firstWord.kana);
  await page.waitForFunction(() => location.hash.includes('q='));
  await sleep(600);
  const tiles = await page.$$eval('.vocab-tile', (els) => els.map((e) => e.textContent));
  check(tiles.length >= 1 && tiles.every((x) => x.includes(state.firstWord.kana)), `search "${state.firstWord.kana}" finds the word`);
  await page.click('.vocab-tile .vocab-star');
  await sleep(600);
  const starred = (await apiCall(page, 'GET', '/api/vocab?filter=starred')).data;
  check(starred.total === 1 && starred.items[0].word.kana === state.firstWord.kana, 'star is saved on the server');
  await shot(page, '17-vocab-search-star');

  step('Settings: dark theme and display name');
  await goHash(page, '#/settings', 'input[name=displayName]');
  await page.click('.segmented [data-value="dark"]');
  state.displayName = 'Integration Learner';
  await fill(page, 'input[name=displayName]', state.displayName);
  await page.evaluate(() => document.querySelector('input[name=displayName]').form.querySelector('button[type=submit]').click());
  await page.waitForFunction((n) => document.querySelector('.user-button-name')?.textContent === n, {}, state.displayName);
  await sleep(800);
  const me = (await apiCall(page, 'GET', '/api/auth/me')).data.user;
  check(me.displayName === state.displayName, 'display name saved');
  check(me.settings.theme === 'dark', 'theme setting saved');
  check(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark theme applied to <html>');
  await shot(page, '18-settings-dark', { fullPage: true });
}
