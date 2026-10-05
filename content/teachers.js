// Tra cứu giảng viên: tải sẵn danh sách ngay trên trang web sinh viên (đã có cookie đăng nhập) để trang tra cứu giảng viên dùng.

const fetchFromPortal = (path, options = {}) => fetch(path, { credentials: "include", ...options });

async function fetchTeacherList(force = false) {
  if (!force) {
    const { teacherList } = await chrome.storage.local.get("teacherList");
    if (teacherList?.length) return { ok: true, count: teacherList.length, cached: true };
  }
  try {
    const list = await loadTeacherList(fetchFromPortal);
    return { ok: true, count: list.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
