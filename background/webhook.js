// Thông báo qua webhook Discord cho mọi lần đồng bộ lịch học: thành công (kèm lịch có thay đổi gì), hoặc thất bại.
// Extension tự so sánh lịch mới với lần trước rồi gửi thẳng tới Discord của người dùng; Worker không biết gì về webhook.

const WEBHOOK_MAX_CHARS = 1900; // Discord giới hạn 2000 ký tự mỗi tin

async function postWebhook(url, content) {
  try {
    if (!(await chrome.permissions.contains({ origins: [new URL(url).origin + "/*"] }))) {
      return { ok: false, error: "Chưa cấp quyền truy cập Discord. Vào Cài đặt và bấm Lưu để cấp quyền." };
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // allowed_mentions rỗng: tên môn học chứa @everyone cũng không gọi ai.
      body: JSON.stringify({ username: "EPU Extension", content: content.slice(0, 2000), allowed_mentions: { parse: [] } }),
    });
    return res.ok ? { ok: true } : { ok: false, error: `Discord trả về lỗi ${res.status}.` };
  } catch {
    return { ok: false, error: "Không kết nối được tới Discord." };
  }
}

const calEventKey = (e) => `${e.date}|${e.startTime}|${e.title}`;
const calEventSort = (e) => `${e.date.split("/").reverse().join("")}${e.startTime}`;
const calEventText = (e) => `**${e.title}** (${e.date} ${e.startTime}-${e.endTime}, ${e.room})`;

// So sánh buổi học cũ và mới, chỉ xét những ngày vừa được lấy lại (trong `dates`).
function calDiff(previous, next, dates) {
  const oldMap = new Map(previous.filter((e) => dates.has(e.date)).map((e) => [calEventKey(e), e]));
  const newMap = new Map(next.map((e) => [calEventKey(e), e]));
  const added = [];
  const changed = [];
  const removed = [];
  for (const [k, e] of newMap) {
    const o = oldMap.get(k);
    if (!o) added.push(e);
    else if (o.room !== e.room || o.teacher !== e.teacher || o.endTime !== e.endTime) changed.push({ old: o, new: e });
  }
  for (const [k, o] of oldMap) if (!newMap.has(k)) removed.push(o);
  const bySort = (a, b) => calEventSort(a.new || a).localeCompare(calEventSort(b.new || b));
  return { added: added.sort(bySort), changed: changed.sort(bySort), removed: removed.sort(bySort) };
}

function calChangeLines(diff) {
  const lines = [];
  for (const e of diff.added) lines.push(`➕ Thêm: ${calEventText(e)}`);
  for (const e of diff.removed) lines.push(`➖ Hủy/bỏ: ${calEventText(e)}`);
  for (const { old: o, new: n } of diff.changed) {
    const parts = [];
    if (o.room !== n.room) parts.push(`phòng ${o.room} → ${n.room}`);
    if (o.teacher !== n.teacher) parts.push(`giảng viên ${o.teacher} → ${n.teacher}`);
    if (o.endTime !== n.endTime) parts.push(`giờ kết thúc ${o.endTime} → ${n.endTime}`);
    lines.push(`🔄 Đổi: **${n.title}** (${n.date} ${n.startTime}): ${parts.join("; ")}`);
  }
  return lines;
}

// Cắt bớt cho vừa giới hạn của Discord, nói rõ còn bao nhiêu dòng bị lược.
function calFit(lines) {
  const out = [];
  let size = 0;
  for (const [i, line] of lines.entries()) {
    if (size + line.length + 1 > WEBHOOK_MAX_CHARS) {
      out.push(`… và ${lines.length - i} thay đổi khác`);
      break;
    }
    out.push(line);
    size += line.length + 1;
  }
  return out;
}

// Mọi lần đồng bộ (thành công hay thất bại, tự động hay bấm tay, kể cả mỗi lần thử lại) đều gửi một tin để người dùng biết.
// Chưa nhập link webhook thì không gửi gì.
async function webhookUrl() {
  const { url } = await getWebhook();
  return isDiscordWebhook(url) ? url.trim() : "";
}

// diff = null nghĩa là lần đồng bộ đầu tiên (chưa có gì để so sánh).
async function notifySyncSuccess({ diff, summary }) {
  const url = await webhookUrl();
  if (!url) return;
  const lines = diff ? calChangeLines(diff) : [];
  const detail = !diff
    ? "ℹ️ Lần đồng bộ đầu tiên, chưa có dữ liệu cũ để so sánh."
    : lines.length
      ? ["🔔 **Lịch học thay đổi:**", ...calFit(lines)].join("\n")
      : "ℹ️ Lịch học không có thay đổi.";
  await postWebhook(url, `✅ **EPU Extension**: đồng bộ lịch học thành công. ${summary}\n${detail}`);
}

async function notifySyncFailure(message) {
  const url = await webhookUrl();
  if (url) await postWebhook(url, `⚠️ **EPU Extension**: đồng bộ lịch học thất bại.\n${message}`);
}

async function sendTestWebhook() {
  const url = await webhookUrl();
  if (!url) return { ok: false, error: "Chưa nhập link webhook Discord hợp lệ." };
  return postWebhook(url, "✅ **EPU Extension**: webhook hoạt động, mỗi lần đồng bộ lịch học bạn sẽ nhận một tin ở kênh này.");
}
