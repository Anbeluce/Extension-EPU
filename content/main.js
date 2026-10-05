// Điểm khởi động của content script (nạp sau cùng): các tác vụ chạy nền khi mở trang web sinh viên.

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => watchStudentInfo());
} else {
  watchStudentInfo();
}

setTimeout(() => runAttendanceCheck(false), 2000);
setTimeout(() => chrome.runtime.sendMessage({ type: "SYNC_COOKIES" }), 3000);
// Nếu lúc mở trình duyệt chưa đăng nhập hoặc chưa biết MSSV thì thử lại khi sinh viên vào web (tối đa 1 lần thành công/ngày).
setTimeout(() => chrome.runtime.sendMessage({ type: "SYNC_CALENDAR" }).catch(() => {}), 4000);
if (location.pathname.includes("dashboard")) setTimeout(runAbsentDashboard, 1500);
setTimeout(() => fetchTeacherList(false), 3500);
