import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GRADES, gradeFor, questionPoints, ratio, round3, testMetrics } from '../server/services/scoring.js';

describe('questionPoints (SPEC §8)', () => {
  const cases = [
    // [description, input, expected]
    ['wrong → 0', { status: 'wrong', len: 4 }, 0],
    ['skipped → 0', { status: 'skipped', len: 4 }, 0],
    ['wrong with hints → 0', { status: 'wrong', hint1Used: true, hint2Used: true, hint2Revealed: 4, len: 4 }, 0],
    ['clean correct → 100', { status: 'correct', len: 4 }, 100],
    ['script hint → 80', { status: 'correct', hint1Used: true, len: 4 }, 80],
    ['guide, nothing revealed → min penalty 10 → 90', { status: 'correct', hint2Used: true, hint2Revealed: 0, len: 4 }, 90],
    ['guide, 1 of 4 revealed → round(15) → 85', { status: 'correct', hint2Used: true, hint2Revealed: 1, len: 4 }, 85],
    ['guide, 2 of 4 revealed → 30 → 70', { status: 'correct', hint2Used: true, hint2Revealed: 2, len: 4 }, 70],
    ['guide, 1 of 7 revealed → round(8.57)=9 → min 10 → 90', { status: 'correct', hint2Used: true, hint2Revealed: 1, len: 7 }, 90],
    ['guide, 1 of 3 revealed → 20 → 80', { status: 'correct', hint2Used: true, hint2Revealed: 1, len: 3 }, 80],
    ['guide, 2 of 3 revealed → 40 → 60', { status: 'correct', hint2Used: true, hint2Revealed: 2, len: 3 }, 60],
    ['guide, 1 of 8 revealed → round(7.5)=8 → min 10 → 90', { status: 'correct', hint2Used: true, hint2Revealed: 1, len: 8 }, 90],
    ['guide, 3 of 8 revealed → round(22.5)=23 → 77', { status: 'correct', hint2Used: true, hint2Revealed: 3, len: 8 }, 77],
    ['guide, all revealed → 60 → 40', { status: 'correct', hint2Used: true, hint2Revealed: 4, len: 4 }, 40],
    ['both hints, all revealed → 80 → 20', { status: 'correct', hint1Used: true, hint2Used: true, hint2Revealed: 5, len: 5 }, 20],
    ['both hints, half revealed → 20 + 30 → 50', { status: 'correct', hint1Used: true, hint2Used: true, hint2Revealed: 2, len: 4 }, 50],
    ['both hints, none revealed → 20 + 10 → 70', { status: 'correct', hint1Used: true, hint2Used: true, hint2Revealed: 0, len: 4 }, 70],
    ['revealed above len is capped at 60 penalty', { status: 'correct', hint2Used: true, hint2Revealed: 99, len: 4 }, 40],
    ['hint2Revealed ignored without hint 2', { status: 'correct', hint2Used: false, hint2Revealed: 4, len: 4 }, 100],
    // SPEC §15.2: + 30·romajiHint + 30·variant
    ['romaji hint → 70', { status: 'correct', romajiHintUsed: true, len: 4 }, 70],
    ['variant spelling → 70', { status: 'correct', variant: true, len: 4 }, 70],
    ['romaji hint + variant → 40', { status: 'correct', romajiHintUsed: true, variant: true, len: 4 }, 40],
    ['script hint + romaji hint → 50', { status: 'correct', hint1Used: true, romajiHintUsed: true, len: 4 }, 50],
    ['all hints + variant floor at 10', { status: 'correct', hint1Used: true, hint2Used: true, hint2Revealed: 1, romajiHintUsed: true, variant: true, len: 4 }, 10],
    ['romaji hint + guide half → 30 + 30 → 40', { status: 'correct', hint2Used: true, hint2Revealed: 2, romajiHintUsed: true, len: 4 }, 40],
    ['wrong with romaji hint → 0', { status: 'wrong', romajiHintUsed: true, len: 4 }, 0],
    ['variant flag ignored when not correct', { status: 'wrong', variant: true, len: 4 }, 0],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => assert.equal(questionPoints(input), expected));
  }

  it('never goes below the minimum of 10 for a correct answer', () => {
    for (let len = 1; len <= 9; len += 1) {
      for (let revealed = 0; revealed <= len; revealed += 1) {
        for (const hint1Used of [false, true]) {
          for (const extra of [false, true]) {
            const p = questionPoints({ status: 'correct', hint1Used, hint2Used: true, hint2Revealed: revealed, len,
              romajiHintUsed: extra, variant: extra });
            assert.ok(p >= 10 && p <= 100, `len ${len} revealed ${revealed}: ${p}`);
          }
        }
      }
    }
  });

  it('is monotonic: revealing more never earns more', () => {
    for (let len = 1; len <= 9; len += 1) {
      let prev = Infinity;
      for (let revealed = 0; revealed <= len; revealed += 1) {
        const p = questionPoints({ status: 'correct', hint2Used: true, hint2Revealed: revealed, len });
        assert.ok(p <= prev);
        prev = p;
      }
    }
  });
});

describe('gradeFor', () => {
  const cases = [
    [1, 'S'], [0.95, 'S'], [0.9499, 'A'], [0.85, 'A'], [0.8499, 'B'], [0.7, 'B'], [0.6999, 'C'],
    [0.5, 'C'], [0.4999, 'D'], [0, 'D'],
  ];
  for (const [pct, grade] of cases) {
    it(`${pct} → ${grade}`, () => assert.equal(gradeFor(pct), grade));
  }
  it('null when nothing answered', () => {
    assert.equal(gradeFor(null), null);
    assert.equal(gradeFor(undefined), null);
  });
  it('exposes kanji for each grade', () => {
    assert.deepEqual(GRADES.map((g) => `${g.grade}${g.kanji}`), ['S秀', 'A優', 'B良', 'C可', 'D不可']);
  });
});

describe('ratios and test metrics', () => {
  it('round3 / ratio', () => {
    assert.equal(round3(5 / 7), 0.714);
    assert.equal(ratio(5, 7), 0.714);
    assert.equal(ratio(3, 0), 0);
  });

  it('matches the SPEC §7.1 TestSummary example', () => {
    const m = testMetrics({ totalQuestions: 20, score: 560, correct: 5, wrong: 1, skipped: 1 });
    assert.deepEqual(m, {
      answered: 7, accuracy: 0.714, maxScore: 2000, answeredMaxScore: 700, scorePercent: 0.8, grade: 'B',
    });
  });

  it('grade uses the unrounded ratio and is null with no answers', () => {
    assert.equal(testMetrics({ totalQuestions: 10, score: 0, correct: 0, wrong: 0, skipped: 0 }).grade, null);
    assert.equal(testMetrics({ totalQuestions: 10, score: 0, correct: 0, wrong: 0, skipped: 0 }).scorePercent, 0);
    // 1899/2000 = 0.9495 rounds to 0.95 for display but is still an A.
    const m = testMetrics({ totalQuestions: 20, score: 1899, correct: 20, wrong: 0, skipped: 0 });
    assert.equal(m.scorePercent, 0.95);
    assert.equal(m.grade, 'A');
    assert.equal(testMetrics({ totalQuestions: 20, score: 1900, correct: 20, wrong: 0, skipped: 0 }).grade, 'S');
  });
});
