// Điểm khởi động của content script (nạp sau cùng): các tác vụ chạy nền khi mở trang web sinh viên.

// Mỗi lần tải trang kiểm tra lại; đóng banner chỉ có hiệu lực trên trang hiện tại.
async function showExtensionUpdate() {
  try {
    const update = await chrome.runtime.sendMessage({ type: "CHECK_UPDATE" });
    if (!update?.ok || !update.available || document.getElementById("epu-extension-update")) return;
    const banner = h("div", { id: "epu-extension-update", role: "status" },
      h("span", {}, `EPU Extension có bản mới v${update.latest} (đang dùng v${update.current}).`),
      h("a", { href: update.url, target: "_blank", rel: "noopener noreferrer" }, "Xem trên GitHub"),
      h("button", { type: "button", "aria-label": "Đóng thông báo", onclick: () => banner.remove() }, "×"),
    );
    banner.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:calc(100vw - 32px);box-sizing:border-box;display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:14px 18px;background:#fff7db;color:#493700;border:1px solid #d6b44d;border-radius:8px;box-shadow:0 4px 18px #0003;font:14px/1.5 system-ui,sans-serif;text-align:left";
    banner.querySelector("a").style.cssText = "color:#174ea6;text-decoration:underline;font-weight:600";
    banner.querySelector("button").style.cssText = "background:transparent;border:0;color:#493700;cursor:pointer;font:24px/1 system-ui;padding:0 4px";
    document.body.append(banner);
  } catch { /* Không làm gián đoạn trang nếu mất mạng hoặc extension vừa được reload. */ }
}
showExtensionUpdate();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => watchStudentInfo());
} else {
  watchStudentInfo();
}

setTimeout(() => runAttendanceCheck(false), 2000);
// Nếu lúc mở trình duyệt chưa đăng nhập hoặc chưa biết MSSV thì thử lại khi sinh viên vào web (tối đa 1 lần thành công/ngày).
setTimeout(() => chrome.runtime.sendMessage({ type: "SYNC_CALENDAR" }).catch(() => {}), 4000);
if (location.pathname.includes("dashboard")) setTimeout(runAbsentDashboard, 1500);
setTimeout(() => fetchTeacherList(false), 3500);
