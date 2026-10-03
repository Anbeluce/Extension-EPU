# Trợ lý Sinh viên (Chrome/Edge, Manifest V3)

Extension hỗ trợ sinh viên thao tác nhanh trên web sinh viên của trường.

## Tính năng hiện có (bản khung)
- Đọc thông tin sinh viên (MSSV, họ tên, lớp, ngành) từ trang web sinh viên và lưu lại.
- Liên kết nhanh tới các trang hay dùng (TKB, điểm, đăng ký tín chỉ...).
- Đăng ký tín chỉ nhanh: nhập danh sách mã học phần, extension tự điền và tìm lần lượt.
  Mặc định chỉ điền và tìm; nút "Đăng ký" do sinh viên bấm (hoặc tick tùy chọn tự bấm).

## Cài đặt thử
1. Mở `chrome://extensions` (hoặc `edge://extensions`), bật **Developer mode**.
2. Chọn **Load unpacked** và trỏ tới thư mục này.
3. Trang Cài đặt tự mở lần đầu: nhập địa chỉ web sinh viên của trường.

## Việc cần làm để dùng được với trường của bạn
1. Sửa domain trong `manifest.json` (`host_permissions`, `content_scripts.matches`) từ `https://*.edu.vn/*` thành domain trường.
2. Dùng DevTools (F12 > Inspect) để lấy CSS selector thật của trang, rồi cập nhật trong Cài đặt (`profileSelectors`, `registerSelectors`).
3. (Tuỳ chọn) Thêm icon vào `icons/` và khai báo trong manifest.

## Cấu trúc
- `manifest.json`: khai báo extension
- `config.js`: cấu hình mặc định, dùng chung
- `content/content.js`: chạy trên trang web sinh viên (đọc dữ liệu, điền form)
- `background/service-worker.js`: lưu dữ liệu
- `popup/`: giao diện khi bấm biểu tượng (phím tắt Alt+S)
- `options/`: trang cài đặt
