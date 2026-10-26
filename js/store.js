/*
 * Бюджет часу — збереження даних.
 *
 * Усе зберігається тут, у браузері (localStorage), під одним ключем
 * і нікуди не відправляється. Перед використанням дані завжди перевіряються:
 * пошкоджений запис не повинен «зламати» сторінку.
 */
(function () {
  'use strict';
  const TB = (globalThis.TB = globalThis.TB || {});
  const T = TB.time;
  const C = TB.calc;

  const STORAGE_KEY = 'timeBudget';
  const VERSION = 1;

  // Кольори категорій. Порядок і відтінки перевірено: сусідні кольори добре
  // розрізняються на темному тлі, зокрема людьми з порушеннями кольорового зору.
  const PALETTE = [
    { color: '#d95926', name: 'помаранчевий' },
    { color: '#3987e5', name: 'синій' },
    { color: '#199e70', name: 'бірюзовий' },
    { color: '#9085e9', name: 'фіолетовий' },
    { color: '#c98500', name: 'жовтий' },
    { color: '#d55181', name: 'малиновий' },
    { color: '#008300', name: 'зелений' },
    { color: '#e66767', name: 'червоний' },
  ];

  const DEFAULT_CATEGORIES = [
    { id: 'food', name: 'Їжа й побут', color: '#d95926' },
    { id: 'study', name: 'Навчання', color: '#3987e5' },
    { id: 'sport', name: 'Спорт', color: '#199e70' },
    { id: 'rest', name: 'Відпочинок', color: '#9085e9' },
    { id: 'work', name: 'Робота', color: '#c98500' },
    { id: 'other', name: 'Інше', color: '#d55181' },
  ];

  const MAX_TITLE = 80;
  const MAX_CATEGORY_NAME = 40;
  const MAX_SLOT = 7 * 24 * T.HOUR; // найдовша справа: забутий на тиждень таймер

  function defaultData() {
    return {
      version: VERSION,
      schedules: [{ from: '2000-01-01', wake: '07:00', sleep: '23:00' }],
      categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, archived: false })),
      tasks: [],
      timer: null,
    };
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isMoment = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const isColor = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  const isText = (v) => typeof v === 'string' && v.trim() !== '';
  const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  // Відрізок часу: повертає виправлений відрізок, null (відрізка немає)
  // або undefined (відрізок зіпсований)
  function cleanSlot(slot) {
    if (slot == null) return null;
    if (!isObject(slot)) return undefined;
    if (slot.start != null) {
      const ok = isMoment(slot.start) && isMoment(slot.end)
        && slot.end > slot.start && slot.end - slot.start <= MAX_SLOT;
      return ok ? { start: slot.start, end: slot.end } : undefined;
    }
    const ok = T.isDayKey(slot.day) && typeof slot.minutes === 'number'
      && slot.minutes >= 1 && slot.minutes <= 1440;
    return ok ? { day: slot.day, minutes: Math.round(slot.minutes) } : undefined;
  }

  // Перевіряє дані (зі сховища або з файлу копії) і лагодить дрібні вади.
  // Повертає { data, problems }, де problems — список того, що довелося виправити.
  // Якщо це взагалі не дані програми — кидає помилку.
  function normalize(raw) {
    if (!isObject(raw) || !Array.isArray(raw.categories) || !Array.isArray(raw.tasks)) {
      throw new Error('Це не схоже на дані «Бюджету часу».');
    }
    if (typeof raw.version === 'number' && raw.version > VERSION) {
      throw new Error('Ці дані створено новішою версією програми.');
    }
    const problems = [];

    let schedules = (Array.isArray(raw.schedules) ? raw.schedules : [])
      .filter((s) => isObject(s) && T.isDayKey(s.from) && !C.scheduleError(s.wake, s.sleep))
      .map((s) => ({ from: s.from, wake: T.formatHM(T.parseHM(s.wake)), sleep: T.formatHM(T.parseHM(s.sleep)) }))
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    if (!schedules.length) {
      schedules = defaultData().schedules;
      problems.push('розклад дня скинуто до 07:00–23:00');
    }

    const categories = [];
    const categoryIds = new Set();
    let badCategories = 0;
    for (const c of raw.categories) {
      if (!isObject(c) || !isText(c.id) || categoryIds.has(c.id) || !isText(c.name)) {
        badCategories++;
        continue;
      }
      categoryIds.add(c.id);
      categories.push({
        id: c.id,
        name: cleanText(c.name, MAX_CATEGORY_NAME),
        color: isColor(c.color) ? c.color.toLowerCase() : PALETTE[categories.length % PALETTE.length].color,
        archived: c.archived === true,
      });
    }
    if (badCategories) problems.push('пропущено пошкоджених категорій: ' + badCategories);

    const tasks = [];
    const taskIds = new Set();
    let badTasks = 0;
    for (const t of raw.tasks) {
      const plan = isObject(t) ? cleanSlot(t.plan) : undefined;
      const fact = isObject(t) ? cleanSlot(t.fact) : undefined;
      if (!isObject(t) || !isText(t.id) || taskIds.has(t.id) || !isText(t.categoryId)
        || plan === undefined || fact === undefined || (!plan && !fact)) {
        badTasks++;
        continue;
      }
      taskIds.add(t.id);
      tasks.push({
        id: t.id,
        categoryId: t.categoryId,
        title: cleanText(t.title, MAX_TITLE),
        plan,
        fact,
        created: isMoment(t.created) ? t.created : 0,
      });
    }
    if (badTasks) problems.push('пропущено пошкоджених справ: ' + badTasks);

    // Справа посилається на категорію, якої немає, — відновлюємо її як приховану
    let lostCategories = 0;
    for (const task of tasks) {
      if (!categoryIds.has(task.categoryId)) {
        categoryIds.add(task.categoryId);
        categories.push({ id: task.categoryId, name: 'Без назви', color: '#898781', archived: true });
        lostCategories++;
      }
    }
    if (lostCategories) problems.push('відновлено категорій без назви: ' + lostCategories);

    // Має лишитися хоча б одна категорія, у яку можна додавати справи
    if (!categories.some((c) => !c.archived)) {
      for (const def of DEFAULT_CATEGORIES) {
        const existing = categories.find((c) => c.id === def.id);
        if (existing) existing.archived = false;
        else categories.push({ ...def, archived: false });
      }
      problems.push('повернуто стандартні категорії');
    }

    let timer = null;
    if (raw.timer != null) {
      const tm = raw.timer;
      if (isObject(tm) && isMoment(tm.start) && isText(tm.categoryId) && categoryIds.has(tm.categoryId)) {
        timer = {
          categoryId: tm.categoryId,
          title: cleanText(tm.title, MAX_TITLE),
          start: tm.start,
          taskId: isText(tm.taskId) ? tm.taskId : null,
        };
      } else {
        problems.push('пошкоджений таймер вимкнено');
      }
    }

    return { data: { version: VERSION, schedules, categories, tasks, timer }, problems };
  }

  // Читає дані зі сховища браузера. status:
  //   'empty'       — даних ще немає (перший запуск),
  //   'ok'          — усе гаразд (problems — що довелося виправити),
  //   'corrupt'     — дані пошкоджені, raw — те, що вдалося прочитати,
  //   'unavailable' — браузер не дає доступу до сховища.
  function load() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return { status: 'unavailable', data: defaultData(), problems: [], error: describeError(error) };
    }
    if (raw == null || raw.trim() === '') return { status: 'empty', data: defaultData(), problems: [] };
    try {
      const { data, problems } = normalize(JSON.parse(raw));
      return { status: 'ok', data, problems };
    } catch (error) {
      const reason = error instanceof SyntaxError ? 'Запис пошкоджено, його не вдається прочитати.' : error.message;
      return { status: 'corrupt', raw, error: reason };
    }
  }

  // Записує дані. Якщо браузер не дає записати — кидає помилку
  function save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  // Зрозуміле пояснення, чому не вдалося зберегти
  function describeError(error) {
    const name = error && error.name;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      return 'У браузері закінчилося місце для даних.';
    }
    if (name === 'SecurityError') {
      return 'Браузер не дозволяє цій сторінці зберігати дані. Перевір, чи не заблоковано дані сайтів і чи це не приватне вікно.';
    }
    return 'Не вдалося зберегти дані: ' + (error && error.message ? error.message : 'невідома помилка') + '.';
  }

  TB.store = {
    STORAGE_KEY, VERSION, PALETTE, DEFAULT_CATEGORIES, MAX_TITLE, MAX_CATEGORY_NAME, MAX_SLOT,
    defaultData, newId, normalize, load, save, describeError,
  };
})();
