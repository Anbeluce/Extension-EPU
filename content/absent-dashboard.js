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

const ABSENT_CELL = "border:1px solid #e5e7eb;padding:5px";

function renderAbsentDashboard(semData, semesters, errorMsg) {
  document.getElementById("tl-sv-absent")?.remove();

  const toggle = h("span", { id: "tl-sv-absent-toggle" }, "▼");
  const header = h("div", {
    style: "background:#1d4ed8;color:#fff;padding:10px 14px;font-weight:600;display:flex;" +
      "justify-content:space-between;align-items:center;cursor:pointer;font-size:14px",
  }, h("span", {}, "Thống kê % nghỉ học"), toggle);
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
