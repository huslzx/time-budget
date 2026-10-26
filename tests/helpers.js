// Помічники для тестів. Завантажують файли програми так само, як браузер
// (звичайними скриптами), і створюють справи для перевірок.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const file of ['time.js', 'calc.js', 'store.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
  vm.runInThisContext(code, { filename: file });
}

const TB = globalThis.TB;
const T = TB.time;
const H = T.HOUR;
const M = T.MINUTE;

// Звичайний розклад: підйом о 07:00, відбій о 23:00
const SCHEDULE = [{ from: '2000-01-01', wake: '07:00', sleep: '23:00' }];

// Момент часу: день + 'ГГ:ХХ' за місцевим часом
function at(day, hm) {
  return T.atMinutes(day, T.parseHM(hm));
}

let counter = 0;

function makeTask(slot, { status, category = 'study', title = '' }) {
  counter++;
  return {
    id: 't' + counter,
    categoryId: category,
    title,
    plan: status === 'planned' ? slot : null,
    fact: status === 'done' ? slot : null,
    created: counter,
  };
}

// Справа з часом. Якщо кінець раніше за початок — він наступного дня.
function timed(day, from, to, { status = 'done', ...rest } = {}) {
  const endDay = T.parseHM(to) <= T.parseHM(from) ? T.addDays(day, 1) : day;
  return makeTask({ start: at(day, from), end: at(endDay, to) }, { status, ...rest });
}

// Справа без часу — лише тривалість у хвилинах
function untimed(day, minutes, { status = 'planned', ...rest } = {}) {
  return makeTask({ day, minutes }, { status, ...rest });
}

module.exports = { T, C: TB.calc, S: TB.store, H, M, SCHEDULE, at, timed, untimed };
