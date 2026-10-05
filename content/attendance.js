// Tự kiểm tra điểm danh và báo khi số buổi nghỉ thay đổi.

async function fetchPageHtml(path) {
  try {
    const r = await fetch(location.origin + path, { credentials: "include" });
    const html = await r.text();
    if (html.includes("portlet-body")) return html;
  } catch { /* ignore */ }

  return new Promise((resolve) => {
    const id = "_atd_" + Math.random().toString(36).slice(2);
    let done = false;
    const onMsg = (e) => {
      if (e.data?.id !== id) return;
      window.removeEventListener("message", onMsg);
      done = true;
      resolve(e.data.html);
    };
    window.addEventListener("message", onMsg);
    const s = document.createElement("script");
    s.textContent = `fetch(${JSON.stringify(path)},{credentials:"include"}).then(r=>r.text()).then(html=>window.postMessage({id:${JSON.stringify(id)},html},"*")).catch(()=>window.postMessage({id:${JSON.stringify(id)},html:""},"*"))`;
    document.documentElement.append(s);
    s.remove();
    setTimeout(() => { if (!done) { window.removeEventListener("message", onMsg); resolve(""); } }, 10000);
  });
}

function parseAttendance(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = doc.querySelectorAll(".table-responsive table tbody tr");
  const data = [];
  let semester = "";
  for (const tr of rows) {
    const tds = tr.querySelectorAll("td");
    if (tr.classList.contains("row-head") && tds.length === 1 && tds[0].colSpan > 4) {
      semester = tds[0].textContent.trim();
      continue;
    }
    if (tds.length < 6 || !semester || tr.classList.contains("row-head")) continue;
    data.push({
      semester,
      code: tds[1].textContent.trim(),
      name: tds[2].textContent.trim(),
      credits: tds[3].textContent.trim(),
      excused: tds[4].textContent.trim(),
      unexcused: tds[5].textContent.trim(),
    });
  }
  return data;
}

function diffAttendance(oldData, newData) {
  const changes = [];
  const oldMap = new Map(oldData.map((d) => [d.code, d]));
  for (const n of newData) {
    const o = oldMap.get(n.code);
    if (!o) {
      changes.push(`Môn mới: ${n.name} (${n.semester})`);
    } else {
      if (o.excused !== n.excused)
        changes.push(`${n.name}: nghỉ CP ${o.excused} → ${n.excused}`);
      if (o.unexcused !== n.unexcused)
        changes.push(`${n.name}: nghỉ KP ${o.unexcused} → ${n.unexcused}`);
    }
  }
  return changes;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function notifyChanges(changes) {
  chrome.runtime.sendMessage({
    type: "SHOW_TOASTR",
    message: changes.map(escapeHtml).join("<br>"),
    title: "Điểm danh thay đổi!",
    options: {
      timeOut: 0, closeButton: true, progressBar: true, enableHtml: true,
      positionClass: "toast-top-right custom-toast-container",
      tapToDismiss: false, extendedTimeOut: 0,
    },
  });
}

async function runAttendanceCheck(force = false) {
  if (!currentMSSV) return { ok: false, error: "Chưa xác định được MSSV." };
  const keyData = `att_${currentMSSV}`;
  const keyTime = `attAt_${currentMSSV}`;

  if (!force) {
    const stored = await chrome.storage.local.get(keyTime);
    if (stored[keyTime] && Date.now() - stored[keyTime] < 30 * 60 * 1000) return { ok: true, changes: [] };
  }

  const html = await fetchPageHtml("/thong-tin-diem-danh.html");
  if (!html) return { ok: false, error: "Không tải được trang điểm danh." };

  const newData = parseAttendance(html);
  if (!newData.length) return { ok: false, error: "Không đọc được dữ liệu điểm danh." };

  const stored = await chrome.storage.local.get(keyData);
  const oldData = stored[keyData];
  let changes = [];
  if (oldData) {
    changes = diffAttendance(oldData, newData);
    if (changes.length) {
      notifyChanges(changes);
    }
  }

  await chrome.storage.local.set({ [keyData]: newData, [keyTime]: Date.now() });
  return { ok: true, changes };
}
