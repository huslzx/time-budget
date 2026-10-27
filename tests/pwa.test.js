// Тести встановлення на телефон (PWA) і перевірка перед публікацією в інтернеті.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(ROOT, file));

// Ширина й висота PNG записані в його заголовку
function pngSize(file) {
  const bytes = fs.readFileSync(path.join(ROOT, file));
  assert.equal(bytes.toString('latin1', 1, 4), 'PNG', file + ' — не PNG');
  return bytes.readUInt32BE(16) + 'x' + bytes.readUInt32BE(20);
}

// Усі файли папки проєкту, крім службової папки git — саме їх можна завантажити на сайт
function projectFiles(dir = ROOT) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? projectFiles(full) : [path.relative(ROOT, full).split(path.sep).join('/')];
  });
}

// Файли, без яких програма не працює
const appFiles = () => projectFiles().filter((file) => file === 'index.html' || file === 'manifest.webmanifest'
  || /^(css|js|icons)\//.test(file));

describe('встановлення на телефон (PWA)', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));

  test('manifest: назва, запуск і вигляд як окремого застосунку', () => {
    assert.equal(manifest.name, 'Бюджет часу');
    assert.ok(manifest.short_name.length <= 12, 'коротка назва вміщається під іконкою');
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.background_color, '#0d0d0d');
    assert.equal(manifest.lang, 'uk');
  });

  test('manifest: іконки 192 і 512, окремо «maskable» для Android, розміри справжні', () => {
    for (const icon of manifest.icons) {
      assert.ok(exists(icon.src), icon.src + ' існує');
      assert.equal(pngSize(icon.src), icon.sizes, icon.src);
    }
    const sizes = manifest.icons.map((icon) => icon.sizes + ' ' + icon.purpose);
    assert.deepEqual(sizes, ['192x192 any', '512x512 any', '512x512 maskable']);
  });

  test('сторінка підключає manifest, іконки й налаштування для iPhone', () => {
    const html = read('index.html');
    assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
    assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
    assert.match(html, /<link rel="icon" href="icons\/icon\.svg"/);
    assert.match(html, /name="apple-mobile-web-app-title" content="Бюджет часу"/);
    assert.equal(pngSize('icons/apple-touch-icon.png'), '180x180');
    assert.ok(exists('icons/icon.svg'));
  });

  test('скрипти підключено в правильному порядку', () => {
    const scripts = [...read('index.html').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(scripts, ['js/time.js', 'js/calc.js', 'js/store.js', 'js/app.js']);
  });

  test('поле імпорту без фільтра за типом, щоб телефон «бачив» файл копії', () => {
    assert.match(read('index.html'), /<input type="file" id="import-file" hidden>/);
  });

  test('service worker зберігає для роботи без інтернету всі файли програми — і лише їх', () => {
    const source = read('sw.js');
    const cached = [...source.match(/const FILES = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);
    assert.equal(cached[0], '', 'перший — сама адреса програми «./»');
    const files = cached.slice(1);
    for (const file of files) assert.ok(exists(file), file + ' існує');
    assert.deepEqual([...files].sort(), appFiles().sort(), 'список у sw.js збігається з файлами програми');
  });

  test('service worker прибирає лише власні старі кеші', () => {
    const source = read('sw.js');
    assert.match(source, /const CACHE = 'time-budget-v\d+';/);
    assert.match(source, /key\.startsWith\('time-budget-'\)/);
  });

  test('service worker не чіпає localStorage: дані лишаються лише на пристрої', () => {
    // Перевіряємо сам код, без коментарів (у коментарі про localStorage якраз пояснення)
    const code = read('sw.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /localStorage|timeBudget/);
  });
});

describe('перед публікацією: нічого особистого', () => {
  const files = projectFiles();
  const textFiles = files.filter((file) => !/\.png$/.test(file));
  const contents = Object.fromEntries(textFiles.map((file) => [file, read(file)]));

  test('немає експортів даних і пошкоджених записів', () => {
    assert.deepEqual(files.filter((file) => /time-budget-.*\.(json|txt)$/.test(file)), []);
    assert.deepEqual(files.filter((file) => /\.json$/.test(file)), ['package.json'], 'єдиний JSON — package.json');
  });

  test('немає файлів із ключами чи паролями', () => {
    const risky = files.filter((file) => /(^|\/)(\.env.*|id_rsa.*|.*\.pem|.*\.key|.*\.p12|.*\.pfx|\.npmrc|\.netrc)$/.test(file));
    assert.deepEqual(risky, []);
  });

  test('у файлах немає токенів і ключів доступу', () => {
    // Шаблони складено з частин, щоб цей файл сам не потрапив під перевірку
    const patterns = [
      new RegExp('gh' + 'p_[A-Za-z0-9]{20,}'),
      new RegExp('github' + '_pat_[A-Za-z0-9_]{20,}'),
      new RegExp('-----BEGIN [A-Z ]*' + 'PRIVATE KEY-----'),
      new RegExp('AK' + 'IA[0-9A-Z]{16}'),
      new RegExp('s' + 'k-[A-Za-z0-9]{20,}'),
      new RegExp('AI' + 'za[0-9A-Za-z_-]{35}'),
      new RegExp('xo' + 'x[baprs]-[A-Za-z0-9-]{10,}'),
    ];
    for (const [file, text] of Object.entries(contents)) {
      for (const pattern of patterns) assert.doesNotMatch(text, pattern, file);
    }
  });

  test('у файлах немає адрес електронної пошти', () => {
    const email = new RegExp('[A-Za-z0-9._%+-]+' + '@' + '[A-Za-z0-9.-]+\\.[A-Za-z]{2,}');
    for (const [file, text] of Object.entries(contents)) assert.doesNotMatch(text, email, file);
  });

  test('у файлах немає особистих шляхів на комп’ютері', () => {
    const home = new RegExp('/' + 'Users/[^/\\s]+');
    for (const [file, text] of Object.entries(contents)) assert.doesNotMatch(text, home, file);
  });
});
