// Тести таймера, шкали дня і перевірки накладання під час збереження.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { C, S, H, M, SCHEDULE, at, timed, untimed } = require('./helpers.js');

const DAY = '2026-10-26'; // понеділок
const NEXT = '2026-10-27';
const SECOND = 1000;

function timerAt(start, extra = {}) {
  return { categoryId: 'study', title: '', start, taskId: null, ...extra };
}

describe('таймер', () => {
  test('зупинка округлює початок і кінець до хвилин', () => {
    const timer = timerAt(at(DAY, '10:05') + 40 * SECOND);
    const result = C.timerResult([], timer, at(DAY, '11:20') + 10 * SECOND);
    assert.deepEqual(result, { slot: { start: at(DAY, '10:06'), end: at(DAY, '11:20') }, taskId: null });
  });

  test('таймер, що йшов менше хвилини, нічого не записує', () => {
    const timer = timerAt(at(DAY, '10:00'));
    assert.equal(C.timerResult([], timer, at(DAY, '10:00') + 25 * SECOND), null);
  });

  test('таймер запланованої справи записує факт саме в неї', () => {
    const task = untimed(DAY, 120);
    const timer = timerAt(at(DAY, '10:00'), { taskId: task.id });
    assert.equal(C.timerResult([task], timer, at(DAY, '11:30')).taskId, task.id);
  });

  test('якщо справу вже позначено виконаною, таймер записує нову справу', () => {
    const task = untimed(DAY, 120, { status: 'done' });
    const timer = timerAt(at(DAY, '10:00'), { taskId: task.id });
    assert.equal(C.timerResult([task], timer, at(DAY, '11:30')).taskId, null);
  });

  test('таймер через опівніч: 23:30–00:30 ділиться навпіл між днями', () => {
    const { slot } = C.timerResult([], timerAt(at(DAY, '23:30')), at(NEXT, '00:30'));
    assert.equal(C.slotOnDay(slot, DAY), 30 * M);
    assert.equal(C.slotOnDay(slot, NEXT), 30 * M);
  });
});

describe('забутий таймер', () => {
  test('запустили ввечері, а відкрили вранці — пропонуємо зупинити у відбій', () => {
    const timer = timerAt(at(DAY, '21:00'));
    assert.equal(C.suggestTimerEnd(SCHEDULE, timer, at(NEXT, '08:00')), at(DAY, '23:00'));
  });

  test('відбій ще не настав — пропонуємо «зараз»', () => {
    const timer = timerAt(at(DAY, '10:05'));
    assert.equal(C.suggestTimerEnd(SCHEDULE, timer, at(DAY, '13:25')), at(DAY, '13:25'));
  });

  test('таймер запустили вже після відбою — пропонуємо «зараз»', () => {
    const timer = timerAt(at(DAY, '23:30'));
    assert.equal(C.suggestTimerEnd(SCHEDULE, timer, at(NEXT, '08:00')), at(NEXT, '08:00'));
  });

  test('час зупинки перевіряється', () => {
    const timer = timerAt(at(DAY, '10:00'));
    const now = at(DAY, '12:00');
    assert.equal(C.timerEndError(timer, at(DAY, '11:00'), now, S.MAX_SLOT), null);
    assert.match(C.timerEndError(timer, at(DAY, '09:00'), now, S.MAX_SLOT), /пізніше за початок/);
    assert.match(C.timerEndError(timer, at(DAY, '13:00'), now, S.MAX_SLOT), /ще не настав/);
    assert.match(C.timerEndError(timer, at('2026-11-05', '10:00'), at('2026-11-06', '10:00'), S.MAX_SLOT), /7 днів/);
    assert.match(C.timerEndError(timer, NaN, now, S.MAX_SLOT), /Вкажи/);
  });
});

describe('накладання під час збереження', () => {
  const NOW = at(DAY, '20:00');

  test('знаходить справу, з якою перетнеться новий час, і спільний проміжок', () => {
    const study = timed(DAY, '09:00', '12:00');
    const conflicts = C.slotConflicts([study], { start: at(DAY, '11:00'), end: at(DAY, '12:30') }, null, null, NOW);
    assert.deepEqual(conflicts, [{ id: study.id, start: at(DAY, '11:00'), end: at(DAY, '12:00') }]);
  });

  test('справа не конфліктує сама з собою (коли її редагують)', () => {
    const study = timed(DAY, '09:00', '12:00');
    assert.deepEqual(C.slotConflicts([study], { start: at(DAY, '10:00'), end: at(DAY, '12:00') }, study.id, null, NOW), []);
  });

  test('запущений таймер теж враховується', () => {
    const timer = timerAt(at(DAY, '19:00'));
    const conflicts = C.slotConflicts([], { start: at(DAY, '19:30'), end: at(DAY, '20:30') }, null, timer, NOW);
    assert.deepEqual(conflicts.map((c) => c.id), ['timer']);
  });

  test('справа без часу ні з чим не конфліктує', () => {
    assert.deepEqual(C.slotConflicts([timed(DAY, '09:00', '12:00')], { day: DAY, minutes: 60 }, null, null, NOW), []);
  });
});

describe('шкала дня', () => {
  const NOW = at(DAY, '13:00');

  test('звичайний день: від підйому до відбою', () => {
    assert.deepEqual(C.timelineRange(SCHEDULE, [], DAY, null, NOW), { from: at(DAY, '07:00'), to: at(DAY, '23:00') });
  });

  test('справа до підйому розширює шкалу до цілої години', () => {
    const tasks = [timed(DAY, '06:20', '07:30')];
    assert.equal(C.timelineRange(SCHEDULE, tasks, DAY, null, NOW).from, at(DAY, '06:00'));
  });

  test('справа через опівніч: шкала до 24:00, а наступного дня — від 00:00', () => {
    const tasks = [timed(DAY, '22:30', '00:30')];
    assert.equal(C.timelineRange(SCHEDULE, tasks, DAY, null, NOW).to, at(NEXT, '00:00'));
    assert.equal(C.timelineRange(SCHEDULE, tasks, NEXT, null, NOW).from, at(NEXT, '00:00'));
    const [today] = C.timelineItems(tasks, DAY, null, NOW);
    const [tomorrow] = C.timelineItems(tasks, NEXT, null, NOW);
    assert.equal(today.cutEnd, true);
    assert.equal(tomorrow.cutStart, true);
    assert.equal(tomorrow.end - tomorrow.start, 30 * M);
  });

  test('справи, що накладаються, стоять на різних доріжках', () => {
    const a = timed(DAY, '09:00', '12:00');
    const b = timed(DAY, '11:00', '12:30');
    const c = timed(DAY, '13:00', '14:00');
    const lanes = Object.fromEntries(C.timelineItems([a, b, c], DAY, null, NOW).map((i) => [i.id, i.lane]));
    assert.deepEqual(lanes, { [a.id]: 0, [b.id]: 1, [c.id]: 0 });
  });

  test('виконані, заплановані й запущений таймер розрізняються', () => {
    const done = timed(DAY, '08:00', '09:00');
    const planned = timed(DAY, '18:00', '19:00', { status: 'planned' });
    const timer = timerAt(at(DAY, '12:00'));
    const kinds = C.timelineItems([done, planned], DAY, timer, NOW).map((i) => i.kind);
    assert.deepEqual(kinds, ['done', 'running', 'planned']);
  });

  test('щойно запущений таймер уже видно на шкалі', () => {
    const items = C.timelineItems([], DAY, timerAt(NOW), NOW);
    assert.deepEqual(items.map((i) => [i.kind, i.end - i.start]), [['running', 0]]);
    // а в інші дні його немає
    assert.deepEqual(C.timelineItems([], NEXT, timerAt(NOW), NOW), []);
  });

  test('для справи з запущеним таймером план не дублюється', () => {
    const task = timed(DAY, '18:00', '19:00', { status: 'planned' });
    const timer = timerAt(at(DAY, '12:00'), { taskId: task.id });
    const items = C.timelineItems([task], DAY, timer, NOW);
    assert.deepEqual(items.map((i) => [i.id, i.kind]), [[task.id, 'running']]);
  });

  test('справи без часу на шкалі не малюються', () => {
    assert.deepEqual(C.timelineItems([untimed(DAY, 120)], DAY, null, NOW), []);
  });

  test('підписи годин: що вужчий екран, то рідше', () => {
    assert.equal(C.pickTickStep(16, 1000), 1); // широкий екран — кожна година
    assert.equal(C.pickTickStep(16, 600), 2);
    assert.equal(C.pickTickStep(16, 320), 3); // телефон
    assert.equal(C.pickTickStep(16, 256), 4); // найвужчий телефон (320 px)
    assert.equal(C.pickTickStep(24, 250), 6);
  });

  test('шкала у день переведення годинника рахує реальні години', () => {
    const range = C.timelineRange(SCHEDULE, [timed('2026-10-25', '01:00', '05:00')], '2026-10-25', null, at('2026-10-26', '10:00'));
    assert.equal(range.from, at('2026-10-25', '01:00'));
    assert.equal(range.to - range.from, 23 * H); // 01:00–23:00 за годинником, але доба на годину довша
  });
});
