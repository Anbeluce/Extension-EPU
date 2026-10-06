const $ = (id) => document.getElementById(id);

const setStatus = (text, isError = false) => {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
};

// ASC.AUTH là cookie HttpOnly nên trang không đọc được; trình duyệt tự gắn nó khi dùng credentials + quyền host.
async function apiFetch(path, options = {}) {
  const { portalUrl } = await getConfig();
  return fetch(portalUrl + path, { credentials: "include", ...options });
}

// Chưa đăng nhập thì server trả trang HTML đăng nhập thay vì JSON, nên res.json() báo SyntaxError.
const explain = (e) =>
  e instanceof SyntaxError ? new Error("Chưa đăng nhập hoặc phiên đã hết hạn. Hãy đăng nhập web sinh viên rồi bấm Tải lại dữ liệu.") : e;

// --- Data ---

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
    allTeachers = await loadTeacherList(apiFetch);
    buildDeptFilter();
    applyFilters();
    setStatus(`${allTeachers.length} giảng viên.`);
  } catch (e) {
    setStatus(explain(e).message, true);
  }
}

function buildDeptFilter() {
  const select = $("filter-dept");
  const depts = [...new Set(allTeachers.map(t => t.dept))].sort();
  const current = select.value;
  select.replaceChildren(h("option", { value: "" }, "Tất cả khoa"), ...depts.map(d => h("option", { value: d }, d)));
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
    grid.replaceChildren(h("div", { style: "padding:24px;color:#6b7280;text-align:center" }, "Không tìm thấy giảng viên phù hợp."));
    $("pagination").replaceChildren();
    return;
  }

  const tbody = h("tbody");
  page.forEach((t, i) => {
    const tr = h("tr", {},
      h("td", {}, String(start + i + 1)),
      h("td", {}, t.dept),
      h("td", {}, h("b", {}, t.name)),
      h("td", {}, t.code));
    tr.addEventListener("click", () => {
      grid.querySelector("tr.active")?.classList.remove("active");
      tr.classList.add("active");
      showTeacherDetail(t);
    });
    tbody.append(tr);
  });
  grid.replaceChildren(h("table", {},
    h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "Khoa"), h("th", {}, "Tên giảng viên"), h("th", {}, "Mã GV"))),
    tbody));

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const pag = $("pagination");
  if (totalPages <= 1) { pag.replaceChildren(h("span", {}, `${filtered.length} kết quả`)); return; }

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

const detailMessage = (text, color) =>
  h("div", { style: `color:${color};text-align:center;padding:20px` }, text);

async function showTeacherDetail(t) {
  const panel = $("teacher-detail");
  panel.replaceChildren(detailMessage("Đang tải...", "#6b7280"));
  try {
    const data = await loadTeacherDetail(apiFetch, t.code);
    if (!data) {
      panel.replaceChildren(detailMessage("Không có dữ liệu.", "#b91c1c"));
      return;
    }
    renderDetail(data);
  } catch (e) {
    panel.replaceChildren(detailMessage(explain(e).message, "#b91c1c"));
  }
}

function detailRow(label, v) {
  const empty = v === null || v === undefined || v === "";
  return h("div", { class: "detail-row" },
    h("span", { class: "detail-label" }, `${label}:`),
    h("span", { class: empty ? "detail-value na" : "detail-value" }, empty ? "N/A" : String(v)));
}

function renderDetail(d) {
  $("teacher-detail").replaceChildren(
    h("div", { class: "detail-header" },
      h("h2", {}, d.HoTen || "N/A"),
      h("div", { class: "detail-sub" }, d.MaGiangVien || "")),
    h("div", { class: "detail-section" },
      h("h3", {}, "Thông tin cá nhân"),
      detailRow("Họ đệm", d.HoDem),
      detailRow("Tên", d.Ten),
      detailRow("Họ tên", d.HoTen),
      detailRow("Ngày sinh", d.NgaySinh)),
    h("div", { class: "detail-section" },
      h("h3", {}, "Đơn vị công tác"),
      detailRow("Khoa", d.TenKhoa)),
    h("div", { class: "detail-section" },
      h("h3", {}, "Liên hệ"),
      detailRow("SĐT", d.SoDienThoai),
      detailRow("Email", d.Email)));
}

// --- Events ---

$("teacher-search").addEventListener("input", applyFilters);
$("filter-dept").addEventListener("change", applyFilters);
$("btn-refresh").addEventListener("click", () => loadTeachers(true));
$("btn-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

// --- Init ---
loadTeachers();
