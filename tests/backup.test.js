// Тести резервної копії (експорт і імпорт) та читання даних зі сховища браузера.
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { S, at, timed, untimed } = require('./helpers.js');

const NOW = at('2026-10-26', '18:45');

// Дані, схожі на справжні: різні справи, прихована категорія, змінений розклад, таймер
function sampleData() {
  const data = S.defaultData();
  data.schedules.push({ from: '2026-10-20', wake: '07:30', sleep: '23:30' });
  data.categories.push({ id: 'road', name: 'Дорога', color: '#008300', archived: true });
  const lunch = timed('2026-10-26', '13:00', '13:45', { category: 'food', title: 'Обід' });
  const study = untimed('2026-10-26', 240, { category: 'study', title: 'Матаналіз' });
  study.fact = { start: at('2026-10-26', '09:00'), end: at('2026-10-26', '12:00') };
  const night = timed('2026-10-25', '22:30', '00:30', { category: 'rest', status: 'planned' });
  const bus = untimed('2026-10-24', 40, { category: 'road', status: 'done' });
  data.tasks.push(lunch, study, night, bus);
  data.timer = { categoryId: 'sport', title: 'Біг', start: at('2026-10-26', '18:30'), taskId: null };
  return data;
}

// Сховище браузера для тестів
function fakeStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
}

describe('експорт', () => {
  test('файл копії: позначка програми, версія, час і всі дані', () => {
    const data = sampleData();
    const file = JSON.parse(S.exportText(data, NOW));
    assert.equal(file.app, 'time-budget');
    assert.equal(file.version, 1);
    assert.equal(file.exportedAt, new Date(NOW).toISOString());
    assert.deepEqual(file.data, data);
  });

  test('назва файлу містить дату й час', () => {
    assert.equal(S.backupFileName(NOW), 'time-budget-2026-10-26-1845.json');
  });

  test('опис копії: справи, категорії, період, таймер', () => {
    assert.deepEqual(S.describeBackup(sampleData()), { tasks: 4, categories: 6, from: '2026-10-24', to: '2026-10-26', timer: true });
    assert.deepEqual(S.describeBackup(S.defaultData()), { tasks: 0, categories: 6, from: null, to: null, timer: false });
  });
});

describe('імпорт', () => {
  test('експорт → імпорт повертає ті самі дані', () => {
    const data = sampleData();
    const result = S.parseBackup(S.exportText(data, NOW));
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, data);
    assert.deepEqual(result.problems, []);
    assert.equal(result.exportedAt, NOW);
  });

  test('приймає й «сирі» дані без конверта (як вони лежать у сховищі)', () => {
    const data = sampleData();
    const result = S.parseBackup(JSON.stringify(data));
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, data);
    assert.equal(result.exportedAt, null);
  });

  test('не JSON — зрозуміла помилка', () => {
    const result = S.parseBackup('це просто текст');
    assert.equal(result.ok, false);
    assert.match(result.error, /не вдається прочитати/);
  });

  test('обрізаний файл (копіювання перервалось) — помилка', () => {
    const text = S.exportText(sampleData(), NOW);
    assert.equal(S.parseBackup(text.slice(0, text.length / 2)).ok, false);
  });

  test('файл іншої програми — помилка', () => {
    assert.match(S.parseBackup('{"app":"fullbody-tracker","data":{}}').error, /іншої програми/);
    assert.match(S.parseBackup('{"hello":"world"}').error, /не схоже на дані «Бюджету часу»/);
    assert.match(S.parseBackup('[1,2,3]').error, /не схоже на дані «Бюджету часу»/);
  });

  test('порожній або завеликий файл — помилка', () => {
    assert.equal(S.parseBackup('').error, 'Файл порожній.');
    assert.match(S.parseBackup('{}', 50 * 1024 * 1024).error, /завеликий/);
  });

  test('копія новішої версії програми — помилка', () => {
    const file = JSON.stringify({ app: 'time-budget', version: 99, data: S.defaultData() });
    assert.match(S.parseBackup(file).error, /новішою версією/);
  });

  test('копія з кількома пошкодженими справами: решта імпортується, проблеми названо', () => {
    const data = sampleData();
    data.tasks.push({ id: 'broken', categoryId: 'study', plan: { start: 'вчора', end: 5 } });
    data.tasks.push('зовсім не справа');
    const result = S.parseBackup(S.exportText(data, NOW));
    assert.equal(result.ok, true);
    assert.equal(result.data.tasks.length, 4);
    assert.deepEqual(result.problems, ['пропущено пошкоджених справ: 2']);
  });

  test('копія, де пошкоджено всі справи, не імпортується', () => {
    const data = S.defaultData();
    data.tasks.push({ id: 'x', categoryId: 'study', plan: null, fact: null });
    assert.match(S.parseBackup(JSON.stringify(data)).error, /немає жодної неушкодженої справи/);
  });

  test('перевірка нічого не змінює у вхідних даних', () => {
    const text = S.exportText(sampleData(), NOW);
    const before = text.slice();
    S.parseBackup(text);
    assert.equal(text, before);
  });
});

describe('дані у сховищі браузера', () => {
  beforeEach(() => {
    globalThis.localStorage = fakeStorage();
  });

  test('порожнє сховище — перший запуск зі стандартними даними', () => {
    const result = S.load();
    assert.equal(result.status, 'empty');
    assert.deepEqual(result.data, S.defaultData());
  });

  test('збережене читається назад без змін', () => {
    const data = sampleData();
    S.save(data);
    const result = S.load();
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data, data);
    assert.equal(result.raw, undefined);
  });

  test('пошкоджений запис: статус «пошкоджено», а сам запис не зачіпається', () => {
    globalThis.localStorage = fakeStorage({ timeBudget: '{"tasks": [зламано' });
    const result = S.load();
    assert.equal(result.status, 'corrupt');
    assert.equal(result.raw, '{"tasks": [зламано');
    assert.equal(localStorage.getItem('timeBudget'), '{"tasks": [зламано');
  });

  test('чужі дані під нашим ключем — теж «пошкоджено»', () => {
    globalThis.localStorage = fakeStorage({ timeBudget: '{"hello":1}' });
    assert.equal(S.load().status, 'corrupt');
  });

  test('частково пошкоджені дані: працюємо з рештою, а початковий запис віддаємо для порятунку', () => {
    const data = sampleData();
    data.tasks.push({ id: 'broken' });
    const raw = JSON.stringify(data);
    globalThis.localStorage = fakeStorage({ timeBudget: raw });
    const result = S.load();
    assert.equal(result.status, 'ok');
    assert.equal(result.data.tasks.length, 4);
    assert.deepEqual(result.problems, ['пропущено пошкоджених справ: 1']);
    assert.equal(result.raw, raw);
  });

  test('сховище недоступне — програма працює, але попереджає', () => {
    globalThis.localStorage = { getItem() { const e = new Error('blocked'); e.name = 'SecurityError'; throw e; } };
    const result = S.load();
    assert.equal(result.status, 'unavailable');
    assert.match(result.error, /не дозволяє/);
  });

  test('«Видалити всі дані» прибирає запис, і наступний запуск — як перший', () => {
    S.save(sampleData());
    assert.equal(S.clear(), null);
    assert.equal(S.load().status, 'empty');
  });

  test('повний цикл: експорт → видалення → імпорт → ті самі дані', () => {
    const original = sampleData();
    S.save(original);
    const file = S.exportText(S.load().data, NOW);
    S.clear();
    const imported = S.parseBackup(file);
    S.save(imported.data);
    assert.deepEqual(S.load().data, original);
  });
});
