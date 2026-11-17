try { importScripts("/config.js", "/background/webhook.js", "/background/calendar-sync.js"); } catch {}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CHECK_UPDATE") {
    checkExtensionUpdate().then(sendResponse);
    return true;
  }
  if (msg.type === "TEST_WEBHOOK") {
    sendTestWebhook().then(sendResponse);
    return true;
  }

  if (msg.type === "SYNC_CALENDAR") {
    syncCalendar(!!msg.force).then(sendResponse);
    return true;
  }

  if (msg.type === "QR_OPEN_URL") {
    let url;
    try { url = new URL(msg.url); } catch { return; }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    chrome.tabs.create({
      url: url.href,
      openerTabId: sender.tab?.id,
      index: sender.tab ? sender.tab.index + 1 : undefined,
    });
    return;
  }

  if (msg.type === "OPEN_AUTO_SURVEY") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("tools/auto-survey.html") + (msg.auto ? "?auto=1" : ""),
      openerTabId: sender.tab?.id,
    });
    return;
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

// Dùng chung nguồn phiên bản cho popup và banner trên trang sinh viên.
// Gộp các yêu cầu đồng thời khi người dùng mở nhiều tab.
let updateCheck = null;
function checkExtensionUpdate() {
  if (updateCheck) return updateCheck;
  updateCheck = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch("https://raw.githubusercontent.com/Anbeluce/Extension-EPU/main/manifest.json", {
        cache: "no-store", signal: controller.signal,
      });
      if (!res.ok) return { ok: false };
      const { version: latest } = await res.json();
      if (typeof latest !== "string" || !/^\d+(?:\.\d+){0,3}$/.test(latest)) return { ok: false };
      const current = chrome.runtime.getManifest().version;
      const a = latest.split(".").map(Number);
      const b = current.split(".").map(Number);
      let available = false;
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (a[i] || 0) - (b[i] || 0);
        if (diff) { available = diff > 0; break; }
      }
      return { ok: true, available, current, latest, url: "https://github.com/Anbeluce/Extension-EPU/releases" };
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(timeout);
    }
  })().finally(() => { updateCheck = null; });
  return updateCheck;
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "scan-qr") startQrScan(tab);
});

async function startQrScan(tab) {
  try {
    tab ||= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab?.id) return;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["lib/jsQR.js", "content/qr-scan.js"],
    });
    await chrome.tabs.sendMessage(tab.id, { type: "QR_START", dataUrl });
  } catch (e) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: "Quét QR",
      message: `Không quét được trên tab này: ${e.message}`,
    });
  }
}

chrome.runtime.onStartup.addListener(() => { syncCalendar(); });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CALENDAR_RETRY_ALARM) syncCalendar();
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});
