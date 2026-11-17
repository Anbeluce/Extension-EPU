// Đồng bộ lịch học tự động, chạy trong service worker nên không cần mở trang web sinh viên:
// lấy lịch từng tuần bằng cookie đăng nhập có sẵn của trình duyệt, lưu vào chrome.storage.local,
// rồi gửi lên Worker lịch (thư mục calendar-worker/) để Worker đổi sang .ics. Mỗi ngày chỉ cần một lần thành công.

const CALENDAR_PATH = "/SinhVien/GetDanhSachLichTheoTuan";
const CALENDAR_DELAY_MS = 700;
// Tăng khi cách thu thập thay đổi để không dùng lại cache của bộ đọc cũ.
const CALENDAR_DATA_VERSION = 2;

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

// Đọc cả lịch học và lịch thi theo cấu trúc bảng tuần của EPU.
function normalizeTime(time) {
  const [hours, minutes] = time.split(":").map(Number);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 || hours > 23 ||
    minutes < 0 || minutes > 59
  ) {
    throw new Error(`Giờ không hợp lệ: ${time}`);
  }

  return (
    String(hours).padStart(2, "0") + ":" +
    String(minutes).padStart(2, "0")
  );
}

function decodeHtmlEntities(str) {
  if (!str) return "Chưa rõ";

  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  return str.replace(
    /&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos|nbsp);/gi,
    (match, numeric, name) => {
      if (name) return named[name.toLowerCase()];

      const value = numeric[0].toLowerCase() === "x"
        ? parseInt(numeric.slice(1), 16)
        : parseInt(numeric, 10);

      return value >= 0 && value <= 0x10FFFF
        ? String.fromCodePoint(value)
        : match;
    }
  ).trim();
}

function htmlText(value) {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ""));
}

function getAttribute(attributes, name) {
  const regex = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`,
    "i"
  );

  return attributes.match(regex)?.[2] || "";
}

function extractEventBlocks(cellHtml) {
  const starts = [];

  for (const match of cellHtml.matchAll(/<div\b([^>]*)>/gi)) {
    const classes = getAttribute(match[1], "class")
      .split(/\s+/)
      .filter(Boolean);

    if (classes.includes("content")) {
      starts.push({
        index: match.index,
        bodyStart: match.index + match[0].length,
        classes,
      });
    }
  }

  return starts.map((item, index) => ({
    classes: item.classes,
    html: cellHtml.slice(
      item.bodyStart,
      starts[index + 1]?.index ?? cellHtml.length
    ),
  }));
}

function parseCalendarHtml(html) {
  const events = [];
  const scrapedDates = [];

  const thead = html.match(
    /<thead\b[^>]*>([\s\S]*?)<\/thead>/i
  );
  const tbody = html.match(
    /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i
  );

  if (!thead || !tbody) {
    throw new Error("Không đọc được cấu trúc bảng lịch.");
  }

  for (const match of thead[1].matchAll(
    /<th\b[^>]*>([\s\S]*?)<\/th>/gi
  )) {
    const date = match[1].match(/\b\d{2}\/\d{2}\/\d{4}\b/);
    if (date) scrapedDates.push(date[0]);
  }

  if (scrapedDates.length !== 7) {
    throw new Error("Không đọc đủ 7 ngày trong bảng lịch tuần.");
  }

  const rows = [...tbody[1].matchAll(
    /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  )];

  if (!rows.length) {
    throw new Error("Không đọc được các hàng trong bảng lịch.");
  }

  for (const row of rows) {
    const cells = [...row[1].matchAll(
      /<td\b[^>]*>([\s\S]*?)<\/td>/gi
    )];

    if (cells.length !== 8) {
      throw new Error("Cấu trúc cột lịch đã thay đổi.");
    }

    // Cột đầu tiên là Sáng / Chiều / Tối.
    for (let column = 1; column < cells.length; column++) {
      const date = scrapedDates[column - 1];
      const blocks = extractEventBlocks(cells[column][1]);

      for (const block of blocks) {
        const titleMatch = block.html.match(
          /<b\b[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>/i
        );

        if (!titleMatch) {
          throw new Error(`Không đọc được tên môn ngày ${date}.`);
        }

        const href = getAttribute(titleMatch[1], "href").trim();
        const isClass = block.classes.includes("color-lichhoc");

        // html/lich-thi.html: buổi thi có thể chỉ mang class "content text-start",
        // không có color-lichthi và không có GV; link tên môn là href="javascript:".
        const isExam =
          block.classes.some(value =>
            value === "color-lichthi" ||
            value.startsWith("color-lichthi-")
          ) ||
          (!isClass && /^javascript:\s*$/i.test(href));

        if (!isClass && !isExam) {
          throw new Error(
            `Gặp loại sự kiện chưa nhận diện được ngày ${date}.`
          );
        }

        const timeMatch = block.html.match(
          /Giờ\s*<\/span>\s*:\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/i
        );

        const roomMatch = block.html.match(
          /Phòng\s*<\/span>\s*:\s*<font\b[^>]*>([\s\S]*?)<\/font>/i
        );

        const teacherMatch = block.html.match(
          /GV\s*<\/span>\s*:\s*<font\b[^>]*>([\s\S]*?)<\/font>/i
        );

        if (!timeMatch) {
          throw new Error(`Không đọc được giờ môn học ngày ${date}.`);
        }

        events.push({
          date,
          type: isExam ? "exam" : "class",
          title: (isExam ? "[THI] " : "") + htmlText(titleMatch[2]),
          startTime: normalizeTime(timeMatch[1]),
          endTime: normalizeTime(timeMatch[2]),
          room: roomMatch ? htmlText(roomMatch[1]) : "Chưa rõ",
          teacher: teacherMatch
            ? htmlText(teacherMatch[1])
            : "Chưa rõ",
        });
      }
    }
  }

  return { events, dates: scrapedDates };
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
    version: CALENDAR_DATA_VERSION,
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
  const range = calendarSyncRange(cal);
  if (range.error) return calSetStatus(false, range.error);
  if (range.expired) {
    await calStopRetry();
    const result = await calSetStatus(true, "Đã qua ngày kết thúc, không cần quét thêm lịch.");
    return { ...result, skipped: true };
  }

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

  const rangeKey = `${range.startIso}|${range.endIso}`;
  const currentData = stored[kData]?.version === CALENDAR_DATA_VERSION && stored[kData]?.range === rangeKey;
  if (!force && stored[kDay] === today && currentData) {
    await calStopRetry();
    return { ok: true, skipped: true };
  }

  try {
    let data = stored[kData];
    const reusable = !force && currentData && data && !data.uploaded && data.day === today && data.mssv === mssv;
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

    const examCount = data.events.filter((e) => e.type === "exam").length;
    const summary = `${data.events.length - examCount} buổi học, ${examCount} buổi thi (${data.weeks} tuần, từ ${calFormat(range.start)} đến ${calFormat(range.end)}).`;
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
