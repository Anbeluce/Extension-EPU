// Cookie Editor: xem/sửa/xoá/thêm cookie cho đúng domain web sinh viên đang cấu hình.
// Chạy như một trang của extension nên gọi thẳng chrome.cookies (đọc/ghi được cả HttpOnly).
const $ = (id) => document.getElementById(id);
const rowsEl = $("rows");

const say = (text, isError = false) => {
  $("msg").textContent = text;
  $("msg").classList.toggle("error", isError);
};

let portalUrl = "";

function toInputDate(expirationDate) {
  if (!expirationDate) return ""; // cookie phiên (session), không có ngày hết hạn
  return new Date(expirationDate * 1000).toISOString().slice(0, 16);
}

function fromInputDate(value) {
  return value ? Math.floor(new Date(value).getTime() / 1000) : undefined;
}

function renderRow(cookie = {}) {
  const tr = document.createElement("tr");
  if (!cookie.name) tr.classList.add("new-row");
  tr.innerHTML = `
    <td><input type="text" data-field="name" value="${cookie.name ?? ""}" ${cookie.name ? "readonly" : ""}></td>
    <td><input type="text" data-field="value" value="${cookie.value ?? ""}"></td>
    <td><input type="text" data-field="path" value="${cookie.path ?? "/"}"></td>
    <td><input type="datetime-local" data-field="expirationDate" value="${toInputDate(cookie.expirationDate)}"></td>
    <td class="flags">
      <label><input type="checkbox" data-field="httpOnly" ${cookie.httpOnly ? "checked" : ""}>HttpOnly</label>
      <label><input type="checkbox" data-field="secure" ${cookie.secure ? "checked" : ""}>Secure</label>
    </td>
    <td>
      <button class="save">Lưu</button>
      ${cookie.name ? '<button class="delete">Xoá</button>' : ""}
    </td>`;

  tr.querySelector(".save").addEventListener("click", () => saveRow(tr, cookie.name));
  tr.querySelector(".delete")?.addEventListener("click", () => deleteRow(cookie.name));
  return tr;
}

async function saveRow(tr, existingName) {
  const field = (name) => tr.querySelector(`[data-field="${name}"]`);
  const name = field("name").value.trim();
  if (!name) return say("Tên cookie không được để trống.", true);

  const details = {
    url: portalUrl,
    name,
    value: field("value").value,
    path: field("path").value || "/",
    httpOnly: field("httpOnly").checked,
    secure: field("secure").checked,
    expirationDate: fromInputDate(field("expirationDate").value)
  };

  try {
    // Nếu đổi tên (thêm mới) mà trùng cookie cũ có path khác, set() sẽ tự tạo/</>cập nhật đúng cookie.
    await chrome.cookies.set(details);
    say(`Đã lưu "${name}".`);
    await loadCookies();
  } catch (e) {
    say("Lỗi khi lưu: " + e.message, true);
  }
}

async function deleteRow(name) {
  if (!confirm(`Xoá cookie "${name}"?`)) return;
  try {
    await chrome.cookies.remove({ url: portalUrl, name });
    say(`Đã xoá "${name}".`);
    await loadCookies();
  } catch (e) {
    say("Lỗi khi xoá: " + e.message, true);
  }
}

async function loadCookies() {
  const cookies = await chrome.cookies.getAll({ url: portalUrl });
  rowsEl.replaceChildren(...cookies.map(renderRow));
  say(`${cookies.length} cookie.`);
}

$("btn-refresh").addEventListener("click", loadCookies);
$("btn-add").addEventListener("click", () => rowsEl.append(renderRow()));

(async () => {
  const { portalUrl: configured } = await getConfig();
  portalUrl = new URLSearchParams(location.search).get("url") || configured;
  $("domain-label").textContent = new URL(portalUrl).hostname;
  await loadCookies();
})();
