/**
 * Helpers that drive the practice page (/practice/:id) through its stable selectors.
 * @module e2e/lib/practice
 */
import { check, clickText, sleep } from './harness.mjs';

/**
 * Wait until the page shows an unanswered question.
 * @param {import('puppeteer-core').Page} page
 */
export async function waitForQuestion(page) {
  await page.waitForFunction(() => document.querySelector('.pr')?.dataset.phase === 'question'
    && document.querySelector('.answer-input'));
  await sleep(250);
}

/**
 * Switch the on-screen keyboard to a script.
 * @param {import('puppeteer-core').Page} page
 * @param {'hiragana'|'katakana'} script
 */
export async function setKeyboardScript(page, script) {
  await page.click(`.kb-script [data-value="${script}"]`);
  await page.waitForFunction((s) => document.querySelector('.kb')?.dataset.script === s, {}, script);
  await sleep(700); // the reshuffled keys deal in (≈ 0.42 s plus a stagger)
}

/**
 * Type kana by clicking on-screen keys (desktop layout shows every section side by side).
 * @param {import('puppeteer-core').Page} page
 * @param {string} kana
 */
export async function clickKeys(page, kana) {
  for (const ch of Array.from(kana)) {
    const key = await page.$(`.kb-key[data-kana="${ch}"]`);
    if (!key) throw new Error(`No on-screen key for "${ch}"`);
    await key.click();
  }
}

/** Current value of the answer field. */
export const inputValue = (page) => page.$eval('.answer-input', (el) => el.value);

/**
 * Wait for the feedback panel and return its tone.
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<'correct'|'wrong'|'neutral'>}
 */
export async function waitForFeedback(page) {
  await page.waitForFunction(() => document.querySelector('.pr')?.dataset.phase === 'feedback'
    && !document.querySelector('.fb')?.hidden);
  await sleep(900); // let the verdict and meaning-card animations settle for screenshots
  return page.$eval('.fb', (el) => el.dataset.tone);
}

/**
 * Assert the meaning card is shown for the scored word.
 * @param {import('puppeteer-core').Page} page
 * @param {string} kana expected kana of the word
 */
export async function checkMeaningCard(page, kana) {
  const card = await page.$eval('.pr-meaning', (el) => ({
    hidden: el.hidden || el.getClientRects().length === 0,
    text: el.textContent,
  }));
  check(!card.hidden && card.text.includes(kana), `meaning card shows ${kana}`);
}

/**
 * Press the main button (Next word) and wait for the next question.
 * @param {import('puppeteer-core').Page} page
 */
export async function nextQuestion(page) {
  await page.click('.pr-check');
  await waitForQuestion(page);
}

/**
 * Open the ⋯ options menu and return the menu item element containing `label`.
 * @param {import('puppeteer-core').Page} page
 * @param {string} label
 */
export async function menuItem(page, label) {
  await page.click('.pr-more');
  await page.waitForSelector('.menu .menu-item');
  return page.waitForFunction((t) => [...document.querySelectorAll('.menu .menu-item')]
    .find((el) => el.textContent.includes(t)), {}, label);
}

/**
 * Click an options-menu entry by label.
 * @param {import('puppeteer-core').Page} page
 * @param {string} label
 */
export async function clickMenuItem(page, label) {
  await page.click('.pr-more');
  await page.waitForSelector('.menu .menu-item');
  await clickText(page, '.menu .menu-item', label);
  await sleep(250);
}

/** Is the answer field the focused element? (It must not be in virtual mode, §15.3.) */
export const answerFocused = (page) => page.evaluate(() => document.activeElement?.classList.contains('answer-input') === true);

/** readonly / inputmode of the answer field. */
export const answerAttrs = (page) => page.$eval('.answer-input', (el) => ({ readOnly: el.readOnly, inputMode: el.getAttribute('inputmode') }));

/**
 * Type kana by tapping on-screen keys on a touch screen: switches the script and the section tab
 * (narrow layouts show one section at a time) as needed.
 * @param {import('puppeteer-core').Page} page
 * @param {string} kana
 * @param {'hiragana'|'katakana'} script
 */
export async function tapKeys(page, kana, script) {
  if (await page.$eval('.kb', (el) => el.dataset.script) !== script) {
    await page.tap(`.kb-script [data-value="${script}"]`);
    await page.waitForFunction((s) => document.querySelector('.kb')?.dataset.script === s, {}, script);
    await sleep(700);
  }
  for (const ch of Array.from(kana)) {
    const sel = `.kb-key[data-kana="${ch}"]`;
    const { section, visible } = await page.$eval(sel, (el) => ({ section: el.dataset.section, visible: el.getClientRects().length > 0 }));
    if (!visible) await page.tap(`.kb-tabs [data-value="${section}"]`);
    await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
    await page.tap(sel);
  }
}

/** Key order of one keyboard section, e.g. "hiragana:かあさ…". */
export const keyOrder = (page, section = 'basic') => page.evaluate((s) => `${document.querySelector('.kb')?.dataset.script}:${
  [...document.querySelectorAll(`.kb-grid[data-section="${s}"] .kb-key`)].map((k) => k.dataset.kana).join('')}`, section);

let strokesCache = null;
/** KanjiVG template strokes served by the app (public/data/kana-strokes.json). */
async function strokeTemplates(page) {
  strokesCache ??= (await page.evaluate(async () => (await fetch('/data/kana-strokes.json')).json())).chars;
  return strokesCache;
}

/** Small kana are written as their full-size kana followed by the pad's 小 key. */
const SMALL_KANA = /[ぁぃぅぇぉゃゅょっゎァィゥェォャュョッヮ]/;
const FULL_SIZE = {
  ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お', ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', っ: 'つ', ゎ: 'わ',
  ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ', ャ: 'ヤ', ュ: 'ユ', ョ: 'ヨ', ッ: 'ツ', ヮ: 'ワ',
};

/**
 * Draw one kana on the handwriting pad from its template strokes, with a little jitter, by mouse
 * or by touch, then wait for the pad to recognise it.
 * @param {import('puppeteer-core').Page} page
 * @param {string} ch
 * @param {{ touch?: boolean }} [opts]
 */
export async function drawKana(page, ch, { touch = false } = {}) {
  const strokes = (await strokeTemplates(page))[ch];
  if (!strokes) throw new Error(`No stroke template for "${ch}"`);
  await page.$eval('.hw-ink', (el) => el.scrollIntoView({ block: 'center' }));
  const box = await (await page.$('.hw-ink')).boundingBox();
  let seed = ch.codePointAt(0);
  const jitter = () => { seed = (seed * 9301 + 49297) % 233280; return (seed / 233280 - 0.5) * 1.6; };
  const at = ([x, y]) => [box.x + ((x + jitter()) / 109) * box.width, box.y + ((y + jitter()) / 109) * box.height];
  for (const stroke of strokes) {
    const pts = stroke.map(at);
    if (touch) {
      // Real fingers report ~60 moves a second and slow down before lifting. Synthetic moves
      // that end at full speed look like a fling to emulated Chrome, and the next tap then only
      // stops that fling (no click). So pace the moves and settle before lifting.
      await page.touchscreen.touchStart(...pts[0]);
      for (const p of pts.slice(1)) { await sleep(16); await page.touchscreen.touchMove(...p); }
      const end = pts[pts.length - 1];
      for (let i = 0; i < 3; i += 1) { await sleep(25); await page.touchscreen.touchMove(end[0] + 0.01 * i, end[1]); }
      await page.touchscreen.touchEnd();
    } else {
      await page.mouse.move(...pts[0]);
      await page.mouse.down();
      for (const p of pts.slice(1)) await page.mouse.move(...p, { steps: 2 });
      await page.mouse.up();
    }
    await sleep(60);
  }
  // The pad recognises 650 ms after the last stroke.
  await page.waitForFunction(() => document.querySelector('.hw')?.dataset.pending !== 'true' && !document.querySelector('.hw')?.classList.contains('has-ink'), { timeout: 5000 });
  await sleep(150);
}

/**
 * Write a whole word on the handwriting pad; small kana use the pad's 小 key after the full-size
 * kana (it shrinks the last character, like the on-screen modifier).
 * @param {import('puppeteer-core').Page} page
 * @param {string} kana
 * @param {{ touch?: boolean }} [opts]
 */
export async function writeOnPad(page, kana, { touch = false } = {}) {
  for (const ch of Array.from(kana)) {
    const small = SMALL_KANA.test(ch);
    await drawKana(page, small ? FULL_SIZE[ch] : ch, { touch });
    if (small) {
      if (touch) await page.tap('.hw-small');
      else await page.click('.hw-small');
      await sleep(150);
    }
  }
}
