/**
 * Journey part 7 (v2, SPEC §15.3–15.5, §15.7a): the three input methods on a touch phone and on
 * desktop. On touch, Kana keys and Handwriting keep the answer field readonly with
 * `inputmode="none"` and never focus it (so the OS keyboard is never requested); only Device
 * keyboard makes it a normal, focused input. Also: the shuffled keyboard (no column labels, a new
 * order per word), handwriting by touch and by mouse from KanjiVG template strokes, and the
 * practice-menu toggles Shuffle keys / Romaji column labels.
 * @module e2e/flows/methods
 */
import { currentWord } from '../lib/answers.mjs';
import {
  MOBILE, apiCall, check, checkNoOverflow, clickText, pageIn, shot, sleep, step, tapCentered,
  waitForHash, waitForSetting,
} from '../lib/harness.mjs';
import {
  answerAttrs, answerFocused, inputValue, keyOrder, menuItem, tapKeys, waitForFeedback,
  waitForQuestion, writeOnPad,
} from '../lib/practice.mjs';

/** Assert the answer field is virtual: readonly, inputmode none, not focused. */
async function checkVirtual(page, label) {
  const a = await answerAttrs(page);
  check(a.readOnly && a.inputMode === 'none' && !(await answerFocused(page)),
    `${label}: field is readonly, inputmode="none" and not focused (no OS keyboard)`);
}

/** Tap the primary button (Check / Next word) on a phone. */
async function tapPrimary(page) {
  await tapCentered(page, '.pr-check');
}

/**
 * @param {import('../smoke.mjs').JourneyContext} ctx
 */
export async function methods(ctx) {
  const { base, dbPath, watch } = ctx;
  const v2 = ctx.state.v2;
  const phone = await pageIn(v2.context, { viewport: MOBILE });
  watch(phone, 'phone');
  ctx.activePage = phone;

  step('Romaji test on a touch phone, Kana keys (shuffled)');
  const res = await apiCall(v2.page, 'POST', '/api/tests', { script: 'mixed', count: 5, pool: 'common', mode: 'romaji' });
  check(res.status === 201, 'created a 5-word romaji test on the common pool');
  v2.methodsTestId = res.data.test.id;
  const word = () => currentWord(dbPath, v2.methodsTestId);
  await phone.goto(`${base}/#/practice/${v2.methodsTestId}`, { waitUntil: 'networkidle0' });
  await waitForQuestion(phone);
  check(await phone.$eval('.pr', (el) => el.dataset.method) === 'keys', 'Kana keys is the default method');
  await checkVirtual(phone, 'on load');
  check(await phone.$eval('.kb', (el) => el.dataset.layout) === 'shuffled', 'keyboard is shuffled by default');
  check((await phone.$$('.kb-col-head')).length === 0, 'no romaji column labels');
  const keyText = await phone.$$eval('.kb-key', (els) => els.filter((e) => e.getClientRects().length).map((e) => e.innerText).join(''));
  check(!/[A-Za-z]/.test(keyText), 'keys show kana only (no visible romaji)');
  check((await phone.$$('.kb-grid.is-packed')).length === 3, 'every section is packed without gaps');

  await phone.tap('.answer-input');
  await phone.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('Use device keyboard')));
  check(!(await answerFocused(phone)), 'tapping the field offers the device keyboard instead of opening it');

  let w = word();
  await tapKeys(phone, '', w.script); // show the word's script before reading the order
  const order1 = await keyOrder(phone);
  await tapKeys(phone, w.kana, w.script);
  check(await inputValue(phone) === w.kana, `tapped keys wrote ${w.kana}`);
  await checkVirtual(phone, 'after tapping keys');
  await shot(phone, '35-mobile-keys');
  await tapPrimary(phone);
  check(await waitForFeedback(phone) === 'correct', 'answer from kana keys is correct');
  await tapPrimary(phone);
  await waitForQuestion(phone);
  await checkVirtual(phone, 'next question');
  const order2 = await keyOrder(phone);
  check(order2.split(':')[0] !== order1.split(':')[0] || order2 !== order1, 'the key order changes for the next word');

  step('Device keyboard on the phone');
  w = word();
  await tapCentered(phone, '.im-switch [data-value="device"]');
  await phone.waitForFunction(() => document.querySelector('.pr')?.dataset.method === 'device');
  const dev = await answerAttrs(phone);
  check(!dev.readOnly && dev.inputMode !== 'none', `device method: a normal input (inputmode=${dev.inputMode ?? 'default'})`);
  check(await answerFocused(phone), 'choosing the device keyboard focuses the field (opens the OS keyboard)');
  check(await phone.$('.im-device:not([hidden])') !== null, 'device panel is shown');
  await waitForSetting(phone, 'inputMethod', 'device');
  check(true, 'the chosen method is saved');
  await phone.type('.answer-input', w.kana);
  await shot(phone, '36-mobile-device');
  await tapPrimary(phone);
  check(await waitForFeedback(phone) === 'correct', 'device-keyboard answer is correct');
  await tapPrimary(phone);
  await waitForQuestion(phone);

  step('Handwriting on the phone (touch)');
  w = word();
  await tapCentered(phone, '.im-switch [data-value="handwriting"]');
  await phone.waitForSelector('.pr-pad-slot > .hw[data-state="ready"]');
  await sleep(200);
  await checkVirtual(phone, 'handwriting');
  check(await phone.$('.kb:not([hidden])') === null || await phone.$eval('.kb', (el) => el.hidden || !el.getClientRects().length), 'the kana keys are hidden');
  await writeOnPad(phone, w.kana, { touch: true });
  check(await inputValue(phone) === w.kana, `handwritten by touch: ${w.kana}`);
  await checkVirtual(phone, 'after writing');
  await shot(phone, '37-mobile-handwriting');
  await checkNoOverflow(phone, 'practice with the handwriting pad');
  await tapPrimary(phone);
  check(await waitForFeedback(phone) === 'correct', 'handwritten answer is correct');
  await tapPrimary(phone);
  await waitForQuestion(phone);

  step('Back to Kana keys');
  await tapCentered(phone, '.im-switch [data-value="keys"]');
  await phone.waitForFunction(() => document.querySelector('.pr')?.dataset.method === 'keys');
  await sleep(200);
  await checkVirtual(phone, 'keys again');
  check(await phone.$('.pr-pad-slot .hw') === null, 'the pad is removed');
  await phone.close();

  step('Handwriting with a mouse on desktop');
  const page = v2.page;
  ctx.activePage = page;
  await page.goto(`${base}/#/practice/${v2.methodsTestId}`, { waitUntil: 'networkidle0' });
  await waitForQuestion(page);
  w = word();
  await clickText(page, '.im-switch .segmented-item, .im-switch [data-value]', 'Handwriting');
  await page.waitForSelector('.pr-pad-slot > .hw[data-state="ready"]');
  const desk = await answerAttrs(page);
  check(!desk.readOnly, 'desktop: the field still accepts physical typing in handwriting mode');
  await writeOnPad(page, w.kana);
  check(await inputValue(page) === w.kana, `handwritten by mouse: ${w.kana}`);
  await shot(page, '38-desktop-handwriting');
  await page.keyboard.press('Enter');
  check(await waitForFeedback(page) === 'correct', 'mouse-written answer is correct');
  await page.click('.pr-check');
  await waitForQuestion(page);

  step('Practice menu: Shuffle keys and Romaji column labels (§15.7a)');
  await clickText(page, '.im-switch [data-value]', 'Kana keys');
  await page.waitForFunction(() => document.querySelector('.pr')?.dataset.method === 'keys');
  const labels = await menuItem(page, 'Romaji column labels');
  const menu = await page.$$eval('.menu .menu-item', (els) => els.map((e) => ({
    text: e.textContent.trim(), checked: e.getAttribute('aria-checked'), disabled: e.disabled || e.getAttribute('aria-disabled') === 'true',
  })));
  const find = (t) => menu.find((m) => m.text.startsWith(t));
  check(find('Shuffle keys')?.checked === 'true', 'menu: Shuffle keys is checked');
  check(find('Romaji column labels')?.disabled && find('Romaji column labels').text.includes('Turn off Shuffle keys'),
    'menu: Romaji column labels is disabled while keys are shuffled, with the hint');
  check(!menu.some((m) => m.text.startsWith('Show keyboard')), 'menu: no obsolete "Show keyboard"');
  check(['Kana keys', 'Handwriting', 'Device keyboard'].every((t) => find(t)), 'menu: the three input methods');
  check(Boolean(labels), 'menu item found');
  await clickText(page, '.menu .menu-item', 'Shuffle keys');
  await page.waitForFunction(() => document.querySelector('.kb')?.dataset.layout === 'gojuon');
  check((await page.$$('.kb-col-head')).length === 0, 'gojūon order still has no column labels by default');
  await sleep(300); // let the closing menu leave
  await page.click('.pr-more');
  await page.waitForSelector('.menu:not(.is-leaving) .menu-item');
  await clickText(page, '.menu:not(.is-leaving) .menu-item', 'Romaji column labels');
  await page.waitForSelector('.kb-col-head');
  const heads = await page.$$eval('.kb-col-head', (els) => els.map((e) => e.textContent.trim()));
  check(['k', 's', 't', 'n', 'h'].every((c) => heads.includes(c)), `column labels shown: ${heads.slice(0, 10).join(' ')}`);
  await waitForSetting(page, 'showKeyHeaders', true);
  await waitForSetting(page, 'keyLayout', 'gojuon');
  check(true, 'keyLayout and showKeyHeaders are saved');
  await sleep(400);
  await shot(page, '39-keyboard-column-labels');

  step('End the methods test');
  await sleep(300);
  await page.click('.pr-more');
  await page.waitForSelector('.menu:not(.is-leaving) .menu-item');
  await clickText(page, '.menu:not(.is-leaving) .menu-item', 'End test');
  await page.waitForSelector('.modal[open] .modal-footer .btn-danger');
  await page.click('.modal[open] .modal-footer .btn-danger');
  await waitForHash(page, new RegExp(`^#/results/${v2.methodsTestId}`));
  await page.waitForSelector('.review-item');
  for (const m of ['keys', 'device', 'handwriting']) {
    check(await page.$(`.review-item .input-badge.is-${m}`) !== null, `results show the ${m} input badge`);
  }
  const detail = (await apiCall(page, 'GET', `/api/tests/${v2.methodsTestId}`)).data;
  const methodsUsed = (detail.questions || detail.results || []).map((q) => q.inputMethod).filter(Boolean);
  check(['keys', 'device', 'handwriting'].every((m) => methodsUsed.includes(m)), `inputMethod recorded: ${methodsUsed.join(', ')}`);
  check(await page.$('.mode-chip.is-romaji') !== null, 'results show the Romaji mode chip');
  await sleep(800);
  await shot(page, '40-methods-results', { fullPage: true });
}
