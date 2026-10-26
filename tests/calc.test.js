// Тести розрахунків: бюджет, вільний і загублений час, «не встигнеш»,
// північ, переведення годинника, накладання справ.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { T, C, H, M, SCHEDULE, at, timed, untimed } = require('./helpers.js');

const DAY = '2026-10-26'; // понеділок
const NEXT = '2026-10-27';

describe('бюджет дня', () => {
  test('07:00–23:00 — це 16 годин', () => {
    assert.equal(C.dayBudget(SCHEDULE, DAY), 16 * H);
  });

  test('відбій 00:00 означає опівніч: 07:00–00:00 — це 17 годин', () => {
    const schedule = [{ from: '2000-01-01', wake: '07:00', sleep: '00:00' }];
    assert.equal(C.dayBudget(schedule, DAY), 17 * H);
  });

  test('новий розклад діє від свого дня, минулі дні не змінюються', () => {
    const schedules = [...SCHEDULE, { from: DAY, wake: '08:00', sleep: '23:00' }];
    assert.equal(C.dayBudget(schedules, '2026-10-25'), 16 * H);
    assert.equal(C.dayBudget(schedules, DAY), 15 * H);
    assert.equal(C.dayBudget(schedules, NEXT), 15 * H);
  });

  test('розклад перевіряється: відбій має бути пізніше за підйом', () => {
    assert.equal(C.scheduleError('07:00', '23:00'), null);
    assert.equal(C.scheduleError('07:00', '00:00'), null);
    assert.match(C.scheduleError('23:00', '07:00'), /пізніше за підйом/);
    assert.match(C.scheduleError('07:00', '07:00'), /пізніше за підйом/);
    assert.match(C.scheduleError('сьома', '23:00'), /ГГ:ХХ/);
  });
});

describe('вільний бюджет', () => {
  const NOW = at(DAY, '08:00');

  test('приклад із завдання: 16 − 2 − 4 − 1,5 = 8,5 год', () => {
    const tasks = [
      untimed(DAY, 120, { status: 'done', category: 'food' }),
      untimed(DAY, 240, { category: 'study' }),
      untimed(DAY, 90, { category: 'sport' }),
    ];
    const result = C.freeBudget(SCHEDULE, tasks, DAY, null, NOW);
    assert.equal(result.used, 7.5 * H);
    assert.equal(result.free, 8.5 * H);
  });

  test('виконана справа рахується за фактом, а не за планом', () => {
    const task = untimed(DAY, 240); // планував 4 год
    task.fact = { start: at(DAY, '09:00'), end: at(DAY, '12:00') }; // зробив за 3 год
    assert.equal(C.freeBudget(SCHEDULE, [task], DAY, null, at(DAY, '13:00')).free, 13 * H);
  });

  test('справ більше, ніж бюджет: вільний бюджет стає від’ємним', () => {
    const tasks = [untimed(DAY, 600), untimed(DAY, 480)]; // 10 + 8 = 18 год
    assert.equal(C.freeBudget(SCHEDULE, tasks, DAY, null, NOW).free, -2 * H);
  });

  test('справи інших днів не рахуються', () => {
    const tasks = [untimed('2026-10-25', 120), untimed(NEXT, 120), timed(NEXT, '10:00', '12:00')];
    assert.equal(C.freeBudget(SCHEDULE, tasks, DAY, null, NOW).free, 16 * H);
  });

  test('запущений таймер зменшує бюджет наживо', () => {
    const timer = { categoryId: 'sport', title: '', start: at(DAY, '10:00'), taskId: null };
    assert.equal(C.freeBudget(SCHEDULE, [], DAY, timer, at(DAY, '10:45')).free, 16 * H - 45 * M);
  });

  test('таймер запланованої справи не рахується двічі', () => {
    const task = untimed(DAY, 120); // план — 2 год
    const timer = { categoryId: 'study', title: '', start: at(DAY, '10:00'), taskId: task.id };
    // Поки таймер не перевищив план, рахується план
    assert.equal(C.freeBudget(SCHEDULE, [task], DAY, timer, at(DAY, '11:00')).free, 14 * H);
    // Коли перевищив — рахується реальний час
    assert.equal(C.freeBudget(SCHEDULE, [task], DAY, timer, at(DAY, '12:30')).free, 13.5 * H);
  });
});

describe('«Не встигнеш»', () => {
  test('плану більше, ніж часу до відбою, — є попередження', () => {
    const tasks = [untimed(DAY, 180), untimed(DAY, 120)]; // 5 год плану
    assert.deepEqual(C.overplan(SCHEDULE, tasks, DAY, null, at(DAY, '19:00')), { planned: 5 * H, left: 4 * H });
  });

  test('плану менше, ніж часу, — попередження немає', () => {
    assert.equal(C.overplan(SCHEDULE, [untimed(DAY, 180)], DAY, null, at(DAY, '19:00')), null);
  });

  test('виконані справи в план не входять', () => {
    const tasks = [untimed(DAY, 300, { status: 'done' }), untimed(DAY, 60)];
    assert.equal(C.overplan(SCHEDULE, tasks, DAY, null, at(DAY, '20:00')), null);
  });

  test('після відбою будь-який невиконаний план — «не встигнеш»', () => {
    assert.deepEqual(C.overplan(SCHEDULE, [untimed(DAY, 30)], DAY, null, at(DAY, '23:30')), { planned: 30 * M, left: 0 });
  });

  test('майбутній день: план порівнюється з усім бюджетом дня', () => {
    const now = at(DAY, '12:00');
    assert.equal(C.overplan(SCHEDULE, [untimed(NEXT, 15 * 60)], NEXT, null, now), null);
    assert.deepEqual(C.overplan(SCHEDULE, [untimed(NEXT, 17 * 60)], NEXT, null, now), { planned: 17 * H, left: 16 * H });
  });

  test('минулий день не попереджає', () => {
    assert.equal(C.overplan(SCHEDULE, [untimed(DAY, 600)], DAY, null, at(NEXT, '10:00')), null);
  });
});

describe('загублений час', () => {
  test('о 13:00 минуло 6 год, справами зайнято 5 год — загублено 1 год', () => {
    const tasks = [
      timed(DAY, '07:00', '09:00', { category: 'food' }),
      timed(DAY, '09:00', '12:00', { category: 'study' }),
    ];
    assert.deepEqual(C.lostTime(SCHEDULE, tasks, DAY, null, at(DAY, '13:00')), { lost: 1 * H, elapsed: 6 * H, covered: 5 * H });
  });

  test('справи, що накладаються, не рахуються двічі', () => {
    const tasks = [timed(DAY, '08:00', '10:00'), timed(DAY, '09:00', '11:00')];
    assert.equal(C.lostTime(SCHEDULE, tasks, DAY, null, at(DAY, '11:00')).lost, 1 * H); // 07:00–08:00
  });

  test('заплановані справи не зменшують загублений час', () => {
    const tasks = [timed(DAY, '07:00', '09:00', { status: 'planned' })];
    assert.equal(C.lostTime(SCHEDULE, tasks, DAY, null, at(DAY, '10:00')).lost, 3 * H);
  });

  test('справа без часу зменшує загублений час на свою тривалість', () => {
    const tasks = [untimed(DAY, 90, { status: 'done' })];
    assert.equal(C.lostTime(SCHEDULE, tasks, DAY, null, at(DAY, '10:00')).lost, 1.5 * H);
  });

  test('справа до підйому не зменшує загублений час: день ще не почався', () => {
    const tasks = [timed(DAY, '06:00', '07:30')];
    assert.equal(C.lostTime(SCHEDULE, tasks, DAY, null, at(DAY, '08:00')).lost, 30 * M);
  });

  test('запущений таймер рахується як зайнятий час', () => {
    const timer = { categoryId: 'study', title: '', start: at(DAY, '08:00'), taskId: null };
    assert.equal(C.lostTime(SCHEDULE, [], DAY, timer, at(DAY, '09:00')).lost, 1 * H);
  });

  test('проспав — це загублений час: розклад однаковий щодня', () => {
    const tasks = [timed(DAY, '09:00', '10:00')]; // встав о 09:00 замість 07:00
    assert.equal(C.lostTime(SCHEDULE, tasks, DAY, null, at(DAY, '10:00')).lost, 2 * H);
  });

  test('до підйому — 0, після відбою час більше не накопичується', () => {
    assert.equal(C.lostTime(SCHEDULE, [], DAY, null, at(DAY, '06:00')).lost, 0);
    assert.equal(C.lostTime(SCHEDULE, [], DAY, null, at(DAY, '23:40')).lost, 16 * H);
  });

  test('минулий день рахується повністю, майбутній — ще ні', () => {
    const now = at(NEXT, '10:00');
    const tasks = [timed(DAY, '07:00', '15:00')];
    assert.equal(C.lostTime(SCHEDULE, tasks, DAY, null, now).lost, 8 * H);
    assert.equal(C.lostTime(SCHEDULE, tasks, '2026-10-28', null, now), null);
  });
});

describe('перехід через опівніч', () => {
  const task = timed(DAY, '22:30', '00:30'); // 2 год, з понеділка на вівторок

  test('22:30–00:30: 1,5 год у старий день, 0,5 год — у новий', () => {
    assert.equal(C.slotLength(task.fact), 2 * H);
    assert.equal(C.slotOnDay(task.fact, DAY), 1.5 * H);
    assert.equal(C.slotOnDay(task.fact, NEXT), 30 * M);
  });

  test('новий день починається з мінусом у бюджеті', () => {
    const now = at(NEXT, '06:00');
    assert.equal(C.freeBudget(SCHEDULE, [task], NEXT, null, now).free, 16 * H - 30 * M);
    assert.equal(C.freeBudget(SCHEDULE, [task], DAY, null, now).free, 14.5 * H);
  });

  test('частина після опівночі (ще до підйому) не зменшує загублений час нового дня', () => {
    assert.equal(C.lostTime(SCHEDULE, [task], NEXT, null, at(NEXT, '08:00')).lost, 1 * H);
  });

  test('справа є в списках обох днів', () => {
    assert.deepEqual(C.tasksForDay([task], DAY).map((t) => t.id), [task.id]);
    assert.deepEqual(C.tasksForDay([task], NEXT).map((t) => t.id), [task.id]);
    assert.deepEqual(C.tasksForDay([task], '2026-10-28'), []);
  });

  test('справа, що закінчується рівно опівночі, повністю належить своєму дню', () => {
    const late = timed(DAY, '22:00', '00:00');
    assert.equal(C.slotOnDay(late.fact, DAY), 2 * H);
    assert.equal(C.slotOnDay(late.fact, NEXT), 0);
  });

  test('таймер, що йде через опівніч, ділиться між днями', () => {
    const timer = { categoryId: 'study', title: '', start: at(DAY, '23:30'), taskId: null };
    const now = at(NEXT, '00:20');
    assert.equal(C.usedOnDay([], DAY, timer, now), 30 * M);
    assert.equal(C.usedOnDay([], NEXT, timer, now), 20 * M);
  });
});

describe('перехід на літній і зимовий час (Europe/Warsaw)', () => {
  test('25.10.2026 годинник переводять назад: доба триває 25 годин', () => {
    assert.equal(T.dayEnd('2026-10-25') - T.dayStart('2026-10-25'), 25 * H);
  });

  test('29.03.2026 годинник переводять уперед: доба триває 23 години', () => {
    assert.equal(T.dayEnd('2026-03-29') - T.dayStart('2026-03-29'), 23 * H);
  });

  test('бюджет 07:00–23:00 у ці дні все одно 16 годин', () => {
    assert.equal(C.dayBudget(SCHEDULE, '2026-10-25'), 16 * H);
    assert.equal(C.dayBudget(SCHEDULE, '2026-03-29'), 16 * H);
  });

  test('нічна справа 01:00–05:00 триває 5 год восени і 3 год навесні', () => {
    assert.equal(C.slotLength(timed('2026-10-25', '01:00', '05:00').fact), 5 * H);
    assert.equal(C.slotLength(timed('2026-03-29', '01:00', '05:00').fact), 3 * H);
  });

  test('якщо день починається вночі, бюджет показує реальні години', () => {
    const early = [{ from: '2000-01-01', wake: '01:00', sleep: '23:00' }]; // 22 год «на папері»
    assert.equal(C.dayBudget(early, '2026-10-25'), 23 * H);
    assert.equal(C.dayBudget(early, '2026-03-29'), 21 * H);
  });

  test('справа через опівніч у ніч переведення годинника ділиться правильно', () => {
    const task = timed('2026-10-24', '23:00', '04:00'); // о 03:00 годинник іде на 02:00
    assert.equal(C.slotLength(task.fact), 6 * H);
    assert.equal(C.slotOnDay(task.fact, '2026-10-24'), 1 * H);
    assert.equal(C.slotOnDay(task.fact, '2026-10-25'), 5 * H);
  });
});

describe('накладання справ', () => {
  const NOW = at(DAY, '20:00');

  test('дві справи, що перетинаються, знаходяться разом зі спільним часом', () => {
    const a = timed(DAY, '10:00', '12:00');
    const b = timed(DAY, '11:30', '13:00');
    assert.deepEqual(C.overlaps([a, b], DAY, null, NOW), [{ a: a.id, b: b.id, start: at(DAY, '11:30'), end: at(DAY, '12:00') }]);
  });

  test('справи «встик» не накладаються', () => {
    const tasks = [timed(DAY, '10:00', '12:00'), timed(DAY, '12:00', '13:00')];
    assert.deepEqual(C.overlaps(tasks, DAY, null, NOW), []);
  });

  test('справи без часу не перевіряються', () => {
    const tasks = [untimed(DAY, 120), timed(DAY, '10:00', '12:00')];
    assert.deepEqual(C.overlaps(tasks, DAY, null, NOW), []);
  });

  test('план, що збігся в часі з виконаною справою, теж помічається', () => {
    const tasks = [timed(DAY, '18:00', '19:00', { status: 'planned' }), timed(DAY, '17:30', '19:30')];
    assert.equal(C.overlaps(tasks, DAY, null, NOW).length, 1);
  });

  test('накладання після опівночі показується в тому дні, де воно сталося', () => {
    const a = timed(DAY, '23:00', '01:00');
    const b = timed(NEXT, '00:30', '02:00');
    const now = at(NEXT, '12:00');
    assert.deepEqual(C.overlaps([a, b], DAY, null, now), []);
    assert.equal(C.overlaps([a, b], NEXT, null, now).length, 1);
  });

  test('таймер, що йде поверх виконаної справи, — це накладання', () => {
    const task = timed(DAY, '10:00', '11:00');
    const timer = { categoryId: 'sport', title: '', start: at(DAY, '10:30'), taskId: null };
    assert.deepEqual(C.overlaps([task], DAY, timer, at(DAY, '10:45')).map((o) => [o.a, o.b]), [[task.id, 'timer']]);
  });

  test('таймер, запущений для запланованої справи, не конфліктує з її планом', () => {
    const task = timed(DAY, '10:00', '12:00', { status: 'planned' });
    const timer = { categoryId: 'study', title: '', start: at(DAY, '10:05'), taskId: task.id };
    assert.deepEqual(C.overlaps([task], DAY, timer, at(DAY, '11:00')), []);
  });
});
