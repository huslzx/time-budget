/*
 * Бюджет часу — інтерфейс.
 *
 * Цей файл малює екрани й відповідає на натискання кнопок.
 * Розрахунки беруться з calc.js, збереження — зі store.js.
 * Після кожної зміни даних екран малюється заново, а «живі» числа
 * (до відбою, загублений час, годинник) оновлюються щосекунди окремо.
 */
(function () {
  'use strict';
  const { time: T, calc: C, store: S } = globalThis.TB;

  const app = document.getElementById('app');
  const dialog = document.getElementById('dialog');
  const toasts = document.getElementById('toasts');

  const state = {
    data: null, // усі дані програми (див. store.js)
    tab: 'today', // відкрита вкладка
    day: '', // день, який показує вкладка «Сьогодні»
    today: '', // сьогоднішня дата — щоб помітити північ
    minute: -1, // поточна хвилина — щоб раз на хвилину оновлювати список
    saveError: null, // текст помилки, якщо дані не вдається зберегти
    form: null, // відкрита форма справи: { taskId, markDone }
  };

  const TABS = [
    { id: 'today', label: 'Сьогодні', icon: 'sun' },
    { id: 'settings', label: 'Налаштування', icon: 'sliders' },
  ];

  // Значки з набору Lucide (lucide.dev, ліцензія ISC)
  const ICONS = {
    hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    sliders: '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  };

  /* ---------- Дрібні помічники ---------- */

  function icon(name) {
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  // Захист від того, щоб назва справи на кшталт «<b>» не стала частиною сторінки
  function esc(value) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value).replace(/[&<>"']/g, (ch) => map[ch]);
  }

  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function todayKey() {
    return T.dayKeyOf(Date.now());
  }

  function category(id) {
    return state.data.categories.find((c) => c.id === id)
      || { id, name: 'Без категорії', color: '#898781', archived: true };
  }

  function activeCategories() {
    return state.data.categories.filter((c) => !c.archived);
  }

  function taskName(task) {
    return task.title || category(task.categoryId).name;
  }

  // Назва дня для повідомлень: «сьогодні», «завтра» або «пт 30.10»
  function dayLabel(key) {
    const rel = T.relativeDay(key, todayKey());
    return rel ? rel.toLowerCase() : T.formatDateShort(key);
  }

  // Тривалість для великих чисел: цифри великі, «год» і «хв» — дрібніші
  function durationHTML(ms, mode) {
    const { sign, h, m } = T.durationParts(ms, mode);
    const unit = (text) => '&nbsp;<span class="unit">' + text + '</span>';
    if (h && m) return sign + h + unit('год') + ' ' + m + unit('хв');
    if (h) return sign + h + unit('год');
    return sign + m + unit('хв');
  }

  // Час справи словами: «10:00 – 12:00», «23:30 – 00:30 наступного дня · усього 1 год»
  function slotText(slot, key) {
    if (!C.isTimed(slot)) return 'без часу';
    const startDay = T.dayKeyOf(slot.start);
    const endDay = T.dayKeyOf(slot.end - 1);
    const side = (day) => {
      const diff = T.daysBetween(key, day);
      if (diff === 0) return '';
      if (diff === 1) return ' наступного дня';
      if (diff === -1) return ' попереднього дня';
      return ' (' + T.formatDateShort(day) + ')';
    };
    let text = T.timeOf(slot.start) + side(startDay) + ' – ' + T.timeOf(slot.end) + side(endDay);
    if (startDay !== endDay) text += ' · усього ' + T.formatDuration(C.slotLength(slot));
    return text;
  }

  // План справи коротко: «10:00 – 14:00 (4 год)» або «4 год, без часу»
  function planText(slot) {
    const length = T.formatDuration(C.slotLength(slot));
    if (!C.isTimed(slot)) return length + ', без часу';
    return slotText(slot, C.slotDay(slot)) + ' (' + length + ')';
  }

  /* ---------- Збереження ---------- */

  function persist() {
    try {
      S.save(state.data);
      state.saveError = null;
    } catch (error) {
      state.saveError = S.describeError(error);
    }
  }

  // Змінити дані, зберегти й перемалювати екран
  function commit(change) {
    change(state.data);
    persist();
    render();
  }

  /* ---------- Малювання екрана ---------- */

  function render() {
    const focused = app.contains(document.activeElement) ? focusKey(document.activeElement) : null;
    const main = state.tab === 'settings' ? renderSettings() : renderToday();
    app.innerHTML = renderTopbar() + '<main class="wrap" id="main">' + renderSaveError() + main + '</main>';
    restoreFocus(focused);
    updateLive();
  }

  // Після перемальовування повертаємо фокус на ту саму кнопку (важливо для клавіатури)
  function focusKey(el) {
    if (!el.dataset || !el.dataset.action) return null;
    let selector = '[data-action="' + el.dataset.action + '"]';
    if (el.dataset.id) selector += '[data-id="' + CSS.escape(el.dataset.id) + '"]';
    if (el.dataset.tab) selector += '[data-tab="' + el.dataset.tab + '"]';
    return selector;
  }

  function restoreFocus(selector) {
    const el = selector && app.querySelector(selector);
    if (el) el.focus({ preventScroll: true });
  }

  function renderTopbar() {
    const tabs = TABS.map((t) => `
      <button type="button" data-action="tab" data-tab="${t.id}" ${state.tab === t.id ? 'aria-current="page"' : ''}>
        ${icon(t.icon)}<span>${t.label}</span>
      </button>`).join('');
    return `
      <header class="topbar">
        <div class="topbar-inner">
          <div class="brand">${icon('hourglass')}<span>Бюджет часу</span></div>
          <nav class="tabs" aria-label="Розділи" style="--tabs:${TABS.length}">${tabs}</nav>
          <span class="clock" id="clock" aria-label="Зараз"></span>
        </div>
      </header>`;
  }

  function renderSaveError() {
    if (!state.saveError) return '';
    return `
      <div class="alert danger" role="alert">${icon('alert')}
        <div><b>Дані не зберігаються.</b> ${esc(state.saveError)} Зміни зникнуть, щойно закриєш сторінку.</div>
      </div>`;
  }

  /* ---------- Вкладка «Сьогодні» ---------- */

  function renderToday() {
    const key = state.day;
    const tKey = todayKey();
    const rel = T.relativeDay(key, tKey);
    const item = C.scheduleFor(state.data.schedules, key);
    const budget = C.dayBudget(state.data.schedules, key);
    return `
      <section class="day-head">
        <button type="button" class="icon-btn" data-action="day-prev" aria-label="Попередній день">${icon('left')}</button>
        <div class="day-title">
          <h1>${esc(rel || capitalize(T.WEEKDAYS[T.weekday(key)]))}</h1>
          <p>${esc(rel ? T.formatDate(key) : T.formatDayMonth(key, tKey))}</p>
        </div>
        <button type="button" class="icon-btn" data-action="day-next" aria-label="Наступний день">${icon('right')}</button>
      </section>
      ${key !== tKey ? '<p class="center"><button type="button" class="link" data-action="day-today">Повернутися до сьогодні</button></p>' : ''}
      <p class="schedule-line">Підйом ${item.wake} · Відбій ${item.sleep} · Бюджет дня ${T.formatDuration(budget)}</p>
      <section class="stats">
        ${statCard('free', 'Вільний бюджет')}
        ${statCard('sleep', 'До відбою')}
        ${statCard('lost', 'Загублений час')}
      </section>
      <div id="overplan"></div>
      ${renderTaskSection(key)}`;
  }

  function statCard(id, label) {
    return `
      <div class="stat" id="stat-${id}">
        <div class="stat-label">${label}</div>
        <div class="stat-value"></div>
        <div class="stat-hint"></div>
      </div>`;
  }

  // Оновлює числа, які залежать від поточного часу. Викликається щосекунди.
  function updateLive() {
    const now = Date.now();
    const clock = document.getElementById('clock');
    if (clock) clock.textContent = T.timeOf(now);
    if (state.tab !== 'today' || !document.getElementById('stat-free')) return;

    const { schedules, tasks, timer } = state.data;
    const key = state.day;
    const item = C.scheduleFor(schedules, key);
    const phase = C.dayPhase(schedules, key, now);
    const w = C.dayWindow(schedules, key);
    const minutes = (ms) => Math.round(ms / T.MINUTE) * T.MINUTE;

    // Вільний бюджет. Рахуємо в цілих хвилинах, щоб числа на екрані сходилися.
    const fb = C.freeBudget(schedules, tasks, key, timer, now);
    const used = minutes(fb.used);
    setStat('free', {
      value: durationHTML(fb.budget - used),
      hint: used ? T.formatDuration(fb.budget) + ' − ' + T.formatDuration(used) + ' на справи' : 'Справ поки немає',
      tone: fb.budget - used < 0 ? 'danger' : '',
    });

    // До відбою
    if (phase === 'during') {
      setStat('sleep', { value: durationHTML(w.sleep - now, 'floor'), hint: 'Відбій о ' + item.sleep });
    } else if (phase === 'before') {
      setStat('sleep', {
        value: 'Ще рано',
        hint: 'День почнеться о ' + item.wake + ', через ' + T.formatDuration(w.wake - now, 'floor'),
        tone: 'quiet',
      });
    } else if (phase === 'after') {
      setStat('sleep', {
        value: 'Час спати',
        hint: 'Відбій був о ' + item.sleep + ', ' + T.formatDuration(now - w.sleep, 'floor') + ' тому',
        tone: 'warn',
      });
    } else {
      setStat('sleep', { value: '—', hint: phase === 'future' ? 'Цей день ще не настав' : 'Цей день уже минув', tone: 'quiet' });
    }

    // Загублений час
    const lt = C.lostTime(schedules, tasks, key, timer, now);
    if (!lt) {
      setStat('lost', { value: '—', hint: 'Порахую, коли день почнеться', tone: 'quiet' });
    } else if (phase === 'before') {
      setStat('lost', { value: durationHTML(0), hint: 'День ще не почався' });
    } else {
      const elapsed = Math.floor(lt.elapsed / T.MINUTE) * T.MINUTE;
      const covered = Math.min(elapsed, minutes(lt.covered));
      setStat('lost', {
        value: durationHTML(elapsed - covered),
        hint: (phase === 'past' ? 'За день' : 'Від підйому') + ' минуло ' + T.formatDuration(elapsed)
          + ', справами зайнято ' + T.formatDuration(covered),
      });
    }

    // Попередження «Не встигнеш»
    const op = C.overplan(schedules, tasks, key, timer, now);
    setHTML(document.getElementById('overplan'), op ? `
      <div class="alert warn">${icon('alert')}
        <div><b>Не встигнеш:</b> плану на ${T.formatDuration(op.planned)}, а часу лишилось ${T.formatDuration(op.left, 'floor')}.</div>
      </div>` : '');
  }

  function setStat(id, { value, hint, tone = '' }) {
    const el = document.getElementById('stat-' + id);
    el.className = 'stat' + (tone ? ' ' + tone : '');
    setHTML(el.querySelector('.stat-value'), value);
    el.querySelector('.stat-hint').textContent = hint;
  }

  // Міняє вміст, лише якщо він справді змінився (щоб нічого не «блимало»)
  function setHTML(el, html) {
    if (el.dataset.html !== html) {
      el.innerHTML = html;
      el.dataset.html = html;
    }
  }

  function renderTaskSection(key) {
    const now = Date.now();
    const list = C.tasksForDay(state.data.tasks, key);
    const addButton = `<button type="button" class="btn primary" data-action="task-add">${icon('plus')}Додати справу</button>`;
    return `
      <div class="section-head"><h2>Справи</h2>${list.length ? addButton : ''}</div>
      ${list.length ? '<ul class="tasks">' + list.map((task) => renderTask(task, key, now)).join('') + '</ul>' : renderEmpty(key, addButton)}`;
  }

  function renderTask(task, key, now) {
    const cat = category(task.categoryId);
    const done = !!task.fact;
    const slot = C.currentSlot(task);
    const name = taskName(task);
    const meta = [];
    if (task.title) meta.push(esc(cat.name));
    meta.push(esc(slotText(slot, key)));
    if (done && task.plan) meta.push('план: ' + esc(T.formatDuration(C.slotLength(task.plan))));
    const late = !done && C.isTimed(slot) && slot.end <= now;
    const id = esc(task.id);
    return `
      <li class="task ${done ? 'is-done' : 'is-planned'}" style="--cat:${esc(cat.color)}">
        <div class="task-main">
          <div class="task-name">${esc(name)}</div>
          <div class="task-meta">${meta.join(' · ')}</div>
          ${late ? '<div class="task-late">Час минув — познач, як було насправді</div>' : ''}
        </div>
        <div class="task-side">
          <div class="task-dur">${T.formatDuration(C.slotOnDay(slot, key))}</div>
          ${done ? `<span class="badge done">${icon('check')}Виконано</span>` : '<span class="badge">Заплановано</span>'}
        </div>
        <div class="task-actions">
          ${done ? '' : `<button type="button" class="btn small" data-action="task-done" data-id="${id}">${icon('check')}Виконано</button>`}
          <button type="button" class="icon-btn" data-action="task-edit" data-id="${id}" aria-label="Змінити «${esc(name)}»">${icon('edit')}</button>
          <button type="button" class="icon-btn" data-action="task-delete" data-id="${id}" aria-label="Видалити «${esc(name)}»">${icon('trash')}</button>
        </div>
      </li>`;
  }

  function renderEmpty(key, addButton) {
    if (state.data.tasks.length === 0) {
      const budget = T.formatDuration(C.dayBudget(state.data.schedules, key));
      return `
        <div class="empty">
          <p class="empty-title">Почнімо!</p>
          <p>Між підйомом і відбоєм у тебе ${budget}. Додай першу справу, наприклад «Навчання, 4 год», і побачиш, скільки часу лишиться.</p>
          ${addButton}
        </div>`;
    }
    return `
      <div class="empty">
        <p class="empty-title">На цей день справ немає</p>
        <p>Заплануй справу наперед або запиши те, що вже зроблено.</p>
        ${addButton}
      </div>`;
  }

  /* ---------- Форма справи ---------- */

  function radio(name, value, label, checked) {
    return `<label><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;
  }

  function sheetHead(title) {
    return `
      <header class="sheet-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="icon-btn" data-action="dialog-close" aria-label="Закрити">${icon('x')}</button>
      </header>`;
  }

  function sheetFoot(okLabel) {
    return `
      <footer class="sheet-foot">
        <button type="button" class="btn" data-action="dialog-close">Скасувати</button>
        <button type="submit" class="btn primary">${okLabel}</button>
      </footer>`;
  }

  // markDone — «Виконано» для запланованої справи: питаємо, як було насправді
  function openTaskForm({ taskId = null, markDone = false } = {}) {
    const task = taskId ? state.data.tasks.find((t) => t.id === taskId) : null;
    if (taskId && !task) return;
    const status = markDone ? 'done'
      : task ? (task.fact ? 'done' : 'planned')
        : state.day < todayKey() ? 'done' : 'planned';
    const cats = activeCategories();
    const categoryId = task ? task.categoryId : cats[0].id;
    if (!cats.some((c) => c.id === categoryId)) cats.push(category(categoryId));
    const heading = markDone ? 'Як було насправді?' : task ? 'Змінити справу' : 'Нова справа';
    const planNote = task && task.plan && (markDone || task.fact)
      ? `<p class="note">План: ${esc(planText(task.plan))}</p>` : '';
    const chips = cats.map((c) => `
      <label class="chip" style="--cat:${esc(c.color)}">
        <input type="radio" name="category" value="${esc(c.id)}" ${c.id === categoryId ? 'checked' : ''}>
        <span><i class="dot"></i>${esc(c.name)}</span>
      </label>`).join('');

    openDialog(`
      <form class="sheet" id="task-form" novalidate>
        ${sheetHead(heading)}
        ${planNote}
        <fieldset class="seg" ${markDone ? 'hidden' : ''}>
          <legend>Статус</legend>
          <div class="seg-options equal" style="--n:2">
            ${radio('status', 'planned', 'Заплановано', status === 'planned')}
            ${radio('status', 'done', 'Виконано', status === 'done')}
          </div>
        </fieldset>
        <fieldset class="seg">
          <legend>Категорія</legend>
          <div class="seg-options">${chips}</div>
        </fieldset>
        <label class="field">
          <span>Назва <small>(необов’язково)</small></span>
          <input type="text" name="title" maxlength="${S.MAX_TITLE}" autocomplete="off" placeholder="Наприклад, матаналіз" value="${esc(task ? task.title : '')}">
        </label>
        <label class="field">
          <span>День</span>
          <input type="date" name="day" required>
        </label>
        <fieldset class="seg">
          <legend>Час</legend>
          <div class="seg-options equal" style="--n:3">
            ${radio('mode', 'range', 'Початок і кінець')}
            ${radio('mode', 'start', 'Початок і тривалість')}
            ${radio('mode', 'duration', 'Лише тривалість')}
          </div>
        </fieldset>
        <div class="row" data-show="range start">
          <label class="field"><span>Початок</span><input type="time" name="start"></label>
          <label class="field" data-show="range"><span>Кінець</span><input type="time" name="end"></label>
        </div>
        <div class="row" data-show="start duration">
          <label class="field"><span>Години</span><input type="text" name="hours" inputmode="decimal" autocomplete="off" placeholder="0"></label>
          <label class="field"><span>Хвилини</span><input type="text" name="minutes" inputmode="numeric" autocomplete="off" placeholder="0"></label>
        </div>
        <p class="preview" id="task-preview"></p>
        <p class="form-error" id="task-error" role="alert"></p>
        ${sheetFoot('Зберегти')}
      </form>`);

    const form = document.getElementById('task-form');
    state.form = { taskId, markDone };
    fillSlot(form, task ? (status === 'done' ? task.fact || task.plan : task.plan) : null,
      status === 'done' ? 'range' : 'duration');
    updateTaskForm(form);
  }

  // Заповнює поля часу з відрізка (або значеннями «за замовчуванням»)
  function fillSlot(form, slot, defaultMode) {
    const f = form.elements;
    if (!slot) {
      f.mode.value = defaultMode;
      f.day.value = state.day;
      return;
    }
    const total = Math.round(C.slotLength(slot) / T.MINUTE);
    f.hours.value = Math.floor(total / 60) || '';
    f.minutes.value = total % 60 || '';
    if (C.isTimed(slot)) {
      f.mode.value = total > 24 * 60 ? 'start' : 'range';
      f.day.value = T.dayKeyOf(slot.start);
      f.start.value = T.timeOf(slot.start);
      f.end.value = T.timeOf(slot.end);
    } else {
      f.mode.value = 'duration';
      f.day.value = slot.day;
    }
  }

  // Читає час із форми. Повертає { slot } або { error }
  function readSlot(form) {
    const f = form.elements;
    const day = f.day.value;
    if (!T.isDayKey(day)) return { error: 'Вкажи день.' };
    const mode = f.mode.value;
    const duration = () => {
      const total = T.parseDuration(f.hours.value, f.minutes.value);
      if (!(total >= 1)) return { error: 'Вкажи тривалість: години та/або хвилини (наприклад, 1,5 год).' };
      if (total > 24 * 60) return { error: 'Справа не може тривати довше за 24 години.' };
      return { total };
    };
    if (mode === 'duration') {
      const d = duration();
      return d.error ? d : { slot: { day, minutes: d.total } };
    }
    const startMinutes = T.parseHM(f.start.value);
    if (Number.isNaN(startMinutes)) return { error: 'Вкажи час початку.' };
    const start = T.atMinutes(day, startMinutes);
    if (mode === 'start') {
      const d = duration();
      return d.error ? d : { slot: { start, end: start + d.total * T.MINUTE } };
    }
    const endMinutes = T.parseHM(f.end.value);
    if (Number.isNaN(endMinutes)) return { error: 'Вкажи час кінця.' };
    if (endMinutes === startMinutes) return { error: 'Кінець збігається з початком.' };
    // Кінець раніше за початок — отже, справа закінчилась після опівночі
    const endDay = endMinutes > startMinutes ? day : T.addDays(day, 1);
    return { slot: { start, end: T.atMinutes(endDay, endMinutes) } };
  }

  // Підказка під полями: як програма зрозуміла введений час
  function previewText(slot) {
    const length = T.formatDuration(C.slotLength(slot));
    if (!C.isTimed(slot)) return 'Тривалість ' + length + ', без конкретного часу.';
    const startDay = T.dayKeyOf(slot.start);
    const endDay = T.dayKeyOf(slot.end - 1);
    let text = T.timeOf(slot.start) + ' – ' + T.timeOf(slot.end) + (endDay !== startDay ? ' наступного дня' : '') + ' · ' + length + '.';
    const clockMinutes = T.daysBetween(startDay, T.dayKeyOf(slot.end)) * 1440
      + T.minutesOfDay(slot.end) - T.minutesOfDay(slot.start);
    if (clockMinutes * T.MINUTE !== C.slotLength(slot)) text += ' Враховано переведення годинника.';
    if (endDay !== startDay) {
      text += ' До опівночі — ' + T.formatDuration(C.slotOnDay(slot, startDay)) + ', решта піде в наступний день.';
    }
    return text;
  }

  function updateTaskForm(form) {
    const mode = form.elements.mode.value;
    form.querySelectorAll('[data-show]').forEach((el) => {
      el.hidden = !el.dataset.show.split(' ').includes(mode);
    });
    const result = readSlot(form);
    document.getElementById('task-preview').textContent = result.slot ? previewText(result.slot) : '';
    document.getElementById('task-error').textContent = '';
  }

  // Перемкнули статус у вже створеної справи — показуємо відповідний час (план або факт)
  function onStatusChange(form) {
    const task = state.form && state.form.taskId && state.data.tasks.find((t) => t.id === state.form.taskId);
    if (!task) return;
    const slot = form.elements.status.value === 'done' ? task.fact : task.plan;
    if (slot) fillSlot(form, slot);
  }

  function submitTaskForm(form) {
    if (!state.form) return;
    const errorBox = document.getElementById('task-error');
    const result = readSlot(form);
    if (result.error) {
      errorBox.textContent = result.error;
      return;
    }
    const slot = result.slot;
    const f = form.elements;
    const status = state.form.markDone ? 'done' : f.status.value;
    const categoryId = f.category.value;
    if (!categoryId) {
      errorBox.textContent = 'Вибери категорію.';
      return;
    }
    const notStarted = C.isTimed(slot) ? slot.start > Date.now() : slot.day > todayKey();
    if (status === 'done' && notStarted) {
      errorBox.textContent = 'Ця справа ще не почалася. Познач її як заплановану.';
      return;
    }
    const title = f.title.value.trim().replace(/\s+/g, ' ').slice(0, S.MAX_TITLE);
    const taskId = state.form.taskId;
    commit((data) => {
      let task = taskId && data.tasks.find((t) => t.id === taskId);
      if (!task) {
        task = { id: S.newId(), categoryId, title, plan: null, fact: null, created: Date.now() };
        data.tasks.push(task);
      }
      task.categoryId = categoryId;
      task.title = title;
      if (status === 'planned') {
        task.plan = slot;
        task.fact = null;
      } else {
        task.fact = slot;
      }
    });
    closeDialog();
    const day = C.slotDay(slot);
    if (day !== state.day) {
      state.day = day;
      render();
      toast('Збережено на ' + dayLabel(day));
    } else {
      toast('Збережено');
    }
  }

  async function deleteTask(id) {
    const task = state.data.tasks.find((t) => t.id === id);
    if (!task) return;
    const ok = await confirmBox({
      title: 'Видалити справу?',
      text: '«' + taskName(task) + '» зникне назавжди.',
      ok: 'Видалити',
      danger: true,
    });
    if (!ok) return;
    commit((data) => {
      data.tasks = data.tasks.filter((t) => t.id !== id);
      if (data.timer && data.timer.taskId === id) data.timer.taskId = null;
    });
    toast('Справу видалено');
  }

  /* ---------- Вкладка «Налаштування» ---------- */

  function renderSettings() {
    const item = C.scheduleFor(state.data.schedules, todayKey());
    const active = activeCategories();
    const archived = state.data.categories.filter((c) => c.archived);
    const rows = active.map((c) => `
      <li class="cat-row">
        <span class="dot" style="--cat:${esc(c.color)}"></span>
        <span class="cat-label">${esc(c.name)}</span>
        <button type="button" class="icon-btn" data-action="cat-edit" data-id="${esc(c.id)}" aria-label="Змінити категорію «${esc(c.name)}»">${icon('edit')}</button>
        <button type="button" class="icon-btn" data-action="cat-delete" data-id="${esc(c.id)}" aria-label="Видалити категорію «${esc(c.name)}»">${icon('trash')}</button>
      </li>`).join('');
    const archivedRows = archived.map((c) => `
      <li class="cat-row">
        <span class="dot" style="--cat:${esc(c.color)}"></span>
        <span class="cat-label">${esc(c.name)}</span>
        <button type="button" class="btn small" data-action="cat-restore" data-id="${esc(c.id)}">Повернути</button>
      </li>`).join('');
    return `
      <h1 class="page-title">Налаштування</h1>
      <section class="card">
        <h2>Розклад дня</h2>
        <form id="schedule-form" class="stack" novalidate>
          <div class="row">
            <label class="field"><span>Підйом</span><input type="time" name="wake" value="${item.wake}" required></label>
            <label class="field"><span>Відбій</span><input type="time" name="sleep" value="${item.sleep}" required></label>
          </div>
          <p class="preview" id="schedule-preview">${schedulePreview(item.wake, item.sleep)}</p>
          <p class="form-error" id="schedule-error" role="alert"></p>
          <div><button type="submit" class="btn primary">Зберегти розклад</button></div>
          <p class="hint">Зміни діють від сьогодні. Минулі дні рахуються за розкладом, який діяв тоді. Відбій 00:00 — це опівніч.</p>
        </form>
      </section>
      <section class="card">
        <div class="section-head">
          <h2>Категорії</h2>
          <button type="button" class="btn" data-action="cat-add">${icon('plus')}Додати</button>
        </div>
        <ul class="cat-list">${rows}</ul>
        ${archived.length ? `
          <h3 class="subhead">Приховані категорії</h3>
          <p class="hint">Їх видалено, але в них є старі справи. Нові справи сюди додати не можна.</p>
          <ul class="cat-list">${archivedRows}</ul>` : ''}
      </section>`;
  }

  function schedulePreview(wake, sleep) {
    return C.scheduleError(wake, sleep) ? '' : 'Бюджет дня: ' + T.formatDuration(C.plainBudget(wake, sleep));
  }

  function saveSchedule(form) {
    const wake = form.elements.wake.value;
    const sleep = form.elements.sleep.value;
    const error = C.scheduleError(wake, sleep);
    if (error) {
      document.getElementById('schedule-error').textContent = error;
      return;
    }
    const key = todayKey();
    const current = C.scheduleFor(state.data.schedules, key);
    if (current.wake === wake && current.sleep === sleep) {
      toast('Розклад не змінився');
      return;
    }
    commit((data) => {
      data.schedules = data.schedules.filter((s) => s.from < key);
      data.schedules.push({ from: key, wake, sleep });
    });
    toast('Розклад збережено. Бюджет дня — ' + T.formatDuration(C.plainBudget(wake, sleep)));
  }

  function categoryNameProblem(name, exceptId) {
    if (!name) return 'Напиши назву категорії.';
    const lower = name.toLocaleLowerCase('uk');
    const taken = state.data.categories.some((c) => c.id !== exceptId && !c.archived
      && c.name.toLocaleLowerCase('uk') === lower);
    return taken ? 'Категорія з такою назвою вже є.' : null;
  }

  // Додати нову категорію (id не задано) або змінити назву й колір наявної
  function openCategoryForm(id) {
    const cat = id ? state.data.categories.find((c) => c.id === id) : null;
    const used = new Set(activeCategories().map((c) => c.color));
    const color = cat ? cat.color : (S.PALETTE.find((p) => !used.has(p.color)) || S.PALETTE[0]).color;
    const swatches = S.PALETTE.map((p) => `
      <label class="swatch-option" style="--cat:${p.color}">
        <input type="radio" name="color" value="${p.color}" ${p.color === color ? 'checked' : ''} aria-label="${p.name}">
        <span class="swatch-dot"></span>
      </label>`).join('');
    openDialog(`
      <form class="sheet" id="category-form" novalidate>
        ${sheetHead(cat ? 'Змінити категорію' : 'Нова категорія')}
        <label class="field">
          <span>Назва</span>
          <input type="text" name="name" maxlength="${S.MAX_CATEGORY_NAME}" autocomplete="off" value="${esc(cat ? cat.name : '')}" placeholder="Наприклад, Дорога">
        </label>
        <fieldset class="seg">
          <legend>Колір</legend>
          <div class="swatch-grid">${swatches}</div>
        </fieldset>
        <p class="form-error" id="category-error" role="alert"></p>
        ${sheetFoot(cat ? 'Зберегти' : 'Додати')}
      </form>`);
    state.form = { categoryId: id || null };
  }

  function submitCategoryForm(form) {
    const id = state.form && state.form.categoryId;
    const name = form.elements.name.value.trim().replace(/\s+/g, ' ').slice(0, S.MAX_CATEGORY_NAME);
    const color = form.elements.color.value;
    const problem = categoryNameProblem(name, id);
    if (problem) {
      document.getElementById('category-error').textContent = problem;
      return;
    }
    commit((data) => {
      const cat = id && data.categories.find((c) => c.id === id);
      if (cat) {
        cat.name = name;
        cat.color = color;
      } else {
        data.categories.push({ id: S.newId(), name, color, archived: false });
      }
    });
    closeDialog();
    toast(id ? 'Категорію змінено' : 'Категорію «' + name + '» додано');
  }

  async function deleteCategory(id) {
    const cat = state.data.categories.find((c) => c.id === id);
    if (!cat) return;
    if (activeCategories().length <= 1) {
      toast('Має лишитися хоча б одна категорія.', 'error');
      return;
    }
    const count = state.data.tasks.filter((t) => t.categoryId === id).length;
    const used = count > 0 || (state.data.timer && state.data.timer.categoryId === id);
    const ok = await confirmBox({
      title: 'Видалити категорію «' + cat.name + '»?',
      text: used
        ? 'У ній є справи (' + count + '). Категорія зникне зі списку для нових справ, а старі справи залишаться з нею.'
        : 'Категорія зникне зі списку.',
      ok: 'Видалити',
      danger: true,
    });
    if (!ok) return;
    commit((data) => {
      if (used) data.categories.find((c) => c.id === id).archived = true;
      else data.categories = data.categories.filter((c) => c.id !== id);
    });
    toast(used ? 'Категорію приховано, старі справи на місці' : 'Категорію видалено');
  }

  function restoreCategory(id) {
    commit((data) => {
      const cat = data.categories.find((c) => c.id === id);
      if (cat) cat.archived = false;
    });
    toast('Категорію повернуто');
  }

  /* ---------- Діалоги й повідомлення ---------- */

  function openDialog(html) {
    dialog.innerHTML = html;
    const heading = dialog.querySelector('h2');
    if (heading) {
      heading.id = 'dialog-title';
      dialog.setAttribute('aria-labelledby', 'dialog-title');
    }
    if (!dialog.open) dialog.showModal();
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
  }

  // Питання «так / ні» у вікні. Повертає Promise<boolean>
  function confirmBox({ title, text = '', ok = 'Так', danger = false }) {
    return new Promise((resolve) => {
      openDialog(`
        <div class="sheet">
          <h2>${esc(title)}</h2>
          ${text ? `<p>${esc(text)}</p>` : ''}
          <footer class="sheet-foot">
            <button type="button" class="btn" data-answer="no">Скасувати</button>
            <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-answer="yes">${esc(ok)}</button>
          </footer>
        </div>`);
      const onClick = (event) => {
        const button = event.target.closest('[data-answer]');
        if (button) finish(button.dataset.answer === 'yes');
      };
      const onClose = () => finish(false);
      function finish(answer) {
        dialog.removeEventListener('click', onClick);
        dialog.removeEventListener('close', onClose);
        closeDialog();
        resolve(answer);
      }
      dialog.addEventListener('click', onClick);
      dialog.addEventListener('close', onClose);
    });
  }

  // Коротке повідомлення внизу екрана. Нове замінює попереднє, щоб вони не накопичувались
  function toast(text, tone) {
    const el = document.createElement('div');
    el.className = 'toast' + (tone ? ' ' + tone : '');
    el.textContent = text;
    toasts.replaceChildren(el);
    setTimeout(() => el.remove(), tone === 'error' ? 6000 : 3000);
  }

  function renderCorrupt(result) {
    app.innerHTML = `
      <main class="wrap">
        <section class="card">
          <h1>Збережені дані пошкоджені</h1>
          <p class="hint">${esc(result.error)}</p>
          <p class="hint">Я нічого не змінюю, доки ти не вирішиш, що робити.</p>
        </section>
      </main>`;
  }

  /* ---------- Події ---------- */

  app.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const id = el.dataset.id;
    switch (el.dataset.action) {
      case 'tab':
        // Повторне натискання «Сьогодні» повертає до сьогоднішнього дня
        if (el.dataset.tab === 'today' && state.tab === 'today') state.day = todayKey();
        state.tab = el.dataset.tab;
        render();
        window.scrollTo(0, 0);
        break;
      case 'day-prev':
        state.day = T.addDays(state.day, -1);
        render();
        break;
      case 'day-next':
        state.day = T.addDays(state.day, 1);
        render();
        break;
      case 'day-today':
        state.day = todayKey();
        render();
        break;
      case 'task-add':
        openTaskForm();
        break;
      case 'task-edit':
        openTaskForm({ taskId: id });
        break;
      case 'task-done':
        openTaskForm({ taskId: id, markDone: true });
        break;
      case 'task-delete':
        deleteTask(id);
        break;
      case 'cat-add':
        openCategoryForm(null);
        break;
      case 'cat-edit':
        openCategoryForm(id);
        break;
      case 'cat-delete':
        deleteCategory(id);
        break;
      case 'cat-restore':
        restoreCategory(id);
        break;
    }
  });

  app.addEventListener('input', (event) => {
    const form = event.target.form;
    if (form && form.id === 'schedule-form') {
      document.getElementById('schedule-preview').textContent = schedulePreview(form.elements.wake.value, form.elements.sleep.value);
      document.getElementById('schedule-error').textContent = '';
    }
  });

  app.addEventListener('submit', (event) => {
    if (event.target.id === 'schedule-form') {
      event.preventDefault();
      saveSchedule(event.target);
    }
  });

  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="dialog-close"]')) closeDialog();
  });

  dialog.addEventListener('input', (event) => {
    const form = event.target.form;
    if (form && form.id === 'task-form') updateTaskForm(form);
  });

  dialog.addEventListener('change', (event) => {
    const form = event.target.form;
    if (!form || form.id !== 'task-form') return;
    if (event.target.name === 'status') onStatusChange(form);
    updateTaskForm(form);
  });

  dialog.addEventListener('submit', (event) => {
    event.preventDefault();
    if (event.target.id === 'task-form') submitTaskForm(event.target);
    if (event.target.id === 'category-form') submitCategoryForm(event.target);
  });

  dialog.addEventListener('close', () => {
    state.form = null;
    dialog.innerHTML = '';
  });

  // Щосекунди: оновити «живі» числа; щохвилини — увесь екран; опівночі — перейти на новий день
  function tick() {
    const now = Date.now();
    const key = T.dayKeyOf(now);
    const minute = Math.floor(now / T.MINUTE);
    if (key !== state.today) {
      if (state.day === state.today) state.day = key;
      state.today = key;
      state.minute = minute;
      render();
    } else if (minute !== state.minute) {
      state.minute = minute;
      if (state.tab === 'today') render();
      else updateLive();
    } else {
      updateLive();
    }
  }

  // Сторінку відкрито в іншій вкладці й там щось змінили — підтягуємо зміни
  window.addEventListener('storage', (event) => {
    if (event.key !== S.STORAGE_KEY || !state.data) return;
    const result = S.load();
    if (result.status === 'ok' || result.status === 'empty') {
      state.data = result.data;
      render();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.data) tick();
  });

  /* ---------- Запуск ---------- */

  function init() {
    const result = S.load();
    if (result.status === 'corrupt') {
      renderCorrupt(result);
      return;
    }
    state.data = result.data;
    if (result.status === 'unavailable') state.saveError = result.error;
    state.today = todayKey();
    state.day = state.today;
    state.minute = Math.floor(Date.now() / T.MINUTE);
    render();
    if (result.problems.length) {
      toast('Частину даних було пошкоджено й виправлено: ' + result.problems.join('; ') + '.', 'error');
    }
    setInterval(tick, 1000);
  }

  init();
})();
