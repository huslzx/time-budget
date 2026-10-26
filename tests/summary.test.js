// Тести підсумків дня й тижня.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { T, C, H, M, SCHEDULE, at, timed, untimed } = require('./helpers.js');

const MON = '2026-10-26'; // понеділок
const TUE = '2026-10-27';
const SUN = '2026-11-01'; // неділя — кінець тижня 26.10–01.11

// Скорочення: рядок підсумку → [категорія, факт у хв, план у хв]
const short = (rows) => rows.map((r) => [r.categoryId, r.fact / M, r.plan / M]);

describe('підсумок дня', () => {
  const NOW = at(MON, '20:00');

  test('по категоріях: зроблено й заплановано', () => {
    const sportTask = untimed(MON, 60, { category: 'sport' }); // план 1 год…
    sportTask.fact = { day: MON, minutes: 90 }; // …а зроблено 1,5 год
    const tasks = [
      timed(MON, '09:00', '12:00', { category: 'study' }), // зроблено 3 год
      untimed(MON, 240, { category: 'study' }), // план 4 год
      sportTask,
      untimed(MON, 120, { category: 'work' }), // план 2 год, не зроблено
    ];
    const day = C.daySummary(SCHEDULE, tasks, MON, null, NOW);
    assert.deepEqual(short(day.rows), [['study', 180, 240], ['sport', 90, 60], ['work', 0, 120]]);
    assert.equal(day.fact, 4.5 * H);
    assert.equal(day.plan, 7 * H);
    assert.equal(day.budget, 16 * H);
  });

  test('відсоток від бюджету дня округлюється', () => {
    assert.equal(C.percentOf(3 * H, 16 * H), 19); // 18,75 %
    assert.equal(C.percentOf(90 * M, 16 * H), 9); // 9,375 %
    assert.equal(C.percentOf(5, 0), 0);
  });

  test('запущений таймер рахується як зроблене', () => {
    const timer = { categoryId: 'rest', title: '', start: at(MON, '19:30'), taskId: null };
    assert.deepEqual(short(C.daySummary(SCHEDULE, [], MON, timer, NOW).rows), [['rest', 30, 0]]);
  });

  test('день без жодної справи: порожній список, а загублений — увесь минулий день', () => {
    const past = C.daySummary(SCHEDULE, [], MON, null, at(TUE, '10:00'));
    assert.deepEqual(past.rows, []);
    assert.equal(past.fact, 0);
    assert.equal(past.lost, 16 * H);
    const future = C.daySummary(SCHEDULE, [], TUE, null, NOW);
    assert.equal(future.lost, null);
    assert.equal(future.phase, 'future');
  });

  test('справа через північ ділиться між днями й позначається', () => {
    const tasks = [timed(MON, '22:30', '00:30', { category: 'rest' })];
    const now = at(TUE, '12:00');
    const mon = C.daySummary(SCHEDULE, tasks, MON, null, now);
    const tue = C.daySummary(SCHEDULE, tasks, TUE, null, now);
    assert.deepEqual(short(mon.rows), [['rest', 90, 0]]);
    assert.deepEqual(short(tue.rows), [['rest', 30, 0]]);
    assert.equal(mon.split, true);
    assert.equal(tue.split, true);
    assert.equal(C.daySummary(SCHEDULE, [timed(MON, '10:00', '11:00')], MON, null, now).split, false);
  });
});

describe('підсумок тижня', () => {
  const NOW = at(SUN, '20:00');

  test('сім днів, що закінчуються обраним днем', () => {
    const week = C.weekSummary(SCHEDULE, [], SUN, null, NOW);
    assert.deepEqual(week.days.map((d) => d.key), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  });

  test('лише кілька днів із даними: середнє — за ці дні, а не за 7', () => {
    const tasks = [
      timed(MON, '09:00', '13:00', { category: 'study' }), // 4 год
      timed('2026-10-28', '09:00', '11:00', { category: 'study' }), // 2 год
      timed('2026-10-28', '18:00', '19:00', { category: 'sport' }), // 1 год
      untimed('2026-10-30', 120, { category: 'work' }), // лише план — день без записів
    ];
    const week = C.weekSummary(SCHEDULE, tasks, SUN, null, NOW);
    assert.equal(week.recordedDays, 2);
    assert.equal(week.fact, 7 * H);
    assert.equal(week.plan, 2 * H);
    assert.equal(week.averageFact, 3.5 * H);
    const study = week.rows.find((r) => r.categoryId === 'study');
    assert.equal(study.fact, 6 * H);
    assert.equal(study.average, 3 * H);
    const work = week.rows.find((r) => r.categoryId === 'work');
    assert.deepEqual([work.fact, work.plan, work.average], [0, 2 * H, 0]);
  });

  test('тиждень без даних: нулі, а не помилка', () => {
    const week = C.weekSummary(SCHEDULE, [], SUN, null, NOW);
    assert.equal(week.recordedDays, 0);
    assert.equal(week.averageFact, 0);
    assert.equal(week.averageLost, null);
    assert.deepEqual(week.rows, []);
  });

  test('загублений час у середньому — лише за дні із записами', () => {
    const tasks = [
      timed(MON, '07:00', '21:00'), // загублено 2 год
      timed(TUE, '07:00', '23:00'), // загублено 0
    ];
    const week = C.weekSummary(SCHEDULE, tasks, SUN, null, NOW);
    assert.equal(week.averageLost, 1 * H);
  });

  test('справа через північ усередині тижня рахується повністю, по частинах у кожен день', () => {
    const week = C.weekSummary(SCHEDULE, [timed('2026-10-29', '23:00', '01:00')], SUN, null, NOW);
    assert.equal(week.fact, 2 * H);
    assert.deepEqual(week.days.map((d) => d.fact / M), [0, 0, 0, 60, 60, 0, 0]);
    assert.equal(week.recordedDays, 2);
  });

  test('справа, що почалась до цього тижня, рахується лише своєю частиною в ньому', () => {
    const week = C.weekSummary(SCHEDULE, [timed('2026-10-25', '23:00', '01:00')], SUN, null, NOW);
    assert.equal(week.fact, 1 * H);
  });
});

describe('графік тижня', () => {
  test('шкала: круглі числа з запасом', () => {
    assert.deepEqual(C.chartScale(16 * H), { top: 16 * H, step: 4 * H });
    assert.deepEqual(C.chartScale(16.5 * H), { top: 20 * H, step: 4 * H });
    assert.deepEqual(C.chartScale(6 * H), { top: 6 * H, step: 2 * H });
    assert.deepEqual(C.chartScale(0), { top: 2 * H, step: 2 * H });
    assert.deepEqual(C.chartScale(30 * H), { top: 32 * H, step: 8 * H });
  });
});

describe('підписи', () => {
  test('проміжок днів', () => {
    assert.equal(T.formatDayRange('2026-10-20', '2026-10-26', '2026-10-26'), '20–26 жовтня');
    assert.equal(T.formatDayRange('2026-09-28', '2026-10-04', '2026-10-26'), '28 вересня – 4 жовтня');
    assert.equal(T.formatDayRange('2026-12-29', '2027-01-04', '2027-01-04'), '29 грудня 2026 – 4 січня 2027');
  });

  test('українська множина', () => {
    const days = (n) => n + ' ' + T.plural(n, 'день', 'дні', 'днів');
    assert.deepEqual([1, 2, 4, 5, 11, 12, 21, 22, 25].map(days),
      ['1 день', '2 дні', '4 дні', '5 днів', '11 днів', '12 днів', '21 день', '22 дні', '25 днів']);
  });
});
