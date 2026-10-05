// Cấu hình mặc định, dùng chung cho content script, popup và options.
// Người dùng chỉnh lại trong trang Cài đặt (lưu ở chrome.storage.sync).
const DEFAULT_CONFIG = {
  portalUrl: "https://sv.epu.edu.vn",
  quickLinks: [
    { name: "Trang chủ", url: "/" },
    { name: "Thời khóa biểu", url: "/thoi-khoa-bieu" },
    { name: "Xem điểm", url: "/xem-diem" },
    { name: "Đăng ký tín chỉ", url: "/dang-ky-hoc-phan.html" }
  ],
  cookieSync: {
    enabled: false,
    workerUrl: "",
    userName: "",
  },
  calendarSync: {
    enabled: false,
    workerUrl: "https://calender.epuer.id.vn/", // Worker lịch (thư mục calendar-worker/)
    fromDate: "", // yyyy-mm-dd; để trống = hôm nay
    toDate: "", // yyyy-mm-dd; để trống = 12 tuần sau ngày bắt đầu
  },
};

const HIDEABLE_FIELDS = [
  { id: "avatar", label: "Ảnh đại diện", langs: [], css: [".profile-userpic img", ".user-account-img"] },
  { id: "hoten", label: "Họ và tên", langs: ["sv-hoten", "thongtinsinhvien-hovaten"], css: [".user-account-name"] },
  { id: "mssv", label: "Mã Sinh Viên", langs: ["sv-mssv", "thongtinsinhvien-mssv"] },
  { id: "ngaysinh", label: "Ngày sinh", langs: ["sv-ngaysinh", "thongtinsinhvien-ngaysinh"] },
  { id: "gioitinh", label: "Giới tính", langs: ["sv-gioitinh", "thongtinsinhvien-gioitinh"] },
  { id: "sdt", label: "Số điện thoại", langs: ["thongtinsinhvien-sdt"] },
  { id: "email", label: "Email", langs: ["thongtinsinhvien-email"] },
  { id: "diachi", label: "Địa chỉ liên lạc", langs: ["thongtinsinhvien-diachilienlac"] },
  { id: "hktt", label: "Hộ khẩu thường trú", langs: ["thongtinsinhvien-hktt"] },
  { id: "noisinh", label: "Nơi sinh", langs: ["sv-noisinh", "thongtinsinhvien-noisinh"] },
  { id: "cccd", label: "Số CCCD/CMND", langs: ["thongtinsinhvien-socmnd"] },
  { id: "cccd-ngaycap", label: "Ngày cấp CCCD", langs: ["thongtinsinhvien-ngaycap"] },
  { id: "cccd-noicap", label: "Nơi cấp CCCD", langs: ["thongtinsinhvien-noicap"] },
  { id: "dantoc", label: "Dân tộc", langs: ["thongtinsinhvien-dantoc"] },
  { id: "tongiao", label: "Tôn giáo", langs: ["thongtinsinhvien-tongiao"] },
  { id: "khuvuc", label: "Khu vực", langs: ["thongtinsinhvien-khuvuc"] },
  { id: "lophoc", label: "Lớp học", langs: ["sv-lophoc", "thongtinsinhvien-lophoc"] },
  { id: "khoahoc", label: "Khóa học", langs: ["sv-khoahoc", "thongtinsinhvien-khoahoc"] },
  { id: "nganh", label: "Ngành", langs: ["sv-nganh", "thongtinsinhvien-nganh"] },
  { id: "chuyennganh", label: "Chuyên ngành", langs: ["thongtinsinhvien-chuyennganh"] },
  { id: "khoa", label: "Khoa", langs: ["thongtinsinhvien-khoa"] },
  { id: "hedaotao", label: "Hệ đào tạo", langs: ["sv-hedaotao", "thongtinsinhvien-bacdaotao"] },
  { id: "loaidaotao", label: "Loại hình đào tạo", langs: ["sv-loaihinhdt", "thongtinsinhvien-loaidaotao"] },
  { id: "trangthai", label: "Trạng thái", langs: ["thongtinsinhvien-trangthai"] },
  { id: "mahoso", label: "Mã hồ sơ", langs: ["thongtinsinhvien-mahoso"] },
  { id: "ngayvaotruong", label: "Ngày vào trường", langs: ["thongtinsinhvien-ngayvaotruong"] },
  { id: "coso", label: "Cơ sở", langs: ["thongtinsinhvien-coso"] },
  { id: "gvcn", label: "GVCN", langs: ["thongtinsinhvien-gvcn"] },
  { id: "covan", label: "Cố vấn lớp học", langs: ["thongtinsinhvien-covanlophoc"] },
  { id: "nganhang", label: "Tên ngân hàng", langs: ["thongtinsinhvien-tennganhang"] },
  { id: "chinhanh", label: "Chi nhánh NH", langs: ["thongtinsinhvien-tenchinhanh"] },
  { id: "chutaikhoan", label: "Chủ tài khoản", langs: ["thongtinsinhvien-chutaikhoan"] },
  { id: "sotaikhoan", label: "Số tài khoản", langs: ["thongtinsinhvien-sotaikhoan"] },
];

const getConfig = async () => {
  const stored = await chrome.storage.sync.get("config");
  return { ...DEFAULT_CONFIG, ...(stored.config || {}) };
};

const isHttps = (url) => {
  try { return new URL(url).protocol === "https:"; } catch { return false; }
};

// Xin quyền truy cập các địa chỉ https (một hộp thoại cho tất cả). Phải gọi từ thao tác của người dùng (click...).
async function ensureOriginPermission(...urls) {
  const list = urls.filter(Boolean);
  if (!list.length) return { ok: false, error: "Chưa nhập địa chỉ." };
  if (!list.every(isHttps)) return { ok: false, error: "Địa chỉ phải bắt đầu bằng https://" };
  const origins = [...new Set(list.map((u) => new URL(u).origin + "/*"))];
  if (await chrome.permissions.contains({ origins })) return { ok: true };
  const granted = await chrome.permissions.request({ origins });
  return granted ? { ok: true } : { ok: false, error: "Bạn đã từ chối cấp quyền truy cập." };
}

const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseIsoDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const validIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && isoDate(parseIsoDate(s)) === s;

function calendarSettings(config) {
  const c = { ...DEFAULT_CONFIG.calendarSync, ...(config.calendarSync || {}) };
  const date = (v) => (validIsoDate(String(v || "")) ? String(v) : "");
  return {
    enabled: !!c.enabled,
    workerUrl: String(c.workerUrl || "").trim(),
    fromDate: date(c.fromDate),
    toDate: date(c.toDate),
  };
}

// Khoảng ngày cần lấy lịch (gồm cả hai đầu). Trả về { error } nếu không hợp lệ.
function calendarRange(cal, today = new Date()) {
  const start = cal.fromDate ? parseIsoDate(cal.fromDate) : new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = cal.toDate ? parseIsoDate(cal.toDate) : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 12 * 7);
  if (end < start) return { error: "Ngày kết thúc phải sau ngày bắt đầu." };
  if (Math.round((end - start) / 86400000) > 371) return { error: "Khoảng thời gian lấy lịch tối đa 1 năm." };
  return { start, end, startIso: isoDate(start), endIso: isoDate(end) };
}

// Link .ics của sinh viên: <địa chỉ Worker>?id=<MSSV>
function calendarLink(workerUrl, mssv) {
  if (!isHttps(workerUrl) || !mssv) return "";
  const u = new URL(workerUrl);
  u.search = "";
  u.hash = "";
  u.searchParams.set("id", mssv);
  return u.href;
}
