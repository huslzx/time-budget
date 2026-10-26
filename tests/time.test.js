// Тести роботи з часом: показ тривалості, введення, дні тижня.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { T, H, M } = require('./helpers.js');

describe('годинник тестів', () => {
  test('тести йдуть у часовому поясі Europe/Warsaw', () => {
    assert.equal(new Date(2026, 6, 1, 12).getTimezoneOffset(), -120); // літо: UTC+2
    assert.equal(new Date(2026, 11, 1, 12).getTimezoneOffset(), -60); // зима: UTC+1
  });
});

describe('показ тривалості', () => {
  test('години й хвилини', () => {
    assert.equal(T.formatDuration(8.5 * H), '8 год 30 хв');
    assert.equal(T.formatDuration(2 * H), '2 год');
    assert.equal(T.formatDuration(45 * M), '45 хв');
    assert.equal(T.formatDuration(0), '0 хв');
  });

  test('від’ємна тривалість — зі знаком мінус', () => {
    assert.equal(T.formatDuration(-2.25 * H), '−2 год 15 хв');
  });

  test('для зворотного відліку неповна хвилина відкидається', () => {
    const almost = 6 * H + 12 * M + 50 * 1000;
    assert.equal(T.formatDuration(almost, 'floor'), '6 год 12 хв');
    assert.equal(T.formatDuration(almost), '6 год 13 хв');
  });

  test('секундомір таймера', () => {
    assert.equal(T.formatClock(H + 5 * M + 9000), '1:05:09');
  });
});

describe('введення тривалості', () => {
  test('години можна писати з комою або крапкою', () => {
    assert.equal(T.parseDuration('1,5', ''), 90);
    assert.equal(T.parseDuration('1.5', ''), 90);
    assert.equal(T.parseDuration('2', '15'), 135);
    assert.equal(T.parseDuration('', '90'), 90);
  });

  test('неправильне введення не приймається', () => {
    assert.ok(Number.isNaN(T.parseDuration('', '')));
    assert.ok(Number.isNaN(T.parseDuration('півтори', '')));
    assert.ok(Number.isNaN(T.parseDuration('1', '-5')));
  });
});

describe('дні', () => {
  test('сусідні дні й назви', () => {
    assert.equal(T.addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(T.addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(T.formatDate('2026-10-26'), 'понеділок, 26 жовтня');
    assert.equal(T.formatDateShort('2026-10-30'), 'пт 30.10');
    assert.equal(T.relativeDay('2026-10-27', '2026-10-26'), 'Завтра');
    assert.equal(T.relativeDay('2026-10-25', '2026-10-26'), 'Вчора');
  });

  test('дні переведення годинника не «з’їдають» дату', () => {
    assert.equal(T.addDays('2026-10-25', 1), '2026-10-26');
    assert.equal(T.addDays('2026-03-29', 1), '2026-03-30');
    assert.equal(T.daysBetween('2026-03-28', '2026-03-30'), 2);
  });

  test('неіснуючі дати не приймаються', () => {
    assert.equal(T.isDayKey('2026-02-29'), false);
    assert.equal(T.isDayKey('2028-02-29'), true);
    assert.equal(T.isDayKey('26.10.2026'), false);
  });
});
