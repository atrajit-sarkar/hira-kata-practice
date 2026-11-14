/**
 * Journey part 6 (v2, SPEC §15.2, §15.6): a second learner with a (stubbed) Japanese voice creates a
 * Listen → write test on the common word pool from the New test dialog, hears each word, buys the
 * romaji hint, writes a same-sound spelling (accepted as a variant), ends the test and sees the
 * mode on the results page. Runs in its own browser context; later v2 flows reuse it via
 * `ctx.state.v2`.
 * @module e2e/flows/listen
 */
import { sameSoundSpelling, testWords } from '../lib/answers.mjs';
import {
  apiCall, check, clickCentered, clickText, installSpeechStub, newPage, shot, sleep, step,
  waitForHash, waitForSpoken,
} from '../lib/harness.mjs';
import { checkMeaningCard, clickMenuItem, waitForFeedback, waitForQuestion } from '../lib/practice.mjs';

const pointsText = (page) => page.$eval('.fb-points', (el) => el.textContent.trim()).catch(() => '');
const cardText = (page) => page.$eval('.pr-card', (el) => `${el.textContent} ${[...el.querySelectorAll('*')]
  .flatMap((n) => [...n.attributes].map((a) => a.value)).join(' ')}`);

/** Count of words in a pool shown in the dialog (".dash-nt-aside" of that option). */
const poolCount = (page, pool) => page.$eval(`.dash-nt-option[data-value="${pool}"] .dash-nt-aside`, (el) => el.textContent.trim());

/**
 * @param {import('../smoke.mjs').JourneyContext} ctx
 */
export async function listen(ctx) {
  const { browser, base, dbPath, watch } = ctx;
  const { context, page } = await newPage(browser);
  watch(page, 'listen');
  await installSpeechStub(page);
  const v2 = { context, page, email: `listener-${Date.now()}@example.com` };
  ctx.state.v2 = v2;
  ctx.activePage = page;

  step('Second learner with a Japanese voice');
  await page.goto(`${base}/#/`, { waitUntil: 'networkidle0' });
  const reg = await apiCall(page, 'POST', '/api/auth/register', { displayName: 'Listening Learner', email: v2.email, password: 'listen and write 2026' });
  check(reg.status === 201 || reg.status === 200, 'registered a second learner');
  const me = (await apiCall(page, 'GET', '/api/auth/me')).data.user;
  check(me.settings.inputMethod === 'keys' && me.settings.keyLayout === 'shuffled' && me.settings.listenAutoplay === true
    && me.settings.ttsRate === 0.9 && me.settings.showKeyHeaders === false, 'v2 setting defaults: kana keys, shuffled, autoplay, rate 0.9, no column labels');
  await page.goto(`${base}/#/dashboard`, { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' }); // boot the app with the new session
  await page.waitForSelector('.dash-welcome');

  step('New test dialog: Listen → write, Katakana, Common words');
  await page.click('.dash-hero .btn-primary');
  await page.waitForSelector('.dash-nt-dialog[open]');
  await page.waitForFunction(() => {
    const opt = document.querySelector('.dash-nt-option[data-value="listen"]');
    return opt && !opt.classList.contains('is-disabled') && !opt.querySelector('input')?.disabled;
  });
  check(true, 'Listen mode is available with a Japanese voice');
  await page.click('.dash-nt-option[data-value="listen"]');
  await clickText(page, '.dash-nt-dialog .dash-nt-option', 'Katakana');
  await page.waitForFunction(() => /\d/.test(document.querySelector('.dash-nt-option[data-value="common"] .dash-nt-aside')?.textContent || ''));
  const counts = { all: await poolCount(page, 'all'), common: await poolCount(page, 'common') };
  const num = (s) => Number(s.replace(/\D/g, ''));
  check(num(counts.common) > 0 && num(counts.common) < num(counts.all), `pool counts: all ${counts.all}, common ${counts.common}`);
  await page.click('.dash-nt-option[data-value="common"]');
  await clickText(page, '.dash-nt-dialog .dash-nt-option-label', '10');
  await page.waitForFunction((n) => (document.querySelector('.dash-nt-summary')?.textContent || '').replace(/\D/g, '').startsWith(n),
    {}, String(num(counts.common)));
  check(true, `live count follows the pool: ${await page.$eval('.dash-nt-summary', (el) => el.textContent.trim())}`);
  await sleep(400);
  await shot(page, '30-new-test-listen');
  await page.click('.dash-nt-dialog .modal-footer .btn-primary');
  const hash = await waitForHash(page, /^#\/practice\/\d+$/);
  v2.listenTestId = Number(hash.split('/').pop());
  const created = (await apiCall(page, 'GET', `/api/tests/${v2.listenTestId}`)).data.test;
  check(created.config.mode === 'listen' && created.config.pool === 'common' && created.config.script === 'katakana',
    'created test: mode listen, pool common, katakana');
  check(created.title.startsWith('Listen · Katakana · Common'), `default title "${created.title}"`);

  const words = testWords(dbPath, v2.listenTestId);
  const variantAt = words.findIndex((w, i) => i >= 2 && sameSoundSpelling(w.kana));

  step('L1 · the word is spoken, the romaji stays hidden');
  await waitForQuestion(page);
  let w = words[0];
  await page.waitForSelector('.lp');
  const st = (await apiCall(page, 'GET', `/api/tests/${v2.listenTestId}/state`)).data.current;
  check(st.mode === 'listen' && st.romaji === null && st.speak === w.kana, 'QuestionPublic: romaji null, speak = the kana');
  const spoken = await waitForSpoken(page, w.kana);
  check(spoken.lang === 'ja-JP' && Math.abs(spoken.rate - 0.9) < 1e-6, `autoplay spoke ${w.kana} (ja-JP, rate ${spoken.rate})`);
  check(!(await cardText(page)).toLowerCase().includes(w.romaji.toLowerCase()) || w.romaji.length < 3, 'romaji is not in the question card');
  await clickCentered(page, '.lp-slow');
  check((await waitForSpoken(page, w.kana, 2)).rate === 0.6, 'Slow replays at 0.6×');
  await page.keyboard.down('Alt');
  await page.keyboard.press('KeyP');
  await page.keyboard.up('Alt');
  await waitForSpoken(page, w.kana, 3);
  check(true, 'Alt+P replays the word');
  await sleep(500);
  await shot(page, '31-listen-question');
  await page.type('.answer-input', w.kana);
  await page.keyboard.press('Enter');
  check(await waitForFeedback(page) === 'correct', 'listened answer is correct');
  check((await pointsText(page)).startsWith('+100'), 'clean listen answer earns +100');
  check((await page.$eval('.pr-card', (el) => el.textContent)).includes(w.romaji), `romaji ${w.romaji} appears after answering`);
  await checkMeaningCard(page, w.kana);
  await shot(page, '32-listen-answered');
  await page.click('.pr-check');
  await waitForQuestion(page);

  step('L2 · romaji hint');
  w = words[1];
  await waitForSpoken(page, w.kana);
  check(true, `the next word plays automatically (${w.kana})`);
  await clickCentered(page, '.hint-romaji');
  await page.waitForFunction((r) => document.querySelector('.q-romaji')?.textContent.includes(r), {}, w.romaji);
  const hinted = (await apiCall(page, 'GET', `/api/tests/${v2.listenTestId}/state`)).data.current;
  check(hinted.romajiHintUsed === true && hinted.romaji === w.romaji, `romaji hint reveals "${w.romaji}"`);
  await page.type('.answer-input', w.kana);
  await page.keyboard.press('Enter');
  check(await waitForFeedback(page) === 'correct', 'answer after the romaji hint is correct');
  check((await pointsText(page)).startsWith('+70'), 'the romaji hint costs 30 points (+70)');
  await page.click('.pr-check');
  await waitForQuestion(page);

  step('L3 · a same-sound spelling');
  if (variantAt < 0) {
    console.log('    · no word in this test has a same-sound spelling; variant check skipped');
  } else {
    for (let i = 2; i < variantAt; i += 1) {
      await page.click('.pr-skip');
      await waitForFeedback(page);
      await page.click('.pr-check');
      await waitForQuestion(page);
    }
    w = words[variantAt];
    const variant = sameSoundSpelling(w.kana);
    await page.type('.answer-input', variant);
    await page.keyboard.press('Enter');
    check(await waitForFeedback(page) === 'correct', `${variant} for ${w.kana} counts as correct`);
    check(await page.$('.fb.is-variant') !== null, 'feedback marks it as a same-sound spelling');
    const explain = await page.$eval('.fb', (el) => el.textContent);
    check(explain.includes('Same sound') && explain.includes(w.kana), 'feedback shows the standard spelling');
    check((await pointsText(page)).startsWith('+70'), 'a same-sound spelling costs 30 points (+70)');
    await shot(page, '33-listen-variant');
  }

  step('End the listen test');
  await clickMenuItem(page, 'End test');
  await page.waitForSelector('.modal[open] .modal-footer .btn-danger');
  await page.click('.modal[open] .modal-footer .btn-danger');
  await waitForHash(page, new RegExp(`^#/results/${v2.listenTestId}`));
  await page.waitForSelector('.review-item');
  check(await page.$('.results .mode-chip.is-listen, .mode-chip.is-listen') !== null, 'results show the Listen mode chip');
  const rows = await page.$$eval('.review-item:not(.is-pending)', (els) => els.map((e) => e.textContent));
  check(rows.some((t) => t.includes(words[0].romaji)), 'answered listen rows show their romaji');
  if (variantAt >= 0) check(rows.some((t) => t.includes('Same sound')), 'the variant row says "Same sound"');
  check((await page.$$('.review-item .input-badge.is-keys')).length >= 2, 'rows show the Kana keys input badge');
  await sleep(1000);
  await shot(page, '34-listen-results', { fullPage: true });
}
