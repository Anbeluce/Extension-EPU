const $ = (id) => document.getElementById(id);
const say = (t) => { $("msg").textContent = t; };

let currentLinks = [];

function renderLinks() {
  const tbody = $("links-body");
  tbody.replaceChildren();
  currentLinks.forEach((link, i) => {
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    const tdUrl = document.createElement("td");
    const tdDel = document.createElement("td");
    tdName.textContent = link.name;
    tdUrl.textContent = link.url;
    const btn = document.createElement("button");
    btn.className = "btn-del";
    btn.textContent = "Xoá";
    btn.addEventListener("click", () => { currentLinks.splice(i, 1); renderLinks(); });
    tdDel.append(btn);
    tr.append(tdName, tdUrl, tdDel);
    tbody.append(tr);
  });
}

function renderHideFields(hiddenFields) {
  const container = $("hide-fields-list");
  container.replaceChildren();

  const actions = document.createElement("div");
  actions.className = "hide-actions";
  const btnAll = document.createElement("button");
  btnAll.textContent = "Chọn tất cả";
  btnAll.addEventListener("click", () => grid.querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = true));
  const btnNone = document.createElement("button");
  btnNone.textContent = "Bỏ tất cả";
  btnNone.addEventListener("click", () => grid.querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = false));
  actions.append(btnAll, btnNone);
  container.append(actions);

  const grid = document.createElement("div");
  grid.className = "hide-grid";
  for (const field of HIDEABLE_FIELDS) {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = field.id;
    cb.checked = hiddenFields.includes(field.id);
    label.append(cb, field.label);
    grid.append(label);
  }
  container.append(grid);
}

function getSelectedHideFields() {
  return [...$("hide-fields-list").querySelectorAll('input[type="checkbox"]:checked')].map(c => c.value);
}

function buildHideCSS(hiddenFields, customCSS) {
  const selectors = [];
  for (const fieldId of hiddenFields) {
    const field = HIDEABLE_FIELDS.find(f => f.id === fieldId);
    if (!field) continue;
    for (const lang of field.langs) {
      selectors.push(`span[lang="${lang}"] ~ span.bold`, `span[lang="${lang}"] ~ b`);
    }
    if (field.css) {
      selectors.push(...field.css);
    }
  }
  const hide = "opacity:0!important;visibility:hidden!important;user-select:none!important;pointer-events:none!important";
  let css = "";
  if (selectors.length) {
    css += selectors.join(",\n") + " { " + hide + " }\n";
  }
  if (customCSS) css += customCSS + "\n";
  return css;
}

async function load() {
  const config = await getConfig();
  $("portalUrl").value = config.portalUrl;
  currentLinks = [...(config.quickLinks || [])];
  renderLinks();

  const { hiddenFields, customHideCSS } = await chrome.storage.local.get(["hiddenFields", "customHideCSS"]);
  renderHideFields(hiddenFields || []);
  $("custom-hide-css").value = customHideCSS || "";

  $("sync-worker-url").value = config.cookieSync?.workerUrl || "";
  $("sync-user-name").value = config.cookieSync?.userName || "";

  const cal = calendarSettings(config);
  $("cal-enabled").checked = cal.enabled;
  $("cal-worker-url").value = cal.workerUrl;
  $("cal-from").value = cal.fromDate;
  $("cal-to").value = cal.toDate;
  renderCalendarStatus();
}

async function renderCalendarStatus() {
  const cal = calendarSettings(await getConfig());
  const { calendarStatus, calendarSyncedAt, studentMSSV } =
    await chrome.storage.local.get(["calendarStatus", "calendarSyncedAt", "studentMSSV"]);
  const el = $("cal-status");
  el.textContent = calendarStatus
    ? `${calendarStatus.message} (${new Date(calendarStatus.at).toLocaleString("vi-VN")})`
    : "Chưa đồng bộ lần nào.";
  el.classList.toggle("error", !!calendarStatus && !calendarStatus.ok);
  $("cal-link").value = calendarSyncedAt ? calendarLink(cal.workerUrl, studentMSSV) : "";
}

$("btn-add-link").addEventListener("click", () => {
  const name = $("link-name").value.trim();
  const url = $("link-url").value.trim();
  if (!name || !url) return say("Nhập tên và đường dẫn.");
  currentLinks.push({ name, url });
  $("link-name").value = "";
  $("link-url").value = "";
  renderLinks();
  say("Đã thêm. Nhớ bấm Lưu.");
});

const fail = (text) => { say(text); return null; };

// Trả về null nếu có lỗi (đã báo ra màn hình), ngược lại cho biết cấu hình lịch học có đổi không.
async function saveAll() {
  const oldConfig = await getConfig();
  const portalUrl = $("portalUrl").value.trim();
  const workerUrl = $("sync-worker-url").value.trim();
  const calEnabled = $("cal-enabled").checked;
  const calUrl = $("cal-worker-url").value.trim();
  if (!isHttps(portalUrl)) return fail("Địa chỉ web sinh viên phải bắt đầu bằng https://");
  if (workerUrl && !isHttps(workerUrl)) return fail("Worker URL phải bắt đầu bằng https://");
  if (calUrl && !isHttps(calUrl)) return fail("Địa chỉ Worker lịch phải bắt đầu bằng https://");
  if (calEnabled && !calUrl) return fail("Nhập địa chỉ Worker lịch rồi mới bật được đồng bộ lịch học.");

  const newCal = { enabled: calEnabled, workerUrl: calUrl, fromDate: $("cal-from").value, toDate: $("cal-to").value };
  const range = calendarRange(newCal);
  if (range.error) return fail(range.error);

  const perm = await ensureOriginPermission(portalUrl, oldConfig.cookieSync?.enabled && workerUrl, calEnabled && calUrl);
  if (!perm.ok) return fail(perm.error);

  const oldCal = calendarSettings(oldConfig);
  const config = {
    ...oldConfig,
    portalUrl,
    quickLinks: currentLinks,
    cookieSync: {
      ...(oldConfig.cookieSync || {}),
      workerUrl,
      userName: $("sync-user-name").value.trim(),
    },
    calendarSync: newCal,
  };
  await chrome.storage.sync.set({ config });
  const hiddenFields = getSelectedHideFields();
  const customHideCSS = $("custom-hide-css").value.trim();
  const hideCSS = buildHideCSS(hiddenFields, customHideCSS);
  await chrome.storage.local.set({ hiddenFields, customHideCSS, hideCSS });
  return { newCal, calChanged: JSON.stringify(oldCal) !== JSON.stringify(newCal) };
}

async function syncCalendarNow() {
  say("Đang đồng bộ lịch học...");
  const res = await chrome.runtime.sendMessage({ type: "SYNC_CALENDAR", force: true });
  await renderCalendarStatus();
  say(res?.ok ? "Đã đồng bộ lịch học." : (res?.error || "Không đồng bộ được lịch học."));
}

$("save").addEventListener("click", async () => {
  const saved = await saveAll();
  if (!saved) return;
  say("Đã lưu. Tải lại trang sv.epu.edu.vn để áp dụng.");
  if (saved.newCal.enabled && saved.calChanged) await syncCalendarNow();
});

$("btn-cal-sync").addEventListener("click", async () => {
  const saved = await saveAll();
  if (!saved) return;
  if (!saved.newCal.enabled) return say("Đã lưu. Hãy tick 'Bật đồng bộ lịch học' để đồng bộ.");
  await syncCalendarNow();
});

$("btn-cal-copy").addEventListener("click", async () => {
  const link = $("cal-link").value;
  if (!link) return say("Chưa có link. Hãy bật và đồng bộ lịch ít nhất một lần.");
  await navigator.clipboard.writeText(link);
  say("Đã sao chép link lịch .ics.");
});

$("reset").addEventListener("click", async () => {
  await chrome.storage.sync.remove("config");
  await load();
  say("Đã khôi phục mặc định.");
});

load();
