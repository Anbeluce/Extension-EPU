// Worker lịch học: chỉ nhận dữ liệu lịch do extension gửi lên, đổi sang .ics và lưu KV.
// POST /            body JSON { id, dates: ["dd/mm/yyyy"], events: [...] }  -> lưu lịch
// GET  /?id=<MSSV>                                                          -> trả file .ics
// GET  /?id=<MSSV>&action=view                                              -> xem dữ liệu lưu trong KV dạng JSON
// Extension gửi trọn từng tuần: các ngày trong `dates` được ĐÈ LẠI hoàn toàn, ngày khác giữ nguyên.
// Worker không tự xóa hay cắt bớt dữ liệu cũ; quá đầy thì từ chối chứ không bỏ buổi nào.

const MAX_BODY = 1024 * 1024;
const MAX_EVENTS_PER_REQUEST = 2000;
const MAX_EVENTS_STORED = 20000;
const MAX_DATES = 400;

const ID_RE = /^\d{6,15}$/;
const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (!env.CALENDAR_KV) return json({ error: "Worker chưa gắn KV namespace (tên biến: CALENDAR_KV)." }, 500);

    if (request.method === "POST") return saveCalendar(request, env);
    if (request.method === "GET") return getCalendar(new URL(request.url), env);
    return json({ error: "Phương thức không được hỗ trợ." }, 405);
  },
};

async function getCalendar(url, env) {
  const id = (url.searchParams.get("id") || "").trim();
  if (!ID_RE.test(id)) return json({ error: "Thiếu hoặc sai tham số id (mã sinh viên)." }, 400);

  if (url.searchParams.get("action") === "view") {
    const [events, meta] = await Promise.all([env.CALENDAR_KV.get(`events:${id}`), env.CALENDAR_KV.get(`meta:${id}`)]);
    if (!events) return notFound();
    return new Response(JSON.stringify({ id, ...JSON.parse(meta || "{}"), events: JSON.parse(events) }, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
    });
  }

  const ics = await env.CALENDAR_KV.get(`ics:${id}`);
  if (!ics) return notFound();
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="epu_calendar_${id}.ics"`,
      ...CORS,
    },
  });
}

const notFound = () =>
  json({ error: "Chưa có dữ liệu lịch cho mã sinh viên này. Hãy cài extension, đăng nhập web sinh viên và bật đồng bộ lịch học." }, 404);

async function saveCalendar(request, env) {
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: "Dữ liệu quá lớn." }, 413);

  let body;
  try { body = JSON.parse(text); } catch { return json({ error: "Dữ liệu không phải JSON hợp lệ." }, 400); }

  const checked = validate(body);
  if (checked.error) return json({ error: checked.error }, 400);
  const { id, dates, events } = checked;

  const stored = await env.CALENDAR_KV.get(`events:${id}`);
  let existing = [];
  try { existing = stored ? JSON.parse(stored) : []; } catch { /* dữ liệu cũ hỏng thì bỏ */ }

  // Tuần nào vừa được gửi thì đè lại cả tuần (buổi bị hủy/đổi biến mất); các ngày không được gửi giữ nguyên.
  const replaced = new Set([...dates, ...events.map((e) => e.date)]);
  const kept = dedupe(existing.filter((e) => !replaced.has(e.date)).concat(events));
  if (kept.length > MAX_EVENTS_STORED) return json({ error: "Dữ liệu lịch của mã sinh viên này đã đầy." }, 413);
  kept.sort((a, b) => startMs(a) - startMs(b));

  const updatedAt = new Date().toISOString();
  await Promise.all([
    env.CALENDAR_KV.put(`events:${id}`, JSON.stringify(kept)),
    env.CALENDAR_KV.put(`ics:${id}`, buildICS(id, kept, updatedAt)),
    env.CALENDAR_KV.put(`meta:${id}`, JSON.stringify({ updatedAt, count: kept.length })),
  ]);
  return json({ ok: true, id, count: kept.length, received: events.length, updatedAt });
}

// ---------- kiểm tra dữ liệu ----------

const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function validDate(s) {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [d, mo, y] = [+m[1], +m[2], +m[3]];
  return y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
}

function validTime(s) {
  const m = TIME_RE.exec(s);
  return !!m && +m[1] < 24 && +m[2] < 60;
}

function validate(body) {
  if (!body || typeof body !== "object") return { error: "Dữ liệu không hợp lệ." };
  const id = String(body.id ?? "").trim();
  if (!ID_RE.test(id)) return { error: "Mã sinh viên (id) không hợp lệ." };

  const dates = Array.isArray(body.dates) ? body.dates : [];
  if (dates.length > MAX_DATES || !dates.every((d) => typeof d === "string" && validDate(d))) {
    return { error: "Danh sách ngày (dates) không hợp lệ." };
  }

  if (!Array.isArray(body.events)) return { error: "Thiếu danh sách buổi học (events)." };
  if (body.events.length > MAX_EVENTS_PER_REQUEST) return { error: "Quá nhiều buổi học trong một lần gửi." };

  const events = [];
  for (const [i, e] of body.events.entries()) {
    if (!e || typeof e.date !== "string" || !validDate(e.date) ||
        typeof e.startTime !== "string" || !validTime(e.startTime) ||
        typeof e.endTime !== "string" || !validTime(e.endTime) || !clean(e.title, 200)) {
      return { error: `Buổi học thứ ${i + 1} không hợp lệ.` };
    }
    events.push({
      date: e.date,
      startTime: e.startTime.padStart(5, "0"),
      endTime: e.endTime.padStart(5, "0"),
      title: clean(e.title, 200),
      room: clean(e.room, 100) || "Chưa rõ",
      teacher: clean(e.teacher, 100) || "Chưa rõ",
    });
  }
  return { id, dates, events };
}

function dedupe(events) {
  const map = new Map();
  for (const e of events) map.set(`${e.date}|${e.startTime}|${e.title}`, e);
  return [...map.values()];
}

// ---------- đổi sang .ics ----------

// Giờ trên web sinh viên là giờ Việt Nam (UTC+7, không có giờ mùa hè).
function startMs(e) { return utcMs(e.date, e.startTime); }

function utcMs(date, time) {
  const [d, mo, y] = date.split("/").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return Date.UTC(y, mo - 1, d, h - 7, mi);
}

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const escapeText = (s) =>
  String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

function hash6(s) {
  let h = 5381;
  for (const ch of s) h = ((h << 5) + h + ch.codePointAt(0)) >>> 0;
  return h.toString(16).padStart(8, "0").slice(0, 6);
}

// Mỗi dòng .ics tối đa 75 byte; dòng dài phải gập bằng "CRLF + khoảng trắng".
function fold(line) {
  if (line.length <= 75 && /^[\x00-\x7f]*$/.test(line)) return line; // dòng ASCII ngắn, đỡ tốn CPU khi lịch có nhiều buổi
  const enc = new TextEncoder();
  const out = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + n > limit) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

function buildICS(id, events, updatedAt) {
  const dtstamp = stamp(Date.parse(updatedAt));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EPU Calendar Worker//VN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Lịch học EPU",
    "X-WR-TIMEZONE:Asia/Ho_Chi_Minh",
    "X-PUBLISHED-TTL:PT6H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
  ];
  for (const e of events) {
    const [d, mo, y] = e.date.split("/");
    lines.push(
      "BEGIN:VEVENT",
      `UID:epu-${id}-${y}${mo}${d}-${e.startTime.replace(":", "")}-${hash6(e.title)}@epu-calendar`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(utcMs(e.date, e.startTime))}`,
      `DTEND:${stamp(utcMs(e.date, e.endTime))}`,
      `SUMMARY:${escapeText(e.title)}`,
      `LOCATION:${escapeText(e.room)}`,
      `DESCRIPTION:${escapeText(`Giảng viên: ${e.teacher}`)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
