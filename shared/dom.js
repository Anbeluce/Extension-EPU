// Tiện ích dựng DOM an toàn: chuỗi truyền vào luôn thành text, không bao giờ được phân tích thành HTML.
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  el.append(...kids.filter((k) => k != null && k !== false));
  return el;
}

// Dùng cho HTML do server trả về (vd. bảng chi tiết): bỏ script, iframe và mọi thuộc tính on*/javascript:.
function sanitizedNodes(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, iframe, object, embed, link, meta, base").forEach((n) => n.remove());
  for (const el of doc.body.querySelectorAll("*")) {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
  }
  return [...doc.body.childNodes].map((n) => document.importNode(n, true));
}
