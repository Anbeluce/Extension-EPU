const $ = (id) => document.getElementById(id);

const setStatus = (text, isError = false) => {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
};

async function getAuthCookie() {
  const { portalUrl } = await getConfig();
  const cookies = await chrome.cookies.getAll({ url: portalUrl, name: "ASC.AUTH" });
  return cookies.length ? `ASC.AUTH=${cookies[0].value}` : null;
}

async function apiFetch(path, options = {}) {
  const cookie = await getAuthCookie();
  if (!cookie) throw new Error("Chưa đăng nhập. Hãy vào sv.epu.edu.vn đăng nhập trước.");
  const { portalUrl } = await getConfig();
  return fetch(portalUrl + path, {
    ...options,
    headers: { Cookie: cookie, ...(options.headers || {}) },
  });
}

// --- Data ---

function parseTeacher(raw) {
  const m = raw.Ten.match(/^(.+?)\s*-\s*(\d{5,})\s*-\s*(.+)$/);
  if (!m) return null;
  return { id: raw.ID, dept: m[1].trim(), code: m[2].trim(), name: m[3].trim() };
}

let allTeachers = [];
let filtered = [];
let currentPage = 1;
const PAGE_SIZE = 20;

async function loadTeachers(force = false) {
  if (!force) {
    const { teacherList } = await chrome.storage.local.get("teacherList");
    if (teacherList?.length) {
      allTeachers = teacherList;
      buildDeptFilter();
      applyFilters();
      setStatus(`${allTeachers.length} giảng viên.`);
      return;
    }
  }
  setStatus("Đang tải danh sách giảng viên...");
  try {
    const res = await apiFetch("/SinhVien/SinhVien_GetGiangVienFullForSelect");
    const data = await res.json();
    allTeachers = data.map(parseTeacher).filter(Boolean);
    await chrome.storage.local.set({ teacherList: allTeachers, teacherListAt: Date.now() });
    buildDeptFilter();
    applyFilters();
    setStatus(`${allTeachers.length} giảng viên.`);
  } catch (e) {
    setStatus(e.message, true);
  }
}

function buildDeptFilter() {
  const select = $("filter-dept");
  const depts = [...new Set(allTeachers.map(t => t.dept))].sort();
  const current = select.value;
  select.innerHTML = '<option value="">Tất cả khoa</option>';
  for (const d of depts) {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    select.append(opt);
  }
  if (current && depts.includes(current)) select.value = current;
}

function applyFilters() {
  const q = $("teacher-search").value.trim().toLowerCase();
  const dept = $("filter-dept").value;
  filtered = allTeachers.filter(t => {
    if (dept && t.dept !== dept) return false;
    if (q && !t.name.toLowerCase().includes(q) && !t.code.includes(q) && !t.dept.toLowerCase().includes(q)) return false;
    return true;
  });
  currentPage = 1;
  renderPage();
}

function renderPage() {
  const grid = $("teacher-grid");
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filtered.slice(start, start + PAGE_SIZE);

  if (!filtered.length) {
    grid.innerHTML = '<div style="padding:24px;color:#6b7280;text-align:center">Không tìm thấy giảng viên phù hợp.</div>';
    $("pagination").innerHTML = "";
    return;
  }

  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>#</th><th>Khoa</th><th>Tên giảng viên</th><th>Mã GV</th></tr></thead>";
  const tbody = document.createElement("tbody");
  page.forEach((t, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${start + i + 1}</td>` +
      `<td>${t.dept}</td>` +
      `<td><b>${t.name}</b></td>` +
      `<td>${t.code}</td>`;
    tr.addEventListener("click", () => {
      grid.querySelector("tr.active")?.classList.remove("active");
      tr.classList.add("active");
      showTeacherDetail(t);
    });
    tbody.append(tr);
  });
  table.append(tbody);
  grid.replaceChildren(table);

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const pag = $("pagination");
  if (totalPages <= 1) { pag.innerHTML = `<span>${filtered.length} kết quả</span>`; return; }

  pag.replaceChildren();
  const info = document.createElement("span");
  info.textContent = `${filtered.length} kết quả — Trang ${currentPage}/${totalPages}`;

  const btnPrev = document.createElement("button");
  btnPrev.textContent = "←";
  btnPrev.disabled = currentPage <= 1;
  btnPrev.addEventListener("click", () => { currentPage--; renderPage(); });

  const btnNext = document.createElement("button");
  btnNext.textContent = "→";
  btnNext.disabled = currentPage >= totalPages;
  btnNext.addEventListener("click", () => { currentPage++; renderPage(); });

  pag.append(btnPrev);

  const maxButtons = 7;
  let startP = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let endP = Math.min(totalPages, startP + maxButtons - 1);
  if (endP - startP < maxButtons - 1) startP = Math.max(1, endP - maxButtons + 1);

  for (let p = startP; p <= endP; p++) {
    const btn = document.createElement("button");
    btn.textContent = p;
    if (p === currentPage) btn.classList.add("active");
    btn.addEventListener("click", () => { currentPage = p; renderPage(); });
    pag.append(btn);
  }

  pag.append(btnNext, info);
}

// --- Chi tiết ---

async function showTeacherDetail(t) {
  const panel = $("teacher-detail");
  panel.innerHTML = `<div style="color:#6b7280;text-align:center;padding:20px">Đang tải...</div>`;
  try {
    const body = new URLSearchParams();
    body.append("param[MaGiangVien]", t.code);
    const res = await apiFetch("/SinhVien/GetThongTinGiangVien", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
      body,
    });
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) {
      panel.innerHTML = `<div style="color:#b91c1c;text-align:center;padding:20px">Không có dữ liệu.</div>`;
      return;
    }
    renderDetail(data[0]);
  } catch (e) {
    panel.innerHTML = `<div style="color:#b91c1c;text-align:center;padding:20px">${e.message}</div>`;
  }
}

function val(v) {
  if (v === null || v === undefined || v === "") return '<span class="detail-value na">N/A</span>';
  return `<span class="detail-value">${v}</span>`;
}

function renderDetail(d) {
  const panel = $("teacher-detail");
  panel.innerHTML =
    `<div class="detail-header">
      <h2>${d.HoTen || "N/A"}</h2>
      <div class="detail-sub">${d.MaGiangVien || ""}</div>
    </div>
    <div class="detail-section">
      <h3>Thông tin cá nhân</h3>
      <div class="detail-row"><span class="detail-label">Họ đệm:</span>${val(d.HoDem)}</div>
      <div class="detail-row"><span class="detail-label">Tên:</span>${val(d.Ten)}</div>
      <div class="detail-row"><span class="detail-label">Họ tên:</span>${val(d.HoTen)}</div>
      <div class="detail-row"><span class="detail-label">Ngày sinh:</span>${val(d.NgaySinh)}</div>
    </div>
    <div class="detail-section">
      <h3>Đơn vị công tác</h3>
      <div class="detail-row"><span class="detail-label">Khoa:</span>${val(d.TenKhoa)}</div>
    </div>
    <div class="detail-section">
      <h3>Liên hệ</h3>
      <div class="detail-row"><span class="detail-label">SĐT:</span>${val(d.SoDienThoai)}</div>
      <div class="detail-row"><span class="detail-label">Email:</span>${val(d.Email)}</div>
    </div>`;
}

// --- Events ---

$("teacher-search").addEventListener("input", applyFilters);
$("filter-dept").addEventListener("change", applyFilters);
$("btn-refresh").addEventListener("click", () => loadTeachers(true));

// --- Init ---
loadTeachers();
