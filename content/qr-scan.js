// Quét QR: hiện ảnh chụp màn hình, người dùng kéo chọn vùng, giải mã bằng jsQR (lib/jsQR.js).
// Được service worker chèn vào tab khi bấm phím tắt, nên chạy được trên mọi trang.

(() => {
  if (window.__tlQrScan) return;
  window.__tlQrScan = true;

  const BANKS = {
    "970436": "Vietcombank", "970415": "VietinBank", "970418": "BIDV", "970405": "Agribank",
    "970422": "MB Bank", "970407": "Techcombank", "970416": "ACB", "970432": "VPBank",
    "970423": "TPBank", "970403": "Sacombank", "970437": "HDBank", "970441": "VIB",
    "970448": "OCB", "970426": "MSB", "970443": "SHB", "970431": "Eximbank",
  };

  const CSS = `
    .layer{position:fixed;left:0;top:0;width:100vw;height:100vh;overflow:hidden;cursor:crosshair;user-select:none;-webkit-user-select:none;touch-action:none}
    .shot{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}
    .dim{position:absolute;inset:0;background:rgba(0,0,0,.4)}
    .sel{display:none;position:absolute;box-sizing:border-box;border:2px solid #38bdf8;box-shadow:0 0 0 100vmax rgba(0,0,0,.45)}
    .hint{position:absolute;top:16px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:8px 14px;border-radius:8px;font:13px/1.4 system-ui,sans-serif;pointer-events:none}
    .panel{position:fixed;top:20px;right:20px;width:min(420px,calc(100vw - 40px));max-height:calc(100vh - 40px);overflow:auto;box-sizing:border-box;background:#fff;color:#111827;border:1px solid #d1d5db;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.25);padding:14px;font:13px/1.45 system-ui,sans-serif}
    .title{font-weight:600;font-size:14px;margin-bottom:8px}
    .note{color:#6b7280;margin-bottom:8px}
    .row{margin-bottom:10px}
    .lbl{color:#6b7280;font-size:12px;margin-bottom:2px}
    .line{display:flex;gap:8px;align-items:flex-start}
    .val{flex:1;min-width:0;word-break:break-all;white-space:pre-wrap;max-height:160px;overflow:auto;background:#f3f4f6;border-radius:6px;padding:6px 8px;font:12px/1.4 ui-monospace,Consolas,monospace}
    .btn{font:inherit;border:1px solid #d1d5db;background:#fff;color:#111827;border-radius:6px;padding:5px 10px;cursor:pointer;white-space:nowrap}
    .btn:hover{background:#f3f4f6}
    .btn.primary{background:#1d4ed8;border-color:#1d4ed8;color:#fff}
    .btn.primary:hover{background:#1e40af}
    .actions{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}
  `;

  let host = null;
  let root = null;
  let timer = 0;
  let lastShot = null;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "QR_START" && msg.dataUrl) startSelection(msg.dataUrl);
  });

  // ---------- DOM helpers (textContent only: nội dung QR là dữ liệu không tin cậy) ----------

  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    el.append(...kids.filter(Boolean));
    return el;
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }

  function mount() {
    unmount();
    host = document.createElement("div");
    host.style.cssText = "all:initial;position:fixed;top:0;left:0;z-index:2147483647";
    root = host.attachShadow({ mode: "closed" });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } catch {
      const st = document.createElement("style");
      st.textContent = CSS;
      root.append(st);
    }
    document.documentElement.append(host);
    window.addEventListener("keydown", onKey, true);
  }

  function unmount() {
    clearTimeout(timer);
    window.removeEventListener("keydown", onKey, true);
    host?.remove();
    host = root = null;
  }

  function close() {
    unmount();
    lastShot = null;
  }

  // ---------- Chọn vùng ----------

  async function startSelection(dataUrl) {
    lastShot = dataUrl;
    const img = new Image();
    img.src = dataUrl;
    try { await img.decode(); } catch { return; }

    mount();
    const dim = h("div", { class: "dim" });
    const sel = h("div", { class: "sel" });
    const hint = h("div", { class: "hint" }, "Kéo chọn vùng có mã QR · Esc để hủy");
    const layer = h("div", { class: "layer" },
      h("img", { class: "shot", src: dataUrl, draggable: "false" }), dim, sel, hint);
    root.append(layer);

    let start = null;
    const clamp = (v, max) => Math.min(Math.max(v, 0), max);
    const rectOf = (e) => {
      const x2 = clamp(e.clientX, window.innerWidth);
      const y2 = clamp(e.clientY, window.innerHeight);
      return {
        x: Math.min(start.x, x2), y: Math.min(start.y, y2),
        w: Math.abs(x2 - start.x), h: Math.abs(y2 - start.y),
      };
    };
    const draw = (r) => Object.assign(sel.style, {
      display: "block", left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px",
    });
    const reset = () => {
      start = null;
      sel.style.display = "none";
      dim.style.display = hint.style.display = "";
    };

    layer.addEventListener("mousedown", (e) => e.preventDefault());
    layer.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      layer.setPointerCapture(e.pointerId);
      start = { x: clamp(e.clientX, window.innerWidth), y: clamp(e.clientY, window.innerHeight) };
      dim.style.display = hint.style.display = "none";
      draw(rectOf(e));
    });
    layer.addEventListener("pointermove", (e) => { if (start) draw(rectOf(e)); });
    layer.addEventListener("pointercancel", reset);
    layer.addEventListener("pointerup", (e) => {
      if (!start) return;
      const r = rectOf(e);
      if (r.w < 8 || r.h < 8) return reset();
      layer.remove();
      const kx = img.naturalWidth / window.innerWidth;
      const ky = img.naturalHeight / window.innerHeight;
      const sx = Math.round(r.x * kx);
      const sy = Math.round(r.y * ky);
      const sw = Math.min(img.naturalWidth - sx, Math.round(r.w * kx));
      const sh = Math.min(img.naturalHeight - sy, Math.round(r.h * ky));
      // Cho trình duyệt vẽ lại trang trước khi giải mã (giải mã chạy đồng bộ).
      setTimeout(() => {
        const text = decode(img, sx, sy, sw, sh);
        if (text) showResult(text);
        else showNotFound();
      }, 0);
    });
  }

  // ---------- Giải mã ----------

  // Thêm viền (quiet zone) và thử nhiều tỉ lệ: người dùng thường kéo sát mã nên jsQR hay trượt nếu không có viền.
  function decode(img, sx, sy, sw, sh) {
    const pad = Math.max(16, Math.round(Math.min(sw, sh) * 0.15));
    for (const padColor of ["#fff", "#000"]) {
      const base = document.createElement("canvas");
      base.width = sw + pad * 2;
      base.height = sh + pad * 2;
      const bctx = base.getContext("2d", { willReadFrequently: true });
      bctx.fillStyle = padColor;
      bctx.fillRect(0, 0, base.width, base.height);
      bctx.drawImage(img, sx, sy, sw, sh, pad, pad, sw, sh);

      const scales = Math.max(base.width, base.height) < 500 ? [1, 2, 3] : [1, 0.5, 0.25];
      for (const s of scales) {
        const w = Math.round(base.width * s);
        const hh = Math.round(base.height * s);
        if (Math.min(w, hh) < 21 || Math.max(w, hh) > 2400) continue;
        let canvas = base;
        if (s !== 1) {
          canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = hh;
          canvas.getContext("2d").drawImage(base, 0, 0, w, hh);
        }
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const px = ctx.getImageData(0, 0, w, hh);
        const code = jsQR(px.data, w, hh, { inversionAttempts: "attemptBoth" });
        if (code?.data) return code.data;
      }
    }
    return null;
  }

  // ---------- Phân loại nội dung QR ----------

  function parseTlv(s) {
    const out = {};
    let i = 0;
    while (i + 4 <= s.length) {
      const len = parseInt(s.slice(i + 2, i + 4), 10);
      if (Number.isNaN(len) || i + 4 + len > s.length) return null;
      out[s.slice(i, i + 2)] = s.slice(i + 4, i + 4 + len);
      i += 4 + len;
    }
    return i === s.length ? out : null;
  }

  function parseVietQr(text) {
    if (!text.startsWith("000201")) return null;
    const top = parseTlv(text);
    const acct = top?.["38"] && parseTlv(top["38"]);
    const inner = acct?.["01"] && parseTlv(acct["01"]);
    if (!inner?.["00"] || !inner["01"]) return null;

    const bin = inner["00"];
    const rows = [
      ["Ngân hàng", BANKS[bin] ? `${BANKS[bin]} (${bin})` : `Mã BIN ${bin}`],
      [acct["02"] === "QRIBFTTC" ? "Số thẻ" : "Số tài khoản", inner["01"]],
    ];
    if (top["59"]) rows.push(["Tên đơn vị", top["59"]]);
    if (top["54"]) {
      const n = Number(top["54"]);
      rows.push(["Số tiền", Number.isFinite(n) ? n.toLocaleString("vi-VN") + " ₫" : top["54"]]);
    }
    const extra = top["62"] && parseTlv(top["62"]);
    if (extra?.["08"]) rows.push(["Nội dung", extra["08"]]);
    return { title: "VietQR chuyển khoản", rows, note: "Chỉ hiển thị thông tin, hãy mở app ngân hàng để thanh toán." };
  }

  function parseWifi(text) {
    const f = {};
    for (const part of text.slice(5).split(/(?<!\\);/)) {
      const m = part.match(/^([A-Za-z]):([\s\S]*)$/);
      if (m) f[m[1].toUpperCase()] = m[2].replace(/\\(.)/g, "$1");
    }
    const rows = [["Tên mạng", f.S || "(trống)"]];
    if (f.P) rows.push(["Mật khẩu", f.P]);
    if (f.T) rows.push(["Bảo mật", f.T]);
    if (f.H === "true") rows.push(["Mạng ẩn", "Có"]);
    return { title: "Wi-Fi", rows };
  }

  function classify(raw) {
    const text = raw.trim();
    const plain = { title: "Nội dung văn bản", rows: [["Nội dung", text]] };

    if (/^https?:\/\//i.test(text)) {
      try {
        const u = new URL(text);
        return { title: "Đã mở liên kết", rows: [["Địa chỉ", u.href]], open: { url: u.href }, auto: true };
      } catch { return plain; }
    }
    if (/^www\.\S+$/i.test(text)) {
      try {
        const u = new URL("https://" + text);
        return { title: "Đã mở liên kết", rows: [["Địa chỉ", u.href]], open: { url: u.href }, auto: true };
      } catch { return plain; }
    }
    if (/^WIFI:/i.test(text)) return parseWifi(text);

    const vietqr = parseVietQr(text);
    if (vietqr) return vietqr;

    const scheme = text.match(/^(mailto|tel|smsto|sms):/i)?.[1].toLowerCase();
    if (scheme) {
      const names = { mailto: ["Email", "Soạn email"], tel: ["Số điện thoại", "Gọi"], sms: ["Tin nhắn", "Soạn tin"], smsto: ["Tin nhắn", "Soạn tin"] };
      return { title: names[scheme][0], rows: [["Nội dung", text]], open: { url: text, label: names[scheme][1] } };
    }

    const geo = text.match(/^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
    if (geo) {
      return {
        title: "Vị trí", rows: [["Tọa độ", `${geo[1]}, ${geo[2]}`]],
        open: { url: `https://www.google.com/maps?q=${geo[1]},${geo[2]}`, label: "Mở bản đồ" },
      };
    }

    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(text)) {
      return { ...plain, open: { url: "https://" + text, label: "Mở như liên kết" } };
    }
    return plain;
  }

  // ---------- Hiển thị kết quả ----------

  function openLink(url) {
    if (/^https?:/i.test(url)) {
      chrome.runtime.sendMessage({ type: "QR_OPEN_URL", url }).catch(() => {});
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.click();
    }
  }

  async function copyText(value, btn) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      root.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    btn.textContent = "Đã chép";
    setTimeout(() => { btn.textContent = "Sao chép"; }, 1500);
  }

  function showPanel(children, autoClose) {
    mount();
    const panel = h("div", { class: "panel" }, ...children);
    root.append(panel);
    if (autoClose) {
      timer = setTimeout(close, 8000);
      panel.addEventListener("pointerenter", () => clearTimeout(timer));
    }
  }

  function showResult(text) {
    const info = classify(text);
    if (info.auto) openLink(info.open.url);

    const rows = info.rows.map(([label, value]) =>
      h("div", { class: "row" },
        h("div", { class: "lbl" }, label),
        h("div", { class: "line" },
          h("div", { class: "val" }, value),
          h("button", { class: "btn", onclick: (e) => copyText(value, e.currentTarget) }, "Sao chép"))));

    const actions = h("div", { class: "actions" },
      info.open && !info.auto
        ? h("button", { class: "btn primary", onclick: () => openLink(info.open.url) }, info.open.label || "Mở")
        : null,
      h("button", { class: "btn", onclick: () => lastShot && startSelection(lastShot) }, "Chọn lại"),
      h("button", { class: "btn", onclick: close }, "Đóng"));

    showPanel([
      h("div", { class: "title" }, info.title),
      info.note ? h("div", { class: "note" }, info.note) : null,
      ...rows,
      actions,
    ], info.auto);
  }

  function showNotFound() {
    showPanel([
      h("div", { class: "title" }, "Không tìm thấy mã QR"),
      h("div", { class: "note" }, "Hãy kéo chọn bao trọn mã QR, tránh vùng bị mờ hoặc lóa rồi thử lại."),
      h("div", { class: "actions" },
        h("button", { class: "btn primary", onclick: () => lastShot && startSelection(lastShot) }, "Chọn lại"),
        h("button", { class: "btn", onclick: close }, "Đóng")),
    ], false);
  }
})();
