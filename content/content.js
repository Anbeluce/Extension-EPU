// --- Lấy thông tin sinh viên và theo dõi thay đổi ---

function findLangValue(langs) {
  for (const lang of langs) {
    const label = document.querySelector(`span[lang="${lang}"]`);
    if (!label) continue;
    const val = label.nextElementSibling;
    if (val && (val.matches("span.bold") || val.matches("b"))) return val;
  }
  return null;
}

let currentMSSV = "";

function saveStudentInfo() {
  const langName = findLangValue(["sv-hoten", "thongtinsinhvien-hovaten"]);
  const headerName = document.querySelector(".user-account-name");
  const mssvEl = findLangValue(["sv-mssv", "thongtinsinhvien-mssv"]);

  const name = langName?.textContent.trim() || headerName?.textContent.trim() || "";
  const mssv = mssvEl?.textContent.trim() || "";
  if (mssv) currentMSSV = mssv;
  const data = {};
  if (name) data.studentName = name;
  if (mssv) data.studentMSSV = mssv;
  if (Object.keys(data).length) chrome.storage.local.set(data);
}

async function watchStudentInfo() {
  saveStudentInfo();

  if (!currentMSSV) {
    const { studentMSSV } = await chrome.storage.local.get("studentMSSV");
    if (studentMSSV) currentMSSV = studentMSSV;
  }

  const watchTargets = [
    findLangValue(["sv-hoten", "thongtinsinhvien-hovaten"]),
    findLangValue(["sv-mssv", "thongtinsinhvien-mssv"]),
    document.querySelector(".user-account-name"),
  ];
  for (const el of watchTargets) {
    if (el) new MutationObserver(saveStudentInfo).observe(el, { childList: true, characterData: true, subtree: true });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => watchStudentInfo());
} else {
  watchStudentInfo();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "CHECK_ATTENDANCE_NOW") {
    runAttendanceCheck(true).then(sendResponse);
    return true;
  }
  if (msg.type === "RUN_NEWS_CHECK") {
    runNewsCheck().then((result) => sendResponse(result || { ok: true }));
    return true;
  }
  if (msg.type === "FETCH_TEACHERS") {
    fetchTeacherList(msg.force).then(sendResponse);
    return true;
  }
  if (msg.type === "GET_TEACHER_DETAIL") {
    fetchTeacherDetail(msg.code).then(sendResponse);
    return true;
  }
});

// --- Tự kiểm tra điểm danh ---

async function fetchPageHtml(path) {
  try {
    const r = await fetch(location.origin + path, { credentials: "include" });
    const html = await r.text();
    if (html.includes("portlet-body")) return html;
  } catch { /* ignore */ }

  return new Promise((resolve) => {
    const id = "_atd_" + Math.random().toString(36).slice(2);
    let done = false;
    const onMsg = (e) => {
      if (e.data?.id !== id) return;
      window.removeEventListener("message", onMsg);
      done = true;
      resolve(e.data.html);
    };
    window.addEventListener("message", onMsg);
    const s = document.createElement("script");
    s.textContent = `fetch("${path}",{credentials:"include"}).then(r=>r.text()).then(html=>window.postMessage({id:"${id}",html},"*")).catch(()=>window.postMessage({id:"${id}",html:""},"*"))`;
    document.documentElement.append(s);
    s.remove();
    setTimeout(() => { if (!done) { window.removeEventListener("message", onMsg); resolve(""); } }, 10000);
  });
}

function parseAttendance(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = doc.querySelectorAll(".table-responsive table tbody tr");
  const data = [];
  let semester = "";
  for (const tr of rows) {
    const tds = tr.querySelectorAll("td");
    if (tr.classList.contains("row-head") && tds.length === 1 && tds[0].colSpan > 4) {
      semester = tds[0].textContent.trim();
      continue;
    }
    if (tds.length < 6 || !semester || tr.classList.contains("row-head")) continue;
    data.push({
      semester,
      code: tds[1].textContent.trim(),
      name: tds[2].textContent.trim(),
      credits: tds[3].textContent.trim(),
      excused: tds[4].textContent.trim(),
      unexcused: tds[5].textContent.trim(),
    });
  }
  return data;
}

function diffAttendance(oldData, newData) {
  const changes = [];
  const oldMap = new Map(oldData.map((d) => [d.code, d]));
  for (const n of newData) {
    const o = oldMap.get(n.code);
    if (!o) {
      changes.push(`Môn mới: ${n.name} (${n.semester})`);
    } else {
      if (o.excused !== n.excused)
        changes.push(`${n.name}: nghỉ CP ${o.excused} → ${n.excused}`);
      if (o.unexcused !== n.unexcused)
        changes.push(`${n.name}: nghỉ KP ${o.unexcused} → ${n.unexcused}`);
    }
  }
  return changes;
}

function notifyChanges(changes) {
  chrome.runtime.sendMessage({
    type: "SHOW_TOASTR",
    message: changes.join("<br>"),
    title: "Điểm danh thay đổi!",
    options: {
      timeOut: 0, closeButton: true, progressBar: true, enableHtml: true,
      positionClass: "toast-top-right custom-toast-container",
      tapToDismiss: false, extendedTimeOut: 0,
    },
  });
}

async function runAttendanceCheck(force = false) {
  if (!currentMSSV) return { ok: false, error: "Chưa xác định được MSSV." };
  const keyData = `att_${currentMSSV}`;
  const keyTime = `attAt_${currentMSSV}`;

  if (!force) {
    const stored = await chrome.storage.local.get(keyTime);
    if (stored[keyTime] && Date.now() - stored[keyTime] < 30 * 60 * 1000) return { ok: true, changes: [] };
  }

  const html = await fetchPageHtml("/thong-tin-diem-danh.html");
  if (!html) return { ok: false, error: "Không tải được trang điểm danh." };

  const newData = parseAttendance(html);
  if (!newData.length) return { ok: false, error: "Không đọc được dữ liệu điểm danh." };

  const stored = await chrome.storage.local.get(keyData);
  const oldData = stored[keyData];
  let changes = [];
  if (oldData) {
    changes = diffAttendance(oldData, newData);
    if (changes.length) {
      notifyChanges(changes);
    }
  }

  await chrome.storage.local.set({ [keyData]: newData, [keyTime]: Date.now() });
  return { ok: true, changes };
}

setTimeout(() => runAttendanceCheck(false), 2000);
setTimeout(() => chrome.runtime.sendMessage({ type: "SYNC_COOKIES" }), 3000);
setTimeout(() => runNewsCheck(), 2500);

// --- Thông báo tin tức mới ---

async function fetchNewsCategories() {
  const res = await fetch("/sinh-vien-tin-tuc-thong-bao.html", { credentials: "include" });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const tabs = doc.querySelectorAll(".sv-news-group-tabs li a");
  const categories = [];

  for (const tab of tabs) {
    const name = tab.querySelector(".sv-news-group-tab-title span:last-child")?.textContent.trim();
    const paneId = tab.getAttribute("href")?.replace("#", "");
    const pane = paneId && doc.getElementById(paneId);
    if (!name || !pane) continue;

    const articles = [];
    for (const a of pane.querySelectorAll(".sv-news-card .title, .sv-news-list .title")) {
      const href = a.getAttribute("href");
      const title = a.getAttribute("title") || a.textContent.trim();
      const date = a.closest(".desc-txt")?.querySelector(".date")?.textContent.trim() || "";
      if (href) articles.push({ title, href, date });
    }
    categories.push({ name, articles });
  }

  await chrome.storage.local.set({ newsCategories: categories.map(c => c.name) });
  return categories;
}

async function runNewsCheck() {
  console.log("[TL-SV] runNewsCheck started");

  try {
    const categories = await fetchNewsCategories();
    console.log("[TL-SV] News categories:", categories.map(c => c.name + " (" + c.articles.length + ")"));

    const { newsSubscriptions, newsLastSeen } = await chrome.storage.local.get(
      ["newsSubscriptions", "newsLastSeen"]
    );
    const subs = newsSubscriptions || [];
    const lastSeen = newsLastSeen || {};
    const newLastSeen = { ...lastSeen };
    const allNew = [];

    for (const cat of categories) {
      if (!cat.articles.length) continue;
      const firstHref = cat.articles[0].href;

      if (subs.includes(cat.name)) {
        const oldHref = lastSeen[cat.name];
        console.log("[TL-SV]", cat.name, "| old:", oldHref, "| new:", firstHref);
        if (oldHref && oldHref !== firstHref) {
          for (const a of cat.articles) {
            if (a.href === oldHref) break;
            allNew.push({ category: cat.name, ...a });
          }
        }
      }
      newLastSeen[cat.name] = firstHref;
    }

    console.log("[TL-SV] New articles:", allNew.length);
    await chrome.storage.local.set({ newsLastSeen: newLastSeen });

    const grouped = {};
    for (const item of allNew) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }
    for (const [cat, items] of Object.entries(grouped)) {
      const show = items.slice(0, 3);
      const lines = show.map(item => {
        const href = location.origin + item.href;
        const datePart = item.date ? `<span style="font-size:11px;opacity:.7">${item.date}</span> ` : "";
        return `${datePart}<a href="${href}" target="_blank" style="color:#1d4ed8;text-decoration:underline">${item.title}</a>`;
      });
      if (items.length > 3) lines.push(`<span style="font-size:11px;opacity:.7">...và ${items.length - 3} bài khác</span>`);
      chrome.runtime.sendMessage({
        type: "SHOW_TOASTR",
        message: lines.join("<br>"),
        title: `${cat} (${items.length} bài mới)`,
        options: {
          timeOut: 0, closeButton: true, progressBar: true, enableHtml: true,
          positionClass: "toast-top-right custom-toast-container",
          tapToDismiss: false, extendedTimeOut: 0,
        },
      });
    }
    return { ok: true, newCount: allNew.length };
  } catch (e) {
    console.error("[TL-SV] News check error:", e);
    return { ok: false, error: e.message };
  }
}

// --- Thống kê % nghỉ học (chỉ trên dashboard) ---

if (location.pathname.includes("dashboard")) {
  setTimeout(runAbsentDashboard, 1500);
}

async function fetchSyllabusMap() {
  const ctkRes = await fetch("/chuong-trinh-khung-theo-khoi-kien-thuc.html", { credentials: "include" });
  const ctkHtml = await ctkRes.text();
  const ctkDoc = new DOMParser().parseFromString(ctkHtml, "text/html");
  const pIDStr = ctkDoc.querySelector("input#IDCTKStr")?.value;
  if (!pIDStr) throw new Error("Không tìm thấy token IDCTKStr.");

  const detailRes = await fetch("/SinhVien/CTK_ChuongTrinhKhungTheoKhoiKienThucDetail", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    credentials: "include",
    body: `pIDStr=${encodeURIComponent(pIDStr)}&pIsHocKy=true&pIsPrint=false`,
  });
  const detailHtml = await detailRes.text();
  const detailDoc = new DOMParser().parseFromString(detailHtml, "text/html");

  const map = {};
  for (const tr of detailDoc.querySelectorAll("#accordion table tbody tr")) {
    const tds = tr.querySelectorAll("td");
    if (tds.length >= 10) {
      const code = tds[3]?.textContent.trim();
      if (!code) continue;
      map[code] = (parseInt(tds[8]?.textContent.trim()) || 0) + (parseInt(tds[9]?.textContent.trim()) || 0);
    }
  }
  if (!Object.keys(map).length) throw new Error("Không đọc được chương trình khung.");
  return map;
}

function parseAttendanceBySemester(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const data = {};
  let sem = "";
  for (const tr of doc.querySelectorAll(".table-responsive table tbody tr")) {
    const tds = tr.querySelectorAll("td");
    if (tr.classList.contains("row-head") && tds.length === 1 && tds[0].colSpan > 4) {
      sem = tds[0].textContent.trim();
      if (!data[sem]) data[sem] = [];
      continue;
    }
    if (tds.length >= 6 && !tr.classList.contains("row-head") && sem) {
      const fullCode = tds[1].textContent.trim();
      if (!fullCode) continue;
      const excTd = tds[4];
      const unexTd = tds[5];
      data[sem].push({
        code: fullCode.length >= 10 ? fullCode.substring(0, 10) : fullCode,
        name: tds[2].textContent.trim(),
        excused: parseInt(excTd.textContent.trim()) || 0,
        unexcused: parseInt(unexTd.textContent.trim()) || 0,
        iddot: excTd.dataset.iddot || unexTd.dataset.iddot || "",
        mamonhoc: excTd.dataset.mamonhoc || unexTd.dataset.mamonhoc || "",
      });
    }
  }
  return data;
}

async function runAbsentDashboard() {
  try {
    const [ddRes, syllabusMap] = await Promise.all([
      fetch(location.origin + "/thong-tin-diem-danh.html", { credentials: "include" }),
      fetchSyllabusMap(),
    ]);
    const ddHtml = await ddRes.text();

    const semData = parseAttendanceBySemester(ddHtml);
    const semesters = Object.keys(semData);
    if (!semesters.length) throw new Error("Không có dữ liệu điểm danh.");

    for (const sem of semesters) {
      for (const c of semData[sem]) {
        const total = c.excused + c.unexcused;
        const hours = syllabusMap[c.code] || 0;
        c.absent = total;
        c.totalHours = hours;
        c.pct = hours > 0 ? (total / hours) * 100 : 0;
        c.pctStr = hours > 0 ? c.pct.toFixed(1) + "%" : "N/A";
      }
    }

    renderAbsentDashboard(semData, semesters);
  } catch (e) {
    renderAbsentDashboard(null, null, e.message);
  }
}

function renderAbsentDashboard(semData, semesters, errorMsg) {
  const old = document.getElementById("tl-sv-absent");
  if (old) old.remove();

  const wrap = document.createElement("div");
  wrap.id = "tl-sv-absent";
  wrap.style.cssText =
    "position:fixed;bottom:20px;right:20px;width:560px;background:#fff;border:1px solid #d1d5db;" +
    "border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.18);z-index:99999;" +
    "font:13px/1.4 system-ui,sans-serif;color:#1f2937;overflow:hidden";

  const header = document.createElement("div");
  header.style.cssText =
    "background:#1d4ed8;color:#fff;padding:10px 14px;font-weight:600;display:flex;" +
    "justify-content:space-between;align-items:center;cursor:pointer;font-size:14px";
  header.innerHTML = '<span>Thống kê % nghỉ học</span><span id="tl-sv-absent-toggle">&#9660;</span>';
  wrap.append(header);

  const content = document.createElement("div");
  content.id = "tl-sv-absent-content";
  content.style.cssText = "padding:12px;max-height:380px;overflow-y:auto";

  header.addEventListener("click", () => {
    const hidden = content.style.display === "none";
    content.style.display = hidden ? "block" : "none";
    header.querySelector("#tl-sv-absent-toggle").innerHTML = hidden ? "&#9660;" : "&#9650;";
  });

  if (errorMsg) {
    content.innerHTML =
      `<div style="color:#dc2626;padding:10px;text-align:center">Lỗi: ${errorMsg}</div>`;
    wrap.append(content);
    document.body.append(wrap);
    return;
  }

  const toolbar = document.createElement("div");
  toolbar.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px";
  const label = document.createElement("label");
  label.textContent = "Kỳ học:";
  label.style.fontWeight = "600";
  const select = document.createElement("select");
  select.style.cssText = "flex:1;padding:5px;border:1px solid #d1d5db;border-radius:4px;font:inherit";
  for (const sem of semesters) {
    const opt = document.createElement("option");
    opt.value = sem; opt.textContent = sem;
    select.append(opt);
  }
  select.value = semesters[semesters.length - 1];
  toolbar.append(label, select);
  content.append(toolbar);

  const table = document.createElement("table");
  table.style.cssText = "width:100%;border-collapse:collapse;text-align:center;font-size:12px";
  table.innerHTML =
    '<thead><tr style="background:#f3f4f6">' +
    '<th style="border:1px solid #e5e7eb;padding:6px">Mã HP</th>' +
    '<th style="border:1px solid #e5e7eb;padding:6px;text-align:left">Tên môn học</th>' +
    '<th style="border:1px solid #e5e7eb;padding:6px" title="Lý thuyết + Thực hành">Tổng tiết</th>' +
    '<th style="border:1px solid #e5e7eb;padding:6px" title="Có phép + Không phép">Đã nghỉ</th>' +
    '<th style="border:1px solid #e5e7eb;padding:6px">Tỷ lệ</th></tr></thead>';
  const tbody = document.createElement("tbody");
  table.append(tbody);
  content.append(table);
  wrap.append(content);

  const detailPanel = document.createElement("div");
  detailPanel.id = "tl-sv-absent-detail";
  detailPanel.style.cssText = "display:none;padding:10px;border-top:1px solid #e5e7eb;max-height:200px;overflow-y:auto;font-size:12px";
  wrap.append(detailPanel);

  async function showDetail(c) {
    if (!c.iddot || !c.mamonhoc || c.absent === 0) return;
    detailPanel.style.display = "block";
    detailPanel.innerHTML = `<div style="text-align:center;color:#6b7280">Đang tải chi tiết ${c.name}...</div>`;
    try {
      const params = new URLSearchParams({
        IDDot: c.iddot, MaMonHoc: c.mamonhoc, TenMonHoc: c.name, IsCoPhep: "false",
      });
      const res = await fetch(`/SinhVien/ThongTinDiemDanhChiTiet?${params}`, { credentials: "include" });
      const html = await res.text();
      detailPanel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <b>${c.name} — Chi tiết nghỉ</b>
        <span style="cursor:pointer;font-size:16px;color:#6b7280" id="tl-sv-close-detail">✕</span>
      </div><div>${html}</div>`;
      detailPanel.querySelector("#tl-sv-close-detail").addEventListener("click", () => {
        detailPanel.style.display = "none";
      });
      const dtable = detailPanel.querySelector("table");
      if (dtable) dtable.style.cssText = "width:100%;border-collapse:collapse;font-size:11px";
      for (const td of detailPanel.querySelectorAll("td,th")) {
        td.style.cssText += ";border:1px solid #e5e7eb;padding:3px 5px";
      }
    } catch (e) {
      detailPanel.innerHTML = `<div style="color:#dc2626">Lỗi: ${e.message}</div>`;
    }
  }

  function render(sem) {
    detailPanel.style.display = "none";
    tbody.replaceChildren();
    const courses = semData[sem] || [];
    if (!courses.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:10px;color:#6b7280">Không có dữ liệu.</td></tr>';
      return;
    }
    for (const c of courses) {
      const tr = document.createElement("tr");
      const warn = c.pct >= 20 ? "color:#dc2626;font-weight:700" : "";
      const clickable = c.absent > 0 && c.iddot ? "cursor:pointer;color:#1d4ed8;text-decoration:underline" : "";
      tr.innerHTML =
        `<td style="border:1px solid #e5e7eb;padding:5px">${c.code}</td>` +
        `<td style="border:1px solid #e5e7eb;padding:5px;text-align:left">${c.name}</td>` +
        `<td style="border:1px solid #e5e7eb;padding:5px">${c.totalHours || "?"}</td>` +
        `<td style="border:1px solid #e5e7eb;padding:5px;font-weight:600;${clickable}" data-detail="1">${c.absent}</td>` +
        `<td style="border:1px solid #e5e7eb;padding:5px;${warn}">${c.pctStr}</td>`;
      if (c.absent > 0 && c.iddot) {
        tr.querySelector('[data-detail]').addEventListener("click", () => showDetail(c));
      }
      tbody.append(tr);
    }
  }

  select.addEventListener("change", () => render(select.value));
  render(select.value);
  document.body.append(wrap);
}

// --- Tra cứu giảng viên ---

function parseTeacher(raw) {
  const m = raw.Ten.match(/^(.+?)\s*-\s*(\d{5,})\s*-\s*(.+)$/);
  if (!m) return null;
  return { id: raw.ID, dept: m[1].trim(), code: m[2].trim(), name: m[3].trim() };
}

async function fetchTeacherList(force = false) {
  if (!force) {
    const { teacherList } = await chrome.storage.local.get("teacherList");
    if (teacherList?.length) return { ok: true, count: teacherList.length, cached: true };
  }
  try {
    const res = await fetch("/SinhVien/SinhVien_GetGiangVienFullForSelect", { credentials: "include" });
    const data = await res.json();
    const list = data.map(parseTeacher).filter(Boolean);
    await chrome.storage.local.set({ teacherList: list, teacherListAt: Date.now() });
    return { ok: true, count: list.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function fetchTeacherDetail(code) {
  try {
    const body = new URLSearchParams();
    body.append("param[MaGiangVien]", code);
    const res = await fetch("/SinhVien/GetThongTinGiangVien", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
      body,
    });
    const data = await res.json();
    if (Array.isArray(data) && data.length) return { ok: true, data: data[0] };
    return { ok: false, error: "Không có dữ liệu." };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

setTimeout(() => fetchTeacherList(false), 3500);
