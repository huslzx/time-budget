/*
 * Бюджет часу — розрахунки.
 *
 * Тут лише «чисті» функції: вони отримують дані й повертають результат,
 * нічого не змінюють і не чіпають сторінку. Тому їх легко перевірити
 * автоматичними тестами (папка tests).
 *
 * Справа:   { id, categoryId, title, plan, fact }
 *           plan — як планувалось, fact — як було насправді.
 *           Є fact → справа виконана.
 * Відрізок: { start, end }   — з точним часом (моменти в мс);
 *           { day, minutes } — лише тривалість, без конкретного часу.
 * Таймер:   { categoryId, title, start, taskId } або null.
 *           taskId — запланована справа, для якої запущено таймер.
 *
 * Справа з часом, що переходить через опівніч, ділиться між днями:
 * частина до 00:00 належить старому дню, решта — новому.
 */
(function () {
  'use strict';
  const TB = (globalThis.TB = globalThis.TB || {});
  const T = TB.time;

  /* ---------- Розклад: підйом, відбій, бюджет ---------- */

  // schedules — список { from, wake, sleep }, відсортований за from.
  // Для дня діє останній запис, що почав діяти не пізніше цього дня,
  // тож зміна розкладу не переписує минулі дні.
  function scheduleFor(schedules, key) {
    let result = schedules[0];
    for (const item of schedules) {
      if (item.from <= key) result = item;
    }
    return result;
  }

  // Відбій '00:00' означає опівніч у кінці дня
  function sleepMinutes(sleep) {
    const m = T.parseHM(sleep);
    return m === 0 ? 1440 : m;
  }

  function scheduleError(wake, sleep) {
    const w = T.parseHM(wake);
    const s = T.parseHM(sleep);
    if (Number.isNaN(w) || Number.isNaN(s)) return 'Вкажи час у форматі ГГ:ХХ, наприклад 07:00.';
    if (sleepMinutes(sleep) <= w) {
      return 'Відбій має бути пізніше за підйом. Найпізніший відбій — 00:00, тобто опівночі.';
    }
    return null;
  }

  // Підйом і відбій дня key як моменти часу
  function dayWindow(schedules, key) {
    const item = scheduleFor(schedules, key);
    return {
      wake: T.atMinutes(key, T.parseHM(item.wake)),
      sleep: T.atMinutes(key, sleepMinutes(item.sleep)),
    };
  }

  // Бюджет дня — від підйому до відбою, у реальному часі
  // (з урахуванням переведення годинника, якщо воно випало на цей проміжок)
  function dayBudget(schedules, key) {
    const w = dayWindow(schedules, key);
    return w.sleep - w.wake;
  }

  // Бюджет за розкладом «на папері» — для підказки в налаштуваннях
  function plainBudget(wake, sleep) {
    return (sleepMinutes(sleep) - T.parseHM(wake)) * T.MINUTE;
  }

  // Де ми зараз відносно дня key:
  // 'past' — день минув, 'future' — ще не настав;
  // для сьогодні: 'before' — до підйому, 'during' — між підйомом і відбоєм, 'after' — після відбою.
  function dayPhase(schedules, key, now) {
    const todayKey = T.dayKeyOf(now);
    if (key < todayKey) return 'past';
    if (key > todayKey) return 'future';
    const w = dayWindow(schedules, key);
    if (now < w.wake) return 'before';
    if (now < w.sleep) return 'during';
    return 'after';
  }

  /* ---------- Відрізки часу ---------- */

  function isTimed(slot) {
    return !!slot && typeof slot.start === 'number';
  }

  // День відрізка: для справи з часом — день, коли вона почалась
  function slotDay(slot) {
    return isTimed(slot) ? T.dayKeyOf(slot.start) : slot.day;
  }

  function slotLength(slot) {
    if (!slot) return 0;
    return isTimed(slot) ? slot.end - slot.start : slot.minutes * T.MINUTE;
  }

  // Довжина спільної частини проміжків [a1, a2) і [b1, b2)
  function overlap(a1, a2, b1, b2) {
    return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  }

  // Скільки часу відрізка припадає на календарний день key (поділ по опівночі)
  function slotOnDay(slot, key) {
    if (!slot) return 0;
    if (!isTimed(slot)) return slot.day === key ? slot.minutes * T.MINUTE : 0;
    return overlap(slot.start, slot.end, T.dayStart(key), T.dayEnd(key));
  }

  /* ---------- Справи й таймер ---------- */

  // Відрізок, яким справа «займає» час: факт, а поки його немає — план
  function currentSlot(task) {
    return task.fact || task.plan;
  }

  // Запланована справа, для якої зараз іде таймер (якщо вона є й ще не виконана)
  function timerTask(tasks, timer) {
    if (!timer || !timer.taskId) return null;
    return tasks.find((task) => task.id === timer.taskId && !task.fact) || null;
  }

  // Таймер як відрізок «від старту до зараз»
  function timerSlot(timer, now) {
    return timer ? { start: timer.start, end: Math.max(now, timer.start) } : null;
  }

  // Справи дня key за часом; справи без часу — у кінці, у порядку додавання
  function tasksForDay(tasks, key) {
    return tasks
      .filter((task) => slotOnDay(currentSlot(task), key) > 0)
      .sort((a, b) => {
        const sa = currentSlot(a);
        const sb = currentSlot(b);
        if (isTimed(sa) !== isTimed(sb)) return isTimed(sa) ? -1 : 1;
        if (isTimed(sa)) return sa.start - sb.start;
        return (a.created || 0) - (b.created || 0);
      });
  }

  /* ---------- Головні числа ---------- */

  // Скільки часу дня key забирають справи (заплановані й виконані) і запущений таймер
  function usedOnDay(tasks, key, timer, now) {
    const linked = timerTask(tasks, timer);
    const running = slotOnDay(timerSlot(timer, now), key);
    let used = linked ? 0 : running;
    for (const task of tasks) {
      if (linked && task.id === linked.id) {
        // Поки таймер не перевищив план, він іде «в рахунок плану»
        used += Math.max(slotOnDay(task.plan, key), running);
      } else {
        used += slotOnDay(currentSlot(task), key);
      }
    }
    return used;
  }

  // Вільний бюджет = бюджет дня − усі справи дня
  function freeBudget(schedules, tasks, key, timer, now) {
    const budget = dayBudget(schedules, key);
    const used = usedOnDay(tasks, key, timer, now);
    return { budget, used, free: budget - used };
  }

  // Скільки часу ще можна використати в день key:
  // сьогодні — до відбою, у майбутній день — увесь бюджет, у минулий — нічого
  function timeLeft(schedules, key, now) {
    const w = dayWindow(schedules, key);
    const phase = dayPhase(schedules, key, now);
    if (phase === 'future' || phase === 'before') return w.sleep - w.wake;
    if (phase === 'during') return w.sleep - now;
    return 0;
  }

  // Скільки запланованого в день key ще не зроблено
  function plannedLeft(tasks, key, timer, now) {
    const linked = timerTask(tasks, timer);
    let left = 0;
    for (const task of tasks) {
      if (task.fact || !task.plan) continue;
      const planned = slotOnDay(task.plan, key);
      if (linked && task.id === linked.id) {
        left += Math.max(0, planned - slotOnDay(timerSlot(timer, now), key));
      } else {
        left += planned;
      }
    }
    return left;
  }

  // «Не встигнеш»: { planned, left }, якщо запланованого більше, ніж лишилось часу; інакше null
  function overplan(schedules, tasks, key, timer, now) {
    if (dayPhase(schedules, key, now) === 'past') return null;
    const planned = plannedLeft(tasks, key, timer, now);
    const left = timeLeft(schedules, key, now);
    return planned > left ? { planned, left } : null;
  }

  // Загальна довжина проміжків у межах [from, to); спільний час рахується один раз
  function unionLength(intervals, from, to) {
    const parts = intervals
      .map(([a, b]) => [Math.max(a, from), Math.min(b, to)])
      .filter(([a, b]) => b > a)
      .sort((x, y) => x[0] - y[0]);
    let total = 0;
    let curStart = 0;
    let curEnd = -Infinity;
    for (const [a, b] of parts) {
      if (a > curEnd) {
        if (curEnd > curStart) total += curEnd - curStart;
        curStart = a;
        curEnd = b;
      } else if (b > curEnd) {
        curEnd = b;
      }
    }
    if (curEnd > curStart) total += curEnd - curStart;
    return total;
  }

  // Загублений час: скільки часу від підйому до «зараз» (а після відбою — до відбою)
  // не зайнято жодною виконаною справою.
  // Повертає { lost, elapsed, covered } або null для дня, що ще не настав.
  function lostTime(schedules, tasks, key, timer, now) {
    const phase = dayPhase(schedules, key, now);
    if (phase === 'future') return null;
    if (phase === 'before') return { lost: 0, elapsed: 0, covered: 0 };
    const w = dayWindow(schedules, key);
    const to = Math.min(now, w.sleep);
    const elapsed = to - w.wake;
    const intervals = [];
    let untimed = 0;
    for (const task of tasks) {
      if (!task.fact) continue;
      if (isTimed(task.fact)) intervals.push([task.fact.start, task.fact.end]);
      else untimed += slotOnDay(task.fact, key);
    }
    if (timer) intervals.push([timer.start, now]);
    const covered = Math.min(elapsed, unionLength(intervals, w.wake, to) + untimed);
    return { lost: elapsed - covered, elapsed, covered };
  }

  /* ---------- Накладання справ ---------- */

  // Пари справ із часом, що накладаються в день key:
  // [{ a, b, start, end }], де a і b — id справ ('timer' — запущений таймер)
  function overlaps(tasks, key, timer, now) {
    const from = T.dayStart(key);
    const to = T.dayEnd(key);
    const linked = timerTask(tasks, timer);
    const items = [];
    for (const task of tasks) {
      const slot = linked && task.id === linked.id ? timerSlot(timer, now) : currentSlot(task);
      if (isTimed(slot)) items.push({ id: task.id, start: slot.start, end: slot.end });
    }
    if (timer && !linked) items.push({ id: 'timer', ...timerSlot(timer, now) });
    const result = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const start = Math.max(items[i].start, items[j].start, from);
        const end = Math.min(items[i].end, items[j].end, to);
        if (end > start) result.push({ a: items[i].id, b: items[j].id, start, end });
      }
    }
    return result;
  }

  TB.calc = {
    scheduleFor, scheduleError, dayWindow, dayBudget, plainBudget, dayPhase,
    isTimed, slotDay, slotLength, slotOnDay, currentSlot, timerTask, timerSlot, tasksForDay,
    usedOnDay, freeBudget, timeLeft, plannedLeft, overplan, unionLength, lostTime, overlaps,
  };
})();
