try { importScripts("/config.js"); } catch {}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_COOKIES") {
    chrome.cookies.getAll({ url: msg.url })
      .then((cookies) => sendResponse({ ok: true, cookies }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === "SYNC_COOKIES") {
    syncCookies(msg.force).then(sendResponse);
    return true;
  }

  if (msg.type === "SHOW_TOASTR") {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (message, title, options) => {
        if (typeof toastr !== "undefined") {
          toastr.info(message, title, options);
        }
      },
      args: [msg.message, msg.title, msg.options],
    });
  }
});

async function syncCookies(force = false) {
  const config = await getConfig();
  const { cookieSync } = config;

  if (!cookieSync?.enabled || !cookieSync?.workerUrl || !cookieSync?.userName) {
    return { ok: false, error: "Chưa cấu hình đồng bộ cookie." };
  }

  if (!force) {
    const { cookieSyncedAt } = await chrome.storage.local.get("cookieSyncedAt");
    if (cookieSyncedAt && Date.now() - cookieSyncedAt < 30 * 60 * 1000) {
      return { ok: true, skipped: true };
    }
  }

  try {
    const cookies = await chrome.cookies.getAll({ url: config.portalUrl, name: "ASC.AUTH" });
    if (!cookies.length) {
      return { ok: false, error: "Không tìm thấy cookie ASC.AUTH." };
    }

    const cookieStr = `ASC.AUTH=${cookies[0].value}`;
    const url = `${cookieSync.workerUrl}?action=update-auth&user=${encodeURIComponent(cookieSync.userName)}`;

    const res = await fetch(url, {
      method: "POST",
      body: cookieStr,
      headers: { "Content-Type": "text/plain" },
    });

    if (!res.ok) {
      return { ok: false, error: `Worker trả về ${res.status}: ${await res.text()}` };
    }

    await chrome.storage.local.set({ cookieSyncedAt: Date.now() });
    return { ok: true, count: cookies.length, response: await res.text() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});
