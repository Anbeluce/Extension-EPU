// Phát hiện khảo sát bắt buộc: khi cổng thông tin ép sinh viên sang trang danh sách
// phiếu khảo sát (và người dùng đã bật tính năng), tự mở MỘT trang chuyên dụng
// (tools/auto-survey.html) ở tab mới — trang đó sẽ tự tải, điền và GỬI hết các phiếu.
//
// Việc gửi thực hiện ở trang runner bằng fetch trực tiếp, nên content script này chỉ
// làm nhiệm vụ phát hiện + mở tab (một lần mỗi phiên) và hiện thông báo nhỏ.

(function () {
  const path = location.pathname.toLowerCase();
  const isList = /danh-sach-phieu-khao-sat-sinh-vien/.test(path);
  if (!isList) return; // chỉ kích hoạt ở trang danh sách (đích mà portal ép tới)

  (async () => {
    let autoSurvey = {};
    try {
      const { config } = await chrome.storage.sync.get("config");
      autoSurvey = (config && config.autoSurvey) || {};
    } catch { return; }
    if (!autoSurvey.enabled) return;

    // Chỉ mở một lần mỗi phiên trình duyệt để không bật lại tab liên tục.
    if (sessionStorage.getItem("as_opened") === "1") return;

    // Còn phiếu chưa khảo sát không? (tab #tab_chuaks)
    const pending = document.querySelectorAll(
      '#tab_chuaks a[href*="chi-tiet-phieu-khao-sat-sinh-vien"], a[href*="chi-tiet-phieu-khao-sat-sinh-vien"]'
    ).length;
    if (!pending) return;

    sessionStorage.setItem("as_opened", "1");
    chrome.runtime.sendMessage({ type: "OPEN_AUTO_SURVEY", auto: true });
    showBanner("Phát hiện khảo sát bắt buộc — đã mở trang Tự động khảo sát ở tab mới.");
  })();

  function showBanner(msg) {
    document.getElementById("epu-auto-survey")?.remove();
    const close = h("button", {
      onclick: () => document.getElementById("epu-auto-survey")?.remove(),
      style: "margin-left:8px;padding:4px 12px;border:0;border-radius:6px;cursor:pointer;background:rgba(255,255,255,.25);color:#fff;font:inherit;font-size:13px",
    }, "Đóng");
    const bar = h("div", {
      id: "epu-auto-survey",
      style:
        "position:fixed;top:0;left:0;right:0;z-index:2147483647;display:flex;align-items:center;gap:8px;" +
        "padding:10px 16px;background:#1d4ed8;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25)",
    }, h("span", { style: "flex:1" }, msg), close);
    (document.body || document.documentElement).append(bar);
    setTimeout(() => document.getElementById("epu-auto-survey")?.remove(), 12000);
  }
})();
