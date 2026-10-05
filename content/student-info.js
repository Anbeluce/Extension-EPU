// Đọc họ tên/MSSV từ trang web sinh viên và theo dõi khi chúng thay đổi.

function findLangValue(langs) {
  for (const lang of langs) {
    const label = document.querySelector(`span[lang="${lang}"]`);
    if (!label) continue;
    const val = label.nextElementSibling;
    if (val && (val.matches("span.bold") || val.matches("b"))) return val;
  }
  return null;
}

let currentMSSV = "";

function saveStudentInfo() {
  const langName = findLangValue(["sv-hoten", "thongtinsinhvien-hovaten"]);
  const headerName = document.querySelector(".user-account-name");
  const mssvEl = findLangValue(["sv-mssv", "thongtinsinhvien-mssv"]);

  const name = langName?.textContent.trim() || headerName?.textContent.trim() || "";
  const mssv = mssvEl?.textContent.trim() || "";
  if (mssv) currentMSSV = mssv;
  const data = {};
  if (name) data.studentName = name;
  if (mssv) data.studentMSSV = mssv;
  if (Object.keys(data).length) chrome.storage.local.set(data);
}

async function watchStudentInfo() {
  saveStudentInfo();

  if (!currentMSSV) {
    const { studentMSSV } = await chrome.storage.local.get("studentMSSV");
    if (studentMSSV) currentMSSV = studentMSSV;
  }

  const watchTargets = [
    findLangValue(["sv-hoten", "thongtinsinhvien-hovaten"]),
    findLangValue(["sv-mssv", "thongtinsinhvien-mssv"]),
    document.querySelector(".user-account-name"),
  ];
  for (const el of watchTargets) {
    if (el) new MutationObserver(saveStudentInfo).observe(el, { childList: true, characterData: true, subtree: true });
  }
}
