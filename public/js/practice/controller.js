/**
 * Practice page controller: builds the practice view from the focused modules and drives it from
 * the {@link PracticeSession} state machine (SPEC §12.4, §15.2–15.5, §15.7).
 *
 * Input methods (§15.3): on touch / coarse-pointer screens the answer field is virtual (readonly,
 * `inputmode="none"`, never focused) unless the learner picks the device keyboard, so the operating
 * system's keyboard only ever appears when asked for. On desktop, physical typing works in every
 * method.
 * @module practice/controller
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';
import { play } from '../ui/sound.js';
import { speak, canSpeak, stop as stopSpeech, hasJapaneseVoice } from '../ui/tts.js';
import { detectScript } from '/shared/kana.js';
import { ApiError } from '../api.js';
import { PracticeSession, PHASE, isRetryable } from './session.js';
import { createHeader } from './header.js';
import { createProgressDots } from './progress-dots.js';
import { createQuestionCard } from './question-card.js';
import { createHints } from './hints.js';
import { createAnswerInput } from './answer-input.js';
import { createGuide } from './guide.js';
import { createKanaKeyboard } from './kana-keyboard.js';
import { createFeedback } from './feedback.js';
import { createQuestionTimer } from './timer.js';
import { createListenPlayer, SLOW_RATE } from './listen.js';
import { createMethodSwitcher, createDevicePanel, INPUT_METHODS, METHOD_LABELS } from './input-method.js';
import { readMemo, writeMemo, clearMemo } from './memo.js';

/** Delay before autoAdvance moves on after a correct answer. */
const AUTO_ADVANCE_MS = 1500;
/** Next / See results ignore presses this soon after a result appears (double click, held Enter). */
const RESULT_GUARD_MS = 450;
/** Minimum gap between two "use your device keyboard?" tips. */
const VIRTUAL_TIP_MS = 6000;
const COARSE_POINTER = '(pointer: coarse)';

/** @returns {boolean} true when focus is in a control that handles Enter itself */
function isInteractive(el) {
  return Boolean(el?.closest?.('button, a[href], input, select, textarea, [role="menu"], [role="tab"], [role="radio"], dialog'));
}

/** True once the page has had a user gesture, so speech is allowed to start without one. */
function hasUserActivation() {
  const ua = navigator.userActivation;
  return ua ? Boolean(ua.hasBeenActive) : true;
}

/** Load the handwriting pad module only when the learner first picks handwriting. */
let padModule = null;
function loadPad() {
  padModule ??= import('../handwriting/pad.js').catch((err) => { padModule = null; throw err; });
  return padModule;
}

export class PracticeController {
  /**
   * @param {HTMLElement} root  the page root (#view)
   * @param {object} ctx        router context ({ params, navigate, store, api })
   */
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.store = ctx.store;
    this.testId = ctx.params.id;
    this.session = new PracticeSession(this.testId, ctx.api);
    this.timer = createQuestionTimer();
    this.timers = new Set();
    this.busyHint = null;
    this.resultShownAt = 0;
    this.disposers = [];
    this.coarse = window.matchMedia(COARSE_POINTER);
    /** @type {'keys'|'handwriting'|'device'|null} */
    this.method = null;
    this.pad = null;
    this.padLoading = null;
    this.speakToken = 0;
    /** @type {'ok'|'none'|'unsupported'} */
    this.voice = 'ok';
    this.virtualTipAt = -1e9;
    /** @type {{close: () => void}|null} */
    this.virtualTip = null;
  }

  /** Schedule a callback that is cancelled when the page is left. */
  later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }

  cancel(t) {
    clearTimeout(t);
    this.timers.delete(t);
  }

  /** @returns {boolean} true for a listen → write test */
  get listen() {
    return this.session.test?.config?.mode === 'listen' || this.session.current?.mode === 'listen';
  }

  /** Build every view and wire their callbacks. */
  build() {
    const s = this.store.settings;
    this.header = createHeader({ onExit: () => this.ctx.navigate('/dashboard'), menuItems: () => this.menuItems() });
    this.dots = createProgressDots();
    this.player = createListenPlayer({
      onPlay: ({ slow }) => this.playWord({ slow }),
      onRomaji: () => this.useRomajiHint(),
    });
    this.question = createQuestionCard({ player: this.player.el });
    this.hints = createHints({
      onScript: () => this.useScriptHint(),
      onGuide: () => this.useGuide(),
      onRomaji: () => this.useRomajiHint(),
    });
    this.keyboard = createKanaKeyboard({
      script: 'hiragana',
      showLabels: s.showRomajiOnKeys,
      layout: s.keyLayout,
      headers: Boolean(s.showKeyHeaders),
      onKey: (ch) => { play('tap'); this.input.insert(ch); },
      onModifier: (mod) => { if (!this.input.modify(mod)) this.keyboard.rejectModifier(mod); },
      onBackspace: () => this.input.backspace(),
      onClear: () => this.input.clear(),
      onScriptChange: (script) => this.onScriptChosen(script),
    });
    this.input = createAnswerInput({
      getScript: () => this.keyboard.getScript(),
      romaji: s.romajiInput,
      onChange: () => this.onInputChange(),
      onSubmit: () => this.primaryAction(),
      onEnableRomaji: () => {
        this.store.updateSettings({ romajiInput: true });
        toast('Romaji typing is on. Type "neko" to get ねこ.', { type: 'success' });
        this.input.focus();
      },
      onVirtualTap: () => this.offerDeviceKeyboard(),
    });
    this.guide = createGuide({
      onReveal: (revealed) => { if (this.session.current) writeMemo(this.session.current.id, { revealed }); },
    });

    this.checkBtn = h('button', { class: 'btn btn-primary btn-lg pr-check', type: 'button', on: { click: () => this.primaryAction() } });
    this.skipBtn = h('button', {
      class: 'btn btn-ghost pr-skip', type: 'button', 'aria-keyshortcuts': 'Alt+S', 'data-tip': 'Skip this word (Alt+S)',
      on: { click: () => this.skip() },
    }, icon('skip-forward', { size: 18 }), 'Skip');
    this.actions = h('div', { class: 'pr-actions' },
      h('div', { class: 'pr-actions-start' }, this.skipBtn), this.checkBtn);

    this.card = h('section', { class: 'pr-card', 'aria-label': 'Question' });
    this.feedback = createFeedback({ card: this.card });
    this.card.append(this.question.el, this.hints.el, this.input.el, this.guide.el, this.feedback.verdictEl, this.actions);

    this.switcher = createMethodSwitcher({
      value: this.methodSetting(),
      onChange: (method) => this.chooseMethod(method),
    });
    this.devicePanel = createDevicePanel({
      onToggleRomaji: () => this.store.updateSettings({ romajiInput: !this.store.settings.romajiInput }),
      onScript: (script) => { this.keyboard.setScript(script); this.onScriptChosen(script); },
    });
    this.padSlot = h('div', { class: 'pr-pad-slot' });
    this.kbWrap = h('section', { class: 'pr-kb', 'aria-label': 'Answer input' },
      this.switcher.el, this.keyboard.el, this.padSlot, this.devicePanel.el);
    this.live = h('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });

    this.el = h('div', { class: 'pr' },
      this.header.el,
      h('main', { class: 'pr-main' },
        this.dots.el,
        h('div', { class: 'pr-stage' }, this.card, this.feedback.meaningEl, this.kbWrap)),
      this.live);
    this.root.replaceChildren(this.el);
  }

  /**
   * Load the test and show the current question.
   * @returns {Promise<boolean>} false when the test is not active (the caller has been redirected)
   * @throws {ApiError} when the state cannot be loaded
   */
  async start() {
    const active = await this.session.load();
    if (this.destroyed) return false;
    if (!active) {
      this.ctx.navigate(`/results/${encodeURIComponent(this.testId)}`, { replace: true });
      return false;
    }
    this.build();
    this.disposers.push(
      this.session.on((e) => this.onSessionEvent(e)),
      this.store.subscribe(() => this.applySettings()),
    );
    const onKey = (e) => this.onKeydown(e);
    document.addEventListener('keydown', onKey);
    this.disposers.push(() => document.removeEventListener('keydown', onKey));
    const onPointer = () => this.applySettings();
    this.coarse.addEventListener('change', onPointer);
    this.disposers.push(() => this.coarse.removeEventListener('change', onPointer));

    this.applySettings();
    this.header.update(this.session.test);
    if (this.listen) this.checkVoices();
    this.showQuestion({ animate: true });
    return true;
  }

  /** The saved input method (falls back to on-screen keys). */
  methodSetting() {
    const m = this.store.settings.inputMethod;
    return INPUT_METHODS.includes(m) ? m : 'keys';
  }

  /** Apply the practice settings (input method, keyboard layout, labels, romaji typing). */
  applySettings() {
    const s = this.store.settings;
    this.keyboard.setLabels(s.showRomajiOnKeys);
    this.keyboard.setLayout(s.keyLayout, { headers: Boolean(s.showKeyHeaders) });
    this.input.setRomajiMode(s.romajiInput);
    this.devicePanel.setRomaji(Boolean(s.romajiInput));
    this.devicePanel.setScript(this.keyboard.getScript());
    this.pad?.setStrict(Boolean(s.handwritingStrict));
    this.setMethod(this.methodSetting());
  }

  /**
   * Show the views for an input method and decide whether the device keyboard may appear.
   * @param {'keys'|'handwriting'|'device'} method
   */
  setMethod(method) {
    const changed = method !== this.method;
    this.method = method;
    this.switcher.setValue(method);
    const question = this.session.phase === PHASE.QUESTION;
    this.el.dataset.method = method;
    this.el.classList.toggle('has-keyboard', method === 'keys');
    this.kbWrap.hidden = !question;
    this.keyboard.el.hidden = method !== 'keys';
    this.padSlot.hidden = method !== 'handwriting';
    this.devicePanel.el.hidden = method !== 'device';
    // §15.3: on touch screens only the device-keyboard method may bring up the OS keyboard.
    this.input.setDeviceKeyboard(method === 'device' || !this.coarse.matches);
    if (method === 'handwriting') this.mountPad();
    else this.unmountPad();
    if (!changed) return;
    // The "use your device keyboard?" tip is stale once another method is chosen.
    this.virtualTip?.close();
    this.virtualTip = null;
    this.refreshGuide();
  }

  /** The learner picked an input method (switcher or menu). */
  chooseMethod(method) {
    if (!INPUT_METHODS.includes(method)) return;
    this.store.updateSettings({ inputMethod: method });
    this.setMethod(method); // applies now, even if the settings update is a no-op
    this.live.textContent = `Answering with ${METHOD_LABELS[method].toLowerCase()}.`;
    // A deliberate choice of the device keyboard may open it right away (this is a user gesture).
    if (this.session.phase === PHASE.QUESTION) this.input.focus();
  }

  /** Create the handwriting pad (once) and keep it in sync with the current question. */
  mountPad() {
    if (this.pad || this.padLoading) return;
    const token = Symbol('pad');
    this.padLoading = token;
    loadPad().then(({ createHandwritingPad }) => {
      if (this.destroyed || this.padLoading !== token || this.method !== 'handwriting') return;
      this.pad = createHandwritingPad({
        onCommit: (ch) => { play('tap'); this.input.insert(ch); },
        onBackspace: () => this.input.backspace(),
        getScript: () => this.padScript(),
        strict: Boolean(this.store.settings.handwritingStrict),
      });
      this.padSlot.replaceChildren(this.pad.el);
      this.syncPadHint();
    }).catch(() => {
      if (this.destroyed) return;
      toast('The handwriting pad could not be loaded. Check your connection and try again.', { type: 'error' });
    }).finally(() => {
      if (this.padLoading === token) this.padLoading = null;
    });
  }

  unmountPad() {
    this.padLoading = null;
    this.pad?.destroy();
    this.pad = null;
    this.padSlot.replaceChildren();
  }

  /**
   * Soft script preference for the recogniser: the script hint when it was bought, otherwise the
   * script of what the learner has already written (never the answer's own script for free).
   */
  padScript() {
    const q = this.session.current;
    if (q?.hint1Used && q.script) return q.script;
    const written = detectScript(this.input.kana());
    return written === 'hiragana' || written === 'katakana' ? written : null;
  }

  syncPadHint() {
    const q = this.session.current;
    this.pad?.setScriptHint(q?.hint1Used ? q.script : null);
  }

  /** A tap on the virtual answer field: point to the device keyboard, at most every few seconds. */
  offerDeviceKeyboard() {
    if (performance.now() - this.virtualTipAt < VIRTUAL_TIP_MS) return;
    this.virtualTipAt = performance.now();
    this.virtualTip?.close();
    this.virtualTip = toast(this.method === 'handwriting'
      ? 'Write each kana in the box below.'
      : 'Answer with the kana keys below.', {
      type: 'info',
      timeout: 5000,
      action: { label: 'Use device keyboard', onClick: () => this.chooseMethod('device') },
    });
  }

  /** The learner switched the script (keyboard toggle, device panel or Alt+K). */
  onScriptChosen(script) {
    if (this.session.current) writeMemo(this.session.current.id, { script });
    this.devicePanel.setScript(script);
    this.refreshGuide();
  }

  /** Render the current question (fresh, after "Next", or restored after a reload). */
  showQuestion({ animate = false } = {}) {
    const q = this.session.current;
    const test = this.session.test;
    this.cancel(this.advanceTimer);
    this.feedback.hide();
    this.el.dataset.phase = 'question';
    this.el.classList.toggle('is-listen', q.mode === 'listen');
    this.card.dataset.result = '';
    this.input.setResult('');
    this.input.setLocked(false);
    this.hints.setLocked(false);
    this.hints.setBusy(null);
    this.hints.el.hidden = false;
    this.skipBtn.hidden = false;
    this.setPrimary('check');

    this.question.setQuestion(q, test.totalQuestions, { animate });
    this.hints.sync(q);
    const memo = readMemo(q.id);
    if (memo.script) this.keyboard.setScript(memo.script);
    else if (q.hint1Used && q.script) this.keyboard.setScript(q.script);
    // A single-script test already tells the learner the script: start the keys in it.
    else if (test.config?.script === 'hiragana' || test.config?.script === 'katakana') this.keyboard.setScript(test.config.script);
    this.devicePanel.setScript(this.keyboard.getScript());
    // A new order for every word (§15.4); animate only when it replaces a visible board.
    this.keyboard.shuffle({ animate });

    this.input.setValue(memo.draft || '');
    this.input.setTypingHint(q.romaji || '');
    this.keyboard.showSection('basic');
    this.pad?.clear();
    this.syncPadHint();
    this.guide.deactivate();
    this.keyboard.clearGuide();
    this.hints.setGuide(null);
    if (q.hint2Used && q.answer) {
      this.guide.activate(q.answer, this.input.kana(), { hint2From: memo.hint2From, revealed: memo.revealed });
      // Without a stored memo (storage unavailable) treat the next letter as revealed (§15.7b).
      if (!Array.isArray(memo.revealed)) this.guide.reveal(this.input.kana());
      writeMemo(q.id, { hint2From: this.guide.hint2From, revealed: this.guide.revealed });
    }
    this.refreshGuide();
    this.dots.update(this.session.questions, q.id);
    this.applySettings();
    this.timer.reset();
    this.timer.start();
    this.input.focus();
    this.startListening();
  }

  /** Listen mode: speak the new word (or wait for a tap when the browser needs a gesture first). */
  startListening() {
    const q = this.session.current;
    this.player.setSpeaking(false);
    this.player.setNeedsTap(false);
    this.player.setVoice(this.voice, { romajiAvailable: !q?.romajiHintUsed });
    if (q?.mode !== 'listen' || !q.speak) return;
    if (!this.store.settings.listenAutoplay || this.voice !== 'ok') return;
    if (hasUserActivation()) this.playWord();
    else this.player.setNeedsTap(true);
  }

  /** Find out (once) whether a Japanese voice exists, and explain if not. */
  checkVoices() {
    const supported = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function';
    if (!supported) {
      this.voice = 'unsupported';
      return;
    }
    hasJapaneseVoice().then((ok) => {
      if (this.destroyed || ok) return;
      this.voice = 'none';
      this.speakToken += 1;
      this.player.setSpeaking(false);
      this.player.setNeedsTap(false);
      this.player.setVoice('none', { romajiAvailable: !this.session.current?.romajiHintUsed });
    });
  }

  /**
   * Speak the current word. Called synchronously from the click / key handler that asked for it,
   * so mobile browsers allow the audio.
   * @param {{slow?: boolean}} [opts]
   */
  playWord({ slow = false } = {}) {
    const q = this.session.current;
    if (!q?.speak || this.voice !== 'ok' || this.destroyed) return;
    const s = this.store.settings;
    const token = ++this.speakToken;
    this.player.setNeedsTap(false);
    this.player.setSpeaking(true, { slow });
    speak(q.speak, { rate: slow ? SLOW_RATE : s.ttsRate, voiceName: s.ttsVoice }).then(() => {
      if (token === this.speakToken && !this.destroyed) this.player.setSpeaking(false);
    });
  }

  /** Switch the primary button between Check, Next word and See results. */
  setPrimary(kind) {
    const labels = {
      check: ['Check', 'check'],
      next: ['Next word', 'arrow-right'],
      results: ['See results', 'trophy'],
    };
    const [label, name] = labels[kind];
    this.primaryKind = kind;
    this.checkBtn.classList.remove('is-loading');
    this.checkBtn.disabled = false;
    const glyph = icon(name, { size: 20 });
    const text = h('span', null, label);
    const key = h('kbd', { class: 'kbd pr-kbd', 'aria-hidden': 'true' }, 'Enter');
    this.checkBtn.replaceChildren(...(kind === 'check' ? [glyph, text, key] : [text, glyph, key]));
    this.checkBtn.setAttribute('aria-keyshortcuts', 'Enter');
  }

  /** Live updates while typing: draft memo and guided-mode state. */
  onInputChange() {
    const q = this.session.current;
    if (!q || this.session.phase !== PHASE.QUESTION) return;
    writeMemo(q.id, { draft: this.input.raw() });
    this.refreshGuide();
  }

  /** Recompute guided mode and point the keyboard at the revealed key (only that one, §15.7b). */
  refreshGuide() {
    if (!this.guide?.active || this.session.phase !== PHASE.QUESTION) {
      this.keyboard?.clearGuide();
      return;
    }
    const kana = this.input.kana();
    const view = this.guide.update(kana);
    if (view?.pulse === 'key') this.keyboard.guideTo(view.ch);
    else if (view?.pulse === 'backspace') this.keyboard.guideToBackspace();
    else this.keyboard.clearGuide();
    this.hints.setGuide({ revealed: this.guide.revealedCount, len: this.guide.length, canReveal: this.guide.canReveal(kana) });
  }

  /** Enter / primary button: Check, Next word or See results depending on the phase. */
  primaryAction() {
    const { phase } = this.session;
    if (phase === PHASE.QUESTION) {
      this.check();
      return;
    }
    // A second click or Enter that lands just after the result appeared must not skip it.
    if (performance.now() - this.resultShownAt < RESULT_GUARD_MS) return;
    if (phase === PHASE.FEEDBACK) this.next();
    else if (phase === PHASE.COMPLETE) this.finish();
  }

  /** Check the written answer. */
  check() {
    if (this.session.phase !== PHASE.QUESTION) return;
    const answer = this.input.answer();
    if (!answer.trim()) {
      this.input.nudge(this.method === 'handwriting'
        ? 'Write the word in the box first, or skip it.'
        : 'Write the word in kana first, or skip it.');
      this.input.focus();
      return;
    }
    const payload = { answer, timeMs: this.timer.elapsed(), inputMethod: this.method || 'keys' };
    if (this.guide.active) {
      payload.hint2From = this.guide.hint2From;
      payload.hint2Revealed = this.guide.revealedCount;
    }
    this.send('check', () => this.session.submit(payload));
  }

  /** Skip the current question. */
  skip() {
    if (this.session.phase !== PHASE.QUESTION) return;
    this.send('skip', () => this.session.skip(this.timer.elapsed()));
  }

  /**
   * Run an answer/skip request with busy states and error recovery. The written answer is never
   * cleared on failure, so the learner can simply retry.
   * @param {'check'|'skip'} kind
   * @param {() => Promise<object|null>} call
   */
  async send(kind, call) {
    const qid = this.session.current?.id;
    this.timer.stop();
    this.input.setLocked(true);
    this.hints.setLocked(true);
    const btn = kind === 'check' ? this.checkBtn : this.skipBtn;
    btn.classList.add('is-loading');
    this.checkBtn.disabled = true;
    this.skipBtn.disabled = true;
    try {
      const res = await call();
      if (res) this.showResult(res);
    } catch (err) {
      if (this.session.current?.id !== qid || this.destroyed) return;
      this.input.setLocked(false);
      this.hints.setLocked(false);
      this.timer.start();
      this.reportError(err, kind === 'check' ? 'Your answer could not be checked.' : 'The word could not be skipped.',
        () => (kind === 'check' ? this.check() : this.skip()));
    } finally {
      btn.classList.remove('is-loading');
      this.checkBtn.disabled = false;
      this.skipBtn.disabled = false;
    }
  }

  /**
   * Show a toast for a failed request (with Retry for transient failures).
   * Conflicts are resolved by the session (resync or redirect), so they only need a short note.
   */
  reportError(err, fallback, retry) {
    if (err instanceof ApiError && (err.code === 'TEST_NOT_ACTIVE' || err.code === 'QUESTION_NOT_CURRENT' || err.status === 401)) return;
    const message = err instanceof ApiError && err.status === 0
      ? `${fallback} Check your connection and try again.`
      : (err instanceof ApiError && err.message) || fallback;
    toast(message, {
      type: 'error',
      timeout: isRetryable(err) ? 8000 : 5000,
      action: isRetryable(err) && retry ? { label: 'Retry', onClick: retry } : undefined,
    });
    this.input.focus();
  }

  /** Render an AnswerResponse: score, streak, dots, verdict, meaning and the next action. */
  showResult(res) {
    const { result, test } = res;
    clearMemo(result.id);
    this.guide.deactivate();
    this.keyboard.clearGuide();
    this.pad?.clear();
    this.el.dataset.phase = 'feedback';
    this.card.dataset.result = result.status;
    this.input.setResult(result.status);
    this.hints.el.hidden = true;
    this.skipBtn.hidden = true;
    this.kbWrap.hidden = true;
    this.header.update(test, { animate: true });
    this.dots.update(this.session.questions, null);
    // Listen mode: now that the word is scored, show how it is spelled in romaji too.
    if (result.romaji) this.question.revealRomaji(result.romaji, { label: 'Romaji', animate: true });

    const announcement = this.feedback.show(result, { firstSeen: this.session.firstSeen, streak: test.currentStreak });
    this.live.textContent = res.completed ? `${announcement} That was the last word.` : announcement;
    if (this.store.settings.autoSpeak && canSpeak()) {
      const s = this.store.settings;
      speak(result.word?.kana || result.expected, { rate: s.ttsRate, voiceName: s.ttsVoice });
    }

    this.setPrimary(res.completed ? 'results' : 'next');
    this.resultShownAt = performance.now();
    if (res.completed) this.later(() => play('complete'), 700);
    this.checkBtn.focus({ preventScroll: true });
    this.later(() => this.feedback.verdictEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);

    if (!res.completed && result.status === 'correct' && this.store.settings.autoAdvance) {
      this.advanceTimer = this.later(() => this.next(), AUTO_ADVANCE_MS);
    }
  }

  /** Move on to the next question. */
  next() {
    if (this.session.phase !== PHASE.FEEDBACK) return;
    this.cancel(this.advanceTimer);
    stopSpeech();
    this.session.advance();
    this.showQuestion({ animate: true });
    this.el.scrollIntoView?.({ block: 'start' });
  }

  /** Go to the results page after the last answer or after ending the test. */
  finish() {
    stopSpeech();
    this.ctx.navigate(`/results/${encodeURIComponent(this.testId)}?fresh=1`);
  }

  /** Hint 1: reveal the script. */
  async useScriptHint() {
    const q = this.session.current;
    if (this.session.phase !== PHASE.QUESTION || q.hint1Used || this.busyHint) return;
    const question = await this.requestHint('script');
    if (!question) return;
    play('hint');
    this.hints.sync(question, { animate: true });
    if (question.script) {
      this.keyboard.setScript(question.script);
      this.devicePanel.setScript(question.script);
    }
    this.syncPadHint();
    this.live.textContent = `Script hint: this word is written in ${question.script}.`;
    this.refreshGuide();
  }

  /**
   * Hint 2 (§15.7b): the first click turns guided spelling on (the server returns the answer);
   * every click reveals one more letter, the first one not yet written correctly.
   */
  async useGuide() {
    const q = this.session.current;
    if (this.session.phase !== PHASE.QUESTION || this.busyHint) return;
    let question = q;
    if (!q.hint2Used || !this.guide.active) {
      if (!q.hint2Used) {
        question = await this.requestHint('spelling');
        if (!question?.answer) return;
      }
      if (!question.answer) return;
      this.guide.activate(question.answer, this.input.kana(), q.hint2Used ? readMemo(q.id) : {});
    }
    const { index, added } = this.guide.reveal(this.input.kana());
    writeMemo(question.id, { hint2From: this.guide.hint2From, revealed: this.guide.revealed });
    if (added) play('hint');
    this.hints.sync(question, { animate: true });
    this.refreshGuide();
    if (index == null) {
      this.live.textContent = 'Nothing left to reveal. Press Check.';
    } else if (added) {
      this.live.textContent = `Letter ${index + 1} is ${this.guide.expectedAt(index)}.`;
    } else {
      this.live.textContent = `Write letter ${index + 1}, ${this.guide.expectedAt(index)}, before revealing the next one.`;
    }
    this.input.focus();
  }

  /** Listen-mode hint: show the romaji (−30). */
  async useRomajiHint() {
    const q = this.session.current;
    if (this.session.phase !== PHASE.QUESTION || q.mode !== 'listen' || q.romajiHintUsed || this.busyHint) return;
    const question = await this.requestHint('romaji');
    if (!question?.romaji) return;
    play('hint');
    this.hints.sync(question, { animate: true });
    this.question.revealRomaji(question.romaji, { animate: true });
    this.input.setTypingHint(question.romaji);
    this.player.setVoice(this.voice, { romajiAvailable: false });
    this.live.textContent = `Romaji hint: ${question.romaji}.`;
  }

  /**
   * @param {'script'|'spelling'|'romaji'} type
   * @returns {Promise<object|null>} the updated QuestionPublic, or null on failure
   */
  async requestHint(type) {
    const qid = this.session.current.id;
    this.busyHint = type;
    this.hints.setBusy(type);
    const retry = { script: () => this.useScriptHint(), spelling: () => this.useGuide(), romaji: () => this.useRomajiHint() }[type];
    try {
      const question = await this.session.useHint(type);
      return this.session.current?.id === qid && !this.destroyed ? question : null;
    } catch (err) {
      if (!this.destroyed) this.reportError(err, 'The hint could not be loaded.', retry);
      return null;
    } finally {
      this.busyHint = null;
      if (!this.destroyed) this.hints.setBusy(null);
    }
  }

  /** Options menu (re-evaluated on every open so the check marks stay current). */
  menuItems() {
    const s = this.store.settings;
    const toggle = (key) => () => this.store.updateSettings({ [key]: !this.store.settings[key] });
    const tz = new Date().getTimezoneOffset();
    const shuffledKeys = s.keyLayout !== 'gojuon';
    const method = this.methodSetting();
    const items = [
      { label: 'Download progress PDF', icon: 'download', href: `${this.ctx.api.tests.reportUrl(this.testId)}?tz=${tz}`, download: true },
      { label: 'End test', icon: 'flag', danger: true, onClick: () => this.endTest() },
      { divider: true },
      { heading: 'Answer with' },
      ...INPUT_METHODS.map((m) => ({ label: METHOD_LABELS[m], radio: true, checked: method === m, onClick: () => this.chooseMethod(m) })),
      { divider: true },
      { heading: 'Practice options' },
      { label: 'Sound', icon: s.sound ? 'volume' : 'volume-off', checked: s.sound, onClick: toggle('sound') },
      { label: 'Romaji on keys', icon: 'type', checked: s.showRomajiOnKeys, onClick: toggle('showRomajiOnKeys') },
      {
        label: 'Shuffle keys', icon: 'refresh', checked: shuffledKeys,
        onClick: () => this.store.updateSettings({ keyLayout: shuffledKeys ? 'gojuon' : 'shuffled' }),
      },
      {
        label: h('span', { class: 'menu-item-stack' }, 'Romaji column labels',
          shuffledKeys ? h('span', { class: 'menu-item-hint' }, 'Turn off Shuffle keys to use column labels') : null),
        icon: 'grid',
        checked: Boolean(s.showKeyHeaders) && !shuffledKeys,
        disabled: shuffledKeys,
        onClick: toggle('showKeyHeaders'),
      },
      { label: 'Romaji typing', icon: 'wand', checked: s.romajiInput, onClick: toggle('romajiInput') },
      { label: 'Strict handwriting', icon: 'target', checked: Boolean(s.handwritingStrict), onClick: toggle('handwritingStrict') },
    ];
    if (this.listen) {
      items.push({ label: 'Play words automatically', icon: 'play', checked: Boolean(s.listenAutoplay), onClick: toggle('listenAutoplay') });
    }
    return items;
  }

  /** Confirm, close the test and show the results. */
  async endTest() {
    const { test } = this.session;
    const answered = test.answeredCount ?? 0;
    const left = test.totalQuestions - answered;
    const ok = await confirmDialog({
      title: 'End this test?',
      message: answered
        ? `You've answered ${answered} of ${test.totalQuestions} words. The ${left} remaining word${left === 1 ? '' : 's'} won't be scored, and the test can't be resumed.`
        : "You haven't answered any words yet. The test will be closed and can't be resumed.",
      confirmLabel: 'End test',
      cancelLabel: 'Keep practising',
      danger: true,
    });
    if (!ok || this.destroyed) return;
    try {
      await this.session.close();
      this.finish();
    } catch (err) {
      this.reportError(err, 'The test could not be ended.', () => this.endTest());
    }
  }

  /**
   * Global shortcuts (SPEC §12.4, §15.2): Enter, Alt+1 (script hint), Alt+2 (reveal next letter),
   * Alt+3 (romaji hint), Alt+P (play the word), Alt+S (skip), Alt+K (toggle keyboard script), and
   * Space to replay in listen mode when not typing.
   */
  onKeydown(e) {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    if (document.querySelector('dialog[open], .menu')) return;
    const { phase } = this.session;
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.code === 'KeyP') {
        e.preventDefault();
        if (this.listen && !e.repeat) this.playWord();
        return;
      }
      const actions = {
        Digit1: () => this.useScriptHint(),
        Numpad1: () => this.useScriptHint(),
        Digit2: () => this.useGuide(),
        Numpad2: () => this.useGuide(),
        Digit3: () => this.useRomajiHint(),
        Numpad3: () => this.useRomajiHint(),
        KeyS: () => this.skip(),
        KeyK: () => this.keyboard.toggleScript(),
      };
      const run = actions[e.code];
      if (!run) return;
      e.preventDefault();
      if (phase === PHASE.QUESTION && !e.repeat) run();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // A held Enter must not run through check, next word and the next check.
    if (e.key === 'Enter' && e.repeat) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && !isInteractive(e.target)) {
      e.preventDefault();
      this.primaryAction();
      return;
    }
    if (e.key === ' ' && this.listen && !isInteractive(e.target)) {
      e.preventDefault();
      if (!e.repeat) this.playWord();
      return;
    }
    // Typing anywhere on the page goes into the answer field (when it accepts typing).
    if (phase === PHASE.QUESTION && e.key.length === 1 && !isInteractive(e.target)) this.input.focus();
  }

  /** React to session events that originate outside a user action. */
  onSessionEvent(e) {
    if (this.destroyed) return;
    if (e.type === 'inactive') {
      toast('This test has already finished.', { type: 'info' });
      this.ctx.navigate(`/results/${encodeURIComponent(this.testId)}`, { replace: true });
    } else if (e.type === 'stale') {
      toast('This test moved on in another tab. Here is the current word.', { type: 'info' });
      this.header.update(this.session.test);
      this.showQuestion({ animate: true });
    }
  }

  /** Tear everything down (router cleanup). */
  destroy() {
    this.destroyed = true;
    stopSpeech();
    this.virtualTip?.close();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const off of this.disposers) off();
    this.timer.destroy();
    this.keyboard?.destroy();
    this.pad?.destroy();
    this.pad = null;
    this.header?.destroy();
    this.feedback?.hide();
  }
}
