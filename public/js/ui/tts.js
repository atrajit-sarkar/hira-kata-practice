/**
 * Japanese text-to-speech via the Web Speech API (SPEC §15.2). Degrades silently when unavailable:
 * nothing here ever throws or rejects.
 *
 * Voices load asynchronously in most browsers (`getVoices()` is empty until `voiceschanged`), so
 * {@link listJapaneseVoices} waits up to {@link VOICE_WAIT_MS}. {@link speak} itself never waits:
 * mobile Safari only allows speech started synchronously inside a user gesture, so before voices
 * are known it speaks with `lang = 'ja-JP'` and lets the browser choose.
 * @module ui/tts
 */

/** How long {@link listJapaneseVoices} waits for the browser to publish its voices. */
export const VOICE_WAIT_MS = 1500;
const POLL_MS = 100;
const DEFAULT_RATE = 0.9;

const JA_LANG = /^ja([-_]|$)/i;
/** Natural / neural / network voices sound far better than legacy offline ones. */
const PREMIUM = /natural|neural|online|google|premium|enhanced/i;

let voicesReady = false;
/** Resolver of the utterance currently playing, so {@link stop} can settle its promise. */
let settleCurrent = null;

function synth() {
  return typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
}

function supported() {
  return Boolean(synth()) && typeof window.SpeechSynthesisUtterance === 'function';
}

/** All voices the browser has published so far (possibly none yet). */
function allVoices() {
  try {
    const voices = synth()?.getVoices() || [];
    if (voices.length) voicesReady = true;
    return Array.from(voices);
  } catch {
    return [];
  }
}

/** Ranks a Japanese voice: higher is better (premium > exact ja-JP > local > other). */
function rank(v) {
  return (PREMIUM.test(v.name) ? 4 : 0) + (/^ja[-_]jp$/i.test(v.lang) ? 2 : 0) + (v.localService ? 1 : 0);
}

/** Japanese voices published so far, best first (ties keep the browser's order). */
function japaneseVoices() {
  return allVoices()
    .filter((v) => JA_LANG.test(v.lang || ''))
    .map((v, i) => ({ v, i, r: rank(v) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map(({ v }) => v);
}

/** The voice to use: `voiceName` (name or voiceURI) when it is a Japanese voice, else the best one. */
function chooseVoice(voiceName) {
  const ja = japaneseVoices();
  if (voiceName) {
    const named = ja.find((v) => v.name === voiceName) || ja.find((v) => v.voiceURI === voiceName);
    if (named) return named;
  }
  return ja[0] || null;
}

if (synth()) {
  allVoices();
  try {
    synth().addEventListener?.('voiceschanged', allVoices);
  } catch { /* very old engines: polling in listJapaneseVoices covers it */ }
}

/**
 * Japanese voices available in this browser, best first (natural/online voices, then ja-JP, then
 * offline ones). Waits up to 1.5 s for the browser to load its voices; resolves to `[]` when speech
 * is unsupported or no Japanese voice exists.
 * @returns {Promise<SpeechSynthesisVoice[]>}
 */
export function listJapaneseVoices() {
  return new Promise((resolve) => {
    if (!supported()) { resolve([]); return; }
    const now = japaneseVoices();
    if (now.length || voicesReady) { resolve(now); return; }
    const s = synth();
    let timer = 0;
    let poll = 0;
    const finish = () => {
      clearTimeout(timer);
      clearInterval(poll);
      try { s.removeEventListener?.('voiceschanged', onChange); } catch { /* ignore */ }
      resolve(japaneseVoices());
    };
    // Some engines publish voices in several batches; settle on the first batch that has ja voices.
    const onChange = () => { if (japaneseVoices().length) finish(); };
    try { s.addEventListener?.('voiceschanged', onChange); } catch { /* ignore */ }
    poll = setInterval(onChange, POLL_MS); // Safari/old engines that never fire voiceschanged
    timer = setTimeout(finish, VOICE_WAIT_MS);
  });
}

/**
 * Whether at least one Japanese voice exists (waits for voices like {@link listJapaneseVoices}).
 * @returns {Promise<boolean>}
 */
export async function hasJapaneseVoice() {
  return (await listJapaneseVoices()).length > 0;
}

/**
 * Whether speech is possible right now (synchronous). Before voices have loaded this optimistically
 * returns true when the API exists; once loaded it requires a Japanese voice.
 * @returns {boolean}
 */
export function canSpeak() {
  if (!supported()) return false;
  const ja = japaneseVoices();
  return voicesReady ? ja.length > 0 : true;
}

/** Stops any speech in progress (its {@link speak} promise resolves). Safe to call any time. */
export function stop() {
  const settle = settleCurrent;
  settleCurrent = null;
  try { synth()?.cancel(); } catch { /* ignore */ }
  settle?.();
}

/**
 * Speak Japanese text, cancelling anything currently speaking. Starts synchronously (so it works
 * inside a tap handler on iOS) and never waits for voices.
 * @param {string} text
 * @param {{rate?: number, voiceName?: string}} [opts] rate clamped to 0.1–2 (default 0.9, slightly
 *   slow for learners); voiceName = a voice's name (or voiceURI) from {@link listJapaneseVoices},
 *   '' or unknown → the best Japanese voice
 * @returns {Promise<void>} resolves when finished, stopped or failed (never rejects)
 */
export function speak(text, { rate = DEFAULT_RATE, voiceName = '' } = {}) {
  return new Promise((resolve) => {
    if (!text || !canSpeak()) { resolve(); return; }
    stop();
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      if (settleCurrent === settle) settleCurrent = null;
      resolve();
    };
    try {
      const u = new window.SpeechSynthesisUtterance(String(text));
      u.lang = 'ja-JP';
      const voice = chooseVoice(voiceName);
      if (voice) u.voice = voice;
      const r = Number(rate);
      u.rate = Number.isFinite(r) ? Math.min(2, Math.max(0.1, r)) : DEFAULT_RATE;
      u.onend = settle;
      u.onerror = settle;
      settleCurrent = settle;
      synth().speak(u);
    } catch {
      settle();
    }
  });
}
