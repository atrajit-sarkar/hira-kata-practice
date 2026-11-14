/**
 * Journey part 8 (v2, SPEC §15.3, §15.6, §15.7a): Settings (input method, keyboard layout, column
 * labels, strict handwriting, Listening voice / rate / test / autoplay), the dashboard's mode and
 * input-method breakdowns and chips, the stats API, and both PDFs with listen-mode data. Ends with
 * phone-width and dark-theme screenshots of the v2 surfaces.
 * @module e2e/flows/surfaces
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DOWNLOADS_DIR, MOBILE, apiCall, check, checkNoOverflow, clickText, downloadWithSession, pageIn,
  shot, sleep, step, waitForSetting,
} from '../lib/harness.mjs';

/** Settings toggle row (label element) by its label text. */
const toggleSel = (label) => `xpath///label[contains(@class,"toggle-row")][.//span[contains(@class,"toggle-row-label")][normalize-space()="${label}"]]`;
const toggleState = (page, label) => page.$eval(toggleSel(label), (el) => {
  const input = el.querySelector('input');
  return { checked: input.checked, disabled: input.disabled, text: el.textContent };
});

/**
 * @param {import('../smoke.mjs').JourneyContext} ctx
 */
export async function surfaces(ctx) {
  const { base } = ctx;
  const v2 = ctx.state.v2;
  const page = v2.page;
  ctx.activePage = page;

  step('Settings: practice options (§15.3, §15.7a)');
  await apiCall(page, 'PATCH', '/api/auth/me', { settings: { keyLayout: 'shuffled', showKeyHeaders: false, inputMethod: 'keys' } });
  await page.goto(`${base}/#/settings`, { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.settings-methods');
  check(await page.$eval('.settings-methods [data-value="keys"]', (el) => el.getAttribute('aria-checked')) === 'true', 'default input method shows Kana keys');
  let labels = await toggleState(page, 'Romaji column labels');
  check(labels.disabled && labels.text.includes('Turn off Shuffle keys'), 'Romaji column labels is disabled while keys are shuffled');
  await page.click('.settings-methods [data-value="handwriting"]');
  await waitForSetting(page, 'inputMethod', 'handwriting');
  check(true, 'default input method saved: handwriting');
  await clickText(page, '.segmented-item', 'Gojūon order');
  await waitForSetting(page, 'keyLayout', 'gojuon');
  labels = await toggleState(page, 'Romaji column labels');
  check(!labels.disabled, 'column labels become available in gojūon order');
  await page.click(toggleSel('Romaji column labels'));
  await waitForSetting(page, 'showKeyHeaders', true);
  await page.click(toggleSel('Strict handwriting'));
  await waitForSetting(page, 'handwritingStrict', true);
  check(true, 'keyLayout gojuon, column labels and strict handwriting saved');

  step('Settings: listening (§15.6)');
  await page.waitForFunction(() => !document.querySelector('#settings-voice')?.disabled);
  const voices = await page.$$eval('#settings-voice option', (els) => els.map((o) => ({ value: o.value, text: o.textContent })));
  check(voices[0].value === '' && voices[0].text.startsWith('Automatic') && voices.some((v) => v.value === 'HiraKata Test Voice'),
    `voice picker lists Automatic and the Japanese voice (${voices.length} options)`);
  await page.select('#settings-voice', 'HiraKata Test Voice');
  await waitForSetting(page, 'ttsVoice', 'HiraKata Test Voice');
  await page.$eval('#settings-rate', (el) => { el.value = '0.7'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await waitForSetting(page, 'ttsRate', 0.7);
  check(true, 'voice and rate 0.7 saved');
  await clickText(page, '.settings-section button', 'Test voice');
  await page.waitForFunction(() => (window.__spoken || []).length > 0);
  const sample = await page.evaluate(() => window.__spoken.at(-1));
  check(sample.voice === 'HiraKata Test Voice' && Math.abs(sample.rate - 0.7) < 1e-6, `Test voice speaks with the chosen voice at 0.7× ("${sample.text}")`);
  check((await toggleState(page, 'Play words automatically')).checked, 'Play words automatically is on by default');
  await page.$eval('#listening', (el) => el.scrollIntoView({ block: 'start' }));
  await sleep(500);
  await shot(page, '41-settings-listening');

  step('The settings reach the practice page');
  const created = await apiCall(page, 'POST', '/api/tests', { script: 'hiragana', count: 5, pool: 'common' });
  v2.settingsTestId = created.data.test.id;
  await page.goto(`${base}/#/practice/${v2.settingsTestId}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.pr-pad-slot > .hw[data-state="ready"]');
  check(await page.$eval('.pr', (el) => el.dataset.method) === 'handwriting', 'practice opens with the default method (handwriting)');
  check(await page.$eval('.hw', (el) => el.classList.contains('is-strict')), 'the pad is in strict mode');
  await clickText(page, '.im-switch [data-value]', 'Kana keys');
  await page.waitForSelector('.kb[data-layout="gojuon"] .kb-col-head');
  check(true, 'keys are in gojūon order with column labels');
  await apiCall(page, 'POST', `/api/tests/${v2.settingsTestId}/close`);
  await apiCall(page, 'PATCH', '/api/auth/me', {
    settings: { keyLayout: 'shuffled', showKeyHeaders: false, handwritingStrict: false, inputMethod: 'keys', ttsRate: 0.9, ttsVoice: '' },
  });

  step('Dashboard: modes, input methods and chips (§15.6)');
  const stats = (await apiCall(page, 'GET', '/api/stats/overview')).data;
  check(stats.byMode.listen.answered >= 2 && stats.byMode.romaji.answered >= 4, `byMode: romaji ${stats.byMode.romaji.answered}, listen ${stats.byMode.listen.answered}`);
  check(stats.byInput.handwriting.answered >= 2 && stats.byInput.device.answered >= 1 && stats.byInput.keys.answered >= 3,
    `byInput: keys ${stats.byInput.keys.answered}, handwriting ${stats.byInput.handwriting.answered}, device ${stats.byInput.device.answered}`);
  check(stats.totals.romajiHintUsed >= 1, 'totals count the romaji hint');
  await page.goto(`${base}/#/dashboard`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.dash-modes');
  await page.waitForSelector('.dash-inputs');
  await page.waitForSelector('.dash-test');
  check(await page.$('.dash-test .mode-chip.is-listen') !== null && await page.$('.dash-test .mode-chip.is-romaji') !== null,
    'tests list shows Listen and Romaji mode chips');
  const modesText = await page.$eval('.dash-modes', (el) => el.textContent);
  const inputsText = await page.$eval('.dash-inputs', (el) => el.textContent);
  check(/listen/i.test(modesText) && /romaji/i.test(modesText), 'Romaji vs listening card is filled');
  check(/handwriting/i.test(inputsText) && /device/i.test(inputsText), 'Input methods card is filled');
  await sleep(1200);
  await page.$eval('.dash-modes', (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(400);
  await shot(page, '42-dashboard-v2');

  step('PDF reports with listen-mode data');
  const listenPdf = await downloadWithSession(page, `/api/tests/${v2.listenTestId}/report.pdf`);
  check(listenPdf.status === 200 && listenPdf.bytes.subarray(0, 5).toString('latin1') === '%PDF-', 'listen test report.pdf is a PDF');
  await writeFile(path.join(DOWNLOADS_DIR, 'listen-test-report.pdf'), listenPdf.bytes);
  const methodsPdf = await downloadWithSession(page, `/api/tests/${v2.methodsTestId}/report.pdf`);
  check(methodsPdf.status === 200 && methodsPdf.bytes.subarray(0, 5).toString('latin1') === '%PDF-', 'input-methods test report.pdf is a PDF');
  const overall = await downloadWithSession(page, '/api/reports/overall.pdf');
  check(overall.status === 200 && overall.bytes.subarray(0, 5).toString('latin1') === '%PDF-', 'overall.pdf with v2 breakdowns is a PDF');
  await writeFile(path.join(DOWNLOADS_DIR, 'overall-report-v2.pdf'), overall.bytes);

  step('Phone width and dark theme (v2 surfaces)');
  // No speech stub on this page: headless Chrome has no Japanese voice (the no-voice state).
  const phone = await pageIn(v2.context, { viewport: MOBILE, theme: 'dark' });
  ctx.watch(phone, 'phone-dark');
  ctx.activePage = phone;
  const listenRetry = await apiCall(page, 'POST', '/api/tests', { script: 'mixed', count: 5, mode: 'listen', pool: 'common' });
  const routes = [
    ['43-mobile-dashboard-v2-dark', '#/dashboard', '.dash-modes', true],
    ['44-mobile-listen-dark', `#/practice/${listenRetry.data.test.id}`, '.lp[data-state="novoice"] .lp-notice:not([hidden])', false],
    ['45-mobile-results-listen-dark', `#/results/${v2.listenTestId}`, '.review-item', true],
    ['46-mobile-settings-dark', '#/settings', '#settings-voice', true],
  ];
  for (const [name, hash, ready, full] of routes) {
    await phone.goto(`${base}/${hash}`, { waitUntil: 'networkidle0' });
    await phone.waitForSelector(ready);
    await sleep(900);
    await checkNoOverflow(phone, hash);
    await shot(phone, name, { fullPage: full });
  }
  check(true, 'without a Japanese voice, listen practice explains how to add one and offers the romaji');
  await phone.close();
  ctx.activePage = page;
}
