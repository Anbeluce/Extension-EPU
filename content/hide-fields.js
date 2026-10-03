chrome.storage.local.get(["hideFieldsEnabled", "hideCSS"], ({ hideFieldsEnabled, hideCSS }) => {
  if (!hideFieldsEnabled || !hideCSS) return;
  const style = document.createElement("style");
  style.id = "tl-sv-hide";
  style.textContent = hideCSS;
  document.documentElement.append(style);
});
