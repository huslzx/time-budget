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

  // З якими справами (і таймером) перетнеться відрізок slot, якщо його зберегти.
  // Справа exceptId — та, яку зараз редагують, — не враховується.
  // Повертає [{ id, start, end }]: id справи або 'timer' і спільний проміжок.
  function slotConflicts(tasks, slot, exceptId, timer, now) {
    if (!isTimed(slot)) return [];
    const linked = timerTask(tasks, timer);
    const result = [];
    const check = (id, other) => {
      const start = Math.max(slot.start, other.start);
      const end = Math.min(slot.end, other.end);
      if (end > start) result.push({ id, start, end });
    };
    for (const task of tasks) {
      if (task.id === exceptId) continue;
      const other = linked && task.id === linked.id ? timerSlot(timer, now) : currentSlot(task);
      if (isTimed(other)) check(task.id, other);
    }
    if (timer && !linked) check('timer', timerSlot(timer, now));
    return result;
  }

  /* ---------- Таймер ---------- */

  function roundToMinute(ms) {
    return Math.round(ms / T.MINUTE) * T.MINUTE;
  }

  // Що записати, коли таймер зупиняють у момент end. Час округлюється до хвилин,
  // щоб суми на екрані сходилися. Повертає { slot, taskId } — taskId є, якщо таймер
  // ішов для запланованої справи; або null, якщо таймер ішов менше хвилини.
  function timerResult(tasks, timer, end) {
    const slot = { start: roundToMinute(timer.start), end: roundToMinute(end) };
    if (slot.end - slot.start < T.MINUTE) return null;
    const linked = timerTask(tasks, timer);
    return { slot, taskId: linked ? linked.id : null };
  }

  // Якщо таймер забули вимкнути: найімовірніше, справа закінчилась у відбій
  // того дня, коли таймер запустили (якщо відбій уже минув). Інакше — зараз.
  function suggestTimerEnd(schedules, timer, now) {
    const sleep = dayWindow(schedules, T.dayKeyOf(timer.start)).sleep;
    return sleep > timer.start && sleep < now ? sleep : now;
  }

  // Перевірка часу зупинки таймера: текст помилки або null
  function timerEndError(timer, end, now, maxLength) {
    if (!Number.isFinite(end)) return 'Вкажи, коли ти закінчив.';
    if (end <= timer.start) return 'Кінець має бути пізніше за початок (' + T.timeOf(timer.start) + ').';
    if (end > now + T.MINUTE) return 'Цей час ще не настав.';
    if (end - timer.start > maxLength) return 'Таймер не може записати справу довшу за 7 днів. Вкажи, коли ти насправді закінчив.';
    return null;
  }

  /* ---------- Шкала дня ---------- */

  function floorHour(ms) {
    const date = new Date(ms);
    date.setMinutes(0, 0, 0);
    return date.getTime();
  }

  function ceilHour(ms) {
    const floored = floorHour(ms);
    return floored === ms ? ms : floored + T.HOUR;
  }

  // Блоки шкали дня key: справи з часом і запущений таймер, обрізані північчю.
  // [{ id, categoryId, kind: 'done' | 'planned' | 'running', start, end, cutStart, cutEnd, lane }]
  // Справи, що накладаються, отримують різні доріжки (lane), щоб їх було видно обидві.
  function timelineItems(tasks, key, timer, now) {
    const dayFrom = T.dayStart(key);
    const dayTo = T.dayEnd(key);
    const linked = timerTask(tasks, timer);
    const items = [];
    const add = (id, categoryId, kind, slot) => {
      if (!isTimed(slot)) return;
      const start = Math.max(slot.start, dayFrom);
      const end = Math.min(slot.end, dayTo);
      // Щойно запущений таймер ще має нульову довжину, але його вже треба показати
      if (end < start || (end === start && kind !== 'running')) return;
      items.push({ id, categoryId, kind, start, end, cutStart: slot.start < dayFrom, cutEnd: slot.end > dayTo });
    };
    for (const task of tasks) {
      // Для справи з запущеним таймером малюємо таймер, а не її план
      if (linked && task.id === linked.id) continue;
      add(task.id, task.categoryId, task.fact ? 'done' : 'planned', currentSlot(task));
    }
    if (timer) add(linked ? linked.id : 'timer', timer.categoryId, 'running', timerSlot(timer, now));
    items.sort((a, b) => a.start - b.start || b.end - a.end);
    const laneEnds = [];
    for (const item of items) {
      let lane = laneEnds.findIndex((end) => end <= item.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = item.end;
      item.lane = lane;
    }
    return items;
  }

  // Межі шкали дня key: від підйому до відбою, розширені, якщо справи виходять
  // за ці межі; округлені до цілих годин і обрізані північчю.
  function timelineRange(schedules, tasks, key, timer, now) {
    const w = dayWindow(schedules, key);
    let from = w.wake;
    let to = w.sleep;
    for (const item of timelineItems(tasks, key, timer, now)) {
      from = Math.min(from, item.start);
      to = Math.max(to, item.end);
    }
    return {
      from: Math.max(T.dayStart(key), floorHour(from)),
      to: Math.min(T.dayEnd(key), ceilHour(to)),
    };
  }

  // Через скільки годин підписувати шкалу, щоб підписи не налазили один на одного
  // (на один підпис «07:00» з відступом треба приблизно 56 пікселів)
  function pickTickStep(hours, widthPx) {
    for (const step of [1, 2, 3, 4, 6]) {
      if ((hours / step) * 56 <= widthPx) return step;
    }
    return 12;
  }

  TB.calc = {
    scheduleFor, scheduleError, dayWindow, dayBudget, plainBudget, dayPhase,
    isTimed, slotDay, slotLength, slotOnDay, currentSlot, timerTask, timerSlot, tasksForDay,
    usedOnDay, freeBudget, timeLeft, plannedLeft, overplan, unionLength, lostTime, overlaps,
    slotConflicts, timerResult, suggestTimerEnd, timerEndError,
    timelineItems, timelineRange, pickTickStep,
  };
})();
