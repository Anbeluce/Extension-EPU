// Danh sách/chi tiết giảng viên, dùng chung cho content script và trang tra cứu giảng viên.
// doFetch(path, options) trả về Promise<Response> và tự lo phần cookie/domain.

const TEACHER_LIST_PATH = "/SinhVien/SinhVien_GetGiangVienFullForSelect";
const TEACHER_DETAIL_PATH = "/SinhVien/GetThongTinGiangVien";

function parseTeacher(raw) {
  const m = raw.Ten.match(/^(.+?)\s*-\s*(\d{5,})\s*-\s*(.+)$/);
  if (!m) return null;
  return { id: raw.ID, dept: m[1].trim(), code: m[2].trim(), name: m[3].trim() };
}

async function loadTeacherList(doFetch) {
  const res = await doFetch(TEACHER_LIST_PATH);
  const list = (await res.json()).map(parseTeacher).filter(Boolean);
  await chrome.storage.local.set({ teacherList: list, teacherListAt: Date.now() });
  return list;
}

async function loadTeacherDetail(doFetch, code) {
  const body = new URLSearchParams();
  body.append("param[MaGiangVien]", code);
  const res = await doFetch(TEACHER_DETAIL_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
    body,
  });
  const data = await res.json();
  return Array.isArray(data) && data.length ? data[0] : null;
}
