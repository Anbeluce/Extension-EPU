const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'background/calendar-sync.js'), 'utf8'), context);
const dates = Array.from({ length: 7 }, (_, i) => `${16 + i}/11/2026`);
const block = (classes, title, href = '/detail') =>
  `<div class="content ${classes}"><b><a href="${href}">${title}</a></b><span>Giờ</span>: 7:00 - 09:00 <span>Phòng</span>: <font>A1</font></div>`;
const html = (content) => `<thead><tr><th>Ca</th>${dates.map(d => `<th class="day"><br/>${d}</th>`).join('')}</tr></thead><tbody><tr><td>Sáng</td><td>${content}</td>${'<td></td>'.repeat(6)}</tr></tbody>`;
const parse = (value) => JSON.parse(JSON.stringify(context.parseCalendarHtml(value)));

test('sync range starts at today after configured start and skips completed ranges', () => {
  const configContext = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), configContext);
  const today = new Date(2026, 10, 17, 15);
  const range = (fromDate, toDate) => configContext.calendarSyncRange({ fromDate, toDate }, today);
  assert.equal(range('2026-10-01', '2027-01-31').startIso, '2026-11-17');
  assert.equal(range('2026-12-01', '2027-01-31').startIso, '2026-12-01');
  assert.equal(range('', '2027-01-31').startIso, '2026-11-17');
  assert.equal(range('2026-10-01', '2026-11-16').expired, true);
  assert.equal(range('2026-10-01', '2026-11-17').expired, undefined);
  assert.equal(range('2026-10-01', '2026-11-17').startIso, '2026-11-17');
  assert.equal(range('2026-10-01', '').endIso, '2026-12-24');
  assert.ok(range('2026-12-01', '2026-11-01').error);
});

test('parse mixed classes and exams, including fallback and HTML entities', () => {
  const result = parse(html(block('color-lichhoc', 'Môn &amp; học') + block('color-lichthi', 'Thi 1') + block('color-lichthi-final', 'Thi 2') + block('', 'Thi 3', 'javascript:')));
  assert.equal(result.dates.length, 7);
  assert.deepEqual(result.events.map(e => e.type), ['class', 'exam', 'exam', 'exam']);
  assert.equal(result.events[0].title, 'Môn & học');
  assert.equal(result.events[1].title, '[THI] Thi 1');
  assert.equal(result.events[1].teacher, 'Chưa rõ');
  assert.equal(result.events[1].startTime, '07:00');
});

test('empty week is valid, malformed week aborts instead of erasing data', () => {
  assert.equal(parse(html('')).events.length, 0);
  assert.throws(() => parse(html('').replace('22/11/2026', 'invalid')));
  assert.throws(() => parse(html(block('color-lichthi', 'Thi').replace('7:00 - 09:00', 'unknown'))));
});

test('actual lich-thi.html: read all four exams without color-lichthi class', () => {
  const sample = fs.readFileSync(path.join(__dirname, 'fixtures/lich-thi.html'), 'utf8');
  const result = parse(sample);
  assert.deepEqual(result.dates, ['04/01/2027', '05/01/2027', '06/01/2027', '07/01/2027', '08/01/2027', '09/01/2027', '10/01/2027']);
  assert.deepEqual(result.events, [
    { date: '04/01/2027', type: 'exam', title: '[THI] Kiểm thử xâm nhập hệ thống mạng', startTime: '07:50', endTime: '09:40', room: 'CS1.A212', teacher: 'Chưa rõ' },
    { date: '08/01/2027', type: 'exam', title: '[THI] Hệ phân tán', startTime: '07:50', endTime: '09:40', room: 'CS1.A208', teacher: 'Chưa rõ' },
    { date: '06/01/2027', type: 'exam', title: '[THI] Học máy nâng cao', startTime: '13:25', endTime: '15:10', room: 'CS1.A202', teacher: 'Chưa rõ' },
    { date: '10/01/2027', type: 'exam', title: '[THI] Phân tích và trực quan hóa dữ liệu', startTime: '17:30', endTime: '19:15', room: 'CS1.A201', teacher: 'Chưa rõ' },
  ]);
});

test('Worker preserves legacy classes, stores exams and replaces only supplied dates', async () => {
  const source = fs.readFileSync(path.join(root, 'calendar-worker/index.js'), 'utf8');
  const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
  const storage = new Map();
  const env = { CALENDAR_KV: { get: async k => storage.get(k) || null, put: async (k, v) => storage.set(k, v) } };
  const post = async (events, replacedDates) => {
    const response = await worker.fetch(new Request('https://example.invalid/', { method: 'POST', body: JSON.stringify({ id: '12345678', dates: replacedDates, events }) }), env);
    assert.equal(response.status, 200);
  };
  const legacy = { date: '01/11/2026', startTime: '07:00', endTime: '09:00', title: 'Legacy', room: 'A', teacher: 'GV' };
  await post([legacy], [legacy.date]);
  const parsed = parse(html(block('color-lichhoc', 'Class') + block('color-lichthi', 'Exam')));
  await post(parsed.events, parsed.dates);
  let stored = JSON.parse(storage.get('events:12345678'));
  assert.equal(stored.length, 3);
  assert.equal(stored.find(e => e.type === 'exam').title, '[THI] Exam');
  const ics = storage.get('ics:12345678');
  assert.match(ics, /SUMMARY:\[THI\] Exam/);
  assert.match(ics, /DESCRIPTION:Lịch thi\./);
  assert.match(ics, /DESCRIPTION:Giảng viên: GV/);
  assert.match(ics, /DTSTART:20261116T000000Z/);
  await post([], parsed.dates);
  stored = JSON.parse(storage.get('events:12345678'));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].title, 'Legacy');
});

test('full sync reads classes and exams from type 0, refetches old cache and exports ICS', async () => {
  const workerSource = fs.readFileSync(path.join(root, 'calendar-worker/index.js'), 'utf8');
  const worker = (await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`)).default;
  const kv = new Map();
  const env = { CALENDAR_KV: { get: async k => kv.get(k) || null, put: async (k, v) => kv.set(k, v) } };
  const local = { studentMSSV: '12345678' };
  const config = { portalUrl: 'https://sv.epu.edu.vn', calendarSync: { enabled: true, workerUrl: 'https://worker.invalid/', fromDate: '2027-01-04', toDate: '2027-01-10' } };
  const calls = [];
  const all = fs.readFileSync(path.join(__dirname, 'fixtures/lich-thi.html'), 'utf8');
  const mixed = all.replace('<td></td>', `<td>${block('color-lichhoc', 'Class')}</td>`);
  let failFetch = false;
  const sandbox = vm.createContext({
    URL, URLSearchParams, Date, setTimeout: fn => { fn(); },
    chrome: {
      storage: {
        sync: { get: async () => ({ config }) },
        local: {
          get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, local[k]])),
          set: async values => Object.assign(local, values),
          remove: async key => { delete local[key]; },
        },
      },
      permissions: { contains: async () => true },
      alarms: { clear: async () => true, create: async () => {} },
    },
    fetch: async (url, init) => {
      if (url.startsWith(config.portalUrl)) {
        const type = init.body.get('pLoaiLich');
        calls.push(type);
        assert.equal(init.credentials, 'include');
        assert.equal(init.body.get('pNgayHienTai'), '04/01/2027');
        assert.equal(type, '0');
        if (failFetch) return new Response('Failed', { status: 500 });
        return new Response(mixed);
      }
      assert.equal(url, config.calendarSync.workerUrl);
      return worker.fetch(new Request(url, init), env);
    },
  });
  for (const file of ['config.js', 'background/webhook.js', 'background/calendar-sync.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox);
  }
  local.cal_day_12345678 = vm.runInContext('calDayKey()', sandbox);
  local.cal_data_12345678 = { uploaded: true, events: [], range: '2027-01-04|2027-01-10' };
  const result = await sandbox.syncCalendar(false);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['0']);
  assert.match(result.message, /1 buổi học, 4 buổi thi/);
  assert.equal(local.cal_data_12345678.uploaded, true);
  assert.equal(local.cal_data_12345678.events.length, 5);
  const response = await worker.fetch(new Request('https://worker.invalid/?id=12345678'), env);
  const ics = (await response.text()).replace(/\r\n /g, '');
  assert.equal((ics.match(/SUMMARY:\[THI\]/g) || []).length, 4);
  assert.match(ics, /SUMMARY:\[THI\] Học máy nâng cao/);
  assert.match(ics, /DTSTART:20270106T062500Z/);
  assert.equal((await sandbox.syncCalendar(false)).skipped, true);
  assert.equal(calls.length, 1);
  assert.equal((await sandbox.syncCalendar(true)).ok, true);
  assert.equal(calls.length, 2);
  const savedICS = kv.get('ics:12345678');
  failFetch = true;
  assert.equal((await sandbox.syncCalendar(true)).ok, false);
  assert.equal(kv.get('ics:12345678'), savedICS);
});
