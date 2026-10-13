// Trang chạy Tự động khảo sát: tải danh sách phiếu chưa làm, với mỗi phiếu thì tải
// trang chi tiết, điền đáp án theo cấu hình rồi POST thẳng tới server — tất cả bằng
// fetch (kèm cookie đăng nhập), hiển thị tiến trình trong bảng.
//
// Đã xác minh bằng Playwright:
//   GET /dashboard.html            → 302 sang trang danh sách; phiếu chưa làm ở #tab_chuaks
//   GET .../chi-tiet-phieu...pKey= → form #FormKhaoSatSuKienSV
//   POST (action của form, có ?Length=n) body x-www-form-urlencoded:
//        __RequestVerificationToken, KeyKhaoSat, KeyIsLuuTam=False,
//        TLRDO_<id>=<id đáp án theo điểm>, YKien_<id>=<câu tự luận>

const $ = (id) => document.getElementById(id);

let PORTAL = "https://sv.epu.edu.vn";
let CFG = { score: 5, text1: "", text2: "" };
let SURVEYS = []; // [{pKey, title, status, message}]
let running = false;
let stopFlag = false;

const CAP = 100; // chặn an toàn

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("err", isError);
}

async function loadConfig() {
  try {
    const { config } = await chrome.storage.sync.get("config");
    if (config?.portalUrl) PORTAL = config.portalUrl.replace(/\/+$/, "");
    const a = config?.autoSurvey || {};
    CFG = { score: a.score != null ? a.score : 5, text1: a.text1 || "", text2: a.text2 || "" };
  } catch {}
  $("cfg-score").value = String(CFG.score);
  $("cfg-text1").value = CFG.text1;
  $("cfg-text2").value = CFG.text2;
}

async function saveConfig() {
  CFG = {
    score: parseInt($("cfg-score").value, 10),
    text1: $("cfg-text1").value.trim(),
    text2: $("cfg-text2").value.trim(),
  };
  try {
    const { config } = await chrome.storage.sync.get("config");
    const next = { ...(config || {}) };
    next.autoSurvey = { ...(next.autoSurvey || {}), ...CFG, reviewed: true };
    await chrome.storage.sync.set({ config: next });
    setStatus("Đã lưu cấu hình.");
  } catch (e) {
    setStatus("Không lưu được cấu hình: " + e.message, true);
  }
}

const apiFetch = (path, init = {}) =>
  fetch(new URL(path, PORTAL).href, { credentials: "include", ...init });

// -------- Tải danh sách phiếu chưa khảo sát --------
async function harvest() {
  setStatus("Đang tải danh sách phiếu…");
  const r = await apiFetch("/dashboard.html");
  const html = await r.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Phiếu CHƯA khảo sát nằm trong #tab_chuaks. Nếu không thấy container thì lùi về
  // lấy mọi link (hiếm khi cần) để tránh bỏ sót khi cổng đổi cấu trúc.
  let anchors = doc.querySelectorAll('#tab_chuaks a[href*="chi-tiet-phieu-khao-sat-sinh-vien"]');
  if (!anchors.length) anchors = doc.querySelectorAll('a[href*="chi-tiet-phieu-khao-sat-sinh-vien"]');

  const seen = new Set();
  SURVEYS = [];
  anchors.forEach((a) => {
    let pKey = "";
    try { pKey = new URL(a.getAttribute("href"), PORTAL).searchParams.get("pKey") || ""; } catch {}
    if (!pKey || seen.has(pKey)) return;
    seen.add(pKey);
    SURVEYS.push({
      pKey,
      title: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140) || pKey.slice(0, 20),
      status: "pending",
      message: "",
    });
  });
  renderTable();
  setStatus(SURVEYS.length ? `Tìm thấy ${SURVEYS.length} phiếu chưa khảo sát.` : "Không còn phiếu nào chưa khảo sát.");
  return SURVEYS.length;
}

// -------- Phân tích trang chi tiết --------
function parseDetail(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const form = doc.getElementById("FormKhaoSatSuKienSV");
  if (!form) return { error: "Không thấy form (phiếu có thể đã làm/hết hạn, hoặc phiên đăng nhập hết)." };

  const action = form.getAttribute("action") || "/KhaoSat/PostKhaoSatSuKienSV";
  const token = form.querySelector('input[name="__RequestVerificationToken"]')?.value || "";
  const keyKhaoSat = form.querySelector('#KeyKhaoSat, input[name="KeyKhaoSat"]')?.value || "";

  const labelOf = (r) => (r.closest("label")?.textContent || "").trim();
  const ratings = {}; // { TLRDO_x: { "1":valId, ..., "5":valId, "0":valId } }
  const groups = {};
  form.querySelectorAll('input[type="radio"][name^="TLRDO_"]').forEach((r) => (groups[r.name] = groups[r.name] || []).push(r));
  for (const name in groups) {
    const byLabel = {};
    groups[name].forEach((r) => { byLabel[labelOf(r)] = r.value; });
    ratings[name] = byLabel;
  }
  const texts = [...form.querySelectorAll('input[name^="YKien_"], textarea[name^="YKien_"]')].map((e) => e.name);
  return { action, token, keyKhaoSat, ratings, texts };
}

function buildBody(d) {
  const score = String(CFG.score);
  const p = new URLSearchParams();
  p.set("__RequestVerificationToken", d.token);
  p.set("KeyKhaoSat", d.keyKhaoSat);
  p.set("KeyIsLuuTam", "False");
  for (const name in d.ratings) {
    const byLabel = d.ratings[name];
    const val = byLabel[score] ?? byLabel["5"] ?? Object.values(byLabel)[0];
    if (val != null) p.set(name, val);
  }
  const answers = [CFG.text1, CFG.text2];
  d.texts.forEach((name, i) => {
    const v = answers[i] != null ? answers[i] : (answers[answers.length - 1] || "");
    p.set(name, v || "");
  });
  return p.toString();
}

// -------- Gửi một phiếu --------
async function submitOne(s) {
  const detail = await apiFetch("/khao-sat/chi-tiet-phieu-khao-sat-sinh-vien.html?pKey=" + encodeURIComponent(s.pKey));
  const html = await detail.text();
  const d = parseDetail(html);
  if (d.error) return { ok: false, message: d.error };
  if (!Object.keys(d.ratings).length) return { ok: false, message: "Không nhận ra câu hỏi nào trong phiếu." };

  const body = buildBody(d);
  const res = await apiFetch(d.action, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}

  if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
  // Phản hồi JSON có Errors.Warning / Errors.WarningCauHoiId = bị từ chối (thiếu câu…)
  if (data && data.Errors && (data.Errors.Warning || data.Errors.WarningCauHoiId)) {
    let m = "Bị từ chối";
    try {
      const w = data.Errors.Warning?.errors || data.Errors.WarningCauHoiId?.errors;
      if (Array.isArray(w) && w.length) m += ": " + w.filter((x) => typeof x === "string").join("; ");
    } catch {}
    return { ok: false, message: m };
  }
  // Không phải JSON (vd trả HTML login) → coi như thất bại
  if (!data && /<form|<!doctype|<html/i.test(text)) return { ok: false, message: "Phản hồi không hợp lệ (phiên đăng nhập?)." };
  return { ok: true, message: "Đã gửi." };
}

// -------- Chạy tất cả --------
async function runAll() {
  if (running) return;
  if (!SURVEYS.length) { const n = await harvest(); if (!n) return; }
  running = true;
  stopFlag = false;
  $("btn-run").disabled = true;
  $("btn-stop").disabled = false;
  $("btn-harvest").disabled = true;

  let done = 0, failed = 0, processed = 0;
  for (const s of SURVEYS) {
    if (stopFlag) { setStatus("Đã dừng."); break; }
    if (s.status === "ok") continue;
    if (++processed > CAP) { setStatus(`Đạt giới hạn an toàn ${CAP} phiếu. Dừng.`, true); break; }
    s.status = "running"; s.message = "Đang gửi…"; renderTable();
    try {
      const r = await submitOne(s);
      s.status = r.ok ? "ok" : "fail";
      s.message = r.message;
      r.ok ? done++ : failed++;
    } catch (e) {
      s.status = "fail"; s.message = e.message; failed++;
    }
    renderTable();
    setStatus(`Đang chạy… thành công ${done}, lỗi ${failed}.`);
    await new Promise((r) => setTimeout(r, 500)); // nghỉ nhẹ giữa các phiếu
  }

  running = false;
  $("btn-run").disabled = false;
  $("btn-stop").disabled = true;
  $("btn-harvest").disabled = false;
  if (!stopFlag) setStatus(`Hoàn tất: đã gửi ${done} phiếu` + (failed ? `, ${failed} phiếu lỗi (xem cột trạng thái).` : "."));
}

// -------- Bảng --------
function renderTable() {
  const rows = SURVEYS.map((s, i) => {
    const tr = document.createElement("tr");
    const badge = { pending: "chờ", running: "đang gửi…", ok: "✓ thành công", fail: "✗ lỗi" }[s.status] || s.status;
    const cls = { ok: "ok", fail: "bad", running: "run" }[s.status] || "";
    const td = (txt, c) => { const d = document.createElement("td"); d.textContent = txt; if (c) d.className = c; return d; };
    tr.append(td(String(i + 1)), td(s.title), td(badge, cls), td(s.message || ""));
    return tr;
  });
  $("rows").replaceChildren(...rows);
}

// -------- Đếm ngược tự chạy (khi mở từ content script) --------
function autoCountdown() {
  let n = 5;
  const bar = $("countdown");
  bar.style.display = "flex";
  const render = () => { $("countdown-text").textContent = `Tự động bắt đầu sau ${n}s… (điểm ${CFG.score})`; };
  render();
  const timer = setInterval(() => {
    n--;
    if (n <= 0) { clearInterval(timer); bar.style.display = "none"; runAll(); }
    else render();
  }, 1000);
  $("countdown-cancel").onclick = () => { clearInterval(timer); bar.style.display = "none"; setStatus("Đã huỷ tự động chạy. Bấm \"Chạy tất cả\" khi muốn."); };
}

// -------- Khởi tạo --------
$("btn-harvest").addEventListener("click", () => harvest().catch((e) => setStatus("Lỗi: " + e.message, true)));
$("btn-run").addEventListener("click", () => runAll().catch((e) => setStatus("Lỗi: " + e.message, true)));
$("btn-stop").addEventListener("click", () => { stopFlag = true; });
$("btn-save-cfg").addEventListener("click", saveConfig);

(async () => {
  await loadConfig();
  const auto = new URLSearchParams(location.search).get("auto") === "1";
  const n = await harvest().catch((e) => { setStatus("Lỗi tải danh sách: " + e.message, true); return 0; });
  if (auto && n) autoCountdown();
})();
