/**
 * Journey part 2: the practice page. Script hint, guided spelling on the on-screen keyboard with
 * one wrong key, a clean answer, a wrong-script answer, a skip and a romaji-typing answer (meaning
 * card after each), the progress PDF mid-test, then End test.
 * @module e2e/flows/practice
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { toImeRomaji } from '../../shared/kana.js';
import { currentWord, otherScript, wrongKanaFor } from '../lib/answers.mjs';
import { DOWNLOADS_DIR, check, clickText, downloadWithSession, shot, sleep, step, waitForHash } from '../lib/harness.mjs';
import {
  checkMeaningCard, clickKeys, clickMenuItem, inputValue, menuItem, nextQuestion,
  setKeyboardScript, waitForFeedback, waitForQuestion,
} from '../lib/practice.mjs';

const pointsText = (page) => page.$eval('.fb-points', (el) => el.textContent.trim()).catch(() => '');

/** Guide strip boxes as { cls, text }. */
const guideBoxes = (page) => page.$$eval('.guide-box', (els) => els.map((el) => ({ cls: el.className, text: el.textContent.trim() })));

/**
 * @param {import('../smoke.mjs').JourneyContext} ctx
 */
export async function practice(ctx) {
  const { page, dbPath, state } = ctx;
  const word = () => currentWord(dbPath, state.testId);
  await waitForQuestion(page);
  check(await page.$eval('.pr-check', (el) => el.textContent.includes('Check')), 'question shows the Check button');
  await shot(page, '05-practice-question');

  step('Q1 · script hint, then a correct answer typed into the field');
  let w = word();
  state.firstWord = w;
  await clickText(page, '.hint-btn', 'Script hint');
  await page.waitForSelector('.hint-badge');
  const badge = await page.$eval('.hint-badge', (el) => el.textContent);
  check(badge.toLowerCase().includes(w.script), `script hint badge says ${w.script}`);
  await page.type('.answer-input', w.kana);
  await shot(page, '06-practice-script-hint');
  await page.click('.pr-check');
  check(await waitForFeedback(page) === 'correct', 'answer is marked correct');
  check((await pointsText(page)).startsWith('+80'), 'script hint costs 20 points (+80)');
  await checkMeaningCard(page, w.kana);
  await shot(page, '07-practice-correct-meaning');
  await nextQuestion(page);

  step('Q2 · Guide me reveals one letter per click (§15.7b), with one wrong key');
  w = word();
  const chars = Array.from(w.kana);
  await clickText(page, '.hint-btn', 'Guide me');
  await page.waitForSelector('.guide:not([hidden]) .guide-box.is-next');
  check((await page.$$('.guide-box')).length === chars.length, 'guide strip has one box per character');
  let boxes = await guideBoxes(page);
  check(boxes[0].text === chars[0] && boxes.slice(1).every((b) => b.cls.includes('is-hidden') && b.text === '?'),
    `first click reveals only letter 1 (${boxes.map((b) => b.text).join(' ')})`);
  check((await page.$eval('.hint-guide', (el) => el.textContent)).includes('Reveal next letter'), 'the button now reads "Reveal next letter"');
  check((await page.$$('.kb .is-guide')).length === 1, 'exactly one keyboard control pulses (the key or the script toggle)');
  await setKeyboardScript(page, w.script);
  const pulsing = await page.$$eval('.kb-key.is-guide', (els) => els.map((el) => el.dataset.kana));
  check(pulsing.length === 1 && pulsing[0] === chars[0], `only the revealed letter's key pulses (${pulsing.join(', ')})`);
  const first = chars[0];
  await clickKeys(page, wrongKanaFor(first, w.script));
  await page.waitForSelector('.guide-box.is-wrong');
  const message = await page.$eval('.guide-message', (el) => el.textContent);
  check(message.includes('should be') && message.includes(first), `wrong key flagged: "${message.trim()}"`);
  await shot(page, '08-practice-guide-wrong');
  await page.click('.kb-backspace');
  await clickKeys(page, first);
  await sleep(200);
  boxes = await guideBoxes(page);
  check(boxes[0].cls.includes('is-done'), 'the revealed letter turns green once written');
  let revealedByClicks = 1;
  if (chars.length > 1) {
    check(boxes[1].cls.includes('is-hidden') && boxes[1].text === '?', 'nothing more is revealed until the next click');
    check((await page.$$('.kb-key.is-guide')).length === 0, 'no key pulses for an unrevealed letter');
    await clickKeys(page, wrongKanaFor(chars[1], w.script));
    await sleep(200);
    check((await guideBoxes(page))[1].cls.includes('is-hidden'), 'a wrong letter at an unrevealed position gets no live feedback');
    await page.click('.kb-backspace');
    await clickText(page, '.hint-btn', 'Reveal next letter');
    await page.waitForFunction(() => document.querySelectorAll('.guide-box')[1]?.classList.contains('is-next'));
    boxes = await guideBoxes(page);
    check(boxes[1].text === chars[1] && boxes.slice(2).every((b) => b.text === '?'), 'the second click reveals letter 2 only');
    revealedByClicks = 2;
    await clickKeys(page, chars.slice(1).join(''));
  }
  await sleep(700);
  check(await page.$eval('.pr', (el) => el.dataset.phase) === 'question', 'no auto-check once the word is complete');
  await page.click('.pr-check');
  check(await waitForFeedback(page) === 'correct', 'guided answer is correct after pressing Check');
  const guidePoints = 100 - Math.max(10, Math.round((60 * revealedByClicks) / chars.length));
  check((await pointsText(page)).startsWith(`+${guidePoints}`), `penalty counts revealed letters only (+${guidePoints})`);
  await checkMeaningCard(page, w.kana);
  await shot(page, '09-practice-guided-correct');
  await nextQuestion(page);

  step('Q3 · clean correct answer on the on-screen keyboard');
  w = word();
  await setKeyboardScript(page, w.script);
  await clickKeys(page, w.kana);
  check(await inputValue(page) === w.kana, `keys typed ${w.kana}`);
  check(await page.evaluate(() => document.activeElement?.classList.contains('answer-input')), 'focus stays in the answer field');
  await page.keyboard.press('Enter');
  check(await waitForFeedback(page) === 'correct', 'clean answer is correct');
  check((await pointsText(page)).startsWith('+100'), 'clean answer earns +100');
  await checkMeaningCard(page, w.kana);
  await nextQuestion(page);

  step('Q4 · right sounds, wrong script');
  w = word();
  await page.type('.answer-input', otherScript(w));
  await page.click('.pr-check');
  check(await waitForFeedback(page) === 'wrong', 'wrong-script answer is marked wrong');
  const explain = await page.$eval('.fb-explain', (el) => el.textContent);
  check(explain.includes('wrong script') && explain.includes(w.script), `explanation: "${explain.trim()}"`);
  check((await page.$$('.fb-row')).length === 2, 'shows "Your answer" and "Correct answer" rows');
  await checkMeaningCard(page, w.kana);
  await shot(page, '10-practice-wrong-script');
  await nextQuestion(page);

  step('Q5 · skip');
  w = word();
  await page.click('.pr-skip');
  check(await waitForFeedback(page) === 'neutral', 'skip shows a neutral verdict');
  await checkMeaningCard(page, w.kana);
  await shot(page, '11-practice-skipped');
  await nextQuestion(page);

  step('Q6 · romaji typing mode');
  w = word();
  await clickMenuItem(page, 'Romaji typing');
  await setKeyboardScript(page, w.script);
  const romaji = toImeRomaji(w.kana);
  await page.type('.answer-input', romaji);
  await sleep(150);
  const typed = await inputValue(page);
  check(typed === w.kana || (typed.endsWith('n') && romaji.endsWith('n')), `romaji "${romaji}" converts to ${typed}`);
  await shot(page, '12-practice-romaji-typing');
  await page.keyboard.press('Enter');
  check(await waitForFeedback(page) === 'correct', 'romaji-typed answer is correct');
  await checkMeaningCard(page, w.kana);
  await nextQuestion(page);

  step('Progress PDF mid-test');
  const link = await menuItem(page, 'Download progress PDF');
  const href = await link.evaluate((el) => el.getAttribute('href') || el.querySelector('a')?.getAttribute('href'));
  await sleep(400); // let the menu finish opening
  await shot(page, '13-practice-menu');
  await page.keyboard.press('Escape');
  check(Boolean(href) && href.includes(`/api/tests/${state.testId}/report.pdf`), `menu links to ${href}`);
  const pdf = await downloadWithSession(page, href);
  check(pdf.status === 200 && pdf.type.startsWith('application/pdf'), 'report.pdf answers 200 application/pdf');
  check(pdf.bytes.subarray(0, 5).toString('latin1') === '%PDF-', 'response body starts with %PDF-');
  check(/attachment; filename="hirakata-test-\d+-\d{4}-\d{2}-\d{2}\.pdf"/.test(pdf.disposition), `download name: ${pdf.disposition}`);
  await writeFile(path.join(DOWNLOADS_DIR, 'test-report.pdf'), pdf.bytes);

  step('End test');
  await clickMenuItem(page, 'End test');
  await page.waitForSelector('.modal[open] .modal-footer .btn-danger');
  await sleep(300);
  await shot(page, '14-practice-end-confirm');
  await page.click('.modal[open] .modal-footer .btn-danger');
  await waitForHash(page, new RegExp(`^#/results/${state.testId}`));
  check(true, 'End test opens the results page');
}
