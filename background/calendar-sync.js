// Đồng bộ lịch học tự động, chạy trong service worker nên không cần mở trang web sinh viên:
// lấy lịch từng tuần bằng cookie đăng nhập có sẵn của trình duyệt, lưu vào chrome.storage.local,
// rồi gửi lên Worker lịch (thư mục calendar-worker/) để Worker đổi sang .ics. Mỗi ngày chỉ cần một lần thành công.

const CALENDAR_PATH = "/SinhVien/GetDanhSachLichTheoTuan";
const CALENDAR_DELAY_MS = 700;

// Lỗi tạm thời (mất mạng, server lỗi) thì tự thử lại, chờ lâu dần; từ lần thứ 5 trở đi cứ 60 phút một lần.
// Mỗi ngày thử lại tối đa CALENDAR_MAX_RETRIES lần, quá thì đợi lần mở trình duyệt/vào web sinh viên tiếp theo.
const CALENDAR_RETRY_ALARM = "calendar-retry";
const CALENDAR_RETRY_MINUTES = [1, 5, 15, 30, 60];
const CALENDAR_MAX_RETRIES = 12;

const calRetryable = (message) => Object.assign(new Error(message), { retry: true });
const calHttpError = (message, status) =>
  Object.assign(new Error(message), { retry: status >= 500 || status === 429 || status === 408 });

const calSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const calDayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const calFormat = (d) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

function calDecode(s) {
  if (!s) return "";
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Service worker không có DOMParser nên đọc bảng lịch tuần bằng regex.
function parseCalendarHtml(html) {
  const events = [];
  const dates = [];
  const thead = html.match(/<thead[\s\S]*?<\/thead>/);
  const tbody = html.match(/<tbody[\s\S]*?<\/tbody>/);
  if (!thead || !tbody) return { events, dates };

  for (const m of thead[0].matchAll(/<th>(?:(?!<\/th>)[\s\S])*?<br>\s*(\d{2}\/\d{2}\/\d{4})\s*<\/th>/g)) dates.push(m[1]);

  for (const tr of tbody[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    let col = -1; // cột 0 là nhãn "Sáng/Chiều"
    for (const td of tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)) {
      if (col >= 0 && col < dates.length && td[1].includes("color-lichhoc")) {
        // Một ô có thể chứa nhiều môn, mỗi môn là một khối color-lichhoc.
        for (const block of td[1].split(/(?=<div[^>]*color-lichhoc)/)) {
          if (!block.includes("color-lichhoc")) continue;
          const title = block.match(/<a[^>]*>([\s\S]*?)<\/a>/);
          const time = block.match(/Giờ<\/span>:\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
          const room = block.match(/Phòng<\/span>:\s*<font>([\s\S]*?)<\/font>/);
          const teacher = block.match(/GV<\/span>:\s*<font>([\s\S]*?)<\/font>/);
          if (!title || !time) continue;
          events.push({
            date: dates[col],
            title: calDecode(title[1]),
            startTime: time[1].padStart(5, "0"),
            endTime: time[2].padStart(5, "0"),
            room: calDecode(room?.[1]) || "Chưa rõ",
            teacher: calDecode(teacher?.[1]) || "Chưa rõ",
          });
        }
      }
      col++;
    }
  }
  return { events, dates };
}

async function calFetchWeek(portalUrl, dateStr) {
  let res, text;
  try {
    res = await fetch(new URL(CALENDAR_PATH, portalUrl).href, {
      method: "POST",
      credentials: "include", // ASC.AUTH là cookie HttpOnly, trình duyệt tự gắn
      headers: {
        "Accept": "text/html, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: new URLSearchParams({ pNgayHienTai: dateStr, pLoaiLich: "0" }),
    });
    text = await res.text();
  } catch {
    throw calRetryable("Không kết nối được tới web sinh viên.");
  }
  if (!res.ok) throw calHttpError(`Web sinh viên trả về lỗi ${res.status}.`, res.status);
  if (text.includes("Đăng nhập") || !text.includes("table-responsive")) {
    throw new Error("Chưa đăng nhập web sinh viên hoặc phiên đã hết hạn. Hãy đăng nhập rồi bấm Đồng bộ ngay.");
  }
  return text;
}

// Web sinh viên trả lịch theo tuần (thứ 2 - chủ nhật): lấy mọi tuần chạm vào khoảng ngày và gửi trọn từng tuần,
// để Worker đè lại cả tuần nào có thay đổi.
async function calScrape(portalUrl, range, mssv, day) {
  const monday = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate() - ((range.start.getDay() + 6) % 7));
  const dates = new Set();
  const events = new Map();
  let weeks = 0;
  for (let m = monday; m <= range.end; m = new Date(m.getFullYear(), m.getMonth(), m.getDate() + 7)) {
    if (weeks) await calSleep(CALENDAR_DELAY_MS);
    const parsed = parseCalendarHtml(await calFetchWeek(portalUrl, calFormat(m)));
    if (!parsed.dates.length) throw new Error("Không đọc được bảng lịch học (giao diện web sinh viên có thể đã đổi).");
    parsed.dates.forEach((x) => dates.add(x));
    for (const e of parsed.events) events.set(`${e.date}|${e.startTime}|${e.title}`, e);
    weeks++;
  }
  return {
    mssv, day, range: `${range.startIso}|${range.endIso}`, fetchedAt: Date.now(), weeks,
    dates: [...dates], events: [...events.values()], uploaded: false,
  };
}

async function calUpload(workerUrl, data) {
  let res;
  try {
    res = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: data.mssv, dates: data.dates, events: data.events }),
    });
  } catch {
    throw calRetryable("Không kết nối được tới Worker lịch.");
  }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch { /* không phải JSON */ }
    throw calHttpError(`Worker lịch trả về lỗi ${res.status}${detail ? ": " + detail : ""}`, res.status);
  }
}

// Gặp lỗi tạm thời mà hôm nay chưa có lần thành công nào thì hẹn thử lại bằng chrome.alarms.
async function calFail(e, today, mssv) {
  let message = e.message;
  if (e.retry) {
    const kDay = `cal_day_${mssv}`;
    const kRetry = `cal_retry_${mssv}`;
    const result = await chrome.storage.local.get([kDay, kRetry]);
    if (result[kDay] !== today) {
      const n = result[kRetry]?.day === today ? result[kRetry].n : 0;
      if (n < CALENDAR_MAX_RETRIES) {
        const delay = CALENDAR_RETRY_MINUTES[Math.min(n, CALENDAR_RETRY_MINUTES.length - 1)];
        await chrome.storage.local.set({ [kRetry]: { day: today, n: n + 1 } });
        await chrome.alarms.create(CALENDAR_RETRY_ALARM, { delayInMinutes: delay });
        message += ` Tự thử lại sau ${delay} phút.`;
      } else {
        message += " Đã thử lại nhiều lần hôm nay, sẽ thử tiếp khi mở trình duyệt hoặc vào web sinh viên.";
      }
    }
  }
  return calSetStatus(false, message, mssv);
}

const calStopRetry = () => chrome.alarms.clear(CALENDAR_RETRY_ALARM);

async function calSetStatus(ok, message, mssv) {
  const status = { ok, message, at: Date.now() };
  const sets = { calendarStatus: status };
  if (mssv) sets[`cal_status_${mssv}`] = status;
  await chrome.storage.local.set(sets);
  if (!ok) await notifySyncFailure(message).catch(() => {});
  return ok ? { ok, message } : { ok, error: message };
}

async function runCalendarSync(force) {
  const config = await getConfig();
  const cal = calendarSettings(config);
  if (!cal.enabled) {
    await calStopRetry();
    return { ok: false, skipped: true, error: "Chưa bật đồng bộ lịch học." };
  }
  if (!cal.workerUrl) return calSetStatus(false, "Chưa có địa chỉ Worker lịch. Vào Cài đặt để nhập.");
  if (!isHttps(cal.workerUrl)) return calSetStatus(false, "Địa chỉ Worker lịch phải bắt đầu bằng https://");
  if (!(await chrome.permissions.contains({ origins: [new URL(cal.workerUrl).origin + "/*"] }))) {
    return calSetStatus(false, "Chưa cấp quyền truy cập Worker lịch. Vào Cài đặt và bấm Lưu để cấp quyền.");
  }
  const range = calendarRange(cal);
  if (range.error) return calSetStatus(false, range.error);

  const { studentMSSV } = await chrome.storage.local.get("studentMSSV");
  const today = calDayKey();
  const mssv = String(studentMSSV || "").trim();
  if (!mssv) return calSetStatus(false, "Chưa biết mã sinh viên. Hãy mở web sinh viên một lần rồi thử lại.");
  if (!/^\d{6,15}$/.test(mssv)) return calSetStatus(false, `Mã sinh viên không hợp lệ: ${mssv}`);

  const kDay = `cal_day_${mssv}`;
  const kData = `cal_data_${mssv}`;
  const kEvents = `cal_events_${mssv}`;
  const kRetry = `cal_retry_${mssv}`;
  const kAt = `cal_at_${mssv}`;
  const stored = await chrome.storage.local.get([kDay, kData, kEvents]);

  if (!force && stored[kDay] === today) {
    await calStopRetry();
    return { ok: true, skipped: true };
  }

  try {
    let data = stored[kData];
    const rangeKey = `${range.startIso}|${range.endIso}`;
    const reusable = !force && data && !data.uploaded && data.day === today && data.mssv === mssv && data.range === rangeKey;
    if (!reusable) {
      data = await calScrape(config.portalUrl, range, mssv, today);
      await chrome.storage.local.set({ [kData]: data });
    }
    await calUpload(cal.workerUrl, data);
    data.uploaded = true;

    const dates = new Set(data.dates);
    const previous = stored[kEvents];
    const diff = previous ? calDiff(previous, data.events, dates) : null;
    const lastEvents = (previous || []).filter((e) => !dates.has(e.date)).concat(data.events);
    await chrome.storage.local.set({
      [kData]: data, [kEvents]: lastEvents, [kDay]: today, [kAt]: Date.now(),
    });
    await calStopRetry();
    await chrome.storage.local.remove(kRetry);

    const summary = `${data.events.length} buổi học (${data.weeks} tuần, từ ${calFormat(range.start)} đến ${calFormat(range.end)}).`;
    await notifySyncSuccess({ diff, summary }).catch(() => {});
    return calSetStatus(true, `Đã gửi ${summary}`, mssv);
  } catch (e) {
    return calFail(e, today, mssv);
  }
}

let calendarRun = null;

function syncCalendar(force = false) {
  if (!calendarRun) {
    calendarRun = runCalendarSync(force)
      .catch((e) => ({ ok: false, error: e.message }))
      .finally(() => { calendarRun = null; });
  }
  return calendarRun;
}
