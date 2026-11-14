/**
 * Landing page (SPEC §12.1).
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { kanaBackground } from '../ui/kana-bg.js';
import { originText } from '../ui/word-card.js';
import { createLandingDemo, DEMO_WORDS } from '../ui/landing-demo.js';
import { number } from '../ui/format.js';
import { metaIcon } from '../results/practice-meta.js';

/**
 * Feature grid. `text` may be a function of the word-bank meta (GET /api/words/meta) so the
 * dictionary card can quote real counts once they arrive; it falls back to round figures.
 */
const FEATURES = [
  {
    icon: 'book', title: 'The whole dictionary', badge: 'New',
    text: (m) => `${m ? number(m.total) : '168,000+'} real words from JMdict — practise the ${m ? number(m.byPool.common) : '21,000+'} everyday common words, or everything.`,
  },
  { icon: 'headphones', title: 'Listen → write', badge: 'New', text: 'Hear a word spoken in natural Japanese, then write what you heard. Same-sound spellings earn partial credit.' },
  { icon: 'pen', title: 'Handwriting recognition', badge: 'New', text: 'Write kana by hand on a practice-paper pad. The recogniser reads each character, stroke by stroke, and scores it.' },
  { icon: 'kana-keys', title: 'Shuffled kana keyboard', text: 'Keys are shuffled for every word, with no romaji crutches, so you must recognise each character. Your phone keyboard stays closed.' },
  { icon: 'lightbulb', title: 'Smart hints', text: 'Reveal the script, the next letter or, in listen mode, the romaji — each for a small score cost.' },
  { icon: 'sparkles', title: 'Vocabulary with meanings', text: 'Every answer unlocks the word: kanji, English meanings, part of speech, loanword origin and JLPT level.' },
  { icon: 'chart', title: 'Dashboard analytics', text: 'Accuracy trends, streaks, an activity calendar and breakdowns by script, mode and input method.' },
  { icon: 'target', title: 'Kana mastery', text: 'A gojūon heatmap shows exactly which characters you know and which ones need another look.' },
  { icon: 'download', title: 'PDF reports', text: 'Download a polished progress report for any test — or for everything you have practised.' },
];

const STEPS = [
  { kana: 'ろ', title: 'Read it or hear it', text: 'Each question is a real dictionary word: shown in romaji like “kōhī”, or spoken aloud in listen mode.' },
  { kana: 'か', title: 'Write it in kana', text: 'Tap the shuffled kana keys, write by hand on the pad, or use your own keyboard — and pick the right script.' },
  { kana: 'わ', title: 'Learn the word', text: 'See what you got right, what to fix, and what the word means. Then on to the next one.' },
];

function toDemoWord(w) {
  return {
    kana: w.kana,
    romaji: w.romaji,
    script: w.script,
    kanji: w.kanji || [],
    meaning: w.senses?.[0]?.gloss?.slice(0, 2).join('; ') || w.meaning,
    jlpt: w.jlpt,
    origin: originText(w.origin),
  };
}

export default {
  title: '',
  layout: 'public',
  auth: false,
  publicOnly: true,
  async render(root, ctx) {
    if (ctx.user) {
      ctx.navigate('/dashboard', { replace: true });
      return undefined;
    }

    const demo = createLandingDemo();
    const wordCount = h('span', { class: 'hero-stat-value' }, '168,000+');
    const featureTexts = [];

    const startGuest = async (e) => {
      const btn = e.currentTarget;
      btn.classList.add('is-loading');
      btn.disabled = true;
      try {
        const { user } = await ctx.api.auth.guest();
        ctx.store.setUser(user, { keepAppearance: true });
        ctx.navigate('/dashboard');
        toast('Welcome! You are practising as a guest. Create an account any time to keep your progress.', { type: 'success', timeout: 5000 });
      } catch (err) {
        toast(err.message, { type: 'error' });
        btn.classList.remove('is-loading');
        btn.disabled = false;
      }
    };

    const ctas = (variant) => h('div', { class: `landing-ctas landing-ctas-${variant}` },
      h('a', { class: 'btn btn-primary btn-lg', href: '#/register' }, 'Create free account', icon('arrow-right', { size: 18 })),
      h('a', { class: 'btn btn-secondary btn-lg', href: '#/login' }, 'Log in'),
      h('button', { class: 'btn btn-ghost btn-lg', type: 'button', on: { click: startGuest } }, icon('user', { size: 18 }), 'Try as guest'));

    root.appendChild(h('div', { class: 'landing' },
      h('section', { class: 'hero' },
        kanaBackground({ count: 24, seed: 11, className: 'hero-kana-bg' }),
        h('div', { class: 'container hero-inner' },
          h('div', { class: 'hero-copy' },
            h('p', { class: 'hero-eyebrow' },
              h('span', { class: 'hero-eyebrow-jp', lang: 'ja' }, 'ひらがな・カタカナ'),
              'Kana writing practice'),
            h('h1', { class: 'hero-title' }, 'Write Japanese, ', h('span', { class: 'hero-title-accent' }, 'one word at a time.')),
            h('p', { class: 'hero-lead' },
              'HiraKata turns the whole Japanese dictionary into bite-sized writing drills. Read the romaji or hear the word, write it in hiragana or katakana — by tapping or by hand — get instant feedback, and learn what every word means.'),
            ctas('hero'),
            h('dl', { class: 'hero-stats' },
              h('div', null, h('dt', null, 'Dictionary words'), h('dd', null, wordCount)),
              h('div', null, h('dt', null, 'Price'), h('dd', null, h('span', { class: 'hero-stat-value' }, 'Free'))),
              h('div', null, h('dt', null, 'Setup'), h('dd', null, h('span', { class: 'hero-stat-value' }, 'None'))))),
          h('div', { class: 'hero-demo' }, demo.el))),

      h('section', { class: 'landing-section', 'aria-labelledby': 'features-title' },
        h('div', { class: 'container' },
          h('div', { class: 'section-head' },
            h('p', { class: 'eyebrow' }, 'Features'),
            h('h2', { id: 'features-title' }, 'Everything you need to master the kana'),
            h('p', { class: 'section-lead' }, 'Built for learners who want to actually write — not just recognise — Japanese.')),
          h('ul', { class: 'feature-grid', role: 'list' },
            FEATURES.map((f) => {
              const text = h('p', null, typeof f.text === 'function' ? f.text(null) : f.text);
              if (typeof f.text === 'function') featureTexts.push([text, f.text]);
              return h('li', { class: ['feature-card', f.badge && 'is-new'] },
                h('span', { class: 'feature-icon' }, metaIcon(f.icon, { size: 22 })),
                h('h3', null, f.title, f.badge ? h('span', { class: 'feature-badge' }, f.badge) : null),
                text);
            })))),

      h('section', { class: 'landing-section landing-steps', 'aria-labelledby': 'how-title' },
        h('div', { class: 'container' },
          h('div', { class: 'section-head' },
            h('p', { class: 'eyebrow' }, 'How it works'),
            h('h2', { id: 'how-title' }, 'Three steps, every word')),
          h('ol', { class: 'steps', role: 'list' },
            STEPS.map((s, i) => h('li', { class: 'step' },
              h('span', { class: 'step-kana kana', lang: 'ja', 'aria-hidden': 'true' }, s.kana),
              h('span', { class: 'step-num' }, `Step ${i + 1}`),
              h('h3', null, s.title),
              h('p', null, s.text)))))),

      h('section', { class: 'landing-section' },
        h('div', { class: 'container' },
          h('div', { class: 'cta-band' },
            h('div', { class: 'cta-band-copy' },
              h('h2', null, 'Ready to write your first word?'),
              h('p', null, 'Start free in seconds. No credit card, no install — just you and the kana.')),
            ctas('band'))))));

    demo.start();

    ctx.api.words.sample(24).then(({ words }) => {
      // The bank is the whole dictionary; everyday (common) words make a friendlier demo.
      const everyday = (words || []).filter((w) => w.common !== false);
      const picked = (everyday.length >= 4 ? everyday : words || [])
        .filter((w) => Array.from(w.kana).length <= 6 && w.romaji.length <= 12)
        .map(toDemoWord)
        .filter((w) => w.meaning && w.meaning.length <= 44)
        .slice(0, 6);
      if (picked.length >= 3) demo.setWords([DEMO_WORDS[0], ...picked.filter((w) => w.kana !== DEMO_WORDS[0].kana)]);
    }).catch(() => { /* fallback words stay */ });

    ctx.api.words.meta().then((meta) => {
      const total = meta?.total || 0;
      if (total >= 1000) wordCount.textContent = `${number(Math.floor(total / 1000) * 1000)}+`;
      else if (total > 0) wordCount.textContent = number(total);
      if (total > 0 && meta.byPool?.common != null) for (const [el, fn] of featureTexts) el.textContent = fn(meta);
    }).catch(() => {});

    return () => demo.stop();
  },
};
