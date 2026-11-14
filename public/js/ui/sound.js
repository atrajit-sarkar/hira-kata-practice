/**
 * Short synthesized UI sounds (WebAudio, no assets). Respects store.settings.sound.
 * The AudioContext is created lazily on first use (after a user gesture).
 * @module ui/sound
 */
import { store } from '../store.js';

const MASTER_VOLUME = 0.22;
let ac = null;
let master = null;

function context() {
  if (ac) return ac;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ac = new Ctor();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 4;
  master = ac.createGain();
  master.gain.value = MASTER_VOLUME;
  master.connect(comp).connect(ac.destination);
  return ac;
}

/**
 * Schedule one soft tone.
 * @param {number} freq Hz
 * @param {number} start seconds from now
 * @param {number} dur seconds
 * @param {{type?: OscillatorType, gain?: number, glide?: number, attack?: number}} [o]
 */
function tone(freq, start, dur, { type = 'sine', gain = 0.6, glide = 0, attack = 0.012 } = {}) {
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glide) osc.frequency.exponentialRampToValueAtTime(freq * glide, t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(master);
  // A quiet octave partial gives a warmer, bell-like timbre.
  const partial = ac.createOscillator();
  const pEnv = ac.createGain();
  partial.type = 'sine';
  partial.frequency.setValueAtTime(freq * 2, t0);
  pEnv.gain.setValueAtTime(0.0001, t0);
  pEnv.gain.exponentialRampToValueAtTime(gain * 0.18, t0 + attack);
  pEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.6);
  partial.connect(pEnv).connect(master);
  osc.start(t0);
  partial.start(t0);
  osc.stop(t0 + dur + 0.05);
  partial.stop(t0 + dur + 0.05);
}

const SOUNDS = {
  // Rising major third (C6 → E6): a bright, quick chime.
  correct: () => {
    tone(1046.5, 0, 0.16, { gain: 0.5 });
    tone(1318.5, 0.07, 0.22, { gain: 0.45 });
  },
  // Soft descending minor second, low and muted.
  wrong: () => {
    tone(311.1, 0, 0.18, { type: 'triangle', gain: 0.45 });
    tone(293.7, 0.11, 0.26, { type: 'triangle', gain: 0.4, glide: 0.94 });
  },
  tap: () => tone(1760, 0, 0.05, { gain: 0.18, attack: 0.004 }),
  hint: () => {
    tone(880, 0, 0.12, { gain: 0.3 });
    tone(1174.7, 0.06, 0.18, { gain: 0.26 });
  },
  // Arpeggio C-E-G-C with a held top note.
  complete: () => {
    [523.3, 659.3, 784.0].forEach((f, i) => tone(f, i * 0.09, 0.22, { gain: 0.42 }));
    tone(1046.5, 0.27, 0.6, { gain: 0.45 });
  },
  streak: () => {
    [784.0, 987.8, 1174.7, 1568.0].forEach((f, i) => tone(f, i * 0.06, 0.16, { gain: 0.32 }));
  },
};

/**
 * Play a UI sound if sound is enabled.
 * @param {'correct'|'wrong'|'tap'|'hint'|'complete'|'streak'} name
 */
export function play(name) {
  if (!store.settings.sound || !SOUNDS[name]) return;
  try {
    if (!context()) return;
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    SOUNDS[name]();
  } catch (err) {
    console.warn('[sound] playback failed', err);
  }
}
