// Điểm khởi động của content script (nạp sau cùng): các tác vụ chạy nền khi mở trang web sinh viên.

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => watchStudentInfo());
} else {
  watchStudentInfo();
}

setTimeout(() => runAttendanceCheck(false), 2000);
setTimeout(() => chrome.runtime.sendMessage({ type: "SYNC_COOKIES" }), 3000);
if (location.pathname.includes("dashboard")) setTimeout(runAbsentDashboard, 1500);
setTimeout(() => fetchTeacherList(false), 3500);
