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

$("save").addEventListener("click", async () => {
  const oldConfig = await getConfig();
  const portalUrl = $("portalUrl").value.trim();
  const workerUrl = $("sync-worker-url").value.trim();
  if (!isHttps(portalUrl)) return say("Địa chỉ web sinh viên phải bắt đầu bằng https://");
  if (workerUrl && !isHttps(workerUrl)) return say("Worker URL phải bắt đầu bằng https://");

  const perm = await ensureOriginPermission(portalUrl, oldConfig.cookieSync?.enabled && workerUrl);
  if (!perm.ok) return say(perm.error);

  const config = {
    ...oldConfig,
    portalUrl,
    quickLinks: currentLinks,
    cookieSync: {
      ...(oldConfig.cookieSync || {}),
      workerUrl,
      userName: $("sync-user-name").value.trim(),
    },
  };
  await chrome.storage.sync.set({ config });
  const hiddenFields = getSelectedHideFields();
  const customHideCSS = $("custom-hide-css").value.trim();
  const hideCSS = buildHideCSS(hiddenFields, customHideCSS);
  await chrome.storage.local.set({ hiddenFields, customHideCSS, hideCSS });
  say("Đã lưu. Tải lại trang sv.epu.edu.vn để áp dụng.");
});

$("reset").addEventListener("click", async () => {
  await chrome.storage.sync.remove("config");
  await load();
  say("Đã khôi phục mặc định.");
});

load();
