// Đồng bộ lịch học tự động, chạy trong service worker nên không cần mở trang web sinh viên:
// lấy lịch từng tuần bằng cookie đăng nhập có sẵn của trình duyệt, lưu vào chrome.storage.local,
// rồi gửi lên Worker lịch (thư mục calendar-worker/) để Worker đổi sang .ics. Mỗi ngày chỉ cần một lần thành công.

const CALENDAR_PATH = "/SinhVien/GetDanhSachLichTheoTuan";
const CALENDAR_DELAY_MS = 700;

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
  let res;
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
  } catch {
    throw new Error("Không kết nối được tới web sinh viên.");
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Web sinh viên trả về lỗi ${res.status}.`);
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
    throw new Error("Không kết nối được tới Worker lịch.");
  }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch { /* không phải JSON */ }
    throw new Error(`Worker lịch trả về lỗi ${res.status}${detail ? ": " + detail : ""}`);
  }
}

async function calSetStatus(ok, message) {
  await chrome.storage.local.set({ calendarStatus: { ok, message, at: Date.now() } });
  return ok ? { ok, message } : { ok, error: message };
}

async function runCalendarSync(force) {
  const config = await getConfig();
  const cal = calendarSettings(config);
  if (!cal.enabled) return { ok: false, skipped: true, error: "Chưa bật đồng bộ lịch học." };
  if (!cal.workerUrl) return calSetStatus(false, "Chưa có địa chỉ Worker lịch. Vào Cài đặt để nhập.");
  if (!isHttps(cal.workerUrl)) return calSetStatus(false, "Địa chỉ Worker lịch phải bắt đầu bằng https://");
  if (!(await chrome.permissions.contains({ origins: [new URL(cal.workerUrl).origin + "/*"] }))) {
    return calSetStatus(false, "Chưa cấp quyền truy cập Worker lịch. Vào Cài đặt và bấm Lưu để cấp quyền.");
  }
  const range = calendarRange(cal);
  if (range.error) return calSetStatus(false, range.error);

  const stored = await chrome.storage.local.get(["studentMSSV", "calendarSyncedDay", "calendarData"]);
  const today = calDayKey();
  if (!force && stored.calendarSyncedDay === today) return { ok: true, skipped: true };

  const mssv = String(stored.studentMSSV || "").trim();
  if (!mssv) return calSetStatus(false, "Chưa biết mã sinh viên. Hãy mở web sinh viên một lần rồi thử lại.");
  if (!/^\d{6,15}$/.test(mssv)) return calSetStatus(false, `Mã sinh viên không hợp lệ: ${mssv}`);

  try {
    let data = stored.calendarData;
    // Hôm nay đã lấy được lịch nhưng gửi lỗi thì chỉ gửi lại, không lấy lại từ web sinh viên.
    const rangeKey = `${range.startIso}|${range.endIso}`;
    const reusable = !force && data && !data.uploaded && data.day === today && data.mssv === mssv && data.range === rangeKey;
    if (!reusable) {
      data = await calScrape(config.portalUrl, range, mssv, today);
      await chrome.storage.local.set({ calendarData: data });
    }
    await calUpload(cal.workerUrl, data);
    data.uploaded = true;
    await chrome.storage.local.set({ calendarData: data, calendarSyncedDay: today, calendarSyncedAt: Date.now() });
    return calSetStatus(true, `Đã gửi ${data.events.length} buổi học (${data.weeks} tuần, từ ${calFormat(range.start)} đến ${calFormat(range.end)}).`);
  } catch (e) {
    return calSetStatus(false, e.message);
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
