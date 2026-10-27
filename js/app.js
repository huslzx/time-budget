/*
 * Бюджет часу — інтерфейс.
 *
 * Цей файл малює екрани й відповідає на натискання кнопок.
 * Розрахунки беруться з calc.js, збереження — зі store.js.
 * Після кожної зміни даних екран малюється заново, а «живі» частини
 * (числа, секундомір таймера, позначка «зараз» на шкалі) оновлюються щосекунди окремо.
 */
(function () {
  'use strict';
  const { time: T, calc: C, store: S } = globalThis.TB;

  const app = document.getElementById('app');
  const dialog = document.getElementById('dialog');
  const toasts = document.getElementById('toasts');

  // Якщо сторінка була прихована довше за це, а таймер ішов, — питаємо, чи його не забули
  const AWAY_LIMIT = 30 * T.MINUTE;

  const state = {
    data: null, // усі дані програми (див. store.js)
    tab: 'today', // відкрита вкладка
    day: '', // день, який показує вкладка «Сьогодні»
    today: '', // сьогоднішня дата — щоб помітити північ
    minute: -1, // поточна хвилина — щоб раз на хвилину оновлювати екран
    saveError: null, // текст помилки, якщо дані не вдається зберегти
    form: null, // відкрита форма: { taskId, markDone, ackOverlap } або { categoryId }
    timeline: null, // межі намальованої шкали дня: { key, from, to }
    hiddenAt: null, // коли сторінку сховали (перейшли на іншу вкладку чи програму)
    summaryMode: 'day', // «Підсумки»: 'day' або 'week'
    weekEnd: '', // останній день тижня, який показують «Підсумки»
    weekPick: null, // день, вибраний на графіку тижня
    weekTableOpen: false, // чи розгорнута таблиця по днях
    corrupt: null, // пошкоджені дані у сховищі: { error, raw } — тоді показуємо екран порятунку
    loadIssue: null, // частину даних виправлено під час читання: { problems, raw }
    ticking: false, // чи запущено щосекундне оновлення
    updateReady: false, // на сайті з'явилась нова версія програми (див. sw.js)
  };

  const TABS = [
    { id: 'today', label: 'Сьогодні', icon: 'sun' },
    { id: 'summary', label: 'Підсумки', icon: 'chart' },
    { id: 'settings', label: 'Налаштування', icon: 'sliders' },
  ];

  const WEEK_HINT = 'Наведи на день або натисни на нього, щоб побачити, з чого він склався.';

  const KIND_LABEL = { done: 'виконано', planned: 'заплановано', running: 'іде зараз' };

  // Значки з набору Lucide (lucide.dev, ліцензія ISC). ring — власний: кільце-«бюджет», як іконка програми
  const ICONS = {
    ring: '<circle cx="12" cy="12" r="8" stroke="#3a3a37" stroke-width="3"/><path d="M12 4A8 8 0 1 1 4.75 15.38" stroke-width="3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    sliders: '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
    upload: '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  };

  /* ---------- Дрібні помічники ---------- */

  function icon(name) {
    return '<svg class="icon icon-' + name + '" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
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

  // Що записує таймер: введена назва, назва справи або категорія
  function timerName(timer) {
    if (timer.title.trim()) return timer.title.trim();
    const linked = C.timerTask(state.data.tasks, timer);
    return linked ? taskName(linked) : category(timer.categoryId).name;
  }

  // Назва учасника накладання: справа або таймер
  function itemName(id) {
    if (id === 'timer') return state.data.timer ? 'таймер «' + timerName(state.data.timer) + '»' : 'таймер';
    const task = state.data.tasks.find((t) => t.id === id);
    return '«' + (task ? taskName(task) : 'справа') + '»';
  }

  // ««Навчання» (10:00–12:00), таймер «Спорт» (11:00–11:30)»
  function conflictText(conflicts) {
    return conflicts.map((c) => itemName(c.id) + ' (' + T.timeOf(c.start) + '–' + T.timeOf(c.end) + ')').join(', ');
  }

  // Назва дня для повідомлень: «сьогодні», «завтра» або «пт 30.10»
  function dayLabel(key) {
    const rel = T.relativeDay(key, todayKey());
    return rel ? rel.toLowerCase() : T.formatDateShort(key);
  }

  // «сьогодні о 10:05», «вчора о 21:00»
  function whenText(ms) {
    return dayLabel(T.dayKeyOf(ms)) + ' о ' + T.timeOf(ms);
  }

  // Користувач саме щось вводить — тоді не перемальовуємо екран, щоб не збити введення
  function isTyping() {
    const el = document.activeElement;
    return !!el && app.contains(el) && el.tagName === 'INPUT';
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
    const main = state.tab === 'settings' ? renderSettings()
      : state.tab === 'summary' ? renderSummary()
        : renderToday();
    app.innerHTML = renderTopbar() + '<main class="wrap" id="main">'
      + renderUpdateNotice() + renderSaveError() + renderLoadIssue() + main + '</main>';
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
          <div class="brand">${icon('ring')}<span>Бюджет часу</span></div>
          <nav class="tabs" aria-label="Розділи" style="--tabs:${TABS.length}">${tabs}</nav>
          <span class="clock" id="clock" aria-label="Зараз"></span>
        </div>
      </header>`;
  }

  function renderUpdateNotice() {
    if (!state.updateReady) return '';
    return `
      <div class="alert info" role="status">${icon('download')}
        <div><b>Є нова версія програми.</b> Твої дані залишаться на місці.
          <div class="alert-actions">
            <button type="button" class="btn small" data-action="app-reload">Оновити</button>
          </div>
        </div>
      </div>`;
  }

  function renderSaveError() {
    if (!state.saveError) return '';
    return `
      <div class="alert danger" role="alert">${icon('alert')}
        <div><b>Дані не зберігаються.</b> ${esc(state.saveError)} Зміни зникнуть, щойно закриєш сторінку.
          <div class="alert-actions">
            <button type="button" class="btn small" data-action="data-export">${icon('download')}Зберегти копію у файл</button>
          </div>
        </div>
      </div>`;
  }

  // Під час читання частину даних довелося пропустити — кажемо про це й даємо врятувати початковий запис
  function renderLoadIssue() {
    if (!state.loadIssue) return '';
    return `
      <div class="alert warn" role="alert">${icon('alert')}
        <div><b>Частину збережених даних пошкоджено.</b> Програма працює з тим, що вдалося прочитати
          (${esc(state.loadIssue.problems.join('; '))}).
          <div class="alert-actions">
            <button type="button" class="btn small" data-action="issue-download">${icon('download')}Завантажити початковий запис</button>
            <button type="button" class="btn small" data-action="data-import">${icon('upload')}Імпортувати з копії</button>
            <button type="button" class="btn small" data-action="issue-dismiss">Зрозуміло</button>
          </div>
        </div>
      </div>`;
  }

  /* ---------- Вкладка «Сьогодні» ---------- */

  // Назва дня зі стрілками ‹ ›. tag — 'h1' на «Сьогодні», 'h2' у «Підсумках»
  function renderDayHead(key, tag) {
    const tKey = todayKey();
    const rel = T.relativeDay(key, tKey);
    return `
      <section class="day-head">
        <button type="button" class="icon-btn" data-action="day-prev" aria-label="Попередній день">${icon('left')}</button>
        <div class="day-title">
          <${tag}>${esc(rel || capitalize(T.WEEKDAYS[T.weekday(key)]))}</${tag}>
          <p>${esc(rel ? T.formatDate(key) : T.formatDayMonth(key, tKey))}</p>
        </div>
        <button type="button" class="icon-btn" data-action="day-next" aria-label="Наступний день">${icon('right')}</button>
      </section>
      ${key !== tKey ? '<p class="center"><button type="button" class="link" data-action="day-today">Повернутися до сьогодні</button></p>' : ''}`;
  }

  function renderToday() {
    const key = state.day;
    const tKey = todayKey();
    const item = C.scheduleFor(state.data.schedules, key);
    const budget = C.dayBudget(state.data.schedules, key);
    return `
      ${renderDayHead(key, 'h1')}
      <p class="schedule-line">Підйом ${item.wake} · Відбій ${item.sleep} · Бюджет дня ${T.formatDuration(budget)}</p>
      ${renderTimerCard()}
      <section class="stats">
        ${statCard('free', 'Вільний бюджет')}
        ${statCard('sleep', 'До відбою')}
        ${statCard('lost', 'Загублений час')}
      </section>
      <div id="alerts"></div>
      ${renderTimeline(key)}
      ${key === tKey ? renderQuickStart() : ''}
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

  // Оновлює все, що залежить від поточного часу. Викликається щосекунди.
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

    // Секундомір таймера
    const timerClock = document.getElementById('timer-clock');
    if (timerClock && timer) timerClock.textContent = T.formatClock(now - timer.start);

    updateTimeline(key, now);
    setHTML(document.getElementById('alerts'), renderAlerts(key, now));
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

  // Попередження: «Не встигнеш» і справи, що накладаються
  function renderAlerts(key, now) {
    const { schedules, tasks, timer } = state.data;
    let html = '';
    const op = C.overplan(schedules, tasks, key, timer, now);
    if (op) {
      html += `
        <div class="alert warn">${icon('alert')}
          <div><b>Не встигнеш:</b> плану на ${T.formatDuration(op.planned)}, а часу лишилось ${T.formatDuration(op.left, 'floor')}.</div>
        </div>`;
    }
    const pairs = C.overlaps(tasks, key, timer, now);
    if (pairs.length) {
      const rows = pairs.slice(0, 5).map((pair) => {
        const fix = fixTarget(pair);
        return `<li>${esc(itemName(pair.a))} і ${esc(itemName(pair.b))}: ${T.timeOf(pair.start)}–${T.timeOf(pair.end)}
          ${fix ? `<button type="button" class="link inline" data-action="task-edit" data-id="${esc(fix)}">Виправити</button>` : ''}</li>`;
      }).join('');
      html += `
        <div class="alert warn">${icon('alert')}
          <div><b>Справи накладаються за часом.</b> Перевір, чи правильно вказано час.
            <ul class="alert-list">${rows}</ul>
          </div>
        </div>`;
    }
    return html;
  }

  // Яку справу з пари запропонувати виправити: пізнішу, і не ту, що зараз іде за таймером
  function fixTarget(pair) {
    const linked = C.timerTask(state.data.tasks, state.data.timer);
    const candidates = [pair.a, pair.b]
      .map((id) => state.data.tasks.find((t) => t.id === id))
      .filter((task) => task && task !== linked)
      .sort((x, y) => C.currentSlot(y).start - C.currentSlot(x).start);
    return candidates.length ? candidates[0].id : null;
  }

  /* ---------- Таймер ---------- */

  function renderTimerCard() {
    const timer = state.data.timer;
    if (!timer) return '';
    const cat = category(timer.categoryId);
    const linked = C.timerTask(state.data.tasks, timer);
    const plan = linked && linked.plan ? ' · план ' + T.formatDuration(C.slotLength(linked.plan)) : '';
    return `
      <section class="timer-card" style="--cat:${esc(cat.color)}" aria-label="Таймер">
        <div class="timer-top">
          <span class="timer-cat"><i class="dot"></i>${esc(cat.name)}</span>
          <span>почато ${esc(whenText(timer.start))}${esc(plan)}</span>
        </div>
        <div class="timer-row">
          <div class="timer-clock" id="timer-clock">${T.formatClock(Date.now() - timer.start)}</div>
          <button type="button" class="btn primary" data-action="timer-stop">${icon('stop')}Зупинити</button>
        </div>
        <input type="text" id="timer-title" maxlength="${S.MAX_TITLE}" autocomplete="off"
          placeholder="Що саме робиш? (необов’язково)" aria-label="Що саме робиш" value="${esc(timer.title)}">
      </section>`;
  }

  function renderQuickStart() {
    const timer = state.data.timer;
    const chips = activeCategories().map((c) => {
      const running = timer && !timer.taskId && timer.categoryId === c.id;
      return `
        <button type="button" class="start-chip" style="--cat:${esc(c.color)}" data-action="timer-start" data-id="${esc(c.id)}"
          aria-pressed="${running ? 'true' : 'false'}" aria-label="Почати таймер: ${esc(c.name)}">
          ${icon('play')}${esc(c.name)}
        </button>`;
    }).join('');
    return `
      <section class="quick">
        <div class="section-head"><h2>Почати зараз</h2></div>
        <div class="start-list">${chips}</div>
        <p class="hint">Натисни категорію — піде таймер. «Зупинити» збереже справу з реальним часом.</p>
      </section>`;
  }

  // Запуск таймера: для категорії (categoryId) або для запланованої справи (taskId)
  async function startTimer({ categoryId = null, taskId = null }) {
    const task = taskId ? state.data.tasks.find((t) => t.id === taskId && !t.fact) : null;
    if (taskId && !task) return;
    const catId = task ? task.categoryId : categoryId;
    const name = task ? taskName(task) : category(catId).name;
    const current = state.data.timer;
    if (current) {
      const same = task ? current.taskId === task.id : !current.taskId && current.categoryId === catId;
      if (same) {
        toast('Цей таймер уже йде.');
        return;
      }
      const ok = await confirmBox({
        title: 'Перемкнути таймер?',
        text: 'Зараз іде «' + timerName(current) + '» (' + T.formatDuration(Date.now() - current.start, 'floor')
          + '). Зупинити його, записати справу й почати «' + name + '»?',
        ok: 'Зупинити й почати',
      });
      if (!ok || !state.data.timer) return;
      const error = finishTimer(Date.now(), { quiet: true });
      if (error) {
        toast(error, 'error');
        return;
      }
    }
    commit((data) => {
      data.timer = { categoryId: catId, title: task ? task.title : '', start: Date.now(), taskId: task ? task.id : null };
    });
    toast('Таймер запущено: ' + name);
  }

  // Зупиняє таймер у момент end і записує справу. Повертає текст помилки або null
  function finishTimer(end, { quiet = false } = {}) {
    const timer = state.data.timer;
    if (!timer) return null;
    const error = C.timerEndError(timer, end, Date.now(), S.MAX_SLOT);
    if (error) return error;
    const result = C.timerResult(state.data.tasks, timer, end);
    let saved = null;
    commit((data) => {
      data.timer = null;
      if (!result) return;
      let task = result.taskId && data.tasks.find((t) => t.id === result.taskId);
      if (!task) {
        task = { id: S.newId(), categoryId: timer.categoryId, title: '', plan: null, fact: null, created: Date.now() };
        data.tasks.push(task);
      }
      const title = timer.title.trim().replace(/\s+/g, ' ').slice(0, S.MAX_TITLE);
      if (title) task.title = title;
      task.fact = result.slot;
      saved = task;
    });
    if (quiet) return null;
    if (!saved) {
      toast('Таймер ішов менше хвилини — справу не збережено.');
      return null;
    }
    const day = T.dayKeyOf(saved.fact.start);
    const where = day === todayKey() ? '' : ' (' + dayLabel(day) + ')';
    const conflicts = C.slotConflicts(state.data.tasks, saved.fact, saved.id, null, Date.now());
    if (conflicts.length) {
      toast('Збережено' + where + ', але справа накладається на ' + conflictText(conflicts) + '.', 'error');
    } else {
      toast('Збережено' + where + ': «' + taskName(saved) + '», ' + T.formatDuration(C.slotLength(saved.fact)));
    }
    return null;
  }

  function toLocalInput(ms) {
    return T.dayKeyOf(ms) + 'T' + T.timeOf(ms);
  }

  function fromLocalInput(value) {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value || '');
    return match ? T.atMinutes(match[1], T.parseHM(match[2])) : NaN;
  }

  // «Таймер ще йде»: питаємо при відкритті сторінки і коли повертаєшся до неї після перерви
  function openForgottenTimer() {
    const timer = state.data && state.data.timer;
    if (!timer || dialog.open) return;
    const now = Date.now();
    const suggested = C.suggestTimerEnd(state.data.schedules, timer, now);
    openDialog(`
      <form class="sheet" id="forgotten-form" novalidate>
        <h2>Таймер ще йде</h2>
        <p>«${esc(timerName(timer))}» запущено ${esc(whenText(timer.start))}, минуло ${esc(T.formatDuration(now - timer.start, 'floor'))}. Ти не забув його вимкнути?</p>
        <div class="choice">
          <button type="button" class="btn" data-action="forgotten-keep">Продовжити</button>
          <button type="button" class="btn" data-action="forgotten-now">Зупинити зараз</button>
        </div>
        <label class="field">
          <span>Або вкажи, коли ти закінчив</span>
          <input type="datetime-local" name="end" value="${toLocalInput(suggested)}" min="${toLocalInput(timer.start)}" max="${toLocalInput(now)}">
        </label>
        <p class="form-error" id="forgotten-error" role="alert"></p>
        <footer class="sheet-foot">
          <button type="submit" class="btn primary">Зупинити о цьому часі</button>
        </footer>
      </form>`);
  }

  function stopForgotten(end) {
    const error = finishTimer(end);
    if (error) {
      document.getElementById('forgotten-error').textContent = error;
      return;
    }
    closeDialog();
  }

  /* ---------- Шкала дня ---------- */

  function timelinePct(ms) {
    const { from, to } = state.timeline;
    return +Math.min(100, Math.max(0, ((ms - from) / (to - from)) * 100)).toFixed(3);
  }

  // Частина дня, де порожні місця — загублений час: від підйому до «зараз» (або до відбою)
  function pastSpan(key, now) {
    const phase = C.dayPhase(state.data.schedules, key, now);
    if (phase === 'future' || phase === 'before') return null;
    const w = C.dayWindow(state.data.schedules, key);
    return [w.wake, Math.min(now, w.sleep)];
  }

  function renderTimeline(key) {
    const now = Date.now();
    const { schedules, tasks, timer } = state.data;
    const range = C.timelineRange(schedules, tasks, key, timer, now);
    const items = C.timelineItems(tasks, key, timer, now);
    state.timeline = { key, from: range.from, to: range.to };
    const w = C.dayWindow(schedules, key);
    const isToday = key === todayKey();
    const lanes = items.reduce((max, item) => Math.max(max, item.lane + 1), 1);
    const width = Math.min(app.clientWidth || 360, 760) - 64;
    const step = C.pickTickStep((range.to - range.from) / T.HOUR, width);
    const ticks = [];
    for (let t = range.from; t <= range.to; t += step * T.HOUR) ticks.push(t);
    const axis = ticks.map((t) => {
      const edge = t === range.from ? 'first' : t === range.to ? 'last' : '';
      return `<span class="${edge}" style="left:${timelinePct(t)}%">${T.timeOf(t)}</span>`;
    }).join('');
    const marks = [[w.wake, 'Підйом'], [w.sleep, 'Відбій']]
      .filter(([ms]) => ms > range.from && ms < range.to)
      .map(([ms, label]) => `<div class="tl-mark" style="left:${timelinePct(ms)}%" title="${label} о ${T.timeOf(ms)}"></div>`)
      .join('');
    const untimed = C.tasksForDay(tasks, key).filter((task) => !C.isTimed(C.currentSlot(task)));
    const past = pastSpan(key, now);
    return `
      <section class="timeline" aria-label="Шкала дня">
        <h2>Шкала дня</h2>
        <div class="tl-wrap">
          <div class="tl-track" style="--lanes:${lanes}">
            <div class="tl-past" id="tl-past" ${past ? '' : 'hidden'}></div>
            ${marks}
            ${items.map(renderBlock).join('')}
          </div>
          ${isToday ? '<div class="tl-now" id="tl-now" hidden><span>зараз</span></div>' : ''}
        </div>
        <div class="tl-axis" aria-hidden="true">${axis}</div>
        ${untimed.length ? `<div class="tl-untimed"><span class="hint">Без часу:</span>${untimed.map(renderUntimedChip).join('')}</div>` : ''}
        <div class="tl-legend">
          <span><i class="lg done"></i>виконано</span>
          <span><i class="lg planned"></i>заплановано</span>
          ${past ? '<span><i class="lg past"></i>минуло від підйому; порожні місця — загублений час</span>' : ''}
          ${isToday ? '<span><i class="lg now"></i>зараз</span>' : ''}
        </div>
      </section>`;
  }

  function renderBlock(item) {
    const cat = category(item.categoryId);
    const task = state.data.tasks.find((t) => t.id === item.id);
    const name = item.kind === 'running' ? timerName(state.data.timer) : task ? taskName(task) : cat.name;
    const until = item.kind === 'running' ? 'зараз' : T.timeOf(item.end);
    const label = name + ', ' + T.timeOf(item.start) + '–' + until + ', ' + KIND_LABEL[item.kind];
    const classes = 'tl-block ' + item.kind + (item.cutStart ? ' cut-start' : '') + (item.cutEnd ? ' cut-end' : '');
    const left = timelinePct(item.start);
    const width = +(timelinePct(item.end) - left).toFixed(3);
    return `
      <button type="button" class="${classes}" data-action="${item.kind === 'running' ? 'timer-focus' : 'task-edit'}"
        data-id="${esc(item.id)}" data-start="${item.start}" title="${esc(label)}" aria-label="${esc(label)}"
        style="--cat:${esc(cat.color)};--lane:${item.lane};left:${left}%;width:${width}%"></button>`;
  }

  function renderUntimedChip(task) {
    const cat = category(task.categoryId);
    const length = T.formatDuration(C.slotLength(C.currentSlot(task)));
    return `
      <button type="button" class="tl-chip ${task.fact ? 'done' : 'planned'}" style="--cat:${esc(cat.color)}"
        data-action="task-edit" data-id="${esc(task.id)}"><i class="dot"></i>${esc(taskName(task))} · ${length}</button>`;
  }

  // «Живі» частини шкали: позначка «зараз», минулий час і блок таймера, що росте
  function updateTimeline(key, now) {
    if (!state.timeline || state.timeline.key !== key) return;
    const nowEl = document.getElementById('tl-now');
    if (nowEl) {
      nowEl.hidden = now < state.timeline.from || now > state.timeline.to;
      nowEl.style.left = timelinePct(now) + '%';
    }
    const pastEl = document.getElementById('tl-past');
    const span = pastSpan(key, now);
    if (pastEl && span) {
      pastEl.hidden = false;
      pastEl.style.left = timelinePct(span[0]) + '%';
      pastEl.style.width = Math.max(0, timelinePct(span[1]) - timelinePct(span[0])) + '%';
    }
    const running = app.querySelector('.tl-block.running');
    if (running) {
      running.style.width = Math.max(0, timelinePct(now) - timelinePct(Number(running.dataset.start))) + '%';
    }
  }

  /* ---------- Список справ ---------- */

  function renderTaskSection(key) {
    const now = Date.now();
    const { tasks, timer } = state.data;
    const list = C.tasksForDay(tasks, key);
    const clashes = {};
    for (const pair of C.overlaps(tasks, key, timer, now)) {
      (clashes[pair.a] = clashes[pair.a] || []).push(pair.b);
      (clashes[pair.b] = clashes[pair.b] || []).push(pair.a);
    }
    const addButton = `<button type="button" class="btn primary" data-action="task-add">${icon('plus')}Додати справу</button>`;
    return `
      <div class="section-head"><h2>Справи</h2>${list.length ? addButton : ''}</div>
      ${list.length
        ? '<ul class="tasks">' + list.map((task) => renderTask(task, key, now, clashes[task.id] || [])).join('') + '</ul>'
        : renderEmpty(key, addButton)}`;
  }

  function renderTask(task, key, now, clashIds) {
    const cat = category(task.categoryId);
    const done = !!task.fact;
    const slot = C.currentSlot(task);
    const name = taskName(task);
    const running = C.timerTask(state.data.tasks, state.data.timer) === task;
    const meta = [];
    if (task.title) meta.push(esc(cat.name));
    meta.push(esc(slotText(slot, key)));
    if (done && task.plan) meta.push('план: ' + esc(T.formatDuration(C.slotLength(task.plan))));
    const late = !done && !running && C.isTimed(slot) && slot.end <= now;
    const canStart = !done && !running && key === todayKey();
    const id = esc(task.id);
    let badge = '<span class="badge">Заплановано</span>';
    if (done) badge = `<span class="badge done">${icon('check')}Виконано</span>`;
    if (running) badge = `<span class="badge running">${icon('clock')}Іде зараз</span>`;
    return `
      <li class="task ${done ? 'is-done' : 'is-planned'}" style="--cat:${esc(cat.color)}">
        <div class="task-main">
          <div class="task-name">${esc(name)}</div>
          <div class="task-meta">${meta.join(' · ')}</div>
          ${late ? '<div class="task-late">Час минув — познач, як було насправді</div>' : ''}
          ${clashIds.length ? '<div class="task-warn">Накладається на ' + esc(clashIds.map(itemName).join(', ')) + '</div>' : ''}
        </div>
        <div class="task-side">
          <div class="task-dur">${T.formatDuration(C.slotOnDay(slot, key))}</div>
          ${badge}
        </div>
        <div class="task-actions">
          ${canStart ? `<button type="button" class="btn small" data-action="task-start" data-id="${id}">${icon('play')}Почати</button>` : ''}
          ${done || running ? '' : `<button type="button" class="btn small" data-action="task-done" data-id="${id}">${icon('check')}Виконано</button>`}
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
          <p>Між підйомом і відбоєм у тебе ${budget}. Додай першу справу, наприклад «Навчання, 4 год», або натисни категорію в «Почати зараз» — піде таймер.</p>
          ${addButton}
          <p class="hint">Є резервна копія? <button type="button" class="link inline" data-action="data-import">Імпортувати дані</button></p>
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
        <p class="form-warn" id="task-warn" role="alert"></p>
        <p class="form-error" id="task-error" role="alert"></p>
        ${sheetFoot('Зберегти')}
      </form>`);

    const form = document.getElementById('task-form');
    state.form = { taskId, markDone, ackOverlap: null };
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
    // Час змінили — попередження про накладання більше не стосується нового часу
    const slotKey = result.slot ? JSON.stringify(result.slot) : null;
    if (state.form && state.form.ackOverlap && state.form.ackOverlap !== slotKey) {
      state.form.ackOverlap = null;
      document.getElementById('task-warn').textContent = '';
      form.querySelector('button[type="submit"]').textContent = 'Зберегти';
    }
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
    const taskId = state.form.taskId;
    // Накладання: попереджаємо один раз; повторне «Зберегти» з тим самим часом — зберігає
    const conflicts = C.slotConflicts(state.data.tasks, slot, taskId, state.data.timer, Date.now());
    const slotKey = JSON.stringify(slot);
    if (conflicts.length && state.form.ackOverlap !== slotKey) {
      state.form.ackOverlap = slotKey;
      document.getElementById('task-warn').textContent = 'Накладається на ' + conflictText(conflicts)
        + '. Зміни час або натисни «Зберегти все одно».';
      form.querySelector('button[type="submit"]').textContent = 'Зберегти все одно';
      return;
    }
    const title = f.title.value.trim().replace(/\s+/g, ' ').slice(0, S.MAX_TITLE);
    let timerStopped = false;
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
        // Реальний час уже вписано вручну — таймер цієї справи більше не потрібен
        if (data.timer && data.timer.taskId === task.id) {
          data.timer = null;
          timerStopped = true;
        }
      }
    });
    closeDialog();
    const day = C.slotDay(slot);
    const note = timerStopped ? ' Таймер цієї справи вимкнено.' : '';
    if (day !== state.day) {
      state.day = day;
      render();
      toast('Збережено на ' + dayLabel(day) + '.' + note);
    } else {
      toast('Збережено.' + note);
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

  /* ---------- Вкладка «Підсумки» ---------- */

  function renderSummary() {
    const modes = [['day', 'День'], ['week', 'Тиждень']].map(([id, label]) => `
      <button type="button" data-action="summary-mode" data-id="${id}" aria-pressed="${state.summaryMode === id}">${label}</button>`).join('');
    return `
      <h1 class="page-title">Підсумки</h1>
      <div class="switch" role="group" aria-label="Підсумок за">${modes}</div>
      ${state.summaryMode === 'week' ? renderWeekSummary() : renderDaySummary()}`;
  }

  // Невелика картка з числом, як «Вільний бюджет» на головній
  function tile(label, valueHTML, hint, tone = '') {
    return `
      <div class="stat${tone ? ' ' + tone : ''}">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${valueHTML}</div>
        <div class="stat-hint">${esc(hint)}</div>
      </div>`;
  }

  // «зроблено на 40 хв менше», «точно за планом»…
  function diffText(fact, plan) {
    if (!fact) return 'нічого не зроблено';
    const diff = fact - plan;
    if (Math.abs(diff) < T.MINUTE) return 'зроблено точно за планом';
    return 'зроблено на ' + T.formatDuration(Math.abs(diff)) + (diff > 0 ? ' більше' : ' менше');
  }

  // Порівняння «план / факт» для категорії. judge = false — день ще не почався, судити рано
  function compareText(fact, plan, judge) {
    if (!plan) return 'без плану';
    const planned = 'план ' + T.formatDuration(plan);
    return judge ? planned + ' — ' + diffText(fact, plan) : planned;
  }

  function sumLegend() {
    return '<span class="sum-legend"><span><i class="lg fact"></i>зроблено</span><span><i class="lg plan-mark"></i>план</span></span>';
  }

  // Рядки категорій: смужка — зроблене, риска — план. kind: 'day' або 'week'
  function renderSumRows(rows, kind, budget, judge) {
    const scaleMax = Math.max(T.MINUTE, ...rows.map((row) => Math.max(row.fact, row.plan)));
    const pct = (ms) => +((ms / scaleMax) * 100).toFixed(2);
    return rows.map((row) => {
      const cat = category(row.categoryId);
      const value = kind === 'week'
        ? T.formatDuration(row.average) + ' <small>на день</small>'
        : T.formatDuration(row.fact) + ' <small>' + C.percentOf(row.fact, budget) + '%</small>';
      const sub = (kind === 'week' ? 'за тиждень ' + T.formatDuration(row.fact) + ' · ' : '') + compareText(row.fact, row.plan, judge);
      const label = cat.name + ': зроблено ' + T.formatDuration(row.fact) + ', ' + (row.plan ? 'план ' + T.formatDuration(row.plan) : 'без плану');
      return `
        <li class="sum-row" style="--cat:${esc(cat.color)}">
          <div class="sum-top">
            <span class="sum-name"><i class="dot"></i>${esc(cat.name)}</span>
            <span class="sum-value">${value}</span>
          </div>
          <div class="sum-bar" role="img" aria-label="${esc(label)}">
            ${row.fact ? `<span class="sum-fact" style="width:${pct(row.fact)}%"></span>` : ''}
            ${row.plan ? `<span class="sum-plan" style="left:${pct(row.plan)}%"></span>` : ''}
          </div>
          <div class="sum-sub">${esc(sub)}</div>
        </li>`;
    }).join('');
  }

  function renderDaySummary() {
    const now = Date.now();
    const key = state.day;
    const { schedules, tasks, timer } = state.data;
    const day = C.daySummary(schedules, tasks, key, timer, now);
    const head = renderDayHead(key, 'h2') + `<p class="schedule-line">Бюджет дня ${T.formatDuration(day.budget)}</p>`;
    if (!day.rows.length) return head + emptyDaySummary(day);
    // До початку дня ще рано казати «не зроблено»
    const judge = day.phase !== 'future' && day.phase !== 'before';
    const notes = [];
    if (timer && C.slotOnDay(C.timerSlot(timer, now), key) > 0) notes.push('Враховано таймер, що зараз іде.');
    if (day.split) notes.push('Справи, що переходять через північ, поділено між днями: тут лише частина цього дня.');
    notes.push('Відсотки — від бюджету дня, округлені.');
    const lostKnown = day.lost !== null;
    return head + `
      <section class="stats">
        ${tile('Зроблено', durationHTML(day.fact), C.percentOf(day.fact, day.budget) + '% бюджету дня')}
        ${tile('Заплановано', durationHTML(day.plan), day.plan ? (judge ? diffText(day.fact, day.plan) : 'на цей день') : 'плану не було')}
        ${tile('Загублено', lostKnown ? durationHTML(day.lost) : '—',
          lostKnown ? C.percentOf(day.lost, day.budget) + '% бюджету дня' : 'день ще не настав', lostKnown ? '' : 'quiet')}
      </section>
      <section class="card">
        <div class="sum-head"><h3>По категоріях</h3>${sumLegend()}</div>
        <ul class="sum-list">${renderSumRows(day.rows, 'day', day.budget, judge)}</ul>
        <p class="hint sum-notes">${notes.join(' ')}</p>
      </section>`;
  }

  function emptyDaySummary(day) {
    let title = 'Сьогодні ще нічого не записано';
    let text = day.lost ? 'Загублений час поки що — ' + T.formatDuration(day.lost) + '.' : 'День ще не почався.';
    if (day.phase === 'future') {
      title = 'На цей день ще нічого не заплановано';
      text = 'Додай справи, і тут з’явиться план по категоріях.';
    } else if (day.phase === 'past') {
      title = 'Цього дня справ не записано';
      text = 'Можливо, програмою тоді ще не користувались.';
    }
    return `
      <div class="empty">
        <p class="empty-title">${title}</p>
        <p>${esc(text)}</p>
        <button type="button" class="btn primary" data-action="task-add">${icon('plus')}Додати справу</button>
      </div>`;
  }

  function renderWeekSummary() {
    const now = Date.now();
    const tKey = todayKey();
    const endKey = state.weekEnd;
    const startKey = T.addDays(endKey, -6);
    const { schedules, tasks, timer } = state.data;
    const week = C.weekSummary(schedules, tasks, endKey, timer, now);
    const current = endKey >= tKey;
    const head = `
      <section class="day-head">
        <button type="button" class="icon-btn" data-action="week-prev" aria-label="Попередні 7 днів">${icon('left')}</button>
        <div class="day-title">
          <h2>${current ? 'Останні 7 днів' : '7 днів'}</h2>
          <p>${esc(T.formatDayRange(startKey, endKey, tKey))}</p>
        </div>
        <button type="button" class="icon-btn" data-action="week-next" aria-label="Наступні 7 днів" ${current ? 'disabled' : ''}>${icon('right')}</button>
      </section>
      ${current ? '' : '<p class="center"><button type="button" class="link" data-action="week-current">До останніх 7 днів</button></p>'}`;
    if (!week.recordedDays && !week.plan) {
      return head + `
        <div class="empty">
          <p class="empty-title">За ці 7 днів записів немає</p>
          <p>Підсумок тижня з’явиться, щойно запишеш хоча б одну справу.</p>
        </div>`;
    }
    const n = week.recordedDays;
    let note = n === 7 ? 'Записи є за всі 7 днів.'
      : n === 0 ? 'Зроблених справ ще немає — лише плани.'
        : 'Записи є за ' + n + ' ' + T.plural(n, 'день', 'дні', 'днів') + ' із 7 — середнє рахую лише за ці дні.';
    if (week.days.some((day) => day.key === tKey && day.fact > 0)) note += ' Сьогоднішній день ще триває.';
    const notes = ['Середнє на день — це зроблене за тиждень, поділене на дні із записами.'];
    if (week.days.some((day) => day.split)) notes.push('Справи, що переходять через північ, поділено між днями.');
    return head + `
      <p class="schedule-line">${esc(note)}</p>
      <section class="stats">
        ${tile('Зроблено в середньому', n ? durationHTML(week.averageFact) : '—', n ? 'на день' : 'ще немає даних', n ? '' : 'quiet')}
        ${tile('За 7 днів', durationHTML(week.fact), week.plan ? 'план ' + T.formatDuration(week.plan) + ' — ' + diffText(week.fact, week.plan) : 'плану не було')}
        ${tile('Загублено в середньому', week.averageLost === null ? '—' : durationHTML(week.averageLost),
          week.averageLost === null ? 'ще немає даних' : 'на день', week.averageLost === null ? 'quiet' : '')}
      </section>
      ${renderWeekChart(week)}
      <section class="card">
        <div class="sum-head"><h3>По категоріях</h3>${sumLegend()}</div>
        <ul class="sum-list">${renderSumRows(week.rows, 'week', 0, true)}</ul>
        <p class="hint sum-notes">${notes.join(' ')}</p>
      </section>
      ${renderWeekTable(week)}`;
  }

  // Стовпчиковий графік: кожен день — стовпчик із частин у кольорах категорій.
  // Риска над стовпчиком — скільки було заплановано, пунктир — бюджет дня.
  function renderWeekChart(week) {
    const tKey = todayKey();
    const scale = C.chartScale(Math.max(...week.days.map((day) => Math.max(day.fact, day.plan, day.budget))));
    const pct = (ms) => +((ms / scale.top) * 100).toFixed(3);
    const order = state.data.categories.map((c) => c.id);
    const byOrder = (a, b) => order.indexOf(a.categoryId) - order.indexOf(b.categoryId);
    const grid = [];
    for (let v = 0; v <= scale.top; v += scale.step) {
      grid.push(`<div class="wk-line" style="bottom:${pct(v)}%"><span>${v / T.HOUR}</span></div>`);
    }
    const columns = week.days.map((day) => {
      const segments = day.rows.filter((row) => row.fact > 0).sort(byOrder).map((row) => `
        <i style="--cat:${esc(category(row.categoryId).color)};flex-grow:${Math.max(1, Math.round(row.fact / T.MINUTE))}"></i>`).join('');
      const picked = state.weekPick === day.key;
      return `
        <button type="button" class="wk-col${day.key === tKey ? ' today' : ''}${picked ? ' picked' : ''}" data-action="week-pick"
          data-id="${day.key}" aria-pressed="${picked}" aria-label="${esc(weekDayLabel(day))}">
          <span class="wk-plot">
            <span class="wk-budget" style="bottom:${pct(day.budget)}%"></span>
            ${day.fact ? `<span class="wk-stack" style="height:${pct(day.fact)}%">${segments}</span>` : ''}
            ${day.plan ? `<span class="wk-plan" style="bottom:${pct(day.plan)}%"></span>` : ''}
          </span>
          <span class="wk-label"><b>${T.WEEKDAYS_SHORT[T.weekday(day.key)]}</b>${Number(day.key.slice(8))}</span>
        </button>`;
    }).join('');
    const used = new Set(week.days.flatMap((day) => day.rows.filter((row) => row.fact > 0).map((row) => row.categoryId)));
    const legend = state.data.categories.filter((c) => used.has(c.id))
      .map((c) => `<span><i class="lg" style="background:${esc(c.color)}"></i>${esc(c.name)}</span>`).join('');
    return `
      <section class="card chart-card">
        <h3>Зроблено по днях, год</h3>
        <div class="wk-chart">
          <div class="wk-grid" aria-hidden="true">${grid.join('')}</div>
          <div class="wk-cols">${columns}</div>
        </div>
        <div class="tl-legend">${legend}<span><i class="lg plan-tick"></i>план на день</span><span><i class="lg budget-line"></i>бюджет дня</span></div>
        <p class="wk-detail" id="wk-detail">${state.weekPick ? weekDetailHTML(state.weekPick) : WEEK_HINT}</p>
      </section>`;
  }

  // Опис дня словами — для програм читання з екрана
  function weekDayLabel(day) {
    const parts = day.rows.filter((row) => row.fact > 0)
      .map((row) => category(row.categoryId).name + ' ' + T.formatDuration(row.fact));
    let text = T.formatDate(day.key) + ': ';
    text += day.fact ? 'зроблено ' + T.formatDuration(day.fact) + ' (' + parts.join(', ') + ')' : 'нічого не зроблено';
    if (day.plan) text += ', план ' + T.formatDuration(day.plan);
    return text;
  }

  // Деталі дня під графіком: спершу число, потім назва
  function weekDetailHTML(key) {
    const { schedules, tasks, timer } = state.data;
    const day = C.daySummary(schedules, tasks, key, timer, Date.now());
    const items = day.rows.filter((row) => row.fact > 0).map((row) => {
      const cat = category(row.categoryId);
      return `<span class="wk-item"><i class="key" style="--cat:${esc(cat.color)}"></i><b>${T.formatDuration(row.fact)}</b> ${esc(cat.name)}</span>`;
    }).join('');
    const summary = (day.fact ? 'зроблено ' + T.formatDuration(day.fact) : 'нічого не зроблено')
      + (day.plan ? ', план ' + T.formatDuration(day.plan) : '');
    return `
      <span class="wk-detail-head"><b>${esc(capitalize(T.formatDate(key)))}</b> — ${esc(summary)}</span>
      ${items ? `<span class="wk-items">${items}</span>` : ''}
      <button type="button" class="link inline" data-action="summary-open-day" data-id="${key}">Підсумок цього дня →</button>`;
  }

  function showWeekDetail(key) {
    const box = document.getElementById('wk-detail');
    if (box) box.innerHTML = key ? weekDetailHTML(key) : WEEK_HINT;
  }

  // Ті самі числа, що й на графіку, — таблицею (для тих, кому зручніше читати цифри)
  function renderWeekTable(week) {
    const rows = week.days.map((day) => `
      <tr>
        <th scope="row">${esc(T.formatDateShort(day.key))}</th>
        <td>${day.fact ? T.formatDuration(day.fact) : '—'}</td>
        <td>${day.plan ? T.formatDuration(day.plan) : '—'}</td>
        <td>${day.fact && day.lost !== null ? T.formatDuration(day.lost) : '—'}</td>
      </tr>`).join('');
    return `
      <details class="card table-card" ${state.weekTableOpen ? 'open' : ''}>
        <summary>Таблиця по днях</summary>
        <table class="wk-table">
          <thead><tr><th scope="col">День</th><th scope="col">Зроблено</th><th scope="col">План</th><th scope="col">Загублено</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="hint">Прочерк — даних немає.</p>
      </details>`;
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
      </section>
      ${renderDataCard()}`;
  }

  function renderDataCard() {
    const n = state.data.tasks.length;
    return `
      <section class="card">
        <h2>Дані</h2>
        <p class="hint">Усе зберігається лише в цьому браузері на цьому комп’ютері й нікуди не відправляється. Зараз: ${n} ${T.plural(n, 'справа', 'справи', 'справ')}.</p>
        <div class="data-actions">
          <button type="button" class="btn primary" data-action="data-export">${icon('download')}Експортувати дані</button>
          <button type="button" class="btn" data-action="data-import">${icon('upload')}Імпортувати дані</button>
        </div>
        <p class="hint">Експорт зберігає файл-копію (JSON), зазвичай у папку «Завантаження». Імпорт відновлює дані з такого файлу: програма спершу перевірить файл і спитає підтвердження.</p>
        <div class="danger-zone">
          <button type="button" class="btn danger-outline" data-action="data-wipe">${icon('trash')}Видалити всі дані</button>
        </div>
      </section>`;
  }

  /* ---------- Резервна копія: експорт, імпорт, видалення ---------- */

  // Віддає браузеру файл на збереження (як звичайне завантаження)
  function downloadFile(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Зберігає копію всіх даних. На комп'ютері — звичайним завантаженням файлу,
  // на телефоні — через меню «Поділитися» (зберегти у «Файли», AirDrop, месенджер).
  // Повертає { name, shared }
  function exportData() {
    const now = Date.now();
    const name = S.backupFileName(now);
    const text = S.exportText(state.data, now);
    if (shareFile(name, text)) return { name, shared: true };
    downloadFile(name, text, 'application/json');
    return { name, shared: false };
  }

  // Меню «Поділитися» є лише на сенсорних пристроях, і то не всюди. true — якщо його відкрито
  function shareFile(name, text) {
    if (!navigator.canShare || !matchMedia('(pointer: coarse)').matches) return false;
    const file = new File([text], name, { type: 'application/json' });
    if (!navigator.canShare({ files: [file] })) return false;
    navigator.share({ files: [file], title: name }).catch((error) => {
      // Меню просто закрили — нічого не робимо; інша помилка — завантажуємо звичайним способом
      if (error.name !== 'AbortError') downloadFile(name, text, 'application/json');
    });
    return true;
  }

  function exportToast(result) {
    return result.shared
      ? 'Вибери, куди зберегти копію «' + result.name + '»: «Зберегти у Файли», AirDrop чи месенджер.'
      : 'Копію збережено: ' + result.name + ' (зазвичай у папці «Завантаження»).';
  }

  // Початковий (пошкоджений) запис зі сховища — у текстовий файл, щоб нічого не загубити
  function downloadDamaged(raw) {
    const now = Date.now();
    downloadFile(S.APP_ID + '-damaged-' + T.dayKeyOf(now) + '-' + T.timeOf(now).replace(':', '') + '.txt', raw, 'text/plain');
  }

  // «26.10.2026, 18:45»
  function formatStamp(ms) {
    const date = new Date(ms);
    return T.pad2(date.getDate()) + '.' + T.pad2(date.getMonth() + 1) + '.' + date.getFullYear() + ', ' + T.timeOf(ms);
  }

  function chooseImportFile() {
    const input = document.getElementById('import-file');
    input.value = '';
    input.click();
  }

  // Імпорт: спершу перевіряємо файл, потім показуємо, що в ньому, і лише після «Замінити дані» замінюємо
  async function importFile(file) {
    let text;
    try {
      text = await file.text();
    } catch (error) {
      await confirmBox({ title: 'Не вдалося прочитати файл', text: 'Браузер не зміг відкрити «' + file.name + '». Твої дані не змінено.', ok: 'Зрозуміло', cancel: null });
      return;
    }
    const result = S.parseBackup(text, file.size);
    if (!result.ok) {
      await confirmBox({ title: 'Цей файл не підходить', text: result.error + ' Твої дані не змінено.', ok: 'Зрозуміло', cancel: null });
      return;
    }
    const info = S.describeBackup(result.data);
    const period = !info.from ? '' : info.from === info.to
      ? ' (' + T.formatDayMonth(info.from, todayKey()) + ')'
      : ' (' + T.formatDayRange(info.from, info.to, todayKey()) + ')';
    const items = ['справ: ' + info.tasks + period, 'категорій: ' + info.categories];
    if (info.timer) items.push('у копії йде таймер — після імпорту програма спитає, що з ним робити');
    const now = state.data
      ? 'Зараз у програмі справ: ' + state.data.tasks.length + '. Усі поточні дані буде замінено даними з копії.'
      : 'Пошкоджені дані буде замінено даними з копії.';
    const ok = await confirmBox({
      title: 'Замінити дані копією?',
      html: `
        <p>Файл «${esc(file.name)}»${result.exportedAt ? ', копія від ' + esc(formatStamp(result.exportedAt)) : ''}.</p>
        <ul class="plain-list">${items.map((item) => '<li>' + esc(item) + '</li>').join('')}</ul>
        ${result.problems.length ? `<p class="form-warn">У файлі є пошкоджені записи (${esc(result.problems.join('; '))}). Їх буде пропущено.</p>` : ''}
        <p>${esc(now)}</p>`,
      ok: 'Замінити дані',
      danger: true,
      extra: state.data && state.data.tasks.length
        ? { label: 'Спершу зберегти поточні', onClick: () => (exportData().shared ? 'Копію передано ✓' : 'Копію збережено ✓') }
        : null,
    });
    if (!ok) return;
    const wasCorrupt = !state.data;
    state.data = result.data;
    state.corrupt = null;
    state.loadIssue = null;
    persist();
    if (wasCorrupt) startApp();
    else {
      resetView();
      render();
    }
    toast('Дані відновлено з копії: ' + info.tasks + ' ' + T.plural(info.tasks, 'справа', 'справи', 'справ') + '.');
    openForgottenTimer();
  }

  async function wipeData() {
    const count = state.data.tasks.length;
    const ok = await confirmBox({
      title: 'Видалити всі дані?',
      text: 'Зникнуть усі справи (' + count + '), категорії й налаштування. Скасувати це не можна.',
      ok: 'Видалити все',
      danger: true,
      extra: count
        ? { label: 'Спершу зберегти копію', onClick: () => (exportData().shared ? 'Копію передано ✓' : 'Копію збережено ✓') }
        : null,
    });
    if (!ok) return;
    const error = S.clear();
    state.data = S.defaultData();
    state.loadIssue = null;
    state.saveError = error;
    resetView();
    render();
    toast(error ? 'Не вдалося видалити дані зі сховища.' : 'Усі дані видалено.', error ? 'error' : '');
  }

  // Екран, коли дані у сховищі пошкоджені: нічого не змінюємо, доки людина не вибере
  function renderCorrupt() {
    app.innerHTML = `
      <header class="topbar">
        <div class="topbar-inner"><div class="brand">${icon('ring')}<span>Бюджет часу</span></div></div>
      </header>
      <main class="wrap">
        <section class="card corrupt">
          <h1>${icon('alert')}Збережені дані пошкоджені</h1>
          <p>${esc(state.corrupt.error)}</p>
          <p class="hint">Я нічого не змінюю, доки ти не вибереш, що робити.</p>
          <ol class="steps">
            <li>
              <button type="button" class="btn primary" data-action="data-import">${icon('upload')}Імпортувати з резервної копії</button>
              <span class="hint">Якщо в тебе є файл-копія, дані відновляться з нього.</span>
            </li>
            <li>
              <button type="button" class="btn" data-action="corrupt-download">${icon('download')}Завантажити пошкоджений запис</button>
              <span class="hint">Збереже те, що є зараз, у файл — про всяк випадок.</span>
            </li>
            <li>
              <button type="button" class="btn danger-outline" data-action="corrupt-reset">${icon('trash')}Почати з нуля</button>
              <span class="hint">Видалить пошкоджений запис і відкриє порожню програму.</span>
            </li>
          </ol>
        </section>
      </main>`;
  }

  async function resetCorrupt() {
    const ok = await confirmBox({
      title: 'Почати з нуля?',
      text: 'Пошкоджений запис буде видалено назавжди. Якщо хочеш його зберегти, спершу натисни «Завантажити пошкоджений запис».',
      ok: 'Почати з нуля',
      danger: true,
    });
    if (!ok) return;
    const error = S.clear();
    state.corrupt = null;
    state.data = S.defaultData();
    state.saveError = error;
    startApp();
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

  // Питання «так / ні» у вікні. Повертає Promise<boolean>.
  // html — готовий вміст замість text; cancel: null — лише одна кнопка (повідомлення);
  // extra — додаткова кнопка { label, onClick }, що не закриває вікно (onClick повертає новий підпис)
  function confirmBox({ title, text = '', html = '', ok = 'Так', cancel = 'Скасувати', danger = false, extra = null }) {
    return new Promise((resolve) => {
      openDialog(`
        <div class="sheet">
          <h2>${esc(title)}</h2>
          ${html || (text ? `<p>${esc(text)}</p>` : '')}
          <footer class="sheet-foot">
            ${cancel ? `<button type="button" class="btn" data-answer="no">${esc(cancel)}</button>` : ''}
            ${extra ? `<button type="button" class="btn" data-answer="extra">${esc(extra.label)}</button>` : ''}
            <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-answer="yes">${esc(ok)}</button>
          </footer>
        </div>`);
      const onClick = (event) => {
        const button = event.target.closest('[data-answer]');
        if (!button) return;
        if (button.dataset.answer === 'extra') {
          button.textContent = extra.onClick();
          button.disabled = true;
          return;
        }
        finish(button.dataset.answer === 'yes');
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
      case 'task-start':
        startTimer({ taskId: id });
        break;
      case 'timer-start':
        startTimer({ categoryId: id });
        break;
      case 'timer-stop': {
        const error = finishTimer(Date.now());
        if (error) openForgottenTimer();
        break;
      }
      case 'timer-focus': {
        const input = document.getElementById('timer-title');
        if (input) {
          input.scrollIntoView({ block: 'center', behavior: 'smooth' });
          input.focus({ preventScroll: true });
        }
        break;
      }
      case 'summary-mode':
        state.summaryMode = id;
        render();
        break;
      case 'summary-open-day':
        state.day = id;
        state.summaryMode = 'day';
        render();
        window.scrollTo(0, 0);
        break;
      case 'week-prev':
        state.weekEnd = T.addDays(state.weekEnd, -7);
        state.weekPick = null;
        render();
        break;
      case 'week-next': {
        const next = T.addDays(state.weekEnd, 7);
        state.weekEnd = next > todayKey() ? todayKey() : next;
        state.weekPick = null;
        render();
        break;
      }
      case 'week-current':
        state.weekEnd = todayKey();
        state.weekPick = null;
        render();
        break;
      case 'week-pick':
        // Натискання «закріплює» день під графіком; повторне — знімає вибір
        state.weekPick = state.weekPick === id ? null : id;
        app.querySelectorAll('.wk-col').forEach((col) => {
          const on = col.dataset.id === state.weekPick;
          col.classList.toggle('picked', on);
          col.setAttribute('aria-pressed', String(on));
        });
        showWeekDetail(state.weekPick || id);
        break;
      case 'data-export':
        toast(exportToast(exportData()));
        break;
      case 'app-reload':
        location.reload();
        break;
      case 'data-import':
        chooseImportFile();
        break;
      case 'data-wipe':
        wipeData();
        break;
      case 'issue-download':
        downloadDamaged(state.loadIssue.raw);
        break;
      case 'issue-dismiss':
        // Людина побачила попередження — зберігаємо виправлені дані
        state.loadIssue = null;
        persist();
        render();
        break;
      case 'corrupt-download':
        downloadDamaged(state.corrupt.raw);
        break;
      case 'corrupt-reset':
        resetCorrupt();
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
    // Назву справи таймера зберігаємо одразу, але без перемальовування
    if (event.target.id === 'timer-title' && state.data.timer) {
      state.data.timer.title = event.target.value.slice(0, S.MAX_TITLE);
      persist();
      return;
    }
    const form = event.target.form;
    if (form && form.id === 'schedule-form') {
      document.getElementById('schedule-preview').textContent = schedulePreview(form.elements.wake.value, form.elements.sleep.value);
      document.getElementById('schedule-error').textContent = '';
    }
  });

  app.addEventListener('keydown', (event) => {
    if (event.target.id === 'timer-title' && event.key === 'Enter') event.target.blur();
  });

  // Графік тижня: наведення мишею чи фокус клавіатурою показує деталі дня
  app.addEventListener('mouseover', (event) => {
    const col = event.target.closest('.wk-col');
    if (col) showWeekDetail(col.dataset.id);
  });

  app.addEventListener('mouseout', (event) => {
    const cols = event.target.closest('.wk-cols');
    if (cols && !cols.contains(event.relatedTarget)) showWeekDetail(state.weekPick);
  });

  app.addEventListener('focusin', (event) => {
    const col = event.target.closest('.wk-col');
    if (col) showWeekDetail(col.dataset.id);
  });

  // Пам'ятаємо, чи розгорнута таблиця, щоб щохвилинне оновлення її не згортало
  app.addEventListener('toggle', (event) => {
    if (event.target.classList.contains('table-card')) state.weekTableOpen = event.target.open;
  }, true);

  app.addEventListener('submit', (event) => {
    if (event.target.id === 'schedule-form') {
      event.preventDefault();
      saveSchedule(event.target);
    }
  });

  dialog.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'dialog-close':
      case 'forgotten-keep':
        closeDialog();
        break;
      case 'forgotten-now':
        stopForgotten(Date.now());
        break;
    }
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
    const form = event.target;
    if (form.id === 'task-form') submitTaskForm(form);
    if (form.id === 'category-form') submitCategoryForm(form);
    if (form.id === 'forgotten-form') stopForgotten(fromLocalInput(form.elements.end.value));
  });

  dialog.addEventListener('close', () => {
    state.form = null;
    dialog.innerHTML = '';
  });

  // Вибрали файл для імпорту
  document.getElementById('import-file').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) importFile(file);
  });

  // Поки кнопка миші чи палець натиснуті, екран не перемальовуємо: інакше кнопка
  // зникла б посеред натискання, і воно б «загубилось»
  let pointerDown = false;
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  document.addEventListener('pointerup', () => { pointerDown = false; }, true);
  document.addEventListener('pointercancel', () => { pointerDown = false; }, true);

  // Щосекунди: оновити «живі» частини; щохвилини — увесь екран; опівночі — перейти на новий день
  function tick() {
    if (!state.data) return; // відкрито екран пошкоджених даних
    const now = Date.now();
    const key = T.dayKeyOf(now);
    const minute = Math.floor(now / T.MINUTE);
    if (pointerDown) {
      updateLive(); // перемалюємо через секунду, коли натискання закінчиться
    } else if (key !== state.today) {
      if (state.day === state.today) state.day = key;
      if (state.weekEnd === state.today) state.weekEnd = key;
      state.today = key;
      state.minute = minute;
      render();
    } else if (minute !== state.minute) {
      state.minute = minute;
      if (state.tab !== 'settings' && !isTyping()) render();
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

  // Повернулися до сторінки після перерви, а таймер весь цей час ішов, — питаємо, чи його не забули
  document.addEventListener('visibilitychange', () => {
    if (!state.data) return;
    if (document.hidden) {
      state.hiddenAt = Date.now();
      return;
    }
    const away = state.hiddenAt ? Date.now() - state.hiddenAt : 0;
    state.hiddenAt = null;
    tick();
    if (state.data.timer && away > AWAY_LIMIT) openForgottenTimer();
  });

  // Ширина екрана змінилась — перемальовуємо, щоб підписи на шкалі не налазили один на одного
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.data && state.tab === 'today' && !isTyping()) render();
    }, 200);
  });

  /* ---------- Запуск ---------- */

  // Після імпорту чи видалення даних — назад до сьогоднішнього дня
  function resetView() {
    state.today = todayKey();
    state.day = state.today;
    state.weekEnd = state.today;
    state.weekPick = null;
  }

  function startApp() {
    resetView();
    state.minute = Math.floor(Date.now() / T.MINUTE);
    render();
    if (!state.ticking) {
      setInterval(tick, 1000);
      state.ticking = true;
    }
  }

  // Робота без інтернету й встановлення на телефон (PWA).
  // Service worker працює лише на сайті (https) або на localhost — не для файлу з диска.
  function setupOffline() {
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || local)) return;
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'update-ready' && !state.updateReady) {
        state.updateReady = true;
        if (state.data) render();
      }
    });
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Без service worker програма працює так само, лише не відкриється без інтернету
    });
    // Просимо браузер не видаляти дані цього сайту, коли бракує місця
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  function init() {
    setupOffline();
    const result = S.load();
    if (result.status === 'corrupt') {
      // Пошкоджені дані не чіпаємо: показуємо екран із варіантами порятунку
      state.corrupt = result;
      renderCorrupt();
      return;
    }
    state.data = result.data;
    if (result.status === 'unavailable') state.saveError = result.error;
    if (result.problems.length) state.loadIssue = { problems: result.problems, raw: result.raw };
    startApp();
    // Таймер іде ще з минулого разу — питаємо, чи його не забули вимкнути
    openForgottenTimer();
  }

  init();
})();
