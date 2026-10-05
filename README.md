# Trợ lý Sinh viên (Chrome/Edge/Firefox, Manifest V3)

Extension hỗ trợ sinh viên thao tác nhanh trên web sinh viên EPU (`https://sv.epu.edu.vn`).

## Tính năng
- Liên kết nhanh tới các trang hay dùng (TKB, điểm, đăng ký tín chỉ...).
- Tra cứu giảng viên (trang riêng, mở từ popup; có nút Cài đặt ở góc trên).
- Thống kê % nghỉ học ngay trên trang dashboard của web sinh viên; tự kiểm tra điểm danh và báo khi có thay đổi.
- Xem/sửa/nhập/xuất cookie.
- Đồng bộ cookie đăng nhập lên Cloudflare Worker của bạn (tắt mặc định, cần cấp quyền khi bật).
- Ẩn thông tin cá nhân trên trang (họ tên, MSSV, CCCD...) theo lựa chọn trong Cài đặt.
- Quét QR bằng phím tắt **Alt+Q**: chụp màn hình, kéo chọn vùng có mã QR, extension giải mã và xử lý theo loại
  (liên kết → tự mở tab mới; Wi-Fi, VietQR, email, SĐT, vị trí, văn bản → hiện kết quả kèm nút sao chép/mở).
  Đổi phím tắt tại `chrome://extensions/shortcuts`.

## Cài đặt thử
1. Mở `chrome://extensions` (hoặc `edge://extensions`), bật **Developer mode**.
2. Chọn **Load unpacked** và trỏ tới thư mục này.
3. Trang Cài đặt tự mở lần đầu: kiểm tra địa chỉ web sinh viên.

## Quyền và quyền riêng tư
- Quyền cố định: `storage`, `activeTab`, `scripting`, `cookies`, `notifications` và truy cập `*://sv.epu.edu.vn/*`. Phải giữ cả `http`: cookie đăng nhập `ASC.AUTH` không có cờ Secure nên Chrome tính nó thuộc `http://sv.epu.edu.vn`; nếu chỉ cho `https`, `chrome.cookies` sẽ không thấy cookie và các tính năng cookie (xuất/sửa, đồng bộ) báo như chưa đăng nhập.
- Địa chỉ khác (ví dụ Worker đồng bộ cookie, hoặc web sinh viên ở domain khác) là **quyền tùy chọn**: trình duyệt hỏi khi bạn bật đồng bộ hoặc lưu địa chỉ đó trong Cài đặt. Chỉ chấp nhận `https://`.
- Các content script chỉ chạy trên `https://sv.epu.edu.vn`. Đổi địa chỉ web sinh viên sang domain khác chỉ ảnh hưởng popup và trang tra cứu giảng viên, không bật được content script ở domain đó.
- Dữ liệu lấy từ server luôn được đưa vào trang bằng `textContent`/DOM API (không dùng `innerHTML`); HTML của server (bảng chi tiết nghỉ) được lọc bỏ script và thuộc tính `on*`.

## Cấu trúc
- `manifest.json`: khai báo extension
- `config.js`: cấu hình mặc định và hàm dùng chung cho các trang extension (popup, cài đặt, tra cứu giảng viên, service worker)
- `shared/`: mã dùng chung cho content script và trang tra cứu giảng viên (`dom.js` dựng DOM an toàn, `teachers.js` logic giảng viên)
- `content/`: chạy trên trang web sinh viên, mỗi file một tính năng
  - `student-info.js` (đọc MSSV/họ tên), `attendance.js` (kiểm tra điểm danh), `absent-dashboard.js` (thống kê % nghỉ), `teachers.js` (tải sẵn danh sách giảng viên), `hide-fields.js` (ẩn thông tin)
  - `main.js`: khởi động các tác vụ nền (nạp sau cùng, thứ tự nạp khai báo trong `manifest.json`)
  - `qr-scan.js`: lớp phủ chọn vùng + giải mã + hiển thị kết quả QR (chèn khi bấm Alt+Q)
- `lib/jsQR.js`: thư viện giải mã QR (jsQR 1.4.0, Apache-2.0, kèm file license)
- `background/service-worker.js`: đồng bộ cookie, mở tab từ QR, xử lý phím tắt
- `popup/` (cookie, đồng bộ, ẩn thông tin, liên kết nhanh), `options/` (trang cài đặt), `teachers/` (trang tra cứu giảng viên)
- `icons/`: icon 16/32/48/128
- `tools/`: công cụ cho người phát triển, **không** đóng gói vào extension (`package.ps1`, `logo-source.png` là logo gốc 818px để tạo lại icon)
- `html/`, `.playwright-mcp/`: dữ liệu phân tích/thử nghiệm cục bộ, đã nằm trong `.gitignore`

## Đóng gói để phát hành
```powershell
powershell -ExecutionPolicy Bypass -File tools/package.ps1
```
Tạo `dist/tro-ly-sinh-vien-<version>.zip` chỉ gồm các file extension cần (không có `html/`, `tools/`, README...). Nhớ tăng `version` trong `manifest.json` trước khi phát hành bản mới.
