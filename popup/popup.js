const $ = (id) => document.getElementById(id);

const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

function renderGreeting(name) {
  $("greeting").textContent = name ? `Xin chào, ${name}` : "Trợ lý Sinh viên";
}

async function renderLinks() {
  const { portalUrl, quickLinks } = await getConfig();
  $("links").replaceChildren(...quickLinks.map(({ name, url }) => {
    const a = document.createElement("a");
    a.textContent = name;
    a.href = new URL(url, portalUrl).href;
    a.target = "_blank";
    return a;
  }));
}

$("btn-open-teachers").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("teachers/teachers.html") });
});

// --- Cookie ---

const setCookieStatus = (text, isError = false) => {
  $("cookie-status").textContent = text;
  $("cookie-status").classList.toggle("error", isError);
};

async function getTabCookieStoreId() {
  const tab = await activeTab();
  if (!tab) return undefined;
  const stores = await chrome.cookies.getAllCookieStores();
  const store = stores.find(s => s.tabIds.includes(tab.id));
  return store?.id;
}

$("btn-export").addEventListener("click", async () => {
  try {
    const { portalUrl } = await getConfig();
    const storeId = await getTabCookieStoreId();
    const query = { url: portalUrl };
    if (storeId) query.storeId = storeId;
    let cookies = await chrome.cookies.getAll(query);
    if (!cookies.length && storeId) cookies = await chrome.cookies.getAll({ url: portalUrl });
    if (!cookies.length) return setCookieStatus("Không có cookie. Hãy đăng nhập trước.", true);
    const data = cookies.map(({ name, value, domain, path, httpOnly, secure, sameSite, expirationDate }) =>
      ({ name, value, domain, path, httpOnly, secure, sameSite, expirationDate }));
    $("cookie-data").value = JSON.stringify(data, null, 2);
    setCookieStatus(`Đã xuất ${data.length} cookie.`);
  } catch (e) {
    setCookieStatus("Lỗi: " + e.message, true);
  }
});

$("btn-copy").addEventListener("click", async () => {
  const text = $("cookie-data").value;
  if (!text) return setCookieStatus("Chưa có dữ liệu.", true);
  await navigator.clipboard.writeText(text);
  setCookieStatus("Đã sao chép.");
});

$("btn-import").addEventListener("click", async () => {
  const text = $("cookie-data").value.trim();
  if (!text) return setCookieStatus("Dán JSON cookie vào ô trên rồi bấm Nhập.", true);
  let cookies;
  try { cookies = JSON.parse(text); } catch { return setCookieStatus("JSON không hợp lệ.", true); }
  if (!Array.isArray(cookies)) return setCookieStatus("Dữ liệu phải là mảng JSON.", true);
  const { portalUrl } = await getConfig();
  let ok = 0;
  for (const c of cookies) {
    try {
      await chrome.cookies.set({
        url: portalUrl, name: c.name, value: c.value ?? "",
        path: c.path || "/", httpOnly: !!c.httpOnly, secure: !!c.secure,
        sameSite: c.sameSite || "unspecified",
        ...(c.expirationDate ? { expirationDate: c.expirationDate } : {})
      });
      ok++;
    } catch {}
  }
  setCookieStatus(`Đã nhập ${ok}/${cookies.length} cookie.`);
});

function createCookieItem(cookie = {}) {
  const isNew = !cookie.name;
  const div = document.createElement("div");
  div.className = "cookie-item" + (isNew ? " new-cookie" : "");
  const header = document.createElement("div");
  header.className = "cookie-row";
  const nameIn = document.createElement("input");
  nameIn.dataset.field = "name";
  nameIn.value = cookie.name || "";
  nameIn.placeholder = "Tên";
  if (!isNew) nameIn.readOnly = true;
  header.append(nameIn);
  if (!isNew) {
    const del = document.createElement("button");
    del.className = "btn-del";
    del.textContent = "Xoá";
    del.addEventListener("click", async () => {
      const { portalUrl } = await getConfig();
      await chrome.cookies.remove({ url: portalUrl, name: cookie.name });
      setCookieStatus(`Đã xoá "${cookie.name}".`);
      loadCookieList();
    });
    header.append(del);
  } else {
    const cancel = document.createElement("button");
    cancel.className = "btn-del";
    cancel.textContent = "Huỷ";
    cancel.addEventListener("click", () => div.remove());
    header.append(cancel);
  }
  const valIn = document.createElement("input");
  valIn.dataset.field = "value";
  valIn.value = cookie.value || "";
  valIn.placeholder = "Giá trị";
  valIn.className = "cookie-val";
  const foot = document.createElement("div");
  foot.className = "cookie-row cookie-foot";
  const pathIn = document.createElement("input");
  pathIn.dataset.field = "path";
  pathIn.value = cookie.path || "/";
  pathIn.className = "cookie-path";
  pathIn.title = "Path";
  const mkFlag = (field, label, checked) => {
    const lbl = document.createElement("label");
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.dataset.field = field;
    chk.checked = checked;
    lbl.append(chk, " " + label);
    return lbl;
  };
  const save = document.createElement("button");
  save.textContent = "Lưu";
  save.className = "btn-save-cookie";
  save.addEventListener("click", async () => {
    const name = div.querySelector('[data-field="name"]').value.trim();
    if (!name) return setCookieStatus("Tên cookie không được trống.", true);
    const { portalUrl } = await getConfig();
    try {
      await chrome.cookies.set({
        url: portalUrl, name,
        value: div.querySelector('[data-field="value"]').value,
        path: div.querySelector('[data-field="path"]').value || "/",
        httpOnly: div.querySelector('[data-field="httpOnly"]').checked,
        secure: div.querySelector('[data-field="secure"]').checked,
      });
      setCookieStatus(`Đã lưu "${name}".`);
      loadCookieList();
    } catch (e) {
      setCookieStatus("Lỗi: " + e.message, true);
    }
  });
  foot.append(pathIn, mkFlag("httpOnly", "H", !!cookie.httpOnly), mkFlag("secure", "S", !!cookie.secure), save);
  div.append(header, valIn, foot);
  return div;
}

async function loadCookieList() {
  try {
    const { portalUrl } = await getConfig();
    const storeId = await getTabCookieStoreId();
    const query = { url: portalUrl };
    if (storeId) query.storeId = storeId;
    const cookies = await chrome.cookies.getAll(query);
    $("cookie-list").replaceChildren(...cookies.map(createCookieItem));
    setCookieStatus(`${cookies.length} cookie.`);
  } catch (e) {
    setCookieStatus("Lỗi: " + e.message, true);
  }
}

$("btn-load-cookies").addEventListener("click", loadCookieList);
$("btn-add-cookie").addEventListener("click", () => $("cookie-list").prepend(createCookieItem()));

// --- Đồng bộ Cookie ---

const setSyncStatus = (text, isError = false) => {
  $("sync-status").textContent = text;
  $("sync-status").classList.toggle("error", isError);
};

async function loadSyncState() {
  const config = await getConfig();
  const { cookieSync } = config;
  $("sync-toggle").checked = !!cookieSync?.enabled;
  if (!cookieSync?.workerUrl || !cookieSync?.userName) {
    setSyncStatus("Chưa cấu hình. Vào Cài đặt để nhập Worker URL và MSSV.", true);
    return;
  }
  const { cookieSyncedAt } = await chrome.storage.local.get("cookieSyncedAt");
  if (cookieSyncedAt) {
    setSyncStatus("Lần sync gần nhất: " + new Date(cookieSyncedAt).toLocaleString("vi-VN"));
  }
}

$("sync-toggle").addEventListener("change", async () => {
  const enabled = $("sync-toggle").checked;
  const config = await getConfig();
  if (enabled) {
    const perm = await ensureOriginPermission(config.cookieSync?.workerUrl);
    if (!perm.ok) {
      $("sync-toggle").checked = false;
      return setSyncStatus(perm.error === "Chưa nhập địa chỉ." ? "Chưa cấu hình. Vào Cài đặt để nhập Worker URL và MSSV." : perm.error, true);
    }
  }
  config.cookieSync = { ...(config.cookieSync || {}), enabled };
  await chrome.storage.sync.set({ config });
  setSyncStatus(enabled ? "Đã bật đồng bộ." : "Đã tắt đồng bộ.");
});

$("btn-sync-now").addEventListener("click", async () => {
  setSyncStatus("Đang đồng bộ...");
  const res = await chrome.runtime.sendMessage({ type: "SYNC_COOKIES", force: true });
  if (!res?.ok) return setSyncStatus(res?.error || "Lỗi đồng bộ.", true);
  setSyncStatus(`Đã gửi ${res.count} cookie lên Worker.`);
});

$("btn-sync-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

// --- Ẩn thông tin ---

const setHideStatus = (text, isError = false) => {
  $("hide-status").textContent = text;
  $("hide-status").classList.toggle("error", isError);
};

async function loadHideState() {
  const { hideFieldsEnabled, hiddenFields } = await chrome.storage.local.get(["hideFieldsEnabled", "hiddenFields"]);
  $("hide-toggle").checked = !!hideFieldsEnabled;
  const count = hiddenFields?.length || 0;
  setHideStatus(count ? `Đang ẩn ${count} trường.` : "Chưa chọn trường nào. Vào Cài đặt để chọn.");
}

$("hide-toggle").addEventListener("change", async () => {
  await chrome.storage.local.set({ hideFieldsEnabled: $("hide-toggle").checked });
  setHideStatus($("hide-toggle").checked ? "Đã bật. Tải lại trang để áp dụng." : "Đã tắt. Tải lại trang để áp dụng.");
});

$("btn-hide-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

// --- Khởi tạo ---

(async () => {
  const { studentName } = await chrome.storage.local.get("studentName");
  renderGreeting(studentName);
  renderLinks();
  loadSyncState();
  loadHideState();
})();
