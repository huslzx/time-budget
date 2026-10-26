/*
 * Бюджет часу — дати й час.
 *
 * Момент часу — це число мілісекунд, як у Date.getTime().
 * День — рядок 'РРРР-ММ-ДД' за місцевим часом, наприклад '2026-10-26'.
 *
 * Перетворення «день + година:хвилина» → момент робить браузер за часовим
 * поясом комп'ютера (Europe/Warsaw). Тому перехід на літній і зимовий час
 * враховується сам: тривалість — це завжди різниця двох моментів.
 */
(function () {
  'use strict';
  const TB = (globalThis.TB = globalThis.TB || {});

  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;

  const WEEKDAYS = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'п’ятниця', 'субота'];
  const WEEKDAYS_SHORT = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
    'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function splitKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return { y, m, d };
  }

  // День, на який припадає момент ms
  function dayKeyOf(ms) {
    const date = new Date(ms);
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function isDayKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const { y, m, d } = splitKey(value);
    const date = new Date(y, m - 1, d, 12);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  }

  // Дні додаються за календарем, а не по 24 години:
  // у дні переведення годинника доба триває 23 або 25 годин.
  function addDays(key, n) {
    const { y, m, d } = splitKey(key);
    return dayKeyOf(new Date(y, m - 1, d + n, 12).getTime());
  }

  // Скільки календарних днів від fromKey до toKey
  function daysBetween(fromKey, toKey) {
    const a = splitKey(fromKey);
    const b = splitKey(toKey);
    return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / (24 * HOUR));
  }

  // Момент, коли в день key годинник показує minutes хвилин від півночі.
  // 1440 — північ у кінці дня, тобто 00:00 наступного дня.
  function atMinutes(key, minutes) {
    const { y, m, d } = splitKey(key);
    return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60).getTime();
  }

  function dayStart(key) {
    return atMinutes(key, 0);
  }

  function dayEnd(key) {
    return dayStart(addDays(key, 1));
  }

  // '07:30' → 450 хвилин; неправильний рядок → NaN
  function parseHM(text) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(text == null ? '' : text).trim());
    if (!match) return NaN;
    const h = Number(match[1]);
    const m = Number(match[2]);
    return h > 23 || m > 59 ? NaN : h * 60 + m;
  }

  function formatHM(minutes) {
    const m = ((minutes % 1440) + 1440) % 1440;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  function minutesOfDay(ms) {
    const date = new Date(ms);
    return date.getHours() * 60 + date.getMinutes();
  }

  function timeOf(ms) {
    return formatHM(minutesOfDay(ms));
  }

  // Розкладає тривалість на знак, години й хвилини.
  // mode 'floor' відкидає неповну хвилину (для зворотного відліку), інакше округлює.
  function durationParts(ms, mode) {
    const minutes = Math.abs(ms) / MINUTE;
    const total = mode === 'floor' ? Math.floor(minutes) : Math.round(minutes);
    return { sign: ms < 0 && total > 0 ? '−' : '', h: Math.floor(total / 60), m: total % 60 };
  }

  // 30 600 000 мс → '8 год 30 хв'
  function formatDuration(ms, mode) {
    const { sign, h, m } = durationParts(ms, mode);
    const text = h && m ? h + ' год ' + m + ' хв' : h ? h + ' год' : m + ' хв';
    return sign + text;
  }

  // Секундомір таймера: 1:05:09
  function formatClock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 3600) + ':' + pad2(Math.floor(s / 60) % 60) + ':' + pad2(s % 60);
  }

  // Тривалість із полів форми: години (можна '1,5') і хвилини → ціле число хвилин.
  // Порожньо або неправильно → NaN.
  function parseDuration(hoursText, minutesText) {
    const h = String(hoursText == null ? '' : hoursText).trim().replace(',', '.');
    const m = String(minutesText == null ? '' : minutesText).trim();
    if (h === '' && m === '') return NaN;
    if (h !== '' && !/^(\d+(\.\d*)?|\.\d+)$/.test(h)) return NaN;
    if (m !== '' && !/^\d+$/.test(m)) return NaN;
    return Math.round((h === '' ? 0 : Number(h)) * 60 + (m === '' ? 0 : Number(m)));
  }

  // День тижня: 0 — неділя, 1 — понеділок…
  function weekday(key) {
    const { y, m, d } = splitKey(key);
    return new Date(y, m - 1, d, 12).getDay();
  }

  // '2026-10-26' → 'понеділок, 26 жовтня'
  function formatDate(key) {
    const { m, d } = splitKey(key);
    return WEEKDAYS[weekday(key)] + ', ' + d + ' ' + MONTHS[m - 1];
  }

  // '2026-10-26' → '26 жовтня'; рік додається, якщо він не поточний
  function formatDayMonth(key, todayKey) {
    const { y, m, d } = splitKey(key);
    const year = todayKey && Number(todayKey.slice(0, 4)) !== y ? ' ' + y : '';
    return d + ' ' + MONTHS[m - 1] + year;
  }

  // '2026-10-26' → 'пн 26.10'
  function formatDateShort(key) {
    const { m, d } = splitKey(key);
    return WEEKDAYS_SHORT[weekday(key)] + ' ' + d + '.' + pad2(m);
  }

  // 'Сьогодні', 'Завтра', 'Вчора' або '' для інших днів
  function relativeDay(key, todayKey) {
    const diff = daysBetween(todayKey, key);
    if (diff === 0) return 'Сьогодні';
    if (diff === 1) return 'Завтра';
    if (diff === -1) return 'Вчора';
    return '';
  }

  TB.time = {
    MINUTE, HOUR, WEEKDAYS, WEEKDAYS_SHORT, MONTHS,
    pad2, dayKeyOf, isDayKey, addDays, daysBetween, atMinutes, dayStart, dayEnd,
    parseHM, formatHM, minutesOfDay, timeOf, durationParts, formatDuration, formatClock,
    parseDuration, weekday, formatDate, formatDayMonth, formatDateShort, relativeDay,
  };
})();
