// Thống kê % nghỉ học (chỉ hiện trên trang dashboard).

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
        fullCode,
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

// Hai loại mã data-bg khác nhau trên web sinh viên:
// - Mã lớp học phần (một số cho cả môn): lấy từ danh sách "Lớp học phần" có sẵn trên dashboard (khớp theo mã lớp
//   học phần 12 số, vd 010100086301); không có thì gọi API danh sách lớp học phần của đúng kỳ (iddot) của môn đó,
//   mỗi kỳ chỉ gọi một lần.
// - Mã buổi học (mỗi buổi trong lịch tuần một số): lấy từ lịch tuần của đúng tuần có ngày nghỉ, khối lịch trùng
//   tên môn nằm ở cột ngày nghỉ.
const lhpByDot = new Map(); // iddot -> Promise<Map<mã lớp học phần 12 số, data-bg>>

function lhpFromLinks(root) {
  const map = new Map();
  for (const a of root.querySelectorAll("a[data-bg]")) {
    const code = a.textContent.trim();
    if (code) map.set(code, a.dataset.bg);
  }
  return map;
}

function lhpOfDot(iddot) {
  if (!lhpByDot.has(iddot)) {
    const request = fetch(`/SinhVien/DanhSachLopHocPhanTheoDot?pIDDot=${encodeURIComponent(iddot)}`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`Lỗi ${res.status}`);
        return res.text();
      })
      .then((html) => lhpFromLinks(new DOMParser().parseFromString(html, "text/html")));
    request.catch(() => lhpByDot.delete(iddot)); // lỗi mạng thì lần bấm sau thử lại
    lhpByDot.set(iddot, request);
  }
  return lhpByDot.get(iddot);
}

const normalizeName = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

const scheduleByWeek = new Map(); // thứ 2 của tuần (dd/mm/yyyy) -> Promise<Document>

const monday = (date) => {
  const [d, m, y] = date.split("/").map(Number);
  const mon = new Date(y, m - 1, d - ((new Date(y, m - 1, d).getDay() + 6) % 7));
  return `${String(mon.getDate()).padStart(2, "0")}/${String(mon.getMonth() + 1).padStart(2, "0")}/${mon.getFullYear()}`;
};

// Lịch tuần chứa ngày `date` (dd/mm/yyyy), mỗi tuần chỉ gọi một lần.
function scheduleOfWeek(date) {
  const key = monday(date);
  if (!scheduleByWeek.has(key)) {
    const request = fetch("/SinhVien/GetDanhSachLichTheoTuan", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      credentials: "include",
      body: new URLSearchParams({ pNgayHienTai: date, pLoaiLich: "0" }),
    }).then((res) => {
      if (!res.ok) throw new Error(`Lỗi ${res.status}`);
      return res.text();
    }).then((html) => new DOMParser().parseFromString(html, "text/html"));
    request.catch(() => scheduleByWeek.delete(key));
    scheduleByWeek.set(key, request);
  }
  return scheduleByWeek.get(key);
}

// Mã buổi học của môn `name` vào ngày `date`: ô lịch nằm ở cột có đúng ngày đó, có thể có nhiều buổi trong ngày.
async function sessionsOnDate(name, date) {
  const doc = await scheduleOfWeek(date);
  const columns = [...doc.querySelectorAll("thead th")].map((th) => th.textContent.match(/\d{2}\/\d{2}\/\d{4}/)?.[0]);
  const wanted = normalizeName(name);
  const found = [];
  for (const tr of doc.querySelectorAll("tbody tr")) {
    [...tr.children].forEach((td, i) => {
      if (columns[i] !== date) return;
      for (const block of td.querySelectorAll(".color-lichhoc[data-bg]")) {
        const a = block.querySelector("a");
        if (a && normalizeName(a.textContent) === wanted) found.push(block.dataset.bg);
      }
    });
  }
  return found;
}

// Các ngày dd/mm/yyyy xuất hiện trong bảng chi tiết nghỉ, bỏ trùng.
function datesInText(text) {
  const found = new Set();
  for (const m of text.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g)) {
    found.add(`${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`);
  }
  return [...found];
}

// Trả về mã lớp học phần hoặc null nếu không tìm được. Kết quả tìm thấy được nhớ lại trong c.lhp.
async function resolveLhp(c) {
  if (c.lhp) return c.lhp;
  const fromPage = lhpFromLinks(document).get(c.fullCode);
  if (fromPage) return (c.lhp = fromPage);

  if (c.iddot) {
    try {
      const fromApi = (await lhpOfDot(c.iddot)).get(c.fullCode);
      if (fromApi) return (c.lhp = fromApi);
    } catch { /* thử nguồn tiếp theo */ }
  }

  return null;
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

const ABSENT_CELL = "border:1px solid #e5e7eb;padding:5px";

function renderAbsentDashboard(semData, semesters, errorMsg) {
  document.getElementById("tl-sv-absent")?.remove();

  const toggle = h("span", { id: "tl-sv-absent-toggle" }, "▼");
  const header = h("div", {
    style: "background:#1d4ed8;color:#fff;padding:10px 14px;font-weight:600;display:flex;" +
      "justify-content:space-between;align-items:center;cursor:pointer;font-size:14px",
  }, h("span", {}, "Thống kê phần trăm nghỉ học"), toggle);
  const content = h("div", { id: "tl-sv-absent-content", style: "padding:12px;max-height:380px;overflow-y:auto" });
  const wrap = h("div", {
    id: "tl-sv-absent",
    style: "position:fixed;bottom:20px;right:20px;width:560px;background:#fff;border:1px solid #d1d5db;" +
      "border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.18);z-index:99999;" +
      "font:13px/1.4 system-ui,sans-serif;color:#1f2937;overflow:hidden",
  }, header, content);

  header.addEventListener("click", () => {
    const hidden = content.style.display === "none";
    content.style.display = hidden ? "block" : "none";
    toggle.textContent = hidden ? "▼" : "▲";
  });

  if (errorMsg) {
    content.append(h("div", { style: "color:#dc2626;padding:10px;text-align:center" }, `Lỗi: ${errorMsg}`));
    document.body.append(wrap);
    return;
  }

  const select = h("select", {
    style: "flex:1;padding:5px;border:1px solid #d1d5db;border-radius:4px;font:inherit",
  }, ...semesters.map((sem) => h("option", { value: sem }, sem)));
  select.value = semesters[semesters.length - 1];
  content.append(h("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:10px" },
    h("label", { style: "font-weight:600" }, "Kỳ học:"), select));

  const th = (extra, text, title) =>
    h("th", { style: `border:1px solid #e5e7eb;padding:6px${extra}`, ...(title ? { title } : {}) }, text);
  const tbody = h("tbody");
  content.append(h("table", { style: "width:100%;border-collapse:collapse;text-align:center;font-size:12px" },
    h("thead", {}, h("tr", { style: "background:#f3f4f6" },
      th("", "Mã HP"),
      th(";text-align:left", "Tên môn học"),
      th("", "Tổng tiết", "Lý thuyết + Thực hành"),
      th("", "Đã nghỉ", "Có phép + Không phép"),
      th("", "Tỷ lệ"))),
    tbody));

  const detailPanel = h("div", {
    id: "tl-sv-absent-detail",
    style: "display:none;padding:10px;border-top:1px solid #e5e7eb;max-height:200px;overflow-y:auto;font-size:12px",
  });
  wrap.append(detailPanel);

  // Thêm hai cột vào bảng chi tiết nghỉ: mã lớp học phần (cả môn) và mã buổi học trong lịch tuần (từng ngày nghỉ).
  // Ô hiện "…" trước, tra xong mới điền, nên bảng chi tiết không phải chờ.
  function addBgColumns(c) {
    const table = detailPanel.querySelector("table");
    const rows = table ? [...table.querySelectorAll("tbody tr")] : [];
    if (!rows.length) return;
    table.querySelector("thead th[colspan]")?.setAttribute("colspan", "6");
    table.querySelector("thead tr:last-child").append(
      h("th", { title: "data-bg của lớp học phần (dashboard/API)" }, "Mã LHP"),
      h("th", { title: "data-bg của buổi học trong lịch tuần" }, "Mã buổi học"));

    const fail = (cell, e) => { cell.textContent = "lỗi"; cell.title = e.message; };
    const lhpCells = [];
    for (const tr of rows) {
      const lhpCell = h("td", { class: "text-center" }, "…");
      const sessionCell = h("td", { class: "text-center" }, "…");
      tr.append(lhpCell, sessionCell);
      lhpCells.push(lhpCell);
      const date = datesInText(tr.children[1]?.textContent || "")[0];
      if (!date) { sessionCell.textContent = "—"; continue; }
      sessionsOnDate(c.name, date)
        .then((ids) => { sessionCell.textContent = ids.join(", ") || "—"; })
        .catch((e) => fail(sessionCell, e));
    }
    resolveLhp(c).then((id) => lhpCells.forEach((cell) => { cell.textContent = id || "—"; }));
  }

  async function showDetail(c) {
    if (!c.iddot || !c.mamonhoc || c.absent === 0) return;
    detailPanel.style.display = "block";
    detailPanel.replaceChildren(h("div", { style: "text-align:center;color:#6b7280" }, `Đang tải chi tiết ${c.name}...`));
    try {
      const params = new URLSearchParams({
        IDDot: c.iddot, MaMonHoc: c.mamonhoc, TenMonHoc: c.name, IsCoPhep: "false",
      });
      const res = await fetch(`/SinhVien/ThongTinDiemDanhChiTiet?${params}`, { credentials: "include" });
      const html = await res.text();
      detailPanel.replaceChildren(
        h("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:6px" },
          h("b", {}, `${c.name} — Chi tiết nghỉ`),
          h("span", {
            style: "cursor:pointer;font-size:16px;color:#6b7280",
            onclick: () => { detailPanel.style.display = "none"; },
          }, "✕")),
        h("div", {}, ...sanitizedNodes(html)));
      addBgColumns(c);
      const dtable = detailPanel.querySelector("table");
      if (dtable) dtable.style.cssText = "width:100%;border-collapse:collapse;font-size:11px";
      for (const td of detailPanel.querySelectorAll("td,th")) {
        td.style.cssText += ";border:1px solid #e5e7eb;padding:3px 5px";
      }
    } catch (e) {
      detailPanel.replaceChildren(h("div", { style: "color:#dc2626" }, `Lỗi: ${e.message}`));
    }
  }

  function render(sem) {
    detailPanel.style.display = "none";
    tbody.replaceChildren();
    const courses = semData[sem] || [];
    if (!courses.length) {
      tbody.append(h("tr", {}, h("td", { colspan: "5", style: "padding:10px;color:#6b7280" }, "Không có dữ liệu.")));
      return;
    }
    for (const c of courses) {
      const warn = c.pct >= 20 ? "color:#dc2626;font-weight:700" : "";
      const canOpen = c.absent > 0 && c.iddot;
      const clickable = canOpen ? "cursor:pointer;color:#1d4ed8;text-decoration:underline" : "";
      const absentCell = h("td", { style: `${ABSENT_CELL};font-weight:600;${clickable}`, "data-detail": "1" }, String(c.absent));
      if (canOpen) absentCell.addEventListener("click", () => showDetail(c));
      tbody.append(h("tr", {},
        h("td", { style: ABSENT_CELL }, c.code),
        h("td", { style: `${ABSENT_CELL};text-align:left` }, c.name),
        h("td", { style: ABSENT_CELL }, String(c.totalHours || "?")),
        absentCell,
        h("td", { style: `${ABSENT_CELL};${warn}` }, c.pctStr)));
    }
  }

  select.addEventListener("change", () => render(select.value));
  render(select.value);
  document.body.append(wrap);
}
